(async () => {
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
    const { closeReportViewer } = app.reportsUi;
    const { openHelpViewer, closeHelpViewer } = app.helpViewer;
    const {
        applyDesktopLibraryScan,
        applyDesktopLibrarySnapshot,
        displayStudies,
        handleSortClick,
        loadLibraryConfig,
        refreshLibrary,
        saveLibraryFolderConfig,
        setLibraryFolderMessage,
        setLibraryFolderStatus,
        updateDesktopScanMessage
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

        if (state.managedLibrary) {
            state.libraryAbort = new AbortController();
            try {
                const result = await app.desktopLibrary.runImport(paths, {
                    signal: state.libraryAbort.signal
                });

                // Re-scan the managed library folder to update state.studies
                const libraryPath = await app.importPipeline.getLibraryPath();
                state.studies = await app.desktopLibrary.loadStudies(libraryPath);
                await displayStudies();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    alert(`Error: ${err.message}`);
                }
            } finally {
                state.libraryAbort = null;
            }
            return;
        }

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

    function pickTestModeStudySeries(studies) {
        const candidates = [];

        for (const [studyUid, study] of Object.entries(studies || {})) {
            for (const [seriesUid, series] of Object.entries(study.series || {})) {
                candidates.push({
                    studyUid,
                    seriesUid,
                    sliceCount: series.slices?.length || 0,
                    imageCount: Number(study.imageCount) || 0
                });
            }
        }

        if (!candidates.length) {
            return null;
        }

        candidates.sort((a, b) => {
            return b.sliceCount - a.sliceCount ||
                b.imageCount - a.imageCount ||
                a.studyUid.localeCompare(b.studyUid) ||
                a.seriesUid.localeCompare(b.seriesUid);
        });

        return candidates[0];
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

            const selection = pickTestModeStudySeries(state.studies);
            if (!selection) return;

            console.log(
                `Auto-opening test series ${selection.seriesUid} from study ${selection.studyUid} (${selection.sliceCount} slices)`
            );
            openViewerWithSeries(selection.studyUid, selection.seriesUid);

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

    async function waitForDesktopRuntime() {
        const runtime = window.__TAURI__;
        if (runtime?.fs?.readFile && runtime?.path?.appDataDir && runtime?.path?.join) {
            return runtime;
        }

        const ready = window.__DICOM_VIEWER_TAURI_STORAGE_READY__ || window.__DICOM_VIEWER_TAURI_READY__;
        if (ready && typeof ready.then === 'function') {
            const resolved = await ready;
            if (resolved?.fs?.readFile && resolved?.path?.appDataDir && resolved?.path?.join) {
                return resolved;
            }
        }

        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
            const current = window.__TAURI__;
            if (current?.fs?.readFile && current?.path?.appDataDir && current?.path?.join) {
                return current;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        return window.__TAURI__ || null;
    }

    async function initializeDesktopLibrary() {
        try {
            const runtime = await waitForDesktopRuntime();
            if (!runtime?.fs || !runtime?.path) {
                throw new Error('Desktop runtime is not ready yet.');
            }

            const desktopConfig = await app.desktopLibrary.getConfig();
            state.managedLibrary = desktopConfig.managedLibrary === true;

            // Apply config to library UI (folder input, status indicators)
            await loadLibraryConfig();

            if (state.managedLibrary) {
                // Managed library mode: load studies from the import pipeline's library path
                const libraryPath = await app.importPipeline.getLibraryPath();

                const cachedStudies = await app.desktopLibrary.loadCachedStudies(libraryPath);
                if (cachedStudies && Object.keys(cachedStudies).length > 0) {
                    await applyDesktopLibrarySnapshot(libraryPath, cachedStudies);
                    setLibraryFolderMessage('Showing cached library while refreshing...', 'info');
                } else {
                    setLibraryFolderMessage('Loading managed library...', 'info');
                }
                await displayStudies();

                const loadLabel = cachedStudies && Object.keys(cachedStudies).length > 0
                    ? 'Refreshing managed library...'
                    : 'Loading managed library...';
                const studies = await app.desktopLibrary.loadStudies(libraryPath, {
                    onProgress: stats => updateDesktopScanMessage(stats, loadLabel)
                });
                await applyDesktopLibraryScan(libraryPath, studies);
            } else {
                // Direct scan mode: existing behavior
                if (!state.libraryFolder) {
                    await displayStudies();
                    return;
                }

                const cachedStudies = await app.desktopLibrary.loadCachedStudies(state.libraryFolder);
                if (cachedStudies && Object.keys(cachedStudies).length > 0) {
                    await applyDesktopLibrarySnapshot(state.libraryFolder, cachedStudies);
                    setLibraryFolderMessage('Showing cached library while refreshing...', 'info');
                } else {
                    setLibraryFolderMessage('Loading saved library folder...', 'info');
                }
                await displayStudies();

                const loadLabel = cachedStudies && Object.keys(cachedStudies).length > 0
                    ? 'Refreshing saved library folder...'
                    : 'Loading saved library folder...';
                const studies = await app.desktopLibrary.loadStudies(state.libraryFolder, {
                    onProgress: stats => updateDesktopScanMessage(stats, loadLabel)
                });
                await applyDesktopLibraryScan(state.libraryFolder, studies);
            }
        } catch (e) {
            try { await app.desktopLibrary.markScanFailed(state.libraryFolder); } catch {}
            state.libraryAvailable = !!state.libraryFolder;
            setLibraryFolderMessage(e.message || 'Failed to auto-load desktop library.', 'error');
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

        eventApi.listen('desktop://show-library-in-finder', async () => {
            try {
                if (!state.managedLibrary || !app.importPipeline?.getLibraryPath) return;
                const libraryPath = await app.importPipeline.getLibraryPath();
                await window.__TAURI__?.core?.invoke('reveal_in_finder', { path: libraryPath });
            } catch (err) {
                console.warn('Failed to reveal library in Finder:', err);
            }
        }).catch(err => {
            console.warn('Failed to register desktop show-library-in-finder menu handler:', err);
        });
    }

    async function initializeDesktopRuntimeBridge() {
        const runtime = await waitForDesktopRuntime();
        if (!runtime) {
            console.warn('Desktop runtime APIs unavailable at startup; continuing without native bridge.');
            return;
        }

        initializeDesktopMenuBridge();

        const currentWebview = runtime.webview?.getCurrentWebview?.();
        const registerDragDrop = currentWebview?.onDragDropEvent;
        if (typeof registerDragDrop !== 'function') {
            console.warn('Desktop drag-drop API unavailable at startup; continuing without native drag events.');
            return;
        }

        await registerDragDrop.call(currentWebview, event => {
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
    }

    studiesTableHead.addEventListener('click', handleSortClick);
    studiesTableHead.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSortClick(e);
        }
    });

    if (config?.deploymentMode === 'desktop') {
        initializeDesktopRuntimeBridge();
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

    // ---- Sync engine bootstrap ----
    //
    // The SyncEngine is created and owned by account-ui.js, which has the
    // proper token lifecycle (getValidAccessToken with refresh). main.js
    // only exposes a thin helper and handles graceful shutdown. This avoids
    // dual engines polling the same endpoint with divergent auth state.

    /**
     * Start the sync engine if an auth token is present.
     * Delegates to the single SyncEngine instance owned by account-ui.js
     * (exposed at app.syncEngine / window.syncEngine).
     */
    function startSyncIfAuthenticated() {
        const engine = app.syncEngine || window.syncEngine;
        if (engine && !engine.isRunning) {
            engine.start();
        }
    }
    window.startSyncIfAuthenticated = startSyncIfAuthenticated;

    // Graceful shutdown: stop sync engine before page unloads to avoid
    // orphaned network requests.
    window.addEventListener('beforeunload', () => {
        const engine = app.syncEngine || window.syncEngine;
        if (engine) {
            engine.stop();
        }
    });

    // ---- App initialization ----

    if (isTestMode) {
        initializeTestMode();
    } else if (config?.features?.libraryAutoLoad && !noLib) {
        initializeLibraryAutoLoad();
    } else {
        displayStudies();
    }
})();
