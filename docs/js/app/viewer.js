(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const config = window.CONFIG;
    const {
        libraryView,
        viewerView,
        canvas,
        slider,
        sliceInfo,
        seriesList,
        metadataContent,
        studyTitle,
        imageLoading,
        prevBtn,
        nextBtn
    } = app.dom;
    const { escapeHtml } = app.utils;
    const { toDicomByteArray } = app.dicom;
    const {
        decodeWithFallback,
        renderDecodeError,
        renderPixels
    } = app.rendering;
    const { readSliceBuffer, getSliceCacheKey } = app.sources;
    const {
        resetViewForNewSeries,
        updateWLDisplay
    } = app.tools;

    const VIEWER_PRELOAD_RADIUS = config?.deploymentMode === 'desktop' ? 1 : 3;
    let loadGeneration = 0;
    let activeLoadRequestId = 0;
    const inFlightLoads = new Map();

    function beginLoadGeneration() {
        loadGeneration += 1;
        activeLoadRequestId += 1;
        inFlightLoads.clear();
    }

    function isLoadStale(generation, requestId, series) {
        return generation !== loadGeneration
            || requestId !== activeLoadRequestId
            || state.currentSeries !== series;
    }

    function renderDecodedSlice(decoded, wlOverride = null, options = {}) {
        const { displayErrors = true } = options;
        if (!decoded) {
            return renderDecodeError(
                {
                    error: true,
                    errorMessage: 'Image decode failed',
                    errorDetails: 'Unknown decode error'
                },
                { display: displayErrors }
            );
        }
        if (decoded.error) {
            return renderDecodeError(decoded, { display: displayErrors });
        }
        return renderPixels(decoded, wlOverride);
    }

    async function getDecodedSlice(slice, index, purpose, generation, options = {}) {
        const { requestId = null, series = null } = options;
        const isStale = () => generation !== loadGeneration
            || (requestId !== null && requestId !== activeLoadRequestId)
            || (series && state.currentSeries !== series);
        const cacheKey = getSliceCacheKey(slice, index);
        if (cacheKey && state.sliceCache.has(cacheKey)) {
            return state.sliceCache.get(cacheKey);
        }

        if (cacheKey && inFlightLoads.has(cacheKey)) {
            return inFlightLoads.get(cacheKey);
        }

        const loadPromise = (async () => {
            const buf = await readSliceBuffer(slice, purpose);
            if (isStale()) return null;

            const byteArray = await toDicomByteArray(buf);
            if (isStale()) return null;

            const dataSet = dicomParser.parseDicom(byteArray);
            if (isStale()) return null;

            const decoded = await decodeWithFallback(dataSet, slice.frameIndex || 0, slice);
            if (isStale()) return null;

            if (decoded && !decoded.error && cacheKey) {
                state.sliceCache.set(cacheKey, decoded);
            }

            return decoded || null;
        })();

        if (cacheKey) {
            inFlightLoads.set(cacheKey, loadPromise);
            loadPromise.finally(() => {
                if (inFlightLoads.get(cacheKey) === loadPromise) {
                    inFlightLoads.delete(cacheKey);
                }
            });
        }

        return loadPromise;
    }

    function preloadNearbySlices(slices, index, generation, requestId, series) {
        if (isLoadStale(generation, requestId, series)) {
            return;
        }

        for (let i = index - VIEWER_PRELOAD_RADIUS; i <= index + VIEWER_PRELOAD_RADIUS; i++) {
            if (i < 0 || i >= slices.length) continue;

            const preloadSlice = slices[i];
            const preloadCacheKey = getSliceCacheKey(preloadSlice, i);
            if (!preloadCacheKey || state.sliceCache.has(preloadCacheKey) || inFlightLoads.has(preloadCacheKey)) {
                continue;
            }

            getDecodedSlice(preloadSlice, i, 'preload', generation).catch(() => {});
        }
    }

    function updateSliceMetadata(info, slice, index, totalSlices) {
        if (info && info.isBlank) {
            metadataContent.innerHTML = `
                <div class="metadata-item"><div class="label">Slice</div><div class="value">${index + 1} / ${totalSlices}</div></div>
                <div class="metadata-item"><div class="label">Modality</div><div class="value">${escapeHtml(info.modality || '-')}</div></div>
                <div class="metadata-item"><div class="label">Size</div><div class="value">${info.cols} x ${info.rows}</div></div>
                <div class="metadata-item"><div class="label">Location</div><div class="value">${slice.sliceLocation?.toFixed(2) || '-'} mm</div></div>
            `;
            return;
        }

        if (info && !info.error) {
            let metadataHtml = `
                <div class="metadata-item"><div class="label">Slice</div><div class="value">${index + 1} / ${totalSlices}</div></div>
                <div class="metadata-item"><div class="label">Modality</div><div class="value">${escapeHtml(info.modality || '-')}</div></div>
                <div class="metadata-item"><div class="label">Size</div><div class="value">${info.cols} x ${info.rows}</div></div>
                <div class="metadata-item"><div class="label">Location</div><div class="value">${slice.sliceLocation?.toFixed(2) || '-'} mm</div></div>
                <div class="metadata-item"><div class="label">Window</div><div class="value">C:${info.wc} W:${info.ww}</div></div>
            `;

            if (info.modality === 'MR' && info.mrMetadata) {
                const mr = info.mrMetadata;
                metadataHtml += '<div class="metadata-divider"></div>';

                if (mr.protocolName) {
                    metadataHtml += `<div class="metadata-item"><div class="label">Protocol</div><div class="value">${escapeHtml(mr.protocolName)}</div></div>`;
                }
                if (mr.sequenceName) {
                    metadataHtml += `<div class="metadata-item"><div class="label">Sequence</div><div class="value">${escapeHtml(mr.sequenceName)}</div></div>`;
                }
                if (mr.repetitionTime) {
                    metadataHtml += `<div class="metadata-item"><div class="label">TR</div><div class="value">${mr.repetitionTime.toFixed(1)} ms</div></div>`;
                }
                if (mr.echoTime) {
                    metadataHtml += `<div class="metadata-item"><div class="label">TE</div><div class="value">${mr.echoTime.toFixed(1)} ms</div></div>`;
                }
                if (mr.flipAngle) {
                    metadataHtml += `<div class="metadata-item"><div class="label">Flip Angle</div><div class="value">${escapeHtml(mr.flipAngle)}°</div></div>`;
                }
                if (mr.magneticFieldStrength) {
                    metadataHtml += `<div class="metadata-item"><div class="label">Field</div><div class="value">${escapeHtml(mr.magneticFieldStrength)}T</div></div>`;
                }
            }

            metadataContent.innerHTML = metadataHtml;
            return;
        }

        if (info && info.error) {
            metadataContent.innerHTML = `
                <div class="metadata-item"><div class="label">Slice</div><div class="value">${index + 1} / ${totalSlices}</div></div>
                <div class="metadata-item"><div class="label">Status</div><div class="value" style="color: #f0ad4e;">Decode Error</div></div>
                <div class="metadata-item"><div class="label">Format</div><div class="value">${info.tsInfo?.name || 'Unknown'}</div></div>
            `;
        }
    }

    async function loadSlice(index) {
        if (!state.currentSeries) return;
        const series = state.currentSeries;
        const slices = series.slices;
        if (index < 0 || index >= slices.length) return;
        const generation = loadGeneration;
        const requestId = ++activeLoadRequestId;

        state.currentSliceIndex = index;
        updateSliceInfo();
        imageLoading.style.display = 'block';

        try {
            const slice = slices[index];
            let decoded = await getDecodedSlice(slice, index, 'load', generation, { requestId, series });
            if (!decoded && !isLoadStale(generation, requestId, series)) {
                decoded = await getDecodedSlice(slice, index, 'load', generation, { requestId, series });
            }
            if (isLoadStale(generation, requestId, series)) {
                return;
            }

            const wlOverride = (state.windowLevel.center !== null && state.windowLevel.width !== null)
                ? state.windowLevel
                : null;
            const info = renderDecodedSlice(decoded, wlOverride);

            updateWLDisplay();
            updateSliceMetadata(info, slice, index, slices.length);
            if (isLoadStale(generation, requestId, series)) {
                return;
            }
            preloadNearbySlices(slices, index, generation, requestId, series);
        } catch (e) {
            console.error('Error loading slice:', e);
            if (!isLoadStale(generation, requestId, series)) {
                const errorInfo = renderDecodedSlice(
                    {
                        error: true,
                        errorMessage: 'Image decode failed',
                        errorDetails: e.message || 'Unknown decode error'
                    },
                    null
                );
                updateSliceMetadata(errorInfo, slices[index], index, slices.length);
            }
        } finally {
            if (requestId === activeLoadRequestId) {
                imageLoading.style.display = 'none';
            }
        }
    }

    function updateSliceInfo() {
        const total = state.currentSeries?.slices.length || 0;
        sliceInfo.textContent = `${state.currentSliceIndex + 1} / ${total}`;
        slider.value = state.currentSliceIndex;
        prevBtn.disabled = state.currentSliceIndex <= 0;
        nextBtn.disabled = state.currentSliceIndex >= total - 1;
    }

    function selectSeries(seriesUid) {
        beginLoadGeneration();
        state.currentSeries = state.currentStudy.series[seriesUid];
        state.sliceCache.clear();
        state.currentSliceIndex = 0;
        resetViewForNewSeries();

        document.querySelectorAll('.series-item').forEach(el => {
            el.classList.toggle('active', el.dataset.uid === seriesUid);
        });

        slider.max = Math.max(0, state.currentSeries.slices.length - 1);
        slider.value = 0;
        loadSlice(0);
    }

    function openViewer(studyUid, initialSeriesUid = null) {
        state.currentStudy = state.studies[studyUid];
        if (!state.currentStudy) return;

        studyTitle.textContent = `${state.currentStudy.patientName || 'Unknown'} - ${state.currentStudy.studyDescription || 'Study'}`;

        const seriesArr = Object.values(state.currentStudy.series);
        seriesList.innerHTML = seriesArr.map(series => `
            <div class="series-item" data-uid="${escapeHtml(series.seriesInstanceUid)}">
                <div class="series-name">${escapeHtml(series.seriesDescription || 'Series ' + (series.seriesNumber || '?'))}</div>
                <div class="series-info">${series.slices.length} slices</div>
            </div>
        `).join('');

        seriesList.querySelectorAll('.series-item').forEach(el => {
            el.onclick = () => selectSeries(el.dataset.uid);
        });

        libraryView.style.display = 'none';
        viewerView.style.display = 'flex';
        document.body.classList.add('viewer-page');

        const seriesUidToSelect = initialSeriesUid && state.currentStudy.series[initialSeriesUid]
            ? initialSeriesUid
            : (seriesArr.length ? seriesArr[0].seriesInstanceUid : null);
        if (seriesUidToSelect) {
            selectSeries(seriesUidToSelect);
        }
    }

    function openViewerWithSeries(studyUid, seriesUid) {
        openViewer(studyUid, seriesUid);
    }

    function closeViewer() {
        beginLoadGeneration();
        viewerView.style.display = 'none';
        libraryView.style.display = 'block';
        document.body.classList.remove('viewer-page');
        state.currentStudy = null;
        state.currentSeries = null;
        state.sliceCache.clear();
        state.measurements.clear();
        state.activeMeasurement = null;
        state.pixelSpacing = null;
        imageLoading.style.display = 'none';
        canvas.style.transform = '';
    }

    app.viewer = {
        closeViewer,
        loadSlice,
        openViewer,
        openViewerWithSeries,
        selectSeries
    };
})();
