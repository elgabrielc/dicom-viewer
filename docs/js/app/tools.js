(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const {
        canvas,
        wlDisplay,
        measurementCanvas,
        measureCtx,
        calibrationWarning,
        canvasContainer
    } = app.dom;
    const { getString, generateUUID } = app.utils;
    let pendingCurrentSliceRender = false;

    function getMeasurementSliceKey() {
        if (!state.currentStudy || !state.currentSeries) return null;
        return `${state.currentStudy.studyInstanceUid}|${state.currentSeries.seriesInstanceUid}|${state.currentSliceIndex}`;
    }

    function extractPixelSpacing(dataSet) {
        let spacingStr = getString(dataSet, 'x00280030');
        if (!spacingStr) {
            spacingStr = getString(dataSet, 'x00181164');
        }
        if (!spacingStr) return null;

        const parts = spacingStr.split('\\');
        if (parts.length !== 2) return null;

        const row = parseFloat(parts[0]);
        const col = parseFloat(parts[1]);
        if (isNaN(row) || isNaN(col) || row <= 0 || col <= 0) return null;

        return { row, col };
    }

    function screenToImage(screenX, screenY) {
        const rect = canvas.getBoundingClientRect();
        const { panX, panY, zoom } = state.viewTransform;
        const canvasX = screenX - rect.left;
        const canvasY = screenY - rect.top;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        return {
            x: (canvasX * scaleX - centerX - panX) / zoom + centerX,
            y: (canvasY * scaleY - centerY - panY) / zoom + centerY
        };
    }

    function imageToCanvas(imageX, imageY) {
        return { x: imageX, y: imageY };
    }

    function calculateDistance(start, end, pixelSpacing) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distancePixels = Math.sqrt(dx * dx + dy * dy);

        let distanceMm = null;
        if (pixelSpacing) {
            const dxMm = dx * pixelSpacing.col;
            const dyMm = dy * pixelSpacing.row;
            distanceMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
        }

        return { distancePixels, distanceMm };
    }

    function formatDistance(distanceMm, distancePixels) {
        if (distanceMm !== null) {
            if (distanceMm >= 100) {
                return (distanceMm / 10).toFixed(2) + ' cm';
            }
            return distanceMm.toFixed(2) + ' mm';
        }
        return distancePixels.toFixed(1) + ' px';
    }

    function createMeasurement(start, end) {
        const { distancePixels, distanceMm } = calculateDistance(start, end, state.pixelSpacing);

        return {
            id: generateUUID(),
            type: 'length',
            studyInstanceUid: state.currentStudy?.studyInstanceUid || null,
            seriesInstanceUid: state.currentSeries?.seriesInstanceUid || null,
            sliceIndex: state.currentSliceIndex,
            sopInstanceUid: null,
            points: [
                { x: start.x, y: start.y },
                { x: end.x, y: end.y }
            ],
            distanceMm,
            distancePixels,
            createdAt: new Date().toISOString(),
            label: null
        };
    }

    function getCurrentSliceMeasurements() {
        const key = getMeasurementSliceKey();
        if (!key) return [];
        return state.measurements.get(key) || [];
    }

    function addMeasurement(measurement) {
        const key = getMeasurementSliceKey();
        if (!key) return;

        const sliceMeasurements = state.measurements.get(key) || [];
        sliceMeasurements.push(measurement);
        state.measurements.set(key, sliceMeasurements);
    }

    function deleteMeasurement(measurementId) {
        const key = getMeasurementSliceKey();
        if (!key) return false;

        const sliceMeasurements = state.measurements.get(key) || [];
        const index = sliceMeasurements.findIndex(m => m.id === measurementId);
        if (index === -1) return false;

        sliceMeasurements.splice(index, 1);
        state.measurements.set(key, sliceMeasurements);
        drawMeasurements();
        return true;
    }

    function deleteLastMeasurement() {
        const key = getMeasurementSliceKey();
        if (!key) return false;

        const sliceMeasurements = state.measurements.get(key) || [];
        if (sliceMeasurements.length === 0) return false;

        sliceMeasurements.pop();
        state.measurements.set(key, sliceMeasurements);
        drawMeasurements();
        return true;
    }

    function clearSliceMeasurements() {
        const key = getMeasurementSliceKey();
        if (!key) return false;

        const sliceMeasurements = state.measurements.get(key) || [];
        if (sliceMeasurements.length === 0) return false;

        state.measurements.delete(key);
        drawMeasurements();
        return true;
    }

    function findMeasurementAtPoint(imageX, imageY, tolerance = 8) {
        const measurements = getCurrentSliceMeasurements();

        for (let i = measurements.length - 1; i >= 0; i--) {
            const measurement = measurements[i];
            if (!measurement.points || measurement.points.length < 2) continue;

            const start = measurement.points[0];
            const end = measurement.points[1];

            if (Math.hypot(imageX - start.x, imageY - start.y) <= tolerance) return measurement;
            if (Math.hypot(imageX - end.x, imageY - end.y) <= tolerance) return measurement;

            if (pointToLineDistance(imageX, imageY, start.x, start.y, end.x, end.y) <= tolerance) {
                return measurement;
            }
        }

        return null;
    }

    function pointToLineDistance(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq === 0) return Math.hypot(px - x1, py - y1);

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    function syncMeasurementCanvas() {
        measurementCanvas.width = canvas.width;
        measurementCanvas.height = canvas.height;
        measurementCanvas.style.maxWidth = '100%';
        measurementCanvas.style.maxHeight = '100%';

        const { panX, panY, zoom } = state.viewTransform;
        measurementCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        measurementCanvas.style.transformOrigin = 'center center';
    }

    function drawMeasurements() {
        if (!measurementCanvas) return;

        syncMeasurementCanvas();
        measureCtx.clearRect(0, 0, measurementCanvas.width, measurementCanvas.height);

        for (const measurement of getCurrentSliceMeasurements()) {
            drawSingleMeasurement(measurement);
        }

        if (state.activeMeasurement) {
            drawSingleMeasurement(state.activeMeasurement, true);
        }
    }

    function drawSingleMeasurement(measurement, isActive = false) {
        if (!measurement.points || measurement.points.length < 2) return;

        const start = measurement.points[0];
        const end = measurement.points[1];
        const startCanvas = imageToCanvas(start.x, start.y);
        const endCanvas = imageToCanvas(end.x, end.y);

        measureCtx.strokeStyle = isActive ? '#ffcc00' : '#00ff00';
        measureCtx.lineWidth = 2;
        measureCtx.lineCap = 'round';

        measureCtx.beginPath();
        measureCtx.moveTo(startCanvas.x, startCanvas.y);
        measureCtx.lineTo(endCanvas.x, endCanvas.y);
        measureCtx.stroke();

        const endpointRadius = 4;
        measureCtx.fillStyle = isActive ? '#ffcc00' : '#00ff00';

        measureCtx.beginPath();
        measureCtx.arc(startCanvas.x, startCanvas.y, endpointRadius, 0, Math.PI * 2);
        measureCtx.fill();

        measureCtx.beginPath();
        measureCtx.arc(endCanvas.x, endCanvas.y, endpointRadius, 0, Math.PI * 2);
        measureCtx.fill();

        const midX = (startCanvas.x + endCanvas.x) / 2;
        const midY = (startCanvas.y + endCanvas.y) / 2;
        const dx = endCanvas.x - startCanvas.x;
        const dy = endCanvas.y - startCanvas.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const offsetDist = 15;

        let perpX = -dy / length;
        let perpY = dx / length;
        if (perpY > 0) {
            perpX = -perpX;
            perpY = -perpY;
        }

        const labelX = midX + perpX * offsetDist;
        const labelY = midY + perpY * offsetDist;
        const distanceText = formatDistance(measurement.distanceMm, measurement.distancePixels);

        measureCtx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        const textMetrics = measureCtx.measureText(distanceText);
        const textWidth = textMetrics.width;
        const textHeight = 14;
        const padding = 4;

        measureCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        measureCtx.fillRect(
            labelX - textWidth / 2 - padding,
            labelY - textHeight / 2 - padding,
            textWidth + padding * 2,
            textHeight + padding * 2
        );

        measureCtx.fillStyle = isActive ? '#ffcc00' : '#00ff00';
        measureCtx.textAlign = 'center';
        measureCtx.textBaseline = 'middle';
        measureCtx.fillText(distanceText, labelX, labelY);
    }

    function updateCalibrationWarning() {
        if (state.currentTool === 'measure') {
            calibrationWarning.style.display = state.pixelSpacing ? 'none' : 'inline';
        } else {
            calibrationWarning.style.display = 'none';
        }
    }

    function setTool(tool) {
        state.currentTool = tool;
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        canvas.style.cursor = getCursorForTool(tool, false);
        canvasContainer.classList.toggle('tool-measure', tool === 'measure');
        updateCalibrationWarning();
    }

    function getCursorForTool(tool, dragging) {
        switch (tool) {
            case 'wl': return dragging ? 'ns-resize' : 'crosshair';
            case 'pan': return dragging ? 'grabbing' : 'grab';
            case 'zoom': return dragging ? 'ns-resize' : 'zoom-in';
            case 'measure': return 'crosshair';
            default: return 'default';
        }
    }

    function applyViewTransform() {
        const { panX, panY, zoom } = state.viewTransform;
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        canvas.style.transformOrigin = 'center center';
        drawMeasurements();
    }

    function updateWLDisplay() {
        const wc = state.windowLevel.center ?? state.baseWindowLevel.center;
        const ww = state.windowLevel.width ?? state.baseWindowLevel.width;
        if (wc !== null && ww !== null) {
            wlDisplay.textContent = `C: ${Math.round(wc)} W: ${Math.round(ww)}`;
        }
    }

    function performCurrentSliceRender() {
        if (!state.currentSeries) return;
        const slice = state.currentSeries.slices[state.currentSliceIndex];
        if (!slice) return;

        const cacheKey = app.sources?.getSliceCacheKey?.(slice, state.currentSliceIndex);
        const decoded = state.sliceCache.get(cacheKey);
        if (!decoded) return;

        const wlOverride = (state.windowLevel.center !== null && state.windowLevel.width !== null)
            ? state.windowLevel
            : null;
        if (decoded.error) {
            app.rendering.renderDecodeError(decoded);
            return;
        }
        app.rendering.renderPixels(decoded, wlOverride);
    }

    function reRenderCurrentSlice() {
        if (pendingCurrentSliceRender) {
            return;
        }

        pendingCurrentSliceRender = true;
        const flush = () => {
            pendingCurrentSliceRender = false;
            performCurrentSliceRender();
        };

        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(flush);
            return;
        }

        setTimeout(flush, 0);
    }

    function handleWLDrag(dx, dy) {
        const sensitivity = 2;
        const currentWidth = state.windowLevel.width ?? state.baseWindowLevel.width;
        const currentCenter = state.windowLevel.center ?? state.baseWindowLevel.center;

        state.windowLevel.width = Math.max(1, currentWidth + dx * sensitivity);
        state.windowLevel.center = currentCenter - dy * sensitivity;

        reRenderCurrentSlice();
        updateWLDisplay();
    }

    function handlePanDrag(dx, dy) {
        state.viewTransform.panX += dx;
        state.viewTransform.panY += dy;
        applyViewTransform();
    }

    function handleZoomDrag(dx, dy) {
        const sensitivity = 0.005;
        const delta = -dy * sensitivity;
        state.viewTransform.zoom = Math.max(0.1, Math.min(10, state.viewTransform.zoom + delta));
        applyViewTransform();
    }

    function resetView() {
        state.viewTransform = { panX: 0, panY: 0, zoom: 1 };
        state.windowLevel = { center: null, width: null };
        applyViewTransform();
        reRenderCurrentSlice();
        updateWLDisplay();
    }

    function resetViewForNewSeries() {
        state.viewTransform = { panX: 0, panY: 0, zoom: 1 };
        state.windowLevel = { center: null, width: null };
        state.baseWindowLevel = { center: null, width: null };
        state.measurements.clear();
        state.activeMeasurement = null;
        state.pixelSpacing = null;
        applyViewTransform();
        updateCalibrationWarning();
    }

    function onCanvasMouseDown(e) {
        if (!state.currentTool || e.button !== 0) return;

        if (state.currentTool === 'measure') {
            handleMeasureMouseDown(e);
            return;
        }

        state.isDragging = true;
        state.dragStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = getCursorForTool(state.currentTool, true);
        e.preventDefault();
    }

    function onCanvasMouseMove(e) {
        if (state.currentTool === 'measure' && state.activeMeasurement) {
            handleMeasureMouseMove(e);
            return;
        }

        if (!state.isDragging) return;
        const dx = e.clientX - state.dragStart.x;
        const dy = e.clientY - state.dragStart.y;

        switch (state.currentTool) {
            case 'wl':
                handleWLDrag(dx, dy);
                break;
            case 'pan':
                handlePanDrag(dx, dy);
                break;
            case 'zoom':
                handleZoomDrag(dx, dy);
                break;
        }

        state.dragStart = { x: e.clientX, y: e.clientY };
    }

    function onCanvasMouseUp(e) {
        if (state.currentTool === 'measure' && state.activeMeasurement) {
            handleMeasureMouseUp(e);
            return;
        }

        if (state.isDragging) {
            state.isDragging = false;
            canvas.style.cursor = getCursorForTool(state.currentTool, false);
        }
    }

    function handleMeasureMouseDown(e) {
        const imageCoords = screenToImage(e.clientX, e.clientY);
        imageCoords.x = Math.max(0, Math.min(canvas.width - 1, imageCoords.x));
        imageCoords.y = Math.max(0, Math.min(canvas.height - 1, imageCoords.y));

        state.activeMeasurement = createMeasurement(imageCoords, imageCoords);
        canvasContainer.classList.add('measuring');
        e.preventDefault();
    }

    function handleMeasureMouseMove(e) {
        if (!state.activeMeasurement) return;

        const imageCoords = screenToImage(e.clientX, e.clientY);
        imageCoords.x = Math.max(0, Math.min(canvas.width - 1, imageCoords.x));
        imageCoords.y = Math.max(0, Math.min(canvas.height - 1, imageCoords.y));

        state.activeMeasurement.points[1] = { x: imageCoords.x, y: imageCoords.y };
        const { distancePixels, distanceMm } = calculateDistance(
            state.activeMeasurement.points[0],
            state.activeMeasurement.points[1],
            state.pixelSpacing
        );
        state.activeMeasurement.distancePixels = distancePixels;
        state.activeMeasurement.distanceMm = distanceMm;
        drawMeasurements();
    }

    function handleMeasureMouseUp() {
        if (!state.activeMeasurement) return;

        if (state.activeMeasurement.distancePixels < 3) {
            state.activeMeasurement = null;
            canvasContainer.classList.remove('measuring');
            drawMeasurements();
            return;
        }

        addMeasurement(state.activeMeasurement);
        state.activeMeasurement = null;
        canvasContainer.classList.remove('measuring');
        drawMeasurements();
    }

    app.tools = {
        addMeasurement,
        applyViewTransform,
        clearSliceMeasurements,
        deleteLastMeasurement,
        deleteMeasurement,
        drawMeasurements,
        extractPixelSpacing,
        findMeasurementAtPoint,
        getCursorForTool,
        onCanvasMouseDown,
        onCanvasMouseMove,
        onCanvasMouseUp,
        resetView,
        resetViewForNewSeries,
        screenToImage,
        setTool,
        updateCalibrationWarning,
        updateWLDisplay
    };
})();
