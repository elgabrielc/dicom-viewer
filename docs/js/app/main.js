(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const config = window.CONFIG;
    const {
        $,
        folderZone,
        studiesTableHead,
        refreshLibraryBtn,
        libraryFolderInput,
        saveLibraryFolderBtn,
        canvas,
        slider,
        viewerView,
        resetViewBtn,
        prevBtn,
        nextBtn,
        backBtn,
        loadSampleCtBtn,
        loadSampleMriBtn
    } = app.dom;
    const { closeReportViewer } = app.notesReports;
    const { openHelpViewer, closeHelpViewer } = app.helpViewer;
    const {
        displayStudies,
        handleSortClick,
        loadLibraryConfig,
        refreshLibrary,
        saveLibraryFolderConfig,
        setLibraryFolderStatus
    } = app.library;
    const {
        closeViewer,
        loadSlice,
        openViewerWithSeries
    } = app.viewer;
    const {
        loadDroppedStudies,
        loadDroppedPaths,
        loadSampleStudies,
        loadStudiesFromApi
    } = app.sources;
    const {
        applyViewTransform,
        clearSliceMeasurements,
        deleteLastMeasurement,
        findMeasurementAtPoint,
        onCanvasMouseDown,
        onCanvasMouseMove,
        onCanvasMouseUp,
        resetView,
        screenToImage,
        setTool
    } = app.tools;

    const searchParams = new URLSearchParams(window.location.search);
    const isTestMode = searchParams.has('test');
    const noLib = searchParams.has('nolib');

    function abortLibraryLoad() {
        if (state.libraryAbort) {
            state.libraryAbort.abort();
            state.libraryAbort = null;
        }
    }

    function setDragActive(isActive) {
        folderZone.classList.toggle('dragover', isActive);
    }

    async function handleDroppedFolder(e) {
        e.preventDefault();
        setDragActive(false);
        abortLibraryLoad();

        try {
            state.studies = await loadDroppedStudies(e.dataTransfer.items);
            await displayStudies();
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    }

    async function handleTauriDrop(paths) {
        setDragActive(false);
        abortLibraryLoad();

        try {
            state.studies = await loadDroppedPaths(paths);
            await displayStudies();
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    }

    async function handleSampleLoad(samplePath, button, buttonLabel) {
        abortLibraryLoad();

        try {
            state.studies = await loadSampleStudies(samplePath, button, buttonLabel);
            await displayStudies();
        } catch (err) {
            alert(`Error loading sample: ${err.message}`);
        }
    }

    async function initializeTestMode() {
        console.log('Test mode enabled - loading test data from server');

        try {
            app.dom.uploadProgress.style.display = 'flex';
            app.dom.progressText.textContent = 'Loading test data...';
            app.dom.progressDetail.textContent = '';

            const result = await loadStudiesFromApi('/api/test-data');
            state.studies = result.studies;

            app.dom.uploadProgress.style.display = 'none';
            await displayStudies();

            const studyIds = Object.keys(state.studies);
            if (studyIds.length === 0) return;

            const firstStudy = state.studies[studyIds[0]];
            const seriesIds = Object.keys(firstStudy.series);
            if (seriesIds.length === 0) return;

            console.log('Auto-opening first series for testing');
            openViewerWithSeries(studyIds[0], seriesIds[0]);

            const maxSkip = 50;
            for (let i = 0; i < maxSkip && state.currentSeries; i++) {
                if (state.baseWindowLevel.center !== null) {
                    console.log(`Found non-blank slice at index ${state.currentSliceIndex}`);
                    break;
                }
                if (state.currentSliceIndex < state.currentSeries.slices.length - 1) {
                    await loadSlice(state.currentSliceIndex + 1);
                } else {
                    break;
                }
            }
        } catch (e) {
            console.error('Failed to load test data:', e);
            app.dom.uploadProgress.style.display = 'none';
            alert(`Failed to load test data: ${e.message}`);
        }
    }

    function initializeLibraryAutoLoad() {
        if (config?.deploymentMode === 'desktop') {
            initializeDesktopLibrary();
            return;
        }

        const libraryConfigPromise = loadLibraryConfig().catch(e => {
            state.libraryConfigReachable = false;
            setLibraryFolderStatus('');
            console.warn('Failed to load library config:', e);
            return null;
        });

        state.libraryAbort = new AbortController();
        loadStudiesFromApi('/api/library', { signal: state.libraryAbort.signal })
            .then(async result => {
                state.libraryAbort = null;
                await libraryConfigPromise;
                state.libraryAvailable = !!result.available;
                if (result.folder) state.libraryFolder = result.folder;
                state.studies = result.studies;
                await displayStudies();
            })
            .catch(async e => {
                state.libraryAbort = null;
                await libraryConfigPromise;
                if (e.name === 'AbortError') return;
                await displayStudies();
            });
    }

    async function initializeDesktopLibrary() {
        try {
            await loadLibraryConfig();
            if (!state.libraryFolder) {
                await displayStudies();
                return;
            }

            const files = await app.desktopLibrary.scanFolder(state.libraryFolder);
            state.studies = await app.sources.processFilesFromSources(files);
            state.libraryAvailable = true;
            app.desktopLibrary.markScanComplete(state.libraryFolder);
        } catch (e) {
            console.warn('Failed to auto-load desktop library:', e);
        }

        await displayStudies();
    }

    function initializeDesktopMenuBridge() {
        const eventApi = window.__TAURI__?.event;
        if (!eventApi?.listen) return;

        eventApi.listen('desktop://open-folder', () => {
            saveLibraryFolderConfig();
        }).catch(err => {
            console.warn('Failed to register desktop open-folder menu handler:', err);
        });

        eventApi.listen('desktop://open-help', () => {
            openHelpViewer();
        }).catch(err => {
            console.warn('Failed to register desktop help menu handler:', err);
        });
    }

    studiesTableHead.addEventListener('click', handleSortClick);
    studiesTableHead.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSortClick(e);
        }
    });

    if (config?.deploymentMode === 'desktop') {
        initializeDesktopMenuBridge();
        window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(event => {
            const payload = event.payload;
            if (payload.type === 'enter' || payload.type === 'over') {
                setDragActive(true);
            } else if (payload.type === 'drop') {
                handleTauriDrop(payload.paths);
            } else if (payload.type === 'leave' || payload.type === 'cancel') {
                setDragActive(false);
            }
        }).catch(err => {
            console.warn('Failed to register Tauri drag-drop handler:', err);
        });
    } else {
        folderZone.addEventListener('dragover', e => {
            e.preventDefault();
            setDragActive(true);
        });
        folderZone.addEventListener('dragleave', e => {
            e.preventDefault();
            setDragActive(false);
        });
        folderZone.addEventListener('drop', handleDroppedFolder);
    }

    backBtn.onclick = e => {
        e.preventDefault();
        closeViewer();
    };
    slider.oninput = () => loadSlice(parseInt(slider.value, 10));
    prevBtn.onclick = () => {
        if (state.currentSliceIndex > 0) {
            loadSlice(state.currentSliceIndex - 1);
        }
    };
    nextBtn.onclick = () => {
        if (state.currentSeries && state.currentSliceIndex < state.currentSeries.slices.length - 1) {
            loadSlice(state.currentSliceIndex + 1);
        }
    };

    loadSampleCtBtn.onclick = () => handleSampleLoad('sample', loadSampleCtBtn, 'CT Scan');
    loadSampleMriBtn.onclick = () => handleSampleLoad('sample-mri', loadSampleMriBtn, 'MRI Scan');

    document.addEventListener('keydown', e => {
        const activeElement = document.activeElement;
        const activeTag = activeElement ? activeElement.tagName : '';
        const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || !!activeElement?.isContentEditable;

        if (!isTyping && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            openHelpViewer();
            return;
        }

        if (e.key === 'Escape' && $('helpViewer').style.display !== 'none') {
            closeHelpViewer();
            return;
        }

        if (viewerView.style.display === 'none') return;

        if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && state.currentTool === 'measure') {
            e.preventDefault();
            if (e.shiftKey) {
                clearSliceMeasurements();
            } else {
                deleteLastMeasurement();
            }
            return;
        }

        if (!isTyping) {
            switch (e.key.toLowerCase()) {
                case 'w':
                    setTool('wl');
                    return;
                case 'p':
                    setTool('pan');
                    return;
                case 'z':
                    setTool('zoom');
                    return;
                case 'm':
                    setTool('measure');
                    return;
                case 'r':
                    resetView();
                    return;
            }
        }

        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (state.currentSliceIndex > 0) {
                loadSlice(state.currentSliceIndex - 1);
            }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (state.currentSeries && state.currentSliceIndex < state.currentSeries.slices.length - 1) {
                loadSlice(state.currentSliceIndex + 1);
            }
        } else if (e.key === 'Escape') {
            if ($('reportViewer').style.display !== 'none') {
                closeReportViewer();
            } else {
                closeViewer();
            }
        }
    });

    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('mouseup', onCanvasMouseUp);
    canvas.addEventListener('mouseleave', onCanvasMouseUp);
    canvas.addEventListener('contextmenu', e => {
        if (state.currentTool !== 'measure') return;

        e.preventDefault();
        const imageCoords = screenToImage(e.clientX, e.clientY);
        const measurement = findMeasurementAtPoint(imageCoords.x, imageCoords.y);
        if (measurement) {
            app.tools.deleteMeasurement(measurement.id);
        }
    });
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        if (state.currentTool === 'zoom') {
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            state.viewTransform.zoom = Math.max(0.1, Math.min(10, state.viewTransform.zoom + delta));
            applyViewTransform();
            return;
        }

        if (e.deltaY > 0) {
            if (state.currentSeries && state.currentSliceIndex < state.currentSeries.slices.length - 1) {
                loadSlice(state.currentSliceIndex + 1);
            }
        } else if (state.currentSliceIndex > 0) {
            loadSlice(state.currentSliceIndex - 1);
        }
    });

    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
    resetViewBtn.addEventListener('click', resetView);
    $('closeReportViewer').addEventListener('click', closeReportViewer);
    $('closeHelpViewer').addEventListener('click', closeHelpViewer);
    document.querySelectorAll('.help-btn').forEach(btn => {
        btn.addEventListener('click', openHelpViewer);
    });

    refreshLibraryBtn.addEventListener('click', refreshLibrary);
    saveLibraryFolderBtn.addEventListener('click', saveLibraryFolderConfig);
    libraryFolderInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveLibraryFolderConfig();
        }
    });

    setTool(state.currentTool);

    if (isTestMode) {
        initializeTestMode();
    } else if (config?.features?.libraryAutoLoad && !noLib) {
        initializeLibraryAutoLoad();
    } else {
        displayStudies();
    }
})();
