(() => {
    const app = window.DicomViewerApp || {};
    window.DicomViewerApp = app;
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
        nextBtn,
    } = app.dom;
    const { escapeHtml } = app.utils;
    const { toDicomByteArray } = app.dicom;
    const {
        decodeWithFallback,
        decodeDesktopPathWithHeader,
        emitDesktopDecodeTrace,
        getActiveDecodeMode,
        isViewerPreloadEnabled,
        renderDecodeError,
        renderPixels,
    } = app.rendering;
    const { readSliceBuffer, getSliceCacheKey } = app.sources;
    const { resetViewForNewSeries, updateWLDisplay } = app.tools;

    const VIEWER_PRELOAD_RADIUS = config?.deploymentMode === 'desktop' ? 1 : 3;
    const MAX_SHARED_PATH_DATASETS = 1;
    let loadGeneration = 0;
    let activeLoadRequestId = 0;
    const inFlightLoads = new Map();
    const sharedPathDataSets = new Map();
    let foregroundLoadTask = null;
    let pendingForegroundLoad = null;
    let preloadTask = null;
    let pendingPreloads = [];
    let preloadContext = null;

    function resolveQueuedLoad(request, value = null) {
        if (typeof request?.resolve === 'function') {
            request.resolve(value);
            request.resolve = null;
        }
    }

    function clearPendingForegroundLoad() {
        resolveQueuedLoad(pendingForegroundLoad, null);
        pendingForegroundLoad = null;
    }

    function clearPendingPreloads() {
        pendingPreloads = [];
        preloadContext = null;
    }

    function clearSharedPathDataSets() {
        sharedPathDataSets.clear();
    }

    function beginLoadGeneration() {
        loadGeneration += 1;
        activeLoadRequestId += 1;
        inFlightLoads.clear();
        clearSharedPathDataSets();
        clearPendingForegroundLoad();
        clearPendingPreloads();
    }

    function isLoadStale(generation, requestId, series) {
        return generation !== loadGeneration || requestId !== activeLoadRequestId || state.currentSeries !== series;
    }

    function renderDecodedSlice(decoded, wlOverride = null, options = {}) {
        const { displayErrors = true } = options;
        if (!decoded) {
            return renderDecodeError(
                {
                    error: true,
                    errorMessage: 'Image decode failed',
                    errorDetails: 'Unknown decode error',
                },
                { display: displayErrors },
            );
        }
        if (decoded.error) {
            return renderDecodeError(decoded, { display: displayErrors });
        }
        return renderPixels(decoded, wlOverride);
    }

    function getSliceTraceDetails(slice, index = null, extra = {}) {
        const { series = null, ...rest } = extra;
        return {
            path: slice?.source?.path || null,
            sourceKind: slice?.source?.kind || null,
            frameIndex: slice?.frameIndex || 0,
            sliceIndex: Number.isInteger(index) ? index : null,
            seriesInstanceUid: series?.seriesInstanceUid || state.currentSeries?.seriesInstanceUid || null,
            ...rest,
        };
    }

    function traceViewerDecode(event, slice, index = null, extra = {}) {
        void emitDesktopDecodeTrace(event, getSliceTraceDetails(slice, index, extra));
    }

    function canUseDesktopHeaderDecode(slice) {
        return (
            config?.deploymentMode === 'desktop' &&
            slice?.source?.kind === 'path' &&
            getActiveDecodeMode() !== 'js' &&
            typeof app.sources.readDesktopRenderHeaderDataSet === 'function' &&
            typeof decodeDesktopPathWithHeader === 'function'
        );
    }

    function shouldReuseSharedPathDataSet(slice, series) {
        if (slice?.source?.kind !== 'path') {
            return false;
        }

        if ((slice?.frameIndex || 0) > 0) {
            return true;
        }

        const sourcePath = slice?.source?.path;
        if (!sourcePath || !Array.isArray(series?.slices)) {
            return false;
        }

        return series.slices.some(
            (candidate) =>
                candidate !== slice && candidate?.source?.kind === 'path' && candidate.source.path === sourcePath,
        );
    }

    function rememberSharedPathDataSet(path, entry) {
        if (!path) return entry;
        // MAX_SHARED_PATH_DATASETS is 1, so just keep the latest
        sharedPathDataSets.clear();
        sharedPathDataSets.set(path, entry);
        return entry;
    }

    async function getSharedPathDataSet(slice, purpose, generation, options = {}) {
        const path = slice?.source?.path;
        if (!path) {
            return null;
        }

        const { requestId = null, series = null } = options;
        const isStale = () =>
            generation !== loadGeneration ||
            (requestId !== null && requestId !== activeLoadRequestId) ||
            (series && state.currentSeries !== series);
        const traceCtx = { purpose, generation, path, series };

        if (sharedPathDataSets.has(path)) {
            const cached = sharedPathDataSets.get(path);
            sharedPathDataSets.delete(path);
            sharedPathDataSets.set(path, cached);
            traceViewerDecode('shared-dataset-hit', slice, null, traceCtx);
            return cached;
        }

        traceViewerDecode('shared-dataset-miss', slice, null, traceCtx);
        const dataSetPromise = (async () => {
            const buf = await readSliceBuffer(slice, purpose);
            if (isStale()) return null;

            const byteArray = await toDicomByteArray(buf);
            if (isStale()) return null;

            return dicomParser.parseDicom(byteArray);
        })();

        rememberSharedPathDataSet(path, dataSetPromise);

        try {
            const dataSet = await dataSetPromise;
            if (!dataSet || isStale()) {
                traceViewerDecode('shared-dataset-stale', slice, null, traceCtx);
                if (sharedPathDataSets.get(path) === dataSetPromise) {
                    sharedPathDataSets.delete(path);
                }
                return null;
            }

            rememberSharedPathDataSet(path, Promise.resolve(dataSet));
            traceViewerDecode('shared-dataset-store', slice, null, traceCtx);
            return dataSet;
        } catch (error) {
            traceViewerDecode('shared-dataset-error', slice, null, {
                ...traceCtx,
                errorMessage: error?.message || String(error),
            });
            if (sharedPathDataSets.get(path) === dataSetPromise) {
                sharedPathDataSets.delete(path);
            }
            throw error;
        }
    }

    async function getDecodedSlice(slice, index, purpose, generation, options = {}) {
        const { requestId = null, series = null } = options;
        const isStale = () =>
            generation !== loadGeneration ||
            (requestId !== null && requestId !== activeLoadRequestId) ||
            (series && state.currentSeries !== series);
        if (isStale()) {
            return null;
        }
        const cacheKey = getSliceCacheKey(slice, index);
        const traceCtx = { cacheKey, purpose, generation, requestId, series };
        if (cacheKey && state.sliceCache.has(cacheKey)) {
            traceViewerDecode('slice-cache-hit', slice, index, traceCtx);
            return state.sliceCache.get(cacheKey);
        }

        if (cacheKey && inFlightLoads.has(cacheKey)) {
            traceViewerDecode('slice-inflight-join', slice, index, traceCtx);
            return inFlightLoads.get(cacheKey);
        }

        const loadPromise = (async () => {
            const decodeMode = getActiveDecodeMode();
            if (canUseDesktopHeaderDecode(slice)) {
                traceViewerDecode('header-decode-attempt', slice, index, traceCtx);
                const headerDataSet = await app.sources.readDesktopRenderHeaderDataSet(slice);
                if (isStale()) return null;

                if (headerDataSet) {
                    try {
                        const decoded = await decodeDesktopPathWithHeader(headerDataSet, slice.frameIndex || 0, slice);
                        if (isStale()) return null;
                        traceViewerDecode('header-decode-success', slice, index, {
                            ...traceCtx,
                            rows: decoded?.rows || null,
                            cols: decoded?.cols || null,
                            decodeError: !!decoded?.error,
                        });
                        if (decoded && !decoded.error && cacheKey) {
                            state.sliceCache.set(cacheKey, decoded);
                            traceViewerDecode('slice-cache-store', slice, index, {
                                ...traceCtx,
                                rows: decoded.rows,
                                cols: decoded.cols,
                                cachedKind: 'decoded',
                            });
                        }
                        return decoded || null;
                    } catch (error) {
                        traceViewerDecode('header-decode-fallback', slice, index, {
                            ...traceCtx,
                            errorMessage: error?.message || String(error),
                        });
                        if (decodeMode === 'native') {
                            throw error;
                        }
                        console.warn(
                            `Desktop header decode fell back to full file read for ${slice?.source?.path || 'slice'}:`,
                            error,
                        );
                    }
                } else if (decodeMode === 'native') {
                    traceViewerDecode('header-decode-header-miss', slice, index, traceCtx);
                    throw new Error(
                        `Forced native decode could not read the DICOM header for ${slice?.source?.path || 'slice'}.`,
                    );
                } else {
                    traceViewerDecode('header-decode-skip-to-js', slice, index, traceCtx);
                }
            }

            if (decodeMode === 'native') {
                throw new Error(`Forced native decode did not complete for ${slice?.source?.path || 'slice'}.`);
            }

            let dataSet;
            if (shouldReuseSharedPathDataSet(slice, series)) {
                traceViewerDecode('js-source-shared-dataset', slice, index, traceCtx);
                dataSet = await getSharedPathDataSet(slice, purpose, generation, { requestId, series });
            } else {
                traceViewerDecode('js-source-full-read', slice, index, traceCtx);
                const buf = await readSliceBuffer(slice, purpose);
                if (isStale()) return null;

                const byteArray = await toDicomByteArray(buf);
                if (isStale()) return null;

                dataSet = dicomParser.parseDicom(byteArray);
            }
            if (isStale()) return null;
            if (!dataSet) return null;

            const decoded = await decodeWithFallback(dataSet, slice.frameIndex || 0, slice);
            if (isStale()) return null;

            if (decoded && !decoded.error && cacheKey) {
                state.sliceCache.set(cacheKey, decoded);
                traceViewerDecode('slice-cache-store', slice, index, {
                    ...traceCtx,
                    rows: decoded.rows,
                    cols: decoded.cols,
                    cachedKind: 'decoded',
                });
            } else {
                traceViewerDecode('slice-decode-not-cached', slice, index, {
                    ...traceCtx,
                    decodeError: !!decoded?.error,
                });
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

    function shouldPausePreloads(generation, requestId, series) {
        return isLoadStale(generation, requestId, series) || !!pendingForegroundLoad;
    }

    async function drainPendingPreloads() {
        if (!isViewerPreloadEnabled()) {
            clearPendingPreloads();
            return null;
        }

        if (preloadTask || !preloadContext) {
            return preloadTask;
        }

        preloadTask = (async () => {
            while (preloadContext && pendingPreloads.length > 0) {
                const { generation, requestId, series } = preloadContext;
                if (shouldPausePreloads(generation, requestId, series)) {
                    break;
                }

                const nextPreload = pendingPreloads.shift();
                if (!nextPreload) {
                    break;
                }

                try {
                    await getDecodedSlice(nextPreload.slice, nextPreload.index, 'preload', generation, {
                        requestId,
                        series,
                    });
                } catch {}
            }
        })().finally(() => {
            preloadTask = null;
            if (!preloadContext || pendingPreloads.length === 0) {
                return;
            }

            const { generation, requestId, series } = preloadContext;
            if (!shouldPausePreloads(generation, requestId, series)) {
                void drainPendingPreloads();
            }
        });

        return preloadTask;
    }

    function preloadNearbySlices(slices, index, generation, requestId, series) {
        if (!isViewerPreloadEnabled()) {
            clearPendingPreloads();
            return;
        }

        if (isLoadStale(generation, requestId, series)) {
            return;
        }

        const preloadEntries = [];
        for (let i = index - VIEWER_PRELOAD_RADIUS; i <= index + VIEWER_PRELOAD_RADIUS; i++) {
            if (i < 0 || i >= slices.length) continue;

            const preloadSlice = slices[i];
            const preloadCacheKey = getSliceCacheKey(preloadSlice, i);
            if (!preloadCacheKey || state.sliceCache.has(preloadCacheKey) || inFlightLoads.has(preloadCacheKey)) {
                continue;
            }

            preloadEntries.push({
                slice: preloadSlice,
                index: i,
            });
        }

        pendingPreloads = preloadEntries;
        preloadContext = preloadEntries.length > 0 ? { generation, requestId, series } : null;
        void drainPendingPreloads();
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

    async function performSliceLoad(request) {
        const { index, generation, requestId, series } = request;
        if (!series || state.currentSeries !== series) return;
        const slices = series.slices;
        if (index < 0 || index >= slices.length) return;

        clearPendingPreloads();
        state.currentSliceIndex = index;
        updateSliceInfo();
        imageLoading.style.display = 'block';
        const traceCtx = { generation, requestId, series };

        try {
            const slice = slices[index];
            traceViewerDecode('slice-load-start', slice, index, traceCtx);
            let decoded = await getDecodedSlice(slice, index, 'load', generation, { requestId, series });
            if (!decoded && !isLoadStale(generation, requestId, series)) {
                decoded = await getDecodedSlice(slice, index, 'load', generation, { requestId, series });
            }
            if (isLoadStale(generation, requestId, series)) {
                return;
            }

            const wlOverride =
                state.windowLevel.center !== null && state.windowLevel.width !== null ? state.windowLevel : null;
            const info = renderDecodedSlice(decoded, wlOverride);
            traceViewerDecode('slice-load-rendered', slice, index, {
                ...traceCtx,
                renderError: !!info?.error,
                isBlank: !!info?.isBlank,
                rows: info?.rows || decoded?.rows || null,
                cols: info?.cols || decoded?.cols || null,
            });

            updateWLDisplay();
            updateSliceMetadata(info, slice, index, slices.length);
            if (isLoadStale(generation, requestId, series)) {
                return;
            }
            preloadNearbySlices(slices, index, generation, requestId, series);
        } catch (e) {
            console.error('Error loading slice:', e);
            traceViewerDecode('slice-load-exception', slices[index], index, {
                ...traceCtx,
                errorMessage: e?.message || String(e),
            });
            if (!isLoadStale(generation, requestId, series)) {
                const errorInfo = renderDecodedSlice(
                    {
                        error: true,
                        errorMessage: 'Image decode failed',
                        errorDetails: e.message || 'Unknown decode error',
                    },
                    null,
                );
                updateSliceMetadata(errorInfo, slices[index], index, slices.length);
            }
        } finally {
            if (requestId === activeLoadRequestId) {
                imageLoading.style.display = 'none';
            }
        }
    }

    async function drainForegroundLoads() {
        if (foregroundLoadTask) {
            return foregroundLoadTask;
        }

        foregroundLoadTask = (async () => {
            while (pendingForegroundLoad) {
                const request = pendingForegroundLoad;
                pendingForegroundLoad = null;
                try {
                    await performSliceLoad(request);
                } finally {
                    resolveQueuedLoad(request, null);
                }
            }
        })().finally(() => {
            foregroundLoadTask = null;
            if (pendingForegroundLoad) {
                void drainForegroundLoads();
            }
        });

        return foregroundLoadTask;
    }

    async function loadSlice(index) {
        if (!state.currentSeries) return null;
        const series = state.currentSeries;
        const slices = series.slices;
        if (index < 0 || index >= slices.length) return null;
        const targetSlice = slices[index];
        const targetCacheKey = getSliceCacheKey(targetSlice, index);
        const currentSlice = slices[state.currentSliceIndex];
        const currentCacheKey = currentSlice ? getSliceCacheKey(currentSlice, state.currentSliceIndex) : null;

        if (
            state.isDragging &&
            state.currentTool === 'wl' &&
            currentSlice &&
            currentCacheKey &&
            state.sliceCache.has(currentCacheKey)
        ) {
            traceViewerDecode('slice-load-blocked-during-wl-drag', currentSlice, state.currentSliceIndex, {
                requestedIndex: index,
                requestedCacheKey: targetCacheKey,
                currentCacheKey,
                series,
            });
            return null;
        }

        if (index === state.currentSliceIndex && targetCacheKey && state.sliceCache.has(targetCacheKey)) {
            traceViewerDecode('slice-load-skip-cached-current', targetSlice, index, {
                cacheKey: targetCacheKey,
                series,
            });
            imageLoading.style.display = 'none';
            return null;
        }

        if (targetCacheKey && inFlightLoads.has(targetCacheKey)) {
            traceViewerDecode('slice-load-join-inflight', targetSlice, index, {
                cacheKey: targetCacheKey,
                series,
            });
            return inFlightLoads.get(targetCacheKey);
        }

        state.currentSliceIndex = index;
        updateSliceInfo();
        imageLoading.style.display = 'block';
        clearPendingPreloads();

        if (pendingForegroundLoad && pendingForegroundLoad.index === index && pendingForegroundLoad.series === series) {
            return pendingForegroundLoad.promise;
        }

        clearPendingForegroundLoad();

        const generation = loadGeneration;
        const requestId = ++activeLoadRequestId;
        let resolveRequest;
        const request = {
            index,
            generation,
            requestId,
            series,
            promise: new Promise((resolve) => {
                resolveRequest = resolve;
            }),
            resolve: resolveRequest,
        };

        traceViewerDecode('slice-load-queued', targetSlice, index, { generation, requestId, series });
        pendingForegroundLoad = request;
        void drainForegroundLoads();
        return request.promise;
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

        document.querySelectorAll('.series-item').forEach((el) => {
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
        seriesList.innerHTML = seriesArr
            .map(
                (series) => `
            <div class="series-item" data-uid="${escapeHtml(series.seriesInstanceUid)}">
                <div class="series-name">${escapeHtml(series.seriesDescription || 'Series ' + (series.seriesNumber || '?'))}</div>
                <div class="series-info">${series.slices.length} slices</div>
            </div>
        `,
            )
            .join('');

        seriesList.querySelectorAll('.series-item').forEach((el) => {
            el.onclick = () => selectSeries(el.dataset.uid);
        });

        libraryView.style.display = 'none';
        viewerView.style.display = 'flex';
        document.body.classList.add('viewer-page');

        const seriesUidToSelect =
            initialSeriesUid && state.currentStudy.series[initialSeriesUid]
                ? initialSeriesUid
                : seriesArr.length
                  ? seriesArr[0].seriesInstanceUid
                  : null;
        if (seriesUidToSelect) {
            selectSeries(seriesUidToSelect);
        }
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
        selectSeries,
    };
})();
