// =====================================================================
// DICOM MEDICAL IMAGING VIEWER - CLIENT-SIDE APPLICATION
// =====================================================================
//
// This script implements the entire DICOM viewing workflow:
//   1. Drag-and-drop folder loading via File System Access API
//   2. DICOM file parsing and organization by study/series
//   3. Image decoding (uncompressed, JPEG Lossless, JPEG 2000)
//   4. Slice navigation and display
//   5. Study/series commenting
//
// The code is organized into the following sections:
//   - DICOM Parsing
//   - File System Operations
//   - Study/Series Processing
//   - Comments System
//   - Library View (studies table)
//   - Transfer Syntax Support
//   - Image Decoding
//   - Rendering
//   - Viewer Controls
//   - Event Handlers
//
// =====================================================================

const { state } = window.DicomViewerApp;
const {
    $,
    libraryView,
    viewerView,
    folderZone,
    studiesTable,
    studiesTableHead,
    studiesBody,
    emptyState,
    emptyStateHint,
    studyCount,
    refreshLibraryBtn,
    libraryFolderConfig,
    libraryFolderInput,
    saveLibraryFolderBtn,
    libraryFolderStatus,
    libraryFolderMessage,
    uploadProgress,
    progressText,
    progressDetail,
    progressFill,
    canvas,
    ctx,
    slider,
    sliceInfo,
    seriesList,
    metadataContent,
    studyTitle,
    imageLoading,
    resetViewBtn,
    wlDisplay,
    measurementCanvas,
    measureCtx,
    calibrationWarning,
    canvasContainer,
    prevBtn,
    nextBtn,
    backBtn,
    loadSampleCtBtn,
    loadSampleMriBtn
} = window.DicomViewerApp.dom;
const {
    formatDate,
    getString,
    getNumber,
    generateUUID
} = window.DicomViewerApp.utils;

const {
    parseDicomMetadata,
    getTransferSyntaxInfo
} = window.DicomViewerApp.dicom;
const { renderDicom } = window.DicomViewerApp.rendering;
const {
    getAllFileHandles,
    processFiles,
    readSliceBuffer,
    normalizeStudiesPayload,
    loadStudiesFromApi
} = window.DicomViewerApp.sources;

// =====================================================================
// MEASUREMENT TOOL FUNCTIONS
// Length measurement with calibration from DICOM PixelSpacing
// =====================================================================

        /**
         * Get unique key for storing measurements by slice
         * @returns {string} Key combining study/series/slice for Map storage
         */
        function getMeasurementSliceKey() {
            if (!state.currentStudy || !state.currentSeries) return null;
            return `${state.currentStudy.studyInstanceUid}|${state.currentSeries.seriesInstanceUid}|${state.currentSliceIndex}`;
        }

        /**
         * Extract pixel spacing from DICOM dataset
         * Tries PixelSpacing (0028,0030) first, then ImagerPixelSpacing (0018,1164)
         * PixelSpacing format is "row\col" (backslash separated)
         *
         * @param {Object} dataSet - dicomParser dataset
         * @returns {Object|null} {row, col} spacing in mm, or null if not available
         */
        function extractPixelSpacing(dataSet) {
            // Try PixelSpacing first (most reliable for cross-sectional imaging)
            let spacingStr = getString(dataSet, 'x00280030');  // (0028,0030) Pixel Spacing

            // Fall back to ImagerPixelSpacing (common in projection radiography)
            if (!spacingStr) {
                spacingStr = getString(dataSet, 'x00181164');  // (0018,1164) Imager Pixel Spacing
            }

            if (!spacingStr) return null;

            // Parse "row\col" format (DICOM uses backslash as separator)
            const parts = spacingStr.split('\\');
            if (parts.length !== 2) return null;

            const row = parseFloat(parts[0]);
            const col = parseFloat(parts[1]);

            // Validate parsed values
            if (isNaN(row) || isNaN(col) || row <= 0 || col <= 0) return null;

            return { row, col };
        }

        /**
         * Convert screen coordinates to image coordinates
         * Accounts for canvas position, pan offset, and zoom level
         *
         * @param {number} screenX - X position in viewport
         * @param {number} screenY - Y position in viewport
         * @returns {Object} {x, y} in image pixel coordinates
         */
        function screenToImage(screenX, screenY) {
            const rect = canvas.getBoundingClientRect();
            const { panX, panY, zoom } = state.viewTransform;

            // Position relative to canvas element
            const canvasX = screenX - rect.left;
            const canvasY = screenY - rect.top;

            // Account for canvas display scaling (CSS vs actual pixels)
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            // Convert to image coordinates, accounting for pan and zoom
            // Transform origin is center of canvas
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;

            const imageX = (canvasX * scaleX - centerX - panX) / zoom + centerX;
            const imageY = (canvasY * scaleY - centerY - panY) / zoom + centerY;

            return { x: imageX, y: imageY };
        }

        /**
         * Convert image coordinates to overlay canvas coordinates
         * Since the overlay canvas has the same CSS transform as the image canvas,
         * we simply return the image coordinates directly.
         *
         * @param {number} imageX - X position in image pixels
         * @param {number} imageY - Y position in image pixels
         * @returns {Object} {x, y} in overlay canvas coordinates
         */
        function imageToCanvas(imageX, imageY) {
            // The overlay canvas uses the same CSS transform as the image canvas,
            // so we draw directly in image coordinates
            return { x: imageX, y: imageY };
        }

        /**
         * Calculate distance between two points
         * Handles anisotropic pixels (different row/col spacing)
         *
         * @param {Object} start - {x, y} start point in image coordinates
         * @param {Object} end - {x, y} end point in image coordinates
         * @param {Object|null} pixelSpacing - {row, col} in mm, or null
         * @returns {Object} {distancePixels, distanceMm}
         */
        function calculateDistance(start, end, pixelSpacing) {
            const dx = end.x - start.x;
            const dy = end.y - start.y;

            // Distance in pixels (always available)
            const distancePixels = Math.sqrt(dx * dx + dy * dy);

            // Distance in mm (only if calibrated)
            let distanceMm = null;
            if (pixelSpacing) {
                // Use col spacing for X, row spacing for Y (DICOM convention)
                const dxMm = dx * pixelSpacing.col;
                const dyMm = dy * pixelSpacing.row;
                distanceMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
            }

            return { distancePixels, distanceMm };
        }

        /**
         * Format distance for display
         * Uses mm for < 100mm, cm for >= 100mm
         * Falls back to pixels if uncalibrated
         *
         * @param {number|null} distanceMm - Distance in mm, or null
         * @param {number} distancePixels - Distance in pixels
         * @returns {string} Formatted distance string
         */
        function formatDistance(distanceMm, distancePixels) {
            if (distanceMm !== null) {
                if (distanceMm >= 100) {
                    return (distanceMm / 10).toFixed(2) + ' cm';
                }
                return distanceMm.toFixed(2) + ' mm';
            }
            return distancePixels.toFixed(1) + ' px';
        }

        /**
         * Create a new measurement object (persistence-ready structure)
         *
         * @param {Object} start - {x, y} start point
         * @param {Object} end - {x, y} end point
         * @returns {Object} Measurement object
         */
        function createMeasurement(start, end) {
            const { distancePixels, distanceMm } = calculateDistance(start, end, state.pixelSpacing);

            return {
                id: generateUUID(),
                type: 'length',
                studyInstanceUid: state.currentStudy?.studyInstanceUid || null,
                seriesInstanceUid: state.currentSeries?.seriesInstanceUid || null,
                sliceIndex: state.currentSliceIndex,
                sopInstanceUid: null,  // Could be extracted from current slice if needed
                points: [
                    { x: start.x, y: start.y },
                    { x: end.x, y: end.y }
                ],
                distanceMm: distanceMm,
                distancePixels: distancePixels,
                createdAt: new Date().toISOString(),
                label: null
            };
        }

        /**
         * Get measurements for current slice
         * @returns {Array} Array of measurements for current slice
         */
        function getCurrentSliceMeasurements() {
            const key = getMeasurementSliceKey();
            if (!key) return [];
            return state.measurements.get(key) || [];
        }

        /**
         * Add a measurement to the current slice
         * @param {Object} measurement - Measurement object to add
         */
        function addMeasurement(measurement) {
            const key = getMeasurementSliceKey();
            if (!key) return;

            const sliceMeasurements = state.measurements.get(key) || [];
            sliceMeasurements.push(measurement);
            state.measurements.set(key, sliceMeasurements);
        }

        /**
         * Delete a measurement by ID from the current slice
         * @param {string} measurementId - ID of measurement to delete
         * @returns {boolean} True if measurement was found and deleted
         */
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

        /**
         * Delete the most recent measurement on current slice
         * @returns {boolean} True if a measurement was deleted
         */
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

        /**
         * Clear all measurements on current slice
         * @returns {boolean} True if measurements were cleared
         */
        function clearSliceMeasurements() {
            const key = getMeasurementSliceKey();
            if (!key) return false;

            const sliceMeasurements = state.measurements.get(key) || [];
            if (sliceMeasurements.length === 0) return false;

            state.measurements.delete(key);
            drawMeasurements();
            return true;
        }

        /**
         * Find measurement at given image coordinates (hit testing)
         * Returns the measurement if click is within tolerance of the line or endpoints
         *
         * @param {number} imageX - X position in image coordinates
         * @param {number} imageY - Y position in image coordinates
         * @param {number} tolerance - Hit detection tolerance in pixels (default 8)
         * @returns {Object|null} Measurement object if found, null otherwise
         */
        function findMeasurementAtPoint(imageX, imageY, tolerance = 8) {
            const measurements = getCurrentSliceMeasurements();

            // Check in reverse order so most recent measurements are hit first
            for (let i = measurements.length - 1; i >= 0; i--) {
                const m = measurements[i];
                if (!m.points || m.points.length < 2) continue;

                const start = m.points[0];
                const end = m.points[1];

                // Check endpoints first (easier click targets)
                if (Math.hypot(imageX - start.x, imageY - start.y) <= tolerance) return m;
                if (Math.hypot(imageX - end.x, imageY - end.y) <= tolerance) return m;

                // Check distance to line segment
                if (pointToLineDistance(imageX, imageY, start.x, start.y, end.x, end.y) <= tolerance) {
                    return m;
                }
            }

            return null;
        }

        /**
         * Calculate shortest distance from point to line segment
         * @param {number} px - Point X
         * @param {number} py - Point Y
         * @param {number} x1 - Line start X
         * @param {number} y1 - Line start Y
         * @param {number} x2 - Line end X
         * @param {number} y2 - Line end Y
         * @returns {number} Distance in pixels
         */
        function pointToLineDistance(px, py, x1, y1, x2, y2) {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const lengthSq = dx * dx + dy * dy;

            // Line segment is a point
            if (lengthSq === 0) return Math.hypot(px - x1, py - y1);

            // Project point onto line, clamped to segment [0, 1]
            const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));

            // Distance to closest point on segment
            return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
        }

        /**
         * Sync measurement overlay canvas size and position with image canvas
         * Applies the same CSS transform so measurements move with the image
         */
        function syncMeasurementCanvas() {
            // Match the image canvas dimensions
            measurementCanvas.width = canvas.width;
            measurementCanvas.height = canvas.height;

            // Copy the same CSS styles as the image canvas
            measurementCanvas.style.maxWidth = '100%';
            measurementCanvas.style.maxHeight = '100%';

            // Apply the same transform as the image canvas
            const { panX, panY, zoom } = state.viewTransform;
            measurementCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
            measurementCanvas.style.transformOrigin = 'center center';
        }

        /**
         * Draw all measurements on the overlay canvas
         * Called after view transform changes or measurements added
         */
        function drawMeasurements() {
            if (!measurementCanvas) return;

            // Sync canvas size/position first
            syncMeasurementCanvas();

            // Clear the overlay
            measureCtx.clearRect(0, 0, measurementCanvas.width, measurementCanvas.height);

            // Get measurements for current slice
            const measurements = getCurrentSliceMeasurements();

            // Draw each measurement
            for (const m of measurements) {
                drawSingleMeasurement(m);
            }

            // Draw active measurement (being drawn)
            if (state.activeMeasurement) {
                drawSingleMeasurement(state.activeMeasurement, true);
            }
        }

        /**
         * Draw a single measurement line with label
         *
         * @param {Object} measurement - Measurement object
         * @param {boolean} isActive - Whether this is the measurement being drawn
         */
        function drawSingleMeasurement(measurement, isActive = false) {
            if (!measurement.points || measurement.points.length < 2) return;

            const start = measurement.points[0];
            const end = measurement.points[1];

            // Convert to canvas coordinates (accounting for pan/zoom)
            const startCanvas = imageToCanvas(start.x, start.y);
            const endCanvas = imageToCanvas(end.x, end.y);

            // Line style
            measureCtx.strokeStyle = isActive ? '#ffcc00' : '#00ff00';
            measureCtx.lineWidth = 2;
            measureCtx.lineCap = 'round';

            // Draw line
            measureCtx.beginPath();
            measureCtx.moveTo(startCanvas.x, startCanvas.y);
            measureCtx.lineTo(endCanvas.x, endCanvas.y);
            measureCtx.stroke();

            // Draw endpoints (small circles)
            const endpointRadius = 4;
            measureCtx.fillStyle = isActive ? '#ffcc00' : '#00ff00';

            measureCtx.beginPath();
            measureCtx.arc(startCanvas.x, startCanvas.y, endpointRadius, 0, Math.PI * 2);
            measureCtx.fill();

            measureCtx.beginPath();
            measureCtx.arc(endCanvas.x, endCanvas.y, endpointRadius, 0, Math.PI * 2);
            measureCtx.fill();

            // Draw label near the midpoint, offset to avoid overlapping the line
            const midX = (startCanvas.x + endCanvas.x) / 2;
            const midY = (startCanvas.y + endCanvas.y) / 2;

            // Calculate perpendicular offset for label placement
            const dx = endCanvas.x - startCanvas.x;
            const dy = endCanvas.y - startCanvas.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const offsetDist = 15;  // Pixels away from line

            // Perpendicular direction (normalized), prefer above the line
            let perpX = -dy / length;
            let perpY = dx / length;
            if (perpY > 0) { perpX = -perpX; perpY = -perpY; }  // Prefer label above

            const labelX = midX + perpX * offsetDist;
            const labelY = midY + perpY * offsetDist;

            // Format distance text
            const distanceText = formatDistance(measurement.distanceMm, measurement.distancePixels);

            // Draw text with background for readability
            measureCtx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
            const textMetrics = measureCtx.measureText(distanceText);
            const textWidth = textMetrics.width;
            const textHeight = 14;
            const padding = 4;

            // Background rectangle
            measureCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            measureCtx.fillRect(
                labelX - textWidth / 2 - padding,
                labelY - textHeight / 2 - padding,
                textWidth + padding * 2,
                textHeight + padding * 2
            );

            // Text
            measureCtx.fillStyle = isActive ? '#ffcc00' : '#00ff00';
            measureCtx.textAlign = 'center';
            measureCtx.textBaseline = 'middle';
            measureCtx.fillText(distanceText, labelX, labelY);
        }

        /**
         * Update calibration warning display
         */
        function updateCalibrationWarning() {
            if (state.currentTool === 'measure') {
                calibrationWarning.style.display = state.pixelSpacing ? 'none' : 'inline';
            } else {
                calibrationWarning.style.display = 'none';
            }
        }

        // =====================================================================
        // COMMENTS SYSTEM
        // Allows users to add notes to studies and series (stored in memory)
        // =====================================================================

        /**
         * Format Unix timestamp to human-readable date/time
         * @param {number} date - Unix timestamp in milliseconds
         * @returns {string} Formatted date string
         */
        function formatTimestamp(date) {
            return new Date(date).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true
            });
        }

        function normalizeCommentId(value) {
            if (value === null || value === undefined) return null;
            const asNumber = Number(value);
            if (!Number.isNaN(asNumber)) return asNumber;
            return String(value);
        }

        function findCommentIndex(comments, commentId) {
            const target = normalizeCommentId(commentId);
            if (target === null) return -1;
            return comments.findIndex(c => normalizeCommentId(c.id) === target);
        }

        function generateLocalCommentId() {
            return `local-${crypto.randomUUID()}`;
        }

        // Render comments list HTML
        function renderComments(comments, studyUid, seriesUid = null) {
            if (!comments || comments.length === 0) return '';
            return comments.map(c => `
                <div class="comment-item" data-comment-id="${escapeHtml(c.id)}">
                    <div class="comment-header">
                        <span class="comment-time">${formatTimestamp(c.time)}</span>
                        <span class="comment-actions">
                            <button class="comment-btn edit-comment" data-study-uid="${escapeHtml(studyUid)}" ${seriesUid ? `data-series-uid="${escapeHtml(seriesUid)}"` : ''} data-comment-id="${escapeHtml(c.id)}">Edit</button>
                            <button class="comment-btn delete-comment" data-study-uid="${escapeHtml(studyUid)}" ${seriesUid ? `data-series-uid="${escapeHtml(seriesUid)}"` : ''} data-comment-id="${escapeHtml(c.id)}">Delete</button>
                        </span>
                    </div>
                    <div class="comment-text">${escapeHtml(c.text)}</div>
                </div>
            `).join('');
        }

        // Track open panels
        const openPanels = {
            studyPanels: new Set(),
            seriesPanels: new Set(),
            seriesDropdowns: new Set()
        };

        const descriptionSaveTimers = new Map();

        function scheduleDescriptionSave(key, callback) {
            const existing = descriptionSaveTimers.get(key);
            if (existing) clearTimeout(existing);
            const handle = setTimeout(() => {
                descriptionSaveTimers.delete(key);
                callback();
            }, 500);
            descriptionSaveTimers.set(key, handle);
        }

        // Update just the comment list without re-rendering everything
        function updateCommentListUI(studyUid, seriesUid) {
            const comments = seriesUid
                ? state.studies[studyUid].series[seriesUid].comments
                : state.studies[studyUid].comments;

            // Find the comment list element
            let commentList;
            if (seriesUid) {
                const panel = document.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                commentList = panel?.querySelector('.comment-list');
            } else {
                const panel = document.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                commentList = panel?.querySelector('.comment-list');
            }

            if (commentList) {
                commentList.innerHTML = renderComments(comments, studyUid, seriesUid);
                // Re-attach edit/delete handlers
                commentList.querySelectorAll('.edit-comment').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        editComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
                    };
                });
                commentList.querySelectorAll('.delete-comment').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        deleteComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
                    };
                });
            }

            // Update the button text
            const count = comments.length;
            let btn;
            if (seriesUid) {
                btn = document.querySelector(`.series-comment-toggle[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
            } else {
                btn = document.querySelector(`.comment-toggle[data-study-uid="${CSS.escape(studyUid)}"]:not(.series-comment-toggle)`);
            }
            // Keep showing "Hide comments" if panel is open
            if (btn && btn.textContent !== 'Hide comments') {
                btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
            }

            // Clear the input
            let input;
            if (seriesUid) {
                input = document.querySelector(`.add-series-comment[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
            } else {
                input = document.querySelector(`.add-study-comment[data-study-uid="${CSS.escape(studyUid)}"]`);
            }
            if (input) input.value = '';
        }

        // Add comment to study or series
        async function addComment(studyUid, seriesUid, text) {
            if (!text.trim()) return;
            const now = Date.now();
            const comment = { id: generateLocalCommentId(), text: text.trim(), time: now };
            let comments;
            if (seriesUid) {
                if (!Array.isArray(state.studies[studyUid].series[seriesUid].comments)) {
                    state.studies[studyUid].series[seriesUid].comments = [];
                }
                comments = state.studies[studyUid].series[seriesUid].comments;
            } else {
                if (!Array.isArray(state.studies[studyUid].comments)) {
                    state.studies[studyUid].comments = [];
                }
                comments = state.studies[studyUid].comments;
            }

            comments.push(comment);
            updateCommentListUI(studyUid, seriesUid);

            const saved = await NotesAPI.addComment(studyUid, {
                text: comment.text,
                time: comment.time,
                seriesUid: seriesUid
            });
            if (saved?.id !== undefined && saved?.id !== null) {
                comment.id = saved.id;
                updateCommentListUI(studyUid, seriesUid);
            }
        }

        // Delete comment
        async function deleteComment(studyUid, seriesUid, commentId) {
            const comments = seriesUid
                ? state.studies[studyUid].series[seriesUid].comments
                : state.studies[studyUid].comments;
            if (!Array.isArray(comments)) return;
            const idx = findCommentIndex(comments, commentId);
            if (idx === -1) return;
            comments.splice(idx, 1);
            updateCommentListUI(studyUid, seriesUid);
            if (!String(commentId).startsWith('local-')) {
                await NotesAPI.deleteComment(studyUid, commentId);
            }
        }

        // Edit comment
        async function editComment(studyUid, seriesUid, commentId) {
            const comments = seriesUid
                ? state.studies[studyUid].series[seriesUid].comments
                : state.studies[studyUid].comments;
            if (!Array.isArray(comments)) return;
            const idx = findCommentIndex(comments, commentId);
            if (idx === -1) return;
            const newText = prompt('Edit comment:', comments[idx].text);
            if (newText !== null && newText.trim()) {
                comments[idx].text = newText.trim();
                comments[idx].time = Date.now();
                updateCommentListUI(studyUid, seriesUid);
                if (!String(commentId).startsWith('local-')) {
                    await NotesAPI.updateComment(studyUid, commentId, {
                    text: comments[idx].text,
                    time: comments[idx].time
                    });
                }
            }
        }

        // =====================================================================
        // NOTES PERSISTENCE (SERVER-SIDE)
        // =====================================================================

        const MIGRATION_FLAG_KEY = 'dicom-viewer-migrated';
        const LEGACY_STORAGE_KEY = 'dicom-viewer-comments';
        const LEGACY_REPORTS_DB = 'dicom-viewer-reports';
        const LEGACY_REPORTS_STORE = 'reports';

        async function loadNotesForStudies() {
            const studyUids = Object.keys(state.studies);
            if (!studyUids.length) return;

            const result = await NotesAPI.loadNotes(studyUids);
            const notes = result?.studies || {};

            for (const [studyUid, entry] of Object.entries(notes)) {
                const study = state.studies[studyUid];
                if (!study) continue;

                if (entry.description !== undefined) {
                    study.description = entry.description || '';
                }
                if (Array.isArray(entry.comments)) {
                    study.comments = entry.comments;
                    study.comments.forEach(c => {
                        if (c.id === undefined || c.id === null) {
                            c.id = generateLocalCommentId();
                        }
                    });
                }
                if (Array.isArray(entry.reports)) {
                    study.reports = entry.reports;
                }

                if (entry.series && typeof entry.series === 'object') {
                    for (const [seriesUid, seriesEntry] of Object.entries(entry.series)) {
                        const series = study.series[seriesUid];
                        if (!series) continue;
                        if (seriesEntry.description !== undefined) {
                            series.description = seriesEntry.description || '';
                        }
                        if (Array.isArray(seriesEntry.comments)) {
                            series.comments = seriesEntry.comments;
                            series.comments.forEach(c => {
                                if (c.id === undefined || c.id === null) {
                                    c.id = generateLocalCommentId();
                                }
                            });
                        }
                    }
                }
            }
        }

        async function openLegacyReportsDB() {
            if (!('indexedDB' in window)) return null;
            return new Promise((resolve) => {
                const request = indexedDB.open(LEGACY_REPORTS_DB, 1);
                request.onerror = () => resolve(null);
                request.onsuccess = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(LEGACY_REPORTS_STORE)) {
                        db.close();
                        resolve(null);
                        return;
                    }
                    resolve(db);
                };
                request.onupgradeneeded = () => resolve(null);
            });
        }

        async function getLegacyReportBlob(db, reportId) {
            if (!db) return null;
            return new Promise((resolve) => {
                const tx = db.transaction(LEGACY_REPORTS_STORE, 'readonly');
                const request = tx.objectStore(LEGACY_REPORTS_STORE).get(reportId);
                request.onsuccess = () => resolve(request.result?.blob || null);
                request.onerror = () => resolve(null);
            });
        }

        async function migrateIfNeeded() {
            if (!NotesAPI.isEnabled()) return;
            if (typeof CONFIG !== 'undefined' && !CONFIG.features.notesServer) return;
            let alreadyMigrated = false;
            try {
                alreadyMigrated = !!localStorage.getItem(MIGRATION_FLAG_KEY);
            } catch (e) {
                return;
            }
            if (alreadyMigrated) return;

            let raw;
            try {
                raw = localStorage.getItem(LEGACY_STORAGE_KEY);
            } catch (e) {
                return;
            }
            if (!raw) {
                localStorage.setItem(MIGRATION_FLAG_KEY, '1');
                return;
            }

            let payload;
            try {
                payload = JSON.parse(raw);
            } catch (e) {
                console.warn('Failed to parse legacy notes for migration:', e);
                return;
            }

            const migrated = await NotesAPI.migrate(payload);
            if (!migrated) return;

            if (payload?.version === 2 && payload?.comments) {
                const db = await openLegacyReportsDB();
                const uploadTasks = [];
                for (const [studyUid, stored] of Object.entries(payload.comments)) {
                    const reports = stored?.reports || [];
                    for (const report of reports) {
                        if (!report?.id) continue;
                        uploadTasks.push((async () => {
                            const blob = await getLegacyReportBlob(db, report.id);
                            if (!blob) return;
                            const filename = report.name || 'report';
                            const file = new File([blob], filename, { type: blob.type || '' });
                            await NotesAPI.uploadReport(studyUid, file, report);
                        })());
                    }
                }
                if (db) db.close();

                // Only set migration flag if all report uploads succeeded.
                // If any failed, omitting the flag allows retry on next load.
                if (uploadTasks.length) {
                    const results = await Promise.allSettled(uploadTasks);
                    if (results.every(r => r.status === 'fulfilled')) {
                        localStorage.setItem(MIGRATION_FLAG_KEY, '1');
                    }
                    return;
                }
            }

            localStorage.setItem(MIGRATION_FLAG_KEY, '1');
        }

        // =====================================================================
        // REPORTS SYSTEM
        // Allows users to attach PDF and image reports to studies
        // =====================================================================

        /**
         * Escape a string for safe insertion into innerHTML
         * @param {string} str - Untrusted string
         * @returns {string} HTML-safe string
         */
        function escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        /**
         * Get file type from MIME type with filename extension fallback
         * @param {File} file - File object
         * @returns {'pdf'|'png'|'jpg'|null}
         */
        function getReportType(file) {
            const mime = file.type;
            if (mime === 'application/pdf') return 'pdf';
            if (mime === 'image/png') return 'png';
            if (mime === 'image/jpeg') return 'jpg';

            // Fallback to extension when MIME is absent or generic
            const ext = file.name.toLowerCase().split('.').pop();
            if (ext === 'pdf') return 'pdf';
            if (ext === 'png') return 'png';
            if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
            return null;
        }

        /**
         * Format file size for display
         * @param {number} bytes
         * @returns {string}
         */
        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        /**
         * Add a report to a study
         * @param {string} studyUid - Study instance UID
         * @param {File} file - File object from input
         */
        async function addReport(studyUid, file) {
            const type = getReportType(file);
            if (!type) {
                alert('Unsupported file type. Please use PDF, PNG, or JPG.');
                return;
            }

            if (!state.studies[studyUid].reports) {
                state.studies[studyUid].reports = [];
            }

            const now = Date.now();

            const report = {
                id: generateUUID(),
                name: file.name,
                type: type,
                size: file.size,
                addedAt: now,
                updatedAt: now,
                blob: null
            };

            const saved = await NotesAPI.uploadReport(studyUid, file, report);
            if (saved) {
                Object.assign(report, saved);
            } else {
                // Server unavailable; keep in-memory blob for this session
                report.blob = file;
            }

            state.studies[studyUid].reports.push(report);
            updateReportListUI(studyUid);
        }

        /**
         * Delete a report from a study
         * @param {string} studyUid - Study instance UID
         * @param {string} reportId - Report UUID
         */
        async function deleteReport(studyUid, reportId) {
            const reports = state.studies[studyUid].reports;
            if (!reports) return;
            const idx = reports.findIndex(r => r.id === reportId);
            if (idx === -1) return;

            const removed = reports.splice(idx, 1)[0];
            updateReportListUI(studyUid);

            const result = await NotesAPI.deleteReport(studyUid, reportId);
            if (!result && NotesAPI.isEnabled()) {
                // Server failed -- restore the report in the UI
                reports.splice(idx, 0, removed);
                updateReportListUI(studyUid);
                alert('Failed to delete report. Please try again.');
            }
        }

        /**
         * Render reports list HTML
         * @param {Array} reports - Array of report objects
         * @param {string} studyUid - Study instance UID
         * @returns {string} HTML string
         */
        function renderReports(reports, studyUid) {
            if (!reports || reports.length === 0) {
                return '<p class="report-empty">No reports attached</p>';
            }

            return reports.map(r => {
                const icon = r.type === 'pdf' ? '&#128196;' : '&#128247;';

                return `
                    <div class="report-item" data-report-id="${escapeHtml(r.id)}">
                        <span class="report-icon">${icon}</span>
                        <span class="report-name">${escapeHtml(r.name)}</span>
                        <span class="report-size">${formatFileSize(r.size)}</span>
                        <span class="report-actions">
                            <button class="report-btn view-report" data-study-uid="${escapeHtml(studyUid)}" data-report-id="${escapeHtml(r.id)}">View</button>
                            <button class="report-btn delete-report" data-study-uid="${escapeHtml(studyUid)}" data-report-id="${escapeHtml(r.id)}">Delete</button>
                        </span>
                    </div>
                `;
            }).join('');
        }

        /**
         * Update report list UI without full page re-render
         * @param {string} studyUid - Study instance UID
         */
        function updateReportListUI(studyUid) {
            const reportList = document.querySelector(`.report-list[data-study-uid="${CSS.escape(studyUid)}"]`);
            if (reportList) {
                reportList.innerHTML = renderReports(state.studies[studyUid].reports, studyUid);
                attachReportEventHandlers(studyUid);
            }

            // Update button text
            const btn = document.querySelector(`.report-toggle[data-study-uid="${CSS.escape(studyUid)}"]`);
            if (btn) {
                const count = state.studies[studyUid].reports?.length || 0;
                btn.textContent = count > 0 ? `${count} report${count > 1 ? 's' : ''}` : 'Add report';
            }
        }

        /**
         * Open report in viewer modal
         * @param {string} studyUid - Study instance UID
         * @param {string} reportId - Report UUID
         */
        async function viewReport(studyUid, reportId) {
            const report = state.studies[studyUid].reports?.find(r => r.id === reportId);
            if (!report) return;

            const viewer = $('reportViewer');
            const pdfFrame = $('reportPdfFrame');
            const imageView = $('reportImageView');
            const title = $('reportViewerTitle');

            // Cleanup previous object URL (used for in-memory fallback)
            if (viewer.dataset.objectUrl) {
                URL.revokeObjectURL(viewer.dataset.objectUrl);
                delete viewer.dataset.objectUrl;
            }

            let url = '';
            if (report.blob) {
                url = URL.createObjectURL(report.blob);
                viewer.dataset.objectUrl = url;
            } else {
                url = NotesAPI.getReportFileUrl(report.id);
            }

            if (!url) {
                alert('Report file not available.');
                return;
            }

            // Hide both viewers initially
            pdfFrame.style.display = 'none';
            imageView.style.display = 'none';

            title.textContent = report.name;

            if (report.type === 'pdf') {
                pdfFrame.src = url;
                pdfFrame.style.display = 'block';
            } else {
                imageView.src = url;
                imageView.style.display = 'block';
            }

            viewer.style.display = 'flex';
        }

        /**
         * Close report viewer and cleanup resources
         */
        function closeReportViewer() {
            const viewer = $('reportViewer');
            const pdfFrame = $('reportPdfFrame');
            const imageView = $('reportImageView');

            // Cleanup object URL to prevent memory leak
            if (viewer.dataset.objectUrl) {
                URL.revokeObjectURL(viewer.dataset.objectUrl);
                delete viewer.dataset.objectUrl;
            }

            pdfFrame.src = '';
            imageView.src = '';
            viewer.style.display = 'none';
        }

        // =====================================================================
        // HELP VIEWER
        // In-app user guide modal with table of contents and scroll sync
        // =====================================================================

        /**
         * Highlight active help section in table of contents
         * @param {string} sectionId - HELP_SECTIONS id value
         */
        function setActiveHelpTocItem(sectionId) {
            document.querySelectorAll('.help-toc-item').forEach(item => {
                item.classList.toggle('active', item.dataset.sectionId === sectionId);
            });
        }

        /**
         * Update active TOC entry as user scrolls help content
         */
        function onHelpContentScroll() {
            const contentEl = $('helpContent');
            if (!contentEl) return;

            const sections = Array.from(contentEl.querySelectorAll('.help-section'));
            if (!sections.length) return;

            const offset = contentEl.scrollTop + 40;
            let activeSectionId = sections[0].dataset.sectionId;

            for (const section of sections) {
                if (section.offsetTop <= offset) {
                    activeSectionId = section.dataset.sectionId;
                } else {
                    break;
                }
            }

            setActiveHelpTocItem(activeSectionId);
        }

        /**
         * Build help table of contents and section content from HELP_SECTIONS
         */
        function renderHelpContent() {
            const tocEl = $('helpToc');
            const contentEl = $('helpContent');
            if (!tocEl || !contentEl || !Array.isArray(HELP_SECTIONS)) return;

            tocEl.innerHTML = HELP_SECTIONS.map(section => `
                <a href="#help-${escapeHtml(section.id)}" class="help-toc-item" data-section-id="${escapeHtml(section.id)}">
                    ${escapeHtml(section.title)}
                </a>
            `).join('');

            contentEl.innerHTML = HELP_SECTIONS.map(section => `
                <section id="help-${escapeHtml(section.id)}" class="help-section" data-section-id="${escapeHtml(section.id)}">
                    <h2>${escapeHtml(section.title)}</h2>
                    ${section.content}
                </section>
            `).join('');

            tocEl.querySelectorAll('.help-toc-item').forEach(item => {
                item.addEventListener('click', e => {
                    e.preventDefault();
                    const sectionId = item.dataset.sectionId;
                    const target = contentEl.querySelector(`#help-${CSS.escape(sectionId)}`);
                    if (!target) return;
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    setActiveHelpTocItem(sectionId);
                });
            });

            contentEl.removeEventListener('scroll', onHelpContentScroll);
            contentEl.addEventListener('scroll', onHelpContentScroll);
            onHelpContentScroll();
        }

        /**
         * Open in-app help modal
         */
        function openHelpViewer() {
            $('helpViewer').style.display = 'flex';
            renderHelpContent();
            const contentEl = $('helpContent');
            if (contentEl) contentEl.scrollTop = 0;
            onHelpContentScroll();
        }

        /**
         * Close in-app help modal
         */
        function closeHelpViewer() {
            $('helpViewer').style.display = 'none';
        }

        /**
         * Attach event handlers for report actions within a study
         * @param {string} studyUid - Study instance UID
         */
        function attachReportEventHandlers(studyUid) {
            // View report buttons
            document.querySelectorAll(`.view-report[data-study-uid="${CSS.escape(studyUid)}"]`).forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    viewReport(studyUid, btn.dataset.reportId);
                };
            });

            // Delete report buttons
            document.querySelectorAll(`.delete-report[data-study-uid="${CSS.escape(studyUid)}"]`).forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this report?')) {
                        deleteReport(studyUid, btn.dataset.reportId);
                    }
                };
            });
        }

        // =====================================================================
        // LIBRARY VIEW (STUDIES TABLE)
        // Renders the main studies list with expandable series rows
        // =====================================================================

        /**
         * Render the studies table in the library view
         * Creates expandable rows for each study with nested series items
         */
        async function displayStudies() {
            // Migrate legacy notes once, then load persisted notes from the server
            await migrateIfNeeded();
            await loadNotesForStudies();

            refreshLibraryBtn.style.display = state.libraryAvailable ? 'inline-block' : 'none';
            libraryFolderConfig.style.display = (state.libraryAvailable || state.libraryConfigReachable) ? 'block' : 'none';

            const studies = Object.values(state.studies);
            const { column, direction } = state.studySort;
            studies.sort((a, b) => {
                let aVal;
                let bVal;

                if (column === 'name') {
                    aVal = (a.patientName || '').trim().toLocaleLowerCase();
                    bVal = (b.patientName || '').trim().toLocaleLowerCase();
                } else {
                    // Normalize to keep YYYYMMDD and YYYY-MM-DD comparable
                    aVal = (a.studyDate || '').replace(/\D/g, '');
                    bVal = (b.studyDate || '').replace(/\D/g, '');
                }

                // Missing values always sort to the bottom
                if (!aVal && !bVal) {
                    return (a.studyInstanceUid || '').localeCompare(b.studyInstanceUid || '');
                }
                if (!aVal) return 1;
                if (!bVal) return -1;

                const cmp = aVal.localeCompare(bVal);
                if (cmp !== 0) {
                    return direction === 'asc' ? cmp : -cmp;
                }

                // Tie-breaker for deterministic rendering order
                return (a.studyInstanceUid || '').localeCompare(b.studyInstanceUid || '');
            });
            if (!studies.length) {
                emptyState.style.display = 'block';
                studiesTable.style.display = 'none';
                studyCount.textContent = '';
                if (state.libraryAvailable) {
                    const folderLabel = state.libraryFolder || 'your library folder';
                    emptyStateHint.textContent = `No DICOM files found in ${folderLabel}.`;
                } else {
                    emptyStateHint.textContent = 'Drop a DICOM folder above to get started';
                }
                return;
            }
            emptyState.style.display = 'none';
            studiesTable.style.display = 'table';
            studyCount.textContent = `(${studies.length})`;

            let html = '';
            for (const s of studies) {
                const seriesArr = Object.values(s.series);
                if (!Array.isArray(s.comments)) s.comments = [];
                const commentCount = s.comments.length;
                const reportCount = s.reports?.length || 0;

                html += `
                    <tr class="study-row" data-uid="${escapeHtml(s.studyInstanceUid)}">
                        <td class="expand-cell"><span class="expand-icon">&#9654;</span></td>
                        <td>${escapeHtml(s.patientName || '-')}</td>
                        <td>${formatDate(s.studyDate)}</td>
                        <td>${escapeHtml(s.studyDescription || '-')}</td>
                        <td><span class="modality-badge">${escapeHtml(s.modality || '-')}</span></td>
                        <td>${s.seriesCount}</td>
                        <td>${s.imageCount}</td>
                        <td class="comment-cell" onclick="event.stopPropagation()">
                            <button class="comment-toggle" data-study-uid="${escapeHtml(s.studyInstanceUid)}">
                                ${commentCount > 0 ? `${commentCount} comment${commentCount > 1 ? 's' : ''}` : 'Add comment'}
                            </button>
                        </td>
                        <td class="report-cell" onclick="event.stopPropagation()">
                            <button class="report-toggle" data-study-uid="${escapeHtml(s.studyInstanceUid)}">
                                ${reportCount > 0 ? `${reportCount} report${reportCount > 1 ? 's' : ''}` : 'Add report'}
                            </button>
                        </td>
                    </tr>
                    <tr class="comment-panel-row" data-study-uid="${escapeHtml(s.studyInstanceUid)}" style="display: none;">
                        <td colspan="9">
                            <div class="detail-panel">
                                <div class="description-section">
                                    <h4>Description</h4>
                                    <textarea class="description-input" data-study-uid="${escapeHtml(s.studyInstanceUid)}" placeholder="Add a more detailed description...">${escapeHtml(s.description || '')}</textarea>
                                </div>
                                <div class="comment-section">
                                    <h4>Comments</h4>
                                    <div class="comment-list">${renderComments(s.comments, s.studyInstanceUid)}</div>
                                    <div class="comment-add">
                                        <input type="text" class="comment-input add-study-comment" data-study-uid="${escapeHtml(s.studyInstanceUid)}" placeholder="Write a comment...">
                                        <button class="comment-submit" data-study-uid="${escapeHtml(s.studyInstanceUid)}">Add</button>
                                    </div>
                                </div>
                                <div class="report-section">
                                    <h4>Reports</h4>
                                    <div class="report-list" data-study-uid="${escapeHtml(s.studyInstanceUid)}">${renderReports(s.reports, s.studyInstanceUid)}</div>
                                    <div class="report-upload">
                                        <input type="file" class="report-file-input" data-study-uid="${escapeHtml(s.studyInstanceUid)}" accept=".pdf,.png,.jpg,.jpeg" style="display: none;">
                                        <button class="report-upload-btn" data-study-uid="${escapeHtml(s.studyInstanceUid)}">Upload Report</button>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                    <tr class="series-dropdown-row" data-study-uid="${escapeHtml(s.studyInstanceUid)}" style="display: none;">
                        <td colspan="9">
                            <div class="series-dropdown">
                                ${seriesArr.map(ser => {
                                    if (!Array.isArray(ser.comments)) ser.comments = [];
                                    const serCommentCount = ser.comments.length;
                                    const tsInfo = getTransferSyntaxInfo(ser.transferSyntax);
                                    const warningIcon = !tsInfo.supported ? `<span class="format-warning" title="${tsInfo.name} - may not display correctly">&#9888;</span>` : '';
                                    return `
                                    <div class="series-dropdown-item" data-study-uid="${escapeHtml(s.studyInstanceUid)}" data-series-uid="${escapeHtml(ser.seriesInstanceUid)}">
                                        <div class="series-main-row">
                                            <span class="series-icon">&#128196;</span>
                                            ${warningIcon}
                                            <span class="series-name">${escapeHtml(ser.seriesDescription || 'Series ' + (ser.seriesNumber || '?'))}</span>
                                            <span class="series-count">${ser.slices.length} slices</span>
                                            <button class="comment-toggle series-comment-toggle" data-study-uid="${escapeHtml(s.studyInstanceUid)}" data-series-uid="${escapeHtml(ser.seriesInstanceUid)}" onclick="event.stopPropagation()">
                                                ${serCommentCount > 0 ? `${serCommentCount} comment${serCommentCount > 1 ? 's' : ''}` : 'Add comment'}
                                            </button>
                                        </div>
                                        <div class="series-comment-panel" data-study-uid="${escapeHtml(s.studyInstanceUid)}" data-series-uid="${escapeHtml(ser.seriesInstanceUid)}" style="display: none;" onclick="event.stopPropagation()">
                                            <div class="detail-panel series-detail-panel">
                                                <div class="description-section">
                                                    <h4>Description</h4>
                                                    <textarea class="description-input series-description" data-study-uid="${escapeHtml(s.studyInstanceUid)}" data-series-uid="${escapeHtml(ser.seriesInstanceUid)}" placeholder="Add a more detailed description...">${escapeHtml(ser.description || '')}</textarea>
                                                </div>
                                                <div class="comment-section">
                                                    <h4>Comments</h4>
                                                    <div class="comment-list">${renderComments(ser.comments, s.studyInstanceUid, ser.seriesInstanceUid)}</div>
                                                    <div class="comment-add">
                                                        <input type="text" class="comment-input add-series-comment" data-study-uid="${escapeHtml(s.studyInstanceUid)}" data-series-uid="${escapeHtml(ser.seriesInstanceUid)}" placeholder="Write a comment...">
                                                        <button class="comment-submit" data-study-uid="${escapeHtml(s.studyInstanceUid)}" data-series-uid="${escapeHtml(ser.seriesInstanceUid)}">Add</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                `}).join('')}
                            </div>
                        </td>
                    </tr>
                `;
            }
            studiesBody.innerHTML = html;

            // Toggle expand/collapse for series
            studiesBody.querySelectorAll('.study-row').forEach(row => {
                row.onclick = (e) => {
                    if (e.target.closest('.comment-cell') || e.target.closest('.report-cell')) return;
                    const uid = row.dataset.uid;
                    const dropdownRow = studiesBody.querySelector(`.series-dropdown-row[data-study-uid="${CSS.escape(uid)}"]`);
                    const icon = row.querySelector('.expand-icon');
                    const isExpanded = dropdownRow.style.display !== 'none';

                    // Close all series dropdowns and track state
                    studiesBody.querySelectorAll('.series-dropdown-row').forEach(r => r.style.display = 'none');
                    studiesBody.querySelectorAll('.expand-icon').forEach(i => { i.textContent = '\u25B6'; i.classList.remove('expanded'); });
                    openPanels.seriesDropdowns.clear();

                    if (!isExpanded) {
                        dropdownRow.style.display = 'table-row';
                        icon.textContent = '\u25BC';
                        icon.classList.add('expanded');
                        openPanels.seriesDropdowns.add(uid);
                    }
                };
            });

            // Toggle study comment panel
            studiesBody.querySelectorAll('.comment-toggle:not(.series-comment-toggle)').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const studyUid = btn.dataset.studyUid;
                    const panel = studiesBody.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                    const isOpen = panel.style.display !== 'none';
                    panel.style.display = isOpen ? 'none' : 'table-row';
                    if (isOpen) {
                        openPanels.studyPanels.delete(studyUid);
                        const count = state.studies[studyUid]?.comments?.length || 0;
                        btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
                    } else {
                        openPanels.studyPanels.add(studyUid);
                        btn.textContent = 'Hide comments';
                    }
                };
            });

            // Toggle series comment panel
            studiesBody.querySelectorAll('.series-comment-toggle').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const studyUid = btn.dataset.studyUid;
                    const seriesUid = btn.dataset.seriesUid;
                    const key = `${studyUid}:${seriesUid}`;
                    const panel = studiesBody.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                    const isOpen = panel.style.display !== 'none';
                    panel.style.display = isOpen ? 'none' : 'block';
                    if (isOpen) {
                        openPanels.seriesPanels.delete(key);
                        const count = state.studies[studyUid]?.series[seriesUid]?.comments?.length || 0;
                        btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
                    } else {
                        openPanels.seriesPanels.add(key);
                        btn.textContent = 'Hide comments';
                    }
                };
            });

            // Click on series to open viewer
            studiesBody.querySelectorAll('.series-main-row').forEach(row => {
                row.onclick = (e) => {
                    if (e.target.closest('.comment-toggle')) return;
                    const item = row.closest('.series-dropdown-item');
                    const studyUid = item.dataset.studyUid;
                    const seriesUid = item.dataset.seriesUid;
                    openViewerWithSeries(studyUid, seriesUid);
                };
            });

            // Add study comment
            studiesBody.querySelectorAll('.comment-submit:not([data-series-uid])').forEach(btn => {
                btn.onclick = () => {
                    const studyUid = btn.dataset.studyUid;
                    const input = studiesBody.querySelector(`.add-study-comment[data-study-uid="${CSS.escape(studyUid)}"]`);
                    addComment(studyUid, null, input.value);
                };
            });

            // Add series comment
            studiesBody.querySelectorAll('.comment-submit[data-series-uid]').forEach(btn => {
                btn.onclick = () => {
                    const studyUid = btn.dataset.studyUid;
                    const seriesUid = btn.dataset.seriesUid;
                    const input = studiesBody.querySelector(`.add-series-comment[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                    addComment(studyUid, seriesUid, input.value);
                };
            });

            // Enter key to submit
            studiesBody.querySelectorAll('.comment-input').forEach(input => {
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        const studyUid = input.dataset.studyUid;
                        const seriesUid = input.dataset.seriesUid || null;
                        addComment(studyUid, seriesUid, input.value);
                    }
                };
            });

            // Edit/Delete buttons
            studiesBody.querySelectorAll('.edit-comment').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    editComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
                };
            });
            studiesBody.querySelectorAll('.delete-comment').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    deleteComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
                };
            });

            // Save study description on input
            studiesBody.querySelectorAll('.description-input:not(.series-description)').forEach(textarea => {
                textarea.oninput = () => {
                    const studyUid = textarea.dataset.studyUid;
                    if (state.studies[studyUid]) {
                        state.studies[studyUid].description = textarea.value;
                        scheduleDescriptionSave(`study:${studyUid}`, () => {
                            NotesAPI.saveStudyDescription(studyUid, textarea.value);
                        });
                    }
                };
            });

            // Save series description on input
            studiesBody.querySelectorAll('.series-description').forEach(textarea => {
                textarea.oninput = () => {
                    const studyUid = textarea.dataset.studyUid;
                    const seriesUid = textarea.dataset.seriesUid;
                    if (state.studies[studyUid]?.series[seriesUid]) {
                        state.studies[studyUid].series[seriesUid].description = textarea.value;
                        scheduleDescriptionSave(`series:${studyUid}:${seriesUid}`, () => {
                            NotesAPI.saveSeriesDescription(studyUid, seriesUid, textarea.value);
                        });
                    }
                };
            });

            // Restore open panels
            openPanels.studyPanels.forEach(studyUid => {
                const panel = studiesBody.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                if (panel) panel.style.display = 'table-row';
                const btn = studiesBody.querySelector(`.comment-toggle[data-study-uid="${CSS.escape(studyUid)}"]:not(.series-comment-toggle)`);
                if (btn) btn.textContent = 'Hide comments';
            });
            openPanels.seriesPanels.forEach(key => {
                const [studyUid, seriesUid] = key.split(':');
                const panel = studiesBody.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                if (panel) panel.style.display = 'block';
                const btn = studiesBody.querySelector(`.series-comment-toggle[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                if (btn) btn.textContent = 'Hide comments';
                // Also need to open the series dropdown
                const dropdown = studiesBody.querySelector(`.series-dropdown-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                if (dropdown) dropdown.style.display = 'table-row';
                const icon = studiesBody.querySelector(`.study-row[data-uid="${CSS.escape(studyUid)}"] .expand-icon`);
                if (icon) { icon.textContent = '\u25BC'; icon.classList.add('expanded'); }
            });
            openPanels.seriesDropdowns.forEach(studyUid => {
                const dropdown = studiesBody.querySelector(`.series-dropdown-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                if (dropdown) dropdown.style.display = 'table-row';
                const icon = studiesBody.querySelector(`.study-row[data-uid="${CSS.escape(studyUid)}"] .expand-icon`);
                if (icon) { icon.textContent = '\u25BC'; icon.classList.add('expanded'); }
            });

            // Report toggle button (reuses comment panel, same behavior)
            studiesBody.querySelectorAll('.report-toggle').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const studyUid = btn.dataset.studyUid;
                    const panel = studiesBody.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                    const isOpen = panel.style.display !== 'none';
                    panel.style.display = isOpen ? 'none' : 'table-row';
                    if (isOpen) {
                        openPanels.studyPanels.delete(studyUid);
                    } else {
                        openPanels.studyPanels.add(studyUid);
                    }
                };
            });

            // Report upload button -> trigger file input
            studiesBody.querySelectorAll('.report-upload-btn').forEach(btn => {
                const studyUid = btn.dataset.studyUid;
                const fileInput = studiesBody.querySelector(`.report-file-input[data-study-uid="${CSS.escape(studyUid)}"]`);
                btn.onclick = (e) => {
                    e.stopPropagation();
                    fileInput.click();
                };
                fileInput.onchange = async () => {
                    const file = fileInput.files[0];
                    if (file) {
                        await addReport(studyUid, file);
                        fileInput.value = '';
                    }
                };
            });

            // Attach report event handlers for all studies
            Object.keys(state.studies).forEach(studyUid => {
                attachReportEventHandlers(studyUid);
            });

            // Update sort indicators and aria state
            document.querySelectorAll('.sortable').forEach(th => {
                const arrow = th.querySelector('.sort-arrow');
                if (!arrow) return;

                if (th.dataset.sort === state.studySort.column) {
                    arrow.textContent = state.studySort.direction === 'asc' ? ' \u25B2' : ' \u25BC';
                    th.setAttribute('aria-sort', state.studySort.direction === 'asc' ? 'ascending' : 'descending');
                } else {
                    arrow.textContent = '';
                    th.setAttribute('aria-sort', 'none');
                }
            });
        }

        function handleSortClick(e) {
            const th = e.target.closest('.sortable');
            if (!th) return;

            const column = th.dataset.sort;
            if (state.studySort.column === column) {
                state.studySort.direction = state.studySort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                state.studySort.column = column;
                state.studySort.direction = column === 'date' ? 'desc' : 'asc';
            }

            displayStudies();
        }

        // =====================================================================
        // VIEWER CONTROLS
        // Slice navigation and series selection
        // =====================================================================

        /**
         * Load and display a specific slice from the current series
         * Handles caching and preloading of adjacent slices
         *
         * @param {number} index - Zero-based slice index
         */
        async function loadSlice(index) {
            if (!state.currentSeries) return;
            const slices = state.currentSeries.slices;
            if (index < 0 || index >= slices.length) return;

            state.currentSliceIndex = index;
            updateSliceInfo();
            imageLoading.style.display = 'block';

            try {
                const slice = slices[index];
                let dataSet = state.sliceCache.get(index);

                if (!dataSet) {
                    const buf = await readSliceBuffer(slice, 'load');
                    dataSet = dicomParser.parseDicom(new Uint8Array(buf));
                    state.sliceCache.set(index, dataSet);
                }

                // Pass W/L override if user has adjusted values
                const wlOverride = (state.windowLevel.center !== null && state.windowLevel.width !== null)
                    ? state.windowLevel : null;
                const info = await renderDicom(dataSet, wlOverride);

                // Update W/L display in toolbar
                updateWLDisplay();

                if (info && !info.error) {
                    // Build base metadata (common to all modalities)
                    let metadataHtml = `
                        <div class="metadata-item"><div class="label">Slice</div><div class="value">${index + 1} / ${slices.length}</div></div>
                        <div class="metadata-item"><div class="label">Modality</div><div class="value">${escapeHtml(info.modality || '-')}</div></div>
                        <div class="metadata-item"><div class="label">Size</div><div class="value">${info.cols} x ${info.rows}</div></div>
                        <div class="metadata-item"><div class="label">Location</div><div class="value">${slice.sliceLocation?.toFixed(2) || '-'} mm</div></div>
                        <div class="metadata-item"><div class="label">Window</div><div class="value">C:${info.wc} W:${info.ww}</div></div>
                    `;

                    // Add MRI-specific metadata
                    if (info.modality === 'MR' && info.mrMetadata) {
                        const mr = info.mrMetadata;
                        metadataHtml += `<div class="metadata-divider"></div>`;

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
                } else if (info && info.isBlank) {
                    // Blank/padding slice - show basic info
                    metadataContent.innerHTML = `
                        <div class="metadata-item"><div class="label">Slice</div><div class="value">${index + 1} / ${slices.length}</div></div>
                        <div class="metadata-item"><div class="label">Modality</div><div class="value">${escapeHtml(info.modality || '-')}</div></div>
                        <div class="metadata-item"><div class="label">Size</div><div class="value">${info.cols} x ${info.rows}</div></div>
                        <div class="metadata-item"><div class="label">Location</div><div class="value">${slice.sliceLocation?.toFixed(2) || '-'} mm</div></div>
                    `;
                } else if (info && info.error) {
                    metadataContent.innerHTML = `
                        <div class="metadata-item"><div class="label">Slice</div><div class="value">${index + 1} / ${slices.length}</div></div>
                        <div class="metadata-item"><div class="label">Status</div><div class="value" style="color: #f0ad4e;">Decode Error</div></div>
                        <div class="metadata-item"><div class="label">Format</div><div class="value">${info.tsInfo?.name || 'Unknown'}</div></div>
                    `;
                }

                // Preload adjacent slices
                for (let i = index - 3; i <= index + 3; i++) {
                    if (i >= 0 && i < slices.length && !state.sliceCache.has(i)) {
                        const s = slices[i];
                        readSliceBuffer(s, 'preload').then(buf => {
                            state.sliceCache.set(i, dicomParser.parseDicom(new Uint8Array(buf)));
                        }).catch(() => {});
                    }
                }
            } catch (e) {
                console.error('Error loading slice:', e);
            }
            imageLoading.style.display = 'none';
            // Redraw measurements for the new slice
            drawMeasurements();
        }

        function updateSliceInfo() {
            const total = state.currentSeries?.slices.length || 0;
            sliceInfo.textContent = `${state.currentSliceIndex + 1} / ${total}`;
            slider.value = state.currentSliceIndex;
            prevBtn.disabled = state.currentSliceIndex <= 0;
            nextBtn.disabled = state.currentSliceIndex >= total - 1;
        }

        function selectSeries(seriesUid) {
            state.currentSeries = state.currentStudy.series[seriesUid];
            state.sliceCache.clear();
            state.currentSliceIndex = 0;

            // Reset view transforms and W/L for new series
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
            seriesList.innerHTML = seriesArr.map(s => `
                <div class="series-item" data-uid="${escapeHtml(s.seriesInstanceUid)}">
                    <div class="series-name">${escapeHtml(s.seriesDescription || 'Series ' + (s.seriesNumber || '?'))}</div>
                    <div class="series-info">${s.slices.length} slices</div>
                </div>
            `).join('');

            seriesList.querySelectorAll('.series-item').forEach(el => {
                el.onclick = () => selectSeries(el.dataset.uid);
            });

            libraryView.style.display = 'none';
            viewerView.style.display = 'flex';
            document.body.classList.add('viewer-page');

            // Select specified series or first one
            const seriesUidToSelect = initialSeriesUid && state.currentStudy.series[initialSeriesUid]
                ? initialSeriesUid
                : (seriesArr.length ? seriesArr[0].seriesInstanceUid : null);
            if (seriesUidToSelect) selectSeries(seriesUidToSelect);
        }

        function openViewerWithSeries(studyUid, seriesUid) {
            openViewer(studyUid, seriesUid);
        }

        function closeViewer() {
            viewerView.style.display = 'none';
            libraryView.style.display = 'block';
            document.body.classList.remove('viewer-page');
            state.currentStudy = null;
            state.currentSeries = null;
            state.sliceCache.clear();
        }

        // =====================================================================
        // VIEWING TOOLS
        // Window/Level, Pan, Zoom, Reset
        // =====================================================================

        /**
         * Set the active viewing tool
         * @param {string} tool - Tool name ('wl', 'pan', 'zoom', or null)
         */
        function setTool(tool) {
            state.currentTool = tool;
            // Update toolbar button states
            document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tool === tool);
            });
            // Update cursor
            canvas.style.cursor = getCursorForTool(tool, false);
            // Update canvas container class for measure tool cursor
            canvasContainer.classList.toggle('tool-measure', tool === 'measure');
            // Update calibration warning visibility
            updateCalibrationWarning();
        }

        /**
         * Get appropriate cursor for the current tool
         * @param {string} tool - Tool name
         * @param {boolean} dragging - Whether currently dragging
         * @returns {string} CSS cursor value
         */
        function getCursorForTool(tool, dragging) {
            switch (tool) {
                case 'wl': return dragging ? 'ns-resize' : 'crosshair';
                case 'pan': return dragging ? 'grabbing' : 'grab';
                case 'zoom': return dragging ? 'ns-resize' : 'zoom-in';
                case 'measure': return 'crosshair';
                default: return 'default';
            }
        }

        /**
         * Apply CSS transform for pan and zoom
         */
        function applyViewTransform() {
            const { panX, panY, zoom } = state.viewTransform;
            canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
            canvas.style.transformOrigin = 'center center';
            // Redraw measurements to account for new transform
            drawMeasurements();
        }

        /**
         * Update the W/L display in the toolbar
         */
        function updateWLDisplay() {
            const wc = state.windowLevel.center ?? state.baseWindowLevel.center;
            const ww = state.windowLevel.width ?? state.baseWindowLevel.width;
            if (wc !== null && ww !== null) {
                wlDisplay.textContent = `C: ${Math.round(wc)} W: ${Math.round(ww)}`;
            }
        }

        /**
         * Re-render the current slice with current W/L settings
         */
        async function reRenderCurrentSlice() {
            if (!state.currentSeries) return;
            const dataSet = state.sliceCache.get(state.currentSliceIndex);
            if (dataSet) {
                const wlOverride = (state.windowLevel.center !== null && state.windowLevel.width !== null)
                    ? state.windowLevel : null;
                await renderDicom(dataSet, wlOverride);
            }
        }

        /**
         * Handle Window/Level drag
         */
        function handleWLDrag(dx, dy) {
            const sensitivity = 2;
            const currentWidth = state.windowLevel.width ?? state.baseWindowLevel.width;
            const currentCenter = state.windowLevel.center ?? state.baseWindowLevel.center;

            state.windowLevel.width = Math.max(1, currentWidth + dx * sensitivity);
            state.windowLevel.center = currentCenter - dy * sensitivity;

            reRenderCurrentSlice();
            updateWLDisplay();
        }

        /**
         * Handle Pan drag
         */
        function handlePanDrag(dx, dy) {
            state.viewTransform.panX += dx;
            state.viewTransform.panY += dy;
            applyViewTransform();
        }

        /**
         * Handle Zoom drag
         */
        function handleZoomDrag(dx, dy) {
            const sensitivity = 0.005;
            const delta = -dy * sensitivity;
            state.viewTransform.zoom = Math.max(0.1, Math.min(10, state.viewTransform.zoom + delta));
            applyViewTransform();
        }

        /**
         * Reset view to default state
         */
        function resetView() {
            state.viewTransform = { panX: 0, panY: 0, zoom: 1 };
            state.windowLevel = { center: null, width: null };
            applyViewTransform();
            reRenderCurrentSlice();
            updateWLDisplay();
        }

        /**
         * Reset view when switching series
         */
        function resetViewForNewSeries() {
            state.viewTransform = { panX: 0, panY: 0, zoom: 1 };
            state.windowLevel = { center: null, width: null };
            state.baseWindowLevel = { center: null, width: null };
            // Clear measurements for new series
            state.measurements.clear();
            state.activeMeasurement = null;
            state.pixelSpacing = null;
            applyViewTransform();
            updateCalibrationWarning();
        }

        // Mouse event handlers for canvas tools
        function onCanvasMouseDown(e) {
            if (!state.currentTool || e.button !== 0) return;

            // Handle measure tool separately
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
            // Handle measure tool separately
            if (state.currentTool === 'measure' && state.activeMeasurement) {
                handleMeasureMouseMove(e);
                return;
            }

            if (!state.isDragging) return;
            const dx = e.clientX - state.dragStart.x;
            const dy = e.clientY - state.dragStart.y;

            switch (state.currentTool) {
                case 'wl': handleWLDrag(dx, dy); break;
                case 'pan': handlePanDrag(dx, dy); break;
                case 'zoom': handleZoomDrag(dx, dy); break;
            }

            state.dragStart = { x: e.clientX, y: e.clientY };
        }

        function onCanvasMouseUp(e) {
            // Handle measure tool separately
            if (state.currentTool === 'measure' && state.activeMeasurement) {
                handleMeasureMouseUp(e);
                return;
            }

            if (state.isDragging) {
                state.isDragging = false;
                canvas.style.cursor = getCursorForTool(state.currentTool, false);
            }
        }

        /**
         * Handle mouse down for measure tool - start new measurement
         */
        function handleMeasureMouseDown(e) {
            const imageCoords = screenToImage(e.clientX, e.clientY);

            // Clamp to image bounds
            imageCoords.x = Math.max(0, Math.min(canvas.width - 1, imageCoords.x));
            imageCoords.y = Math.max(0, Math.min(canvas.height - 1, imageCoords.y));

            // Start new measurement
            state.activeMeasurement = createMeasurement(imageCoords, imageCoords);
            canvasContainer.classList.add('measuring');
            e.preventDefault();
        }

        /**
         * Handle mouse move for measure tool - update active measurement endpoint
         */
        function handleMeasureMouseMove(e) {
            if (!state.activeMeasurement) return;

            const imageCoords = screenToImage(e.clientX, e.clientY);

            // Clamp to image bounds
            imageCoords.x = Math.max(0, Math.min(canvas.width - 1, imageCoords.x));
            imageCoords.y = Math.max(0, Math.min(canvas.height - 1, imageCoords.y));

            // Update endpoint
            state.activeMeasurement.points[1] = { x: imageCoords.x, y: imageCoords.y };

            // Recalculate distance
            const { distancePixels, distanceMm } = calculateDistance(
                state.activeMeasurement.points[0],
                state.activeMeasurement.points[1],
                state.pixelSpacing
            );
            state.activeMeasurement.distancePixels = distancePixels;
            state.activeMeasurement.distanceMm = distanceMm;

            // Redraw
            drawMeasurements();
        }

        /**
         * Handle mouse up for measure tool - finalize measurement
         */
        function handleMeasureMouseUp(e) {
            if (!state.activeMeasurement) return;

            // Discard very small measurements (< 3 pixels)
            if (state.activeMeasurement.distancePixels < 3) {
                state.activeMeasurement = null;
                canvasContainer.classList.remove('measuring');
                drawMeasurements();
                return;
            }

            // Add to measurements collection
            addMeasurement(state.activeMeasurement);
            state.activeMeasurement = null;
            canvasContainer.classList.remove('measuring');
            drawMeasurements();
        }

        // =====================================================================
        // EVENT HANDLERS
        // Drag-and-drop, keyboard navigation, mouse wheel scrolling
        // =====================================================================

        studiesTableHead.addEventListener('click', handleSortClick);
        studiesTableHead.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSortClick(e);
            }
        });

        // Drag-and-drop handlers for folder loading
        folderZone.addEventListener('dragover', e => { e.preventDefault(); folderZone.classList.add('dragover'); });
        folderZone.addEventListener('dragleave', e => { e.preventDefault(); folderZone.classList.remove('dragover'); });

        folderZone.addEventListener('drop', async e => {
            e.preventDefault();
            folderZone.classList.remove('dragover');
            if (libraryAbort) {
                libraryAbort.abort();
                libraryAbort = null;
            }

            uploadProgress.style.display = 'flex';
            progressText.textContent = 'Reading folder...';
            progressDetail.textContent = '';
            progressFill.style.width = '0%';

            try {
                const items = e.dataTransfer.items;
                if (!items?.[0]?.getAsFileSystemHandle) {
                    throw new Error('Please use Chrome or Edge for folder drop support');
                }

                const handle = await items[0].getAsFileSystemHandle();
                if (handle.kind !== 'directory') {
                    throw new Error('Please drop a folder, not a file');
                }

                progressText.textContent = 'Finding files...';
                const fileHandles = await getAllFileHandles(handle);
                progressDetail.textContent = `Found ${fileHandles.length} files`;

                if (!fileHandles.length) throw new Error('No files found');

                state.studies = await processFiles(fileHandles);
                uploadProgress.style.display = 'none';
                await displayStudies();

            } catch (err) {
                uploadProgress.style.display = 'none';
                alert('Error: ' + err.message);
            }
        });

        backBtn.onclick = e => { e.preventDefault(); closeViewer(); };
        slider.oninput = () => loadSlice(parseInt(slider.value));
        prevBtn.onclick = () => { if (state.currentSliceIndex > 0) loadSlice(state.currentSliceIndex - 1); };
        nextBtn.onclick = () => {
            if (state.currentSeries && state.currentSliceIndex < state.currentSeries.slices.length - 1)
                loadSlice(state.currentSliceIndex + 1);
        };

        // Load sample scan (reusable for CT and MRI)
        async function loadSampleScan(samplePath, button, buttonLabel) {
            if (libraryAbort) {
                libraryAbort.abort();
                libraryAbort = null;
            }
            button.disabled = true;
            button.textContent = 'Loading...';
            uploadProgress.style.display = 'flex';
            progressText.textContent = 'Loading sample scan...';
            progressDetail.textContent = '';
            progressFill.style.width = '0%';

            try {
                // Fetch the manifest of sample files
                const manifestRes = await fetch(`${samplePath}/manifest.json`);
                const fileNames = await manifestRes.json();

                progressText.textContent = 'Downloading DICOM files...';
                progressDetail.textContent = `0/${fileNames.length} files`;

                // Fetch all DICOM files
                const filePromises = fileNames.map(async (name, i) => {
                    const res = await fetch(`${samplePath}/${name}`);
                    const blob = await res.blob();
                    // Update progress periodically
                    if ((i + 1) % 5 === 0 || i === fileNames.length - 1) {
                        const pct = Math.round(((i + 1) / fileNames.length) * 50);
                        progressFill.style.width = pct + '%';
                        progressDetail.textContent = `${i + 1}/${fileNames.length} files`;
                    }
                    return { name, blob };
                });

                const files = await Promise.all(filePromises);

                progressText.textContent = 'Processing DICOM files...';
                progressFill.style.width = '50%';

                // Process files similar to processFiles but with blobs
                const studies = {};
                let processed = 0;

                for (const { name, blob } of files) {
                    const meta = await parseDicomMetadata(blob);
                    processed++;

                    const pct = 50 + Math.round((processed / files.length) * 50);
                    progressFill.style.width = pct + '%';
                    progressDetail.textContent = `Processing ${processed}/${files.length}`;

                    if (!meta?.studyInstanceUid) continue;

                    const studyUid = meta.studyInstanceUid;
                    const seriesUid = meta.seriesInstanceUid;

                    if (!studies[studyUid]) {
                        studies[studyUid] = {
                            ...meta,
                            series: {},
                            comments: []
                        };
                    }

                    if (!studies[studyUid].series[seriesUid]) {
                        studies[studyUid].series[seriesUid] = {
                            seriesInstanceUid: seriesUid,
                            seriesNumber: meta.seriesNumber,
                            seriesDescription: meta.seriesDescription,
                            modality: meta.modality,
                            transferSyntax: meta.transferSyntax,
                            slices: [],
                            comments: []
                        };
                    }

                    studies[studyUid].series[seriesUid].slices.push({
                        instanceNumber: meta.instanceNumber,
                        sliceLocation: meta.sliceLocation,
                        blob: blob  // Store blob instead of handle
                    });
                }

                // Sort slices and calculate counts
                for (const study of Object.values(studies)) {
                    let imageCount = 0;
                    for (const series of Object.values(study.series)) {
                        series.slices.sort((a, b) =>
                            (a.sliceLocation ?? a.instanceNumber ?? 0) -
                            (b.sliceLocation ?? b.instanceNumber ?? 0)
                        );
                        imageCount += series.slices.length;
                    }
                    study.seriesCount = Object.keys(study.series).length;
                    study.imageCount = imageCount;
                }

                state.studies = studies;
                uploadProgress.style.display = 'none';
                await displayStudies();
                button.textContent = buttonLabel;
                button.disabled = false;

            } catch (err) {
                uploadProgress.style.display = 'none';
                button.textContent = buttonLabel;
                button.disabled = false;
                alert('Error loading sample: ' + err.message);
            }
        }

        loadSampleCtBtn.onclick = () => loadSampleScan('sample', loadSampleCtBtn, 'CT Scan');
        loadSampleMriBtn.onclick = () => loadSampleScan('sample-mri', loadSampleMriBtn, 'MRI Scan');

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

            // Delete/Backspace for measurements when measure tool is active
            if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && state.currentTool === 'measure') {
                e.preventDefault();
                if (e.shiftKey) {
                    clearSliceMeasurements();  // Shift+Delete clears all on slice
                } else {
                    deleteLastMeasurement();   // Delete removes most recent
                }
                return;
            }

            // Tool shortcuts (only when not typing in an input)
            if (!isTyping) {
                switch (e.key.toLowerCase()) {
                    case 'w': setTool('wl'); return;
                    case 'p': setTool('pan'); return;
                    case 'z': setTool('zoom'); return;
                    case 'm': setTool('measure'); return;
                    case 'r': resetView(); return;
                }
            }

            // Navigation shortcuts
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (state.currentSliceIndex > 0) loadSlice(state.currentSliceIndex - 1);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                if (state.currentSeries && state.currentSliceIndex < state.currentSeries.slices.length - 1)
                    loadSlice(state.currentSliceIndex + 1);
            } else if (e.key === 'Escape') {
                // Close report viewer first if open, otherwise close main viewer
                if ($('reportViewer').style.display !== 'none') {
                    closeReportViewer();
                } else {
                    closeViewer();
                }
            }
        });

        // Canvas mouse events for tools
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mouseup', onCanvasMouseUp);
        canvas.addEventListener('mouseleave', onCanvasMouseUp);

        // Right-click to delete measurement
        canvas.addEventListener('contextmenu', e => {
            if (state.currentTool !== 'measure') return;

            e.preventDefault();
            const imageCoords = screenToImage(e.clientX, e.clientY);
            const measurement = findMeasurementAtPoint(imageCoords.x, imageCoords.y);

            if (measurement) {
                deleteMeasurement(measurement.id);
            }
        });

        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (state.currentTool === 'zoom') {
                // Zoom mode: scroll to zoom
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                state.viewTransform.zoom = Math.max(0.1, Math.min(10, state.viewTransform.zoom + delta));
                applyViewTransform();
            } else {
                // Default: scroll to navigate slices
                if (e.deltaY > 0) {
                    if (state.currentSeries && state.currentSliceIndex < state.currentSeries.slices.length - 1)
                        loadSlice(state.currentSliceIndex + 1);
                } else {
                    if (state.currentSliceIndex > 0) loadSlice(state.currentSliceIndex - 1);
                }
            }
        });

        // Toolbar button events
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => setTool(btn.dataset.tool));
        });
        resetViewBtn.addEventListener('click', resetView);

        // Report viewer close button
        $('closeReportViewer').addEventListener('click', closeReportViewer);
        $('closeHelpViewer').addEventListener('click', closeHelpViewer);

        // Help buttons (library + viewer headers)
        document.querySelectorAll('.help-btn').forEach(btn => {
            btn.addEventListener('click', openHelpViewer);
        });

        // Initialize cursor for default tool
        canvas.style.cursor = getCursorForTool(state.currentTool, false);

        // =====================================================================
        // API DATA MODES
        // Test mode (?test) and local library mode (personal)
        // =====================================================================

        const searchParams = new URLSearchParams(window.location.search);
        const isTestMode = searchParams.has('test');
        const noLib = searchParams.has('nolib');
        let libraryAbort = null;

        function setLibraryFolderStatus(message, tone = '') {
            if (!message) {
                libraryFolderStatus.style.display = 'none';
                libraryFolderStatus.textContent = '';
                libraryFolderStatus.className = 'library-folder-status';
                return;
            }

            libraryFolderStatus.textContent = message;
            libraryFolderStatus.className = `library-folder-status ${tone}`.trim();
            libraryFolderStatus.style.display = 'block';
        }

        function setLibraryFolderMessage(message, tone = '') {
            if (!message) {
                libraryFolderMessage.style.display = 'none';
                libraryFolderMessage.textContent = '';
                libraryFolderMessage.className = 'library-folder-message';
                return;
            }

            libraryFolderMessage.textContent = message;
            libraryFolderMessage.className = `library-folder-message ${tone}`.trim();
            libraryFolderMessage.style.display = 'block';
        }

        function applyLibraryConfigPayload(payload, options = {}) {
            const { preserveInput = false } = options;
            state.libraryConfigReachable = true;
            state.libraryFolderSource = payload.source || '';
            state.libraryFolderResolved = payload.folderResolved || '';
            state.libraryFolder = payload.folder || '';

            if (!preserveInput) {
                libraryFolderInput.value = state.libraryFolder;
            }

            if (state.libraryFolderSource === 'env') {
                setLibraryFolderStatus(
                    'Currently overridden by DICOM_LIBRARY environment variable.',
                    'warning'
                );
            } else {
                setLibraryFolderStatus('');
            }
        }

        async function loadLibraryConfig() {
            const response = await fetch('/api/library/config');
            if (!response.ok) throw new Error(`Failed to load library config: ${response.status}`);
            const payload = await response.json().catch(() => {
                throw new Error('Library config response was not valid JSON');
            });
            applyLibraryConfigPayload(payload);
            return payload;
        }

        async function saveLibraryFolderConfig() {
            const folder = libraryFolderInput.value.trim();
            if (!folder) {
                setLibraryFolderMessage('Enter a folder path.', 'error');
                return;
            }

            saveLibraryFolderBtn.disabled = true;
            const previousText = saveLibraryFolderBtn.textContent;
            saveLibraryFolderBtn.textContent = 'Saving...';
            setLibraryFolderMessage('');

            try {
                const response = await fetch('/api/library/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folder })
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.error || `Failed to save library folder: ${response.status}`);
                }

                const result = normalizeStudiesPayload(payload, '/api/library');
                state.libraryAvailable = !!result.available;
                state.studies = result.studies;
                applyLibraryConfigPayload(payload, { preserveInput: !!payload.overridden });

                if (payload.overridden) {
                    libraryFolderInput.value = folder;
                    setLibraryFolderMessage(
                        'Saved. Will take effect when the DICOM_LIBRARY environment variable is removed.',
                        'info'
                    );
                } else {
                    setLibraryFolderMessage('Library folder updated.', 'success');
                }

                await displayStudies();
            } catch (e) {
                setLibraryFolderMessage(e.message || 'Failed to save library folder.', 'error');
            } finally {
                saveLibraryFolderBtn.disabled = false;
                saveLibraryFolderBtn.textContent = previousText;
            }
        }

        async function refreshLibrary() {
            if (libraryAbort) {
                libraryAbort.abort();
                libraryAbort = null;
            }
            refreshLibraryBtn.disabled = true;
            const previousText = refreshLibraryBtn.textContent;
            refreshLibraryBtn.textContent = 'Refreshing...';
            try {
                const response = await fetch('/api/library/refresh', { method: 'POST' });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || `Failed to refresh library: ${response.status}`);
                }
                const result = normalizeStudiesPayload(payload, '/api/library');
                state.libraryAvailable = !!result.available;
                if (result.folder) state.libraryFolder = result.folder;
                state.studies = result.studies;
                await displayStudies();
            } catch (e) {
                alert(`Failed to refresh library: ${e.message}`);
            } finally {
                refreshLibraryBtn.disabled = false;
                refreshLibraryBtn.textContent = previousText;
            }
        }

        refreshLibraryBtn.addEventListener('click', refreshLibrary);
        saveLibraryFolderBtn.addEventListener('click', saveLibraryFolderConfig);
        libraryFolderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveLibraryFolderConfig();
            }
        });

        // Auto-load test data if in test mode
        if (isTestMode) {
            console.log('Test mode enabled - loading test data from server');
            (async () => {
                try {
                    uploadProgress.style.display = 'flex';
                    progressText.textContent = 'Loading test data...';
                    progressDetail.textContent = '';

                    const result = await loadStudiesFromApi('/api/test-data');
                    state.studies = result.studies;

                    uploadProgress.style.display = 'none';
                    await displayStudies();

                    // Auto-open first study/series if available
                    const studyIds = Object.keys(state.studies);
                    if (studyIds.length > 0) {
                        const firstStudy = state.studies[studyIds[0]];
                        const seriesIds = Object.keys(firstStudy.series);
                        if (seriesIds.length > 0) {
                            console.log('Auto-opening first series for testing');
                            openViewerWithSeries(studyIds[0], seriesIds[0]);

                            // Auto-advance past blank slices to find displayable content
                            // MPR reconstructions often have blank padding slices at the start
                            const maxSkip = 50;
                            for (let i = 0; i < maxSkip && state.currentSeries; i++) {
                                // Check if current W/L is set (non-blank slice)
                                if (state.baseWindowLevel.center !== null) {
                                    console.log(`Found non-blank slice at index ${state.currentSliceIndex}`);
                                    break;
                                }
                                // Advance to next slice
                                if (state.currentSliceIndex < state.currentSeries.slices.length - 1) {
                                    await loadSlice(state.currentSliceIndex + 1);
                                } else {
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to load test data:', e);
                    uploadProgress.style.display = 'none';
                    alert('Failed to load test data: ' + e.message);
                }
            })();
        } else if (CONFIG.features.libraryAutoLoad && !noLib) {
            const libraryConfigPromise = loadLibraryConfig().catch(e => {
                state.libraryConfigReachable = false;
                setLibraryFolderStatus('');
                console.warn('Failed to load library config:', e);
                return null;
            });

            libraryAbort = new AbortController();
            loadStudiesFromApi('/api/library', { signal: libraryAbort.signal })
                .then(async result => {
                    libraryAbort = null;
                    await libraryConfigPromise;
                    state.libraryAvailable = !!result.available;
                    if (result.folder) state.libraryFolder = result.folder;
                    state.studies = result.studies;
                    await displayStudies();
                })
                .catch(async e => {
                    libraryAbort = null;
                    await libraryConfigPromise;
                    if (e.name === 'AbortError') return;
                    await displayStudies();
                });
        } else {
            displayStudies();
        }
