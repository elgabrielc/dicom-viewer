(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const config = window.CONFIG;
    const { state } = app;
    const { canvas, ctx } = app.dom;
    const { getString, getNumber, getPixelDataArrayType } = app.utils;
    const {
        isCompressed,
        isJpegLossless,
        isJpegBaseline,
        isJpeg2000,
        getNumberOfFrames,
        getTransferSyntaxInfo,
        getModalityDefaults,
        calculateAutoWindowLevel,
        isBlankSlice,
        displayBlankSlice,
        decodeJpegLossless,
        decodeJpeg2000,
        decodeJpegBaseline
    } = app.dicom;
    // JPEG 2000 fluoroscopy/angiography studies are the desktop-native-first route because
    // the browser WASM path has shown vendor-specific failures on these modalities.
    const HIGH_RISK_SYNTAXES = new Map([
        ['1.2.840.10008.1.2.4.90', new Set(['RF', 'XA'])],
        ['1.2.840.10008.1.2.4.91', new Set(['RF', 'XA'])]
    ]);
    const DEBUG_DECODE_MODE_STORAGE_KEY = 'dicom-viewer-debug-decode-mode';
    const DEBUG_PRELOAD_MODE_STORAGE_KEY = 'dicom-viewer-debug-preload-mode';
    let desktopDebugSettings = {
        loaded: false,
        decodeMode: 'auto',
        preloadMode: 'auto',
        frontendDecodeTrace: false,
        nativeDecodeDebug: false
    };
    const INCOMPATIBLE_WINDOW_WIDTH_RATIO = 4;
    let reusableRenderImageData = null;
    let frontendDecodeTraceSequence = 0;

    function normalizeDecodeMode(value) {
        if (typeof value !== 'string') {
            return 'auto';
        }

        switch (value.toLowerCase()) {
            case 'js':
            case 'native':
            case 'auto':
                return value.toLowerCase();
            default:
                return 'auto';
        }
    }

    function normalizePreloadMode(value) {
        if (typeof value !== 'string') {
            return 'auto';
        }

        switch (value.toLowerCase()) {
            case 'on':
            case 'off':
            case 'auto':
                return value.toLowerCase();
            default:
                return 'auto';
        }
    }

    function getStoredDecodeMode() {
        try {
            return normalizeDecodeMode(localStorage.getItem(DEBUG_DECODE_MODE_STORAGE_KEY));
        } catch {
            return 'auto';
        }
    }

    function getStoredPreloadMode() {
        try {
            return normalizePreloadMode(localStorage.getItem(DEBUG_PRELOAD_MODE_STORAGE_KEY));
        } catch {
            return 'auto';
        }
    }

    function getQueryDecodeMode() {
        try {
            return normalizeDecodeMode(new URLSearchParams(window.location.search).get('decodeMode'));
        } catch {
            return 'auto';
        }
    }

    function getQueryPreloadMode() {
        try {
            return normalizePreloadMode(new URLSearchParams(window.location.search).get('preloadMode'));
        } catch {
            return 'auto';
        }
    }

    function getRuntimeDebugSettings() {
        const runtimeSettings = window.__DICOM_VIEWER_DEBUG__ || {};
        return {
            decodeMode: normalizeDecodeMode(runtimeSettings.decodeMode),
            preloadMode: normalizePreloadMode(runtimeSettings.preloadMode),
            frontendDecodeTrace: !!runtimeSettings.frontendDecodeTrace,
            nativeDecodeDebug: !!runtimeSettings.nativeDecodeDebug
        };
    }

    async function hydrateDebugSettings() {
        const runtimeSettings = getRuntimeDebugSettings();
        let decodeMode = getQueryDecodeMode();
        let preloadMode = getQueryPreloadMode();
        let frontendDecodeTrace = runtimeSettings.frontendDecodeTrace;
        let nativeDecodeDebug = runtimeSettings.nativeDecodeDebug;
        let nativeDecodeMode = 'auto';
        let nativePreloadMode = 'auto';

        if (config.deploymentMode === 'desktop') {
            const invoke = window.__TAURI__?.core?.invoke;
            if (typeof invoke === 'function') {
                try {
                    const nativeSettings = await invoke('get_debug_settings');
                    nativeDecodeMode = normalizeDecodeMode(nativeSettings?.decodeMode);
                    nativePreloadMode = normalizePreloadMode(nativeSettings?.preloadMode);
                    frontendDecodeTrace = frontendDecodeTrace || !!nativeSettings?.frontendDecodeTrace;
                    nativeDecodeDebug = nativeDecodeDebug || !!nativeSettings?.nativeDecodeDebug;
                } catch (error) {
                    console.warn('Failed to load desktop debug settings:', error);
                }
            }
        }

        if (decodeMode === 'auto') {
            decodeMode = nativeDecodeMode;
        }
        if (preloadMode === 'auto') {
            preloadMode = nativePreloadMode;
        }

        if (decodeMode === 'auto') {
            decodeMode = runtimeSettings.decodeMode;
        }
        if (preloadMode === 'auto') {
            preloadMode = runtimeSettings.preloadMode;
        }

        if (decodeMode === 'auto') {
            decodeMode = getStoredDecodeMode();
        }
        if (preloadMode === 'auto') {
            preloadMode = getStoredPreloadMode();
        }

        desktopDebugSettings = {
            loaded: true,
            decodeMode,
            preloadMode,
            frontendDecodeTrace,
            nativeDecodeDebug
        };
        window.__DICOM_VIEWER_DEBUG__ = {
            ...(window.__DICOM_VIEWER_DEBUG__ || {}),
            ...desktopDebugSettings
        };
        return desktopDebugSettings;
    }

    function getActiveDecodeMode() {
        const runtimeSettings = getRuntimeDebugSettings();
        if (runtimeSettings.decodeMode !== 'auto') {
            return runtimeSettings.decodeMode;
        }
        if (desktopDebugSettings.decodeMode !== 'auto') {
            return desktopDebugSettings.decodeMode;
        }
        const queryMode = getQueryDecodeMode();
        if (queryMode !== 'auto') {
            return queryMode;
        }
        return getStoredDecodeMode();
    }

    function getActivePreloadMode() {
        const runtimeSettings = getRuntimeDebugSettings();
        if (runtimeSettings.preloadMode !== 'auto') {
            return runtimeSettings.preloadMode;
        }
        if (desktopDebugSettings.preloadMode !== 'auto') {
            return desktopDebugSettings.preloadMode;
        }
        const queryMode = getQueryPreloadMode();
        if (queryMode !== 'auto') {
            return queryMode;
        }
        return getStoredPreloadMode();
    }

    function isViewerPreloadEnabled() {
        return getActivePreloadMode() !== 'off';
    }

    function isFrontendDecodeTraceEnabled() {
        return !!(getRuntimeDebugSettings().frontendDecodeTrace || desktopDebugSettings.frontendDecodeTrace);
    }

    function normalizeTraceValue(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(normalizeTraceValue);
        }
        if (typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value)
                    .map(([key, entryValue]) => [key, normalizeTraceValue(entryValue)])
                    .filter(([, entryValue]) => entryValue !== undefined)
            );
        }
        return String(value);
    }

    async function emitDesktopDecodeTrace(event, details = {}) {
        if (!isFrontendDecodeTraceEnabled() || config.deploymentMode !== 'desktop') {
            return;
        }

        const invoke = window.__TAURI__?.core?.invoke;
        if (typeof invoke !== 'function') {
            return;
        }

        frontendDecodeTraceSequence += 1;
        const payload = {
            seq: frontendDecodeTraceSequence,
            event,
            ...normalizeTraceValue(details)
        };

        try {
            await invoke('log_frontend_decode_event', {
                message: JSON.stringify(payload)
            });
        } catch (error) {
            console.warn('Failed to emit frontend decode trace:', error);
        }
    }

    function getReusableRenderImageData(cols, rows) {
        if (
            !reusableRenderImageData ||
            reusableRenderImageData.width !== cols ||
            reusableRenderImageData.height !== rows
        ) {
            reusableRenderImageData = ctx.createImageData(cols, rows);
        }
        return reusableRenderImageData;
    }

    function hasWindowLevel(windowLevel) {
        return Number.isFinite(windowLevel?.center) &&
            Number.isFinite(windowLevel?.width) &&
            windowLevel.width > 0;
    }

    function shouldResetWindowLevelOverride(decoded, wlOverride) {
        if (!hasWindowLevel(wlOverride)) {
            return false;
        }

        const previousBaseWidth = Number(state.baseWindowLevel.width);
        const nextBaseWidth = Number(decoded.windowWidth);
        if (
            !Number.isFinite(previousBaseWidth) ||
            previousBaseWidth <= 0 ||
            !Number.isFinite(nextBaseWidth) ||
            nextBaseWidth <= 0
        ) {
            return false;
        }

        const widthRatio = Math.max(previousBaseWidth, nextBaseWidth) / Math.min(previousBaseWidth, nextBaseWidth);
        if (widthRatio > INCOMPATIBLE_WINDOW_WIDTH_RATIO) {
            return true;
        }

        const previousBaseCenter = Number(state.baseWindowLevel.center);
        const nextBaseCenter = Number(decoded.windowCenter);
        if (!Number.isFinite(previousBaseCenter) || !Number.isFinite(nextBaseCenter)) {
            return false;
        }

        return Math.abs(previousBaseCenter - nextBaseCenter) > Math.max(previousBaseWidth, nextBaseWidth);
    }

    function getUncompressedFramePixelData(
        dataSet,
        pixelDataElement,
        rows,
        cols,
        bitsAllocated,
        pixelRepresentation,
        samplesPerPixel,
        frameIndex = 0
    ) {
        if (bitsAllocated % 8 !== 0) {
            throw new Error(`Native pixel data with Bits Allocated ${bitsAllocated} is not byte-aligned.`);
        }

        const framePixelCount = rows * cols * samplesPerPixel;
        const bytesPerSample = Math.max(1, Math.ceil(bitsAllocated / 8));
        const expectedFrameBytes = framePixelCount * bytesPerSample;
        const numberOfFrames = getNumberOfFrames(dataSet);
        const totalPixelBytes = Number.isFinite(pixelDataElement.length)
            ? pixelDataElement.length
            : (dataSet.byteArray.byteLength - pixelDataElement.dataOffset);

        if (frameIndex < 0 || frameIndex >= numberOfFrames) {
            throw new Error(`Frame index ${frameIndex} is outside the available native frames (${numberOfFrames}).`);
        }

        const evenlyDivisibleStride = numberOfFrames > 0 && totalPixelBytes % numberOfFrames === 0
            ? totalPixelBytes / numberOfFrames
            : null;
        const frameStrideBytes = evenlyDivisibleStride && evenlyDivisibleStride >= expectedFrameBytes
            ? evenlyDivisibleStride
            : expectedFrameBytes;
        const frameDataOffset = pixelDataElement.dataOffset + (frameIndex * frameStrideBytes);
        const frameDataEnd = frameDataOffset + expectedFrameBytes;
        const pixelDataEnd = pixelDataElement.dataOffset + totalPixelBytes;

        if (frameDataEnd > pixelDataEnd) {
            throw new Error('Native pixel data is shorter than the requested frame payload.');
        }

        const PixelArrayType = getPixelDataArrayType(bitsAllocated, pixelRepresentation);
        const bufferOffset = dataSet.byteArray.byteOffset + frameDataOffset;

        // Return a detached copy so future consumers can safely mutate decoded.pixelData.
        return new PixelArrayType(dataSet.byteArray.buffer, bufferOffset, framePixelCount).slice();
    }

    // =====================================================================
    // RENDERING
    // Converts decoded pixel data to visible image on canvas
    // =====================================================================

    /**
     * Display an error message on the canvas when image cannot be decoded
     * @param {string} message - Main error message
     * @param {string} details - Additional details (e.g., format name)
     */
    function displayError(message, details, diagnostics = []) {
        canvas.width = 512;
        canvas.height = 512;
        ctx.fillStyle = '#0F1E14';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#f0ad4e';
        ctx.font = 'bold 18px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ Unable to Display Image', canvas.width / 2, 200);

        ctx.fillStyle = '#ccc';
        ctx.font = '14px -apple-system, sans-serif';
        ctx.fillText(message, canvas.width / 2, 240);

        let nextLineY = 270;
        if (details) {
            ctx.fillStyle = '#888';
            ctx.font = '12px -apple-system, sans-serif';
            ctx.fillText(details, canvas.width / 2, nextLineY);
            nextLineY += 28;
        }

        for (const diagnosticLine of diagnostics.filter(Boolean)) {
            ctx.fillStyle = '#9aa5b1';
            ctx.font = '12px -apple-system, sans-serif';
            ctx.fillText(diagnosticLine, canvas.width / 2, nextLineY);
            nextLineY += 20;
        }

        ctx.fillStyle = '#666';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillText('This format may require additional decoders', canvas.width / 2, Math.max(nextLineY + 12, 310));
    }

    function buildRenderInfo(decoded, windowCenter, windowWidth, extra = {}) {
        return {
            rows: decoded.rows,
            cols: decoded.cols,
            wc: windowCenter,
            ww: windowWidth,
            transferSyntax: decoded.transferSyntax,
            modality: decoded.modality,
            mrMetadata: decoded.mrMetadata,
            ...extra
        };
    }

    function buildDecodeError(errorMessage, errorDetails, extra = {}) {
        return {
            error: true,
            errorMessage,
            errorDetails,
            stage: extra.stage || 'decode',
            ...extra
        };
    }

    function getDecodeFailureStage(error, fallbackStage = 'decode') {
        return typeof error?.stage === 'string' && error.stage ? error.stage : fallbackStage;
    }

    function buildDecodeDiagnosticLines(errorInfo) {
        const diagnosticLines = [];
        if (errorInfo.stage) {
            diagnosticLines.push(`Stage: ${errorInfo.stage}`);
        }
        if (errorInfo.tsInfo?.name) {
            diagnosticLines.push(`Transfer Syntax: ${errorInfo.tsInfo.name}`);
        } else if (errorInfo.transferSyntax) {
            diagnosticLines.push(`Transfer Syntax UID: ${errorInfo.transferSyntax}`);
        }
        if (errorInfo.modality) {
            diagnosticLines.push(`Modality: ${errorInfo.modality}`);
        }
        if (errorInfo.jsErrorStage) {
            diagnosticLines.push(`JS Stage: ${errorInfo.jsErrorStage}`);
        }
        if (errorInfo.nativeErrorStage) {
            diagnosticLines.push(`Native Stage: ${errorInfo.nativeErrorStage}`);
        }
        return diagnosticLines.slice(0, 5);
    }

    function getOptionalNumber(dataSet, tag) {
        const value = getString(dataSet, tag);
        if (!value) {
            return null;
        }

        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function getMrMetadata(dataSet) {
        return {
            repetitionTime: getNumber(dataSet, 'x00180080', 0),     // (0018,0080) TR
            echoTime: getNumber(dataSet, 'x00180081', 0),          // (0018,0081) TE
            flipAngle: getNumber(dataSet, 'x00181314', 0),         // (0018,1314) Flip Angle
            magneticFieldStrength: getNumber(dataSet, 'x00180087', 0), // (0018,0087) Field Strength
            protocolName: getString(dataSet, 'x00181030'),         // (0018,1030) Protocol Name
            sequenceName: getString(dataSet, 'x00180024'),         // (0018,0024) Sequence Name
            scanningSequence: getString(dataSet, 'x00180020'),     // (0018,0020) Scanning Sequence
            mrAcquisitionType: getString(dataSet, 'x00180023')    // (0018,0023) MR Acquisition Type (2D/3D)
        };
    }

    function resolveWindowLevel(dataSet, modality, preferredWindowCenter = null, preferredWindowWidth = null) {
        const modalityDefaults = getModalityDefaults(modality);
        const storedWindowCenter = getOptionalNumber(dataSet, 'x00281050');  // (0028,1050)
        const storedWindowWidth = getOptionalNumber(dataSet, 'x00281051');   // (0028,1051)
        const hasPreferredWindowLevel = Number.isFinite(preferredWindowCenter) &&
            Number.isFinite(preferredWindowWidth);
        const hasStoredWindowLevel = Number.isFinite(storedWindowCenter) &&
            Number.isFinite(storedWindowWidth);
        const hasWindowLevel = hasPreferredWindowLevel || hasStoredWindowLevel;

        let windowCenter = hasPreferredWindowLevel ? preferredWindowCenter : storedWindowCenter;
        let windowWidth = hasPreferredWindowLevel ? preferredWindowWidth : storedWindowWidth;

        if (!hasWindowLevel) {
            windowCenter = modalityDefaults.windowCenter;
            windowWidth = modalityDefaults.windowWidth;
        }

        return {
            windowCenter,
            windowWidth,
            hasWindowLevel
        };
    }

    function validateRenderedPixelData(decoded, sourceLabel = 'Decoded image') {
        const expectedSampleCount = decoded.rows * decoded.cols * decoded.samplesPerPixel;
        if (!Number.isInteger(expectedSampleCount) || expectedSampleCount <= 0) {
            throw new Error(
                `${sourceLabel} returned invalid dimensions (${decoded.rows}x${decoded.cols}) or Samples Per Pixel (${decoded.samplesPerPixel}).`
            );
        }

        if (decoded.pixelData.length !== expectedSampleCount) {
            throw new Error(
                `${sourceLabel} returned ${decoded.pixelData.length} sample(s) for ${decoded.rows}x${decoded.cols} with ${decoded.samplesPerPixel} sample(s) per pixel; expected ${expectedSampleCount}.`
            );
        }

        const isRgb = decoded.samplesPerPixel === 3 && decoded.photometricInterpretation === 'RGB';
        if (decoded.samplesPerPixel !== 1 && !isRgb) {
            throw new Error(
                `${sourceLabel} returned ${decoded.samplesPerPixel} sample(s) per pixel with photometric interpretation ${decoded.photometricInterpretation || 'unknown'}, but the current renderer only supports monochrome and RGB fallback data.`
            );
        }

        if (isRgb && decoded.planarConfiguration !== 0 && decoded.planarConfiguration !== 1) {
            throw new Error(
                `${sourceLabel} returned RGB data with unsupported Planar Configuration ${decoded.planarConfiguration}.`
            );
        }
    }

    function finalizeDecodedImage(decoded, hasWindowLevel) {
        if (decoded.samplesPerPixel === 1 && isBlankSlice(decoded.pixelData, decoded.rescaleSlope, decoded.rescaleIntercept)) {
            console.log('Detected blank slice (all pixels same value)');
            return {
                ...decoded,
                isBlank: true
            };
        }

        let { windowCenter, windowWidth } = decoded;
        if (
            !hasWindowLevel &&
            decoded.samplesPerPixel === 1 &&
            (decoded.modality === 'MR' || decoded.modality === 'PT' || decoded.modality === 'NM')
        ) {
            const autoWL = calculateAutoWindowLevel(decoded.pixelData, decoded.rescaleSlope, decoded.rescaleIntercept);
            windowCenter = autoWL.windowCenter;
            windowWidth = autoWL.windowWidth;
            console.log(`Auto window/level for ${decoded.modality}: C=${windowCenter} W=${windowWidth}`);
        }

        return {
            ...decoded,
            windowCenter,
            windowWidth,
            isBlank: false
        };
    }

    function getDecodeFailureMessage(error) {
        if (!error) {
            return 'Unknown decode error';
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error.errorMessage) {
            return error.errorDetails ? `${error.errorMessage}: ${error.errorDetails}` : error.errorMessage;
        }
        if (error.message) {
            return error.message;
        }
        return String(error);
    }

    function buildFallbackDecodeError(dataSet, jsFailure = null, nativeFailure = null) {
        const transferSyntax = getString(dataSet, 'x00020010');
        const modality = getString(dataSet, 'x00080060');
        const tsInfo = getTransferSyntaxInfo(transferSyntax);

        if (!nativeFailure && jsFailure?.error) {
            return {
                ...jsFailure,
                stage: getDecodeFailureStage(jsFailure),
                transferSyntax: jsFailure.transferSyntax || transferSyntax,
                modality: jsFailure.modality || modality,
                tsInfo: jsFailure.tsInfo || tsInfo
            };
        }

        const detailParts = [];
        if (jsFailure) {
            detailParts.push(`JS: ${getDecodeFailureMessage(jsFailure)}`);
        }
        if (nativeFailure) {
            detailParts.push(`Native: ${getDecodeFailureMessage(nativeFailure)}`);
        }

        return buildDecodeError(
            'Image decode failed',
            detailParts.join(' | ') || tsInfo.name,
            {
                stage: getDecodeFailureStage(jsFailure, getDecodeFailureStage(nativeFailure)),
                transferSyntax,
                modality,
                tsInfo,
                jsErrorStage: jsFailure ? getDecodeFailureStage(jsFailure) : null,
                jsErrorMessage: jsFailure ? getDecodeFailureMessage(jsFailure) : null,
                nativeErrorStage: nativeFailure ? getDecodeFailureStage(nativeFailure) : null,
                nativeErrorMessage: nativeFailure ? getDecodeFailureMessage(nativeFailure) : null
            }
        );
    }

    function canUseNativeDecode(slice) {
        return config.deploymentMode === 'desktop' &&
            typeof slice?.source?.path === 'string' &&
            slice.source.path.length > 0 &&
            typeof app.desktopDecode?.decodeFrameWithPixels === 'function';
    }

    function shouldPreferNativeDesktopPathDecode(slice, modality, frameCount = 1) {
        return canUseNativeDecode(slice) &&
            frameCount > 1 &&
            (modality === 'XA' || modality === 'RF');
    }

    function getDecodeRoute(transferSyntax, modality, slice = null, options = {}) {
        const forcedDecodeMode = getActiveDecodeMode();
        if (forcedDecodeMode === 'native') {
            return 'native-first';
        }
        if (forcedDecodeMode === 'js') {
            return 'js-first';
        }
        if (shouldPreferNativeDesktopPathDecode(slice, modality, options.frameCount)) {
            return 'native-first';
        }
        const riskyModalities = HIGH_RISK_SYNTAXES.get(transferSyntax);
        if (riskyModalities?.has(modality)) {
            return 'native-first';
        }
        return 'js-first';
    }

    function getJsDecoderKind(transferSyntax) {
        if (isJpeg2000(transferSyntax)) {
            return 'jpeg2000-worker';
        }
        if (isJpegLossless(transferSyntax)) {
            return 'jpeg-lossless';
        }
        if (isJpegBaseline(transferSyntax)) {
            return 'jpeg-baseline';
        }
        if (isCompressed(transferSyntax)) {
            return 'unsupported-compressed';
        }
        return 'uncompressed-js';
    }

    function renderDecodeError(errorInfo, options = {}) {
        const { display = true } = options;
        const normalizedError = {
            ...errorInfo,
            diagnosticLines: errorInfo.diagnosticLines || buildDecodeDiagnosticLines(errorInfo)
        };
        state.pixelSpacing = null;
        app.tools.updateCalibrationWarning();
        if (display) {
            displayError(
                normalizedError.errorMessage,
                normalizedError.errorDetails,
                normalizedError.diagnosticLines
            );
            app.tools.drawMeasurements?.();
        }
        return normalizedError;
    }

    async function decodeDicom(dataSet, frameIndex = 0) {
        // Extract image dimensions and pixel format from DICOM tags
        const rows = dataSet.uint16('x00280010');              // (0028,0010) Rows
        const cols = dataSet.uint16('x00280011');              // (0028,0011) Columns
        const bitsAllocated = dataSet.uint16('x00280100') || 16;  // (0028,0100) Bits Allocated
        const bitsStored = Math.min(bitsAllocated, dataSet.uint16('x00280101') || bitsAllocated); // (0028,0101)
        const pixelRepresentation = dataSet.uint16('x00280103') || 0;  // (0028,0103) 0=unsigned, 1=signed
        const samplesPerPixel = dataSet.uint16('x00280002') || 1;
        const planarConfiguration = samplesPerPixel > 1 ? (dataSet.uint16('x00280006') || 0) : 0;
        const photometricInterpretation = getString(dataSet, 'x00280004');
        let decodedBitsAllocated = bitsAllocated;
        let decodedBitsStored = bitsStored;
        let decodedSamplesPerPixel = samplesPerPixel;
        let decodedPlanarConfiguration = planarConfiguration;
        let decodedPhotometricInterpretation = photometricInterpretation;

        // Get modality for appropriate defaults
        const modality = getString(dataSet, 'x00080060');  // (0008,0060) Modality

        // Rescale slope/intercept for converting stored values
        // CT: converts to Hounsfield Units; MR: arbitrary signal intensity
        const rescaleSlope = getNumber(dataSet, 'x00281053', 1);     // (0028,1053)
        const rescaleIntercept = getNumber(dataSet, 'x00281052', 0); // (0028,1052)

        // Window/level for display - use modality-appropriate defaults
        const {
            windowCenter,
            windowWidth,
            hasWindowLevel
        } = resolveWindowLevel(dataSet, modality);

        // Extract pixel spacing for measurement calibration
        const pixelSpacing = app.tools.extractPixelSpacing(dataSet);

        // Extract MRI-specific metadata
        const mrMetadata = getMrMetadata(dataSet);

        // Get transfer syntax to determine compression format
        const transferSyntax = getString(dataSet, 'x00020010');  // (0002,0010)
        console.log('Transfer Syntax:', transferSyntax, 'Compressed:', isCompressed(transferSyntax));

        // Get pixel data element
        const pixelDataElement = dataSet.elements.x7fe00010;  // (7FE0,0010) Pixel Data
        const transferSyntaxInfo = getTransferSyntaxInfo(transferSyntax);

        if (!pixelDataElement) {
            console.error('No pixel data element found');
            return buildDecodeError(
                'No pixel data found',
                'The DICOM file may be corrupted or incomplete',
                {
                    stage: 'frame-extraction',
                    transferSyntax,
                    modality,
                    tsInfo: transferSyntaxInfo
                }
            );
        }

        let pixelData;
        let skipWindowLevel = false;

        // Determine if pixel data is compressed based on transfer syntax
        const isCompressedData = isCompressed(transferSyntax);

        if (isCompressedData) {
            // Decode compressed pixel data using appropriate decoder
            if (isJpeg2000(transferSyntax)) {
                try {
                    pixelData = await decodeJpeg2000(
                        dataSet,
                        pixelDataElement,
                        rows,
                        cols,
                        bitsAllocated,
                        pixelRepresentation,
                        frameIndex
                    );
                } catch (error) {
                    return buildDecodeError(
                        'JPEG 2000 decode failed',
                        getDecodeFailureMessage(error),
                        {
                            stage: getDecodeFailureStage(error),
                            transferSyntax,
                            modality,
                            tsInfo: transferSyntaxInfo
                        }
                    );
                }
            } else if (isJpegLossless(transferSyntax)) {
                try {
                    pixelData = decodeJpegLossless(
                        dataSet,
                        pixelDataElement,
                        rows,
                        cols,
                        bitsAllocated,
                        frameIndex
                    );
                } catch (error) {
                    return buildDecodeError(
                        'JPEG Lossless decode failed',
                        getDecodeFailureMessage(error),
                        {
                            stage: getDecodeFailureStage(error),
                            transferSyntax,
                            modality,
                            tsInfo: transferSyntaxInfo
                        }
                    );
                }
            } else if (isJpegBaseline(transferSyntax)) {
                let result;
                try {
                    result = await decodeJpegBaseline(dataSet, pixelDataElement, rows, cols, frameIndex);
                } catch (error) {
                    return buildDecodeError(
                        'JPEG decode failed',
                        getDecodeFailureMessage(error),
                        {
                            stage: getDecodeFailureStage(error),
                            transferSyntax,
                            modality,
                            tsInfo: transferSyntaxInfo
                        }
                    );
                }
                pixelData = result.pixelData;
                decodedBitsAllocated = result.bitsAllocated ?? bitsAllocated;
                decodedBitsStored = result.bitsStored ?? decodedBitsAllocated;
                decodedSamplesPerPixel = result.samplesPerPixel ?? samplesPerPixel;
                decodedPlanarConfiguration = result.planarConfiguration ?? planarConfiguration;
                decodedPhotometricInterpretation = result.photometricInterpretation ?? photometricInterpretation;
                skipWindowLevel = result.skipWindowLevel ?? false;
            } else {
                // Unsupported compression format
                return buildDecodeError(
                    'Unsupported compression format',
                    transferSyntaxInfo.name,
                    {
                        stage: 'decode',
                        transferSyntax,
                        modality,
                        tsInfo: transferSyntaxInfo
                    }
                );
            }
        } else {
            try {
                pixelData = getUncompressedFramePixelData(
                    dataSet,
                    pixelDataElement,
                    rows,
                    cols,
                    bitsAllocated,
                    pixelRepresentation,
                    samplesPerPixel,
                    frameIndex
                );
            } catch (error) {
                console.error('Native pixel data decode error:', error);
                return buildDecodeError(
                    'Native pixel data decode failed',
                    getDecodeFailureMessage(error),
                    {
                        stage: getDecodeFailureStage(error, 'pixel-conversion'),
                        transferSyntax,
                        modality,
                        tsInfo: transferSyntaxInfo
                    }
                );
            }
        }

        const decoded = {
            pixelData,
            rows,
            cols,
            bitsAllocated: decodedBitsAllocated,
            bitsStored: decodedBitsStored,
            pixelRepresentation,
            samplesPerPixel: decodedSamplesPerPixel,
            planarConfiguration: decodedPlanarConfiguration,
            photometricInterpretation: decodedPhotometricInterpretation,
            windowCenter,
            windowWidth,
            rescaleSlope,
            rescaleIntercept,
            modality,
            transferSyntax,
            mrMetadata,
            pixelSpacing,
            skipWindowLevel
        };
        try {
            validateRenderedPixelData(decoded, 'Decoded image');
        } catch (error) {
            return buildDecodeError(
                'Decoded pixel data is not renderable',
                getDecodeFailureMessage(error),
                {
                    stage: getDecodeFailureStage(error, 'pixel-conversion'),
                    transferSyntax,
                    modality,
                    tsInfo: transferSyntaxInfo
                }
            );
        }

        return finalizeDecodedImage(decoded, hasWindowLevel);
    }

    async function decodeNative(dataSet, filePath, frameIndex = 0) {
        if (!filePath) {
            const error = new Error('Native decode requires a desktop path-backed slice.');
            error.stage = 'decode';
            throw error;
        }

        const nativeDecoded = await app.desktopDecode.decodeFrameWithPixels(filePath, frameIndex);
        const modality = getString(dataSet, 'x00080060');
        const transferSyntax = getString(dataSet, 'x00020010');
        const photometricInterpretation = nativeDecoded.photometricInterpretation || getString(dataSet, 'x00280004');
        const rows = Number(nativeDecoded.rows);
        const cols = Number(nativeDecoded.cols);
        const bitsAllocated = Number(nativeDecoded.bitsAllocated);
        const storedBitTagValue = typeof dataSet?.uint16 === 'function'
            ? dataSet.uint16('x00280101')
            : bitsAllocated;
        const bitsStored = Math.min(
            bitsAllocated,
            Number(nativeDecoded.bitsStored || storedBitTagValue || bitsAllocated)
        );
        const pixelRepresentation = Number(nativeDecoded.pixelRepresentation);
        const samplesPerPixel = Number(nativeDecoded.samplesPerPixel || 1);
        const planarConfiguration = Number(nativeDecoded.planarConfiguration || 0);
        const {
            windowCenter,
            windowWidth,
            hasWindowLevel
        } = resolveWindowLevel(
            dataSet,
            modality,
            nativeDecoded.windowCenter,
            nativeDecoded.windowWidth
        );
        const rescaleSlope = Number.isFinite(nativeDecoded.rescaleSlope)
            ? nativeDecoded.rescaleSlope
            : getNumber(dataSet, 'x00281053', 1);
        const rescaleIntercept = Number.isFinite(nativeDecoded.rescaleIntercept)
            ? nativeDecoded.rescaleIntercept
            : getNumber(dataSet, 'x00281052', 0);
        const decoded = {
            pixelData: nativeDecoded.pixelData,
            rows,
            cols,
            bitsAllocated,
            bitsStored,
            pixelRepresentation,
            samplesPerPixel,
            planarConfiguration,
            photometricInterpretation,
            windowCenter,
            windowWidth,
            rescaleSlope,
            rescaleIntercept,
            modality,
            transferSyntax,
            mrMetadata: getMrMetadata(dataSet),
            pixelSpacing: app.tools.extractPixelSpacing(dataSet),
            skipWindowLevel: bitsAllocated <= 8 &&
                samplesPerPixel === 1 &&
                photometricInterpretation !== 'MONOCHROME1' &&
                photometricInterpretation !== 'MONOCHROME2'
        };
        try {
            validateRenderedPixelData(decoded, 'Native decode');
        } catch (error) {
            error.stage = getDecodeFailureStage(error, 'pixel-conversion');
            throw error;
        }
        return finalizeDecodedImage(decoded, hasWindowLevel);
    }

    async function decodeWithFallback(dataSet, frameIndex = 0, slice = null) {
        const transferSyntax = getString(dataSet, 'x00020010');
        const modality = getString(dataSet, 'x00080060');
        const nativeEligible = canUseNativeDecode(slice);
        const forcedDecodeMode = getActiveDecodeMode();
        const jsDecoderKind = getJsDecoderKind(transferSyntax);
        const slicePath = slice?.source?.path || null;
        const frameCount = getNumberOfFrames(dataSet);
        const route = getDecodeRoute(transferSyntax, modality, slice, { frameCount });
        let nativeError = null;

        const traceBase = {
            path: slicePath,
            frameIndex,
            frameCount,
            transferSyntax,
            modality,
            route,
            forcedDecodeMode,
            nativeEligible,
            jsDecoderKind
        };
        const traceOutcome = (event, extra = {}) => {
            void emitDesktopDecodeTrace(event, {
                ...traceBase,
                ...extra
            });
        };

        traceOutcome('decode-route');

        if (forcedDecodeMode === 'native') {
            if (!nativeEligible) {
                const fallback = buildFallbackDecodeError(
                    dataSet,
                    null,
                    createStagedError('decode', 'Forced native decode is unavailable for this slice source.')
                );
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: 'native',
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }

            try {
                const decoded = await decodeNative(dataSet, slice.source.path, frameIndex);
                traceOutcome('decode-result', {
                    outcome: decoded?.error ? 'error' : 'success',
                    decoder: 'native',
                    stage: decoded?.stage || null,
                    rows: decoded?.rows || null,
                    cols: decoded?.cols || null
                });
                return decoded;
            } catch (error) {
                const fallback = buildFallbackDecodeError(dataSet, null, error);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: 'native',
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }
        }

        if (forcedDecodeMode === 'js') {
            try {
                const decoded = await decodeDicom(dataSet, frameIndex);
                const result = decoded || buildFallbackDecodeError(dataSet, null, null);
                traceOutcome('decode-result', {
                    outcome: result?.error ? 'error' : 'success',
                    decoder: jsDecoderKind,
                    stage: result?.stage || null,
                    rows: result?.rows || null,
                    cols: result?.cols || null
                });
                return result;
            } catch (jsError) {
                const fallback = buildFallbackDecodeError(dataSet, jsError, null);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: jsDecoderKind,
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }
        }

        if (route === 'native-first' && nativeEligible) {
            try {
                const decoded = await decodeNative(dataSet, slice.source.path, frameIndex);
                traceOutcome('decode-result', {
                    outcome: decoded?.error ? 'error' : 'success',
                    decoder: 'native',
                    stage: decoded?.stage || null,
                    rows: decoded?.rows || null,
                    cols: decoded?.cols || null
                });
                return decoded;
            } catch (error) {
                nativeError = error;
                console.warn('Native decode failed, falling back to JS:', error);
                traceOutcome('decode-fallback', {
                    from: 'native',
                    to: jsDecoderKind,
                    nativeErrorStage: getDecodeFailureStage(error),
                    nativeErrorMessage: getDecodeFailureMessage(error)
                });
            }

            try {
                const decoded = await decodeDicom(dataSet, frameIndex);
                if (decoded && !decoded.error) {
                    traceOutcome('decode-result', {
                        outcome: 'success',
                        decoder: jsDecoderKind,
                        stage: decoded.stage || null,
                        rows: decoded.rows || null,
                        cols: decoded.cols || null
                    });
                    return decoded;
                }
                const fallback = buildFallbackDecodeError(dataSet, decoded, nativeError);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: jsDecoderKind,
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            } catch (jsError) {
                const fallback = buildFallbackDecodeError(dataSet, jsError, nativeError);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: jsDecoderKind,
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }
        }

        try {
            const decoded = await decodeDicom(dataSet, frameIndex);
            if (decoded && !decoded.error) {
                traceOutcome('decode-result', {
                    outcome: 'success',
                    decoder: jsDecoderKind,
                    stage: decoded.stage || null,
                    rows: decoded.rows || null,
                    cols: decoded.cols || null
                });
                return decoded;
            }

            if (!nativeEligible) {
                const fallback = decoded || buildFallbackDecodeError(dataSet, null, null);
                traceOutcome('decode-result', {
                    outcome: fallback?.error ? 'error' : 'success',
                    decoder: jsDecoderKind,
                    stage: fallback?.stage || null,
                    errorMessage: fallback?.errorMessage || null,
                    errorDetails: fallback?.errorDetails || null
                });
                return fallback;
            }

            try {
                traceOutcome('decode-fallback', {
                    from: jsDecoderKind,
                    to: 'native',
                    jsErrorStage: decoded?.stage || null,
                    jsErrorMessage: decoded?.errorDetails || decoded?.errorMessage || null
                });
                const nativeDecoded = await decodeNative(dataSet, slice.source.path, frameIndex);
                traceOutcome('decode-result', {
                    outcome: nativeDecoded?.error ? 'error' : 'success',
                    decoder: 'native',
                    stage: nativeDecoded?.stage || null,
                    rows: nativeDecoded?.rows || null,
                    cols: nativeDecoded?.cols || null
                });
                return nativeDecoded;
            } catch (error) {
                const fallback = buildFallbackDecodeError(dataSet, decoded, error);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: 'native',
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }
        } catch (jsError) {
            if (!nativeEligible) {
                const fallback = buildFallbackDecodeError(dataSet, jsError, null);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: jsDecoderKind,
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }

            try {
                traceOutcome('decode-fallback', {
                    from: jsDecoderKind,
                    to: 'native',
                    jsErrorStage: getDecodeFailureStage(jsError),
                    jsErrorMessage: getDecodeFailureMessage(jsError)
                });
                const nativeDecoded = await decodeNative(dataSet, slice.source.path, frameIndex);
                traceOutcome('decode-result', {
                    outcome: nativeDecoded?.error ? 'error' : 'success',
                    decoder: 'native',
                    stage: nativeDecoded?.stage || null,
                    rows: nativeDecoded?.rows || null,
                    cols: nativeDecoded?.cols || null
                });
                return nativeDecoded;
            } catch (nativeFallbackError) {
                const fallback = buildFallbackDecodeError(dataSet, jsError, nativeFallbackError);
                traceOutcome('decode-result', {
                    outcome: 'error',
                    decoder: 'native',
                    stage: fallback.stage,
                    errorMessage: fallback.errorMessage,
                    errorDetails: fallback.errorDetails
                });
                return fallback;
            }
        }
    }

    async function decodeDesktopPathWithHeader(dataSet, frameIndex = 0, slice = null) {
        if (!canUseNativeDecode(slice)) {
            const error = new Error('Desktop path-backed native decode is unavailable for this slice.');
            error.stage = 'decode';
            throw error;
        }

        return decodeNative(dataSet, slice.source.path, frameIndex);
    }

    function renderPixels(decoded, wlOverride = null) {
        let windowCenter = decoded.windowCenter;
        let windowWidth = decoded.windowWidth;
        let effectiveWindowLevelOverride = wlOverride;

        state.pixelSpacing = decoded.pixelSpacing || null;
        app.tools.updateCalibrationWarning();

        if (decoded.isBlank) {
            displayBlankSlice(decoded.rows, decoded.cols);
            app.tools.drawMeasurements?.();
            return buildRenderInfo(decoded, windowCenter, windowWidth, { isBlank: true });
        }

        if (shouldResetWindowLevelOverride(decoded, wlOverride)) {
            void emitDesktopDecodeTrace('wl-override-reset', {
                previousBaseCenter: state.baseWindowLevel.center,
                previousBaseWidth: state.baseWindowLevel.width,
                requestedCenter: wlOverride?.center ?? null,
                requestedWidth: wlOverride?.width ?? null,
                nextBaseCenter: decoded.windowCenter,
                nextBaseWidth: decoded.windowWidth,
                rows: decoded.rows,
                cols: decoded.cols,
                bitsAllocated: decoded.bitsAllocated,
                bitsStored: decoded.bitsStored,
                modality: decoded.modality,
                transferSyntax: decoded.transferSyntax
            });
            state.windowLevel = { center: null, width: null };
            effectiveWindowLevelOverride = null;
        }

        // Track the current slice defaults so reset and the W/L HUD stay aligned while scrubbing.
        state.baseWindowLevel = { center: windowCenter, width: windowWidth };

        // Apply W/L override if provided (from user drag adjustment)
        if (hasWindowLevel(effectiveWindowLevelOverride)) {
            windowCenter = effectiveWindowLevelOverride.center;
            windowWidth = effectiveWindowLevelOverride.width;
        }

        // Avoid reallocating the canvas backing store for every same-sized slice.
        if (canvas.width !== decoded.cols || canvas.height !== decoded.rows) {
            canvas.width = decoded.cols;
            canvas.height = decoded.rows;
            reusableRenderImageData = null;
        }

        // Reuse the RGBA output buffer across same-sized renders to reduce churn during scrub.
        const imageData = getReusableRenderImageData(decoded.cols, decoded.rows);
        const outputPixels = imageData.data;

        // Calculate window/level range (min/max displayable values)
        const windowMin = windowCenter - windowWidth / 2;
        const windowMax = windowCenter + windowWidth / 2;
        const windowDivisor = Math.max(windowMax - windowMin, 1);

        if (decoded.samplesPerPixel === 3 && decoded.photometricInterpretation === 'RGB') {
            const planeSize = decoded.rows * decoded.cols;
            const rgbBitDepth = Math.max(
                1,
                Math.min(
                    Number(decoded.bitsStored || decoded.bitsAllocated || 8),
                    Number(decoded.bitsAllocated || 8)
                )
            );
            const rgbScale = rgbBitDepth > 8 ? 255 / ((2 ** rgbBitDepth) - 1) : 1;
            for (let i = 0; i < planeSize; i++) {
                const pixelIndex = i * 4;
                if (decoded.planarConfiguration === 1) {
                    outputPixels[pixelIndex] = Math.round(decoded.pixelData[i] * rgbScale);
                    outputPixels[pixelIndex + 1] = Math.round(decoded.pixelData[i + planeSize] * rgbScale);
                    outputPixels[pixelIndex + 2] = Math.round(decoded.pixelData[i + (planeSize * 2)] * rgbScale);
                } else {
                    const interleavedIndex = i * 3;
                    outputPixels[pixelIndex] = Math.round(decoded.pixelData[interleavedIndex] * rgbScale);
                    outputPixels[pixelIndex + 1] = Math.round(decoded.pixelData[interleavedIndex + 1] * rgbScale);
                    outputPixels[pixelIndex + 2] = Math.round(decoded.pixelData[interleavedIndex + 2] * rgbScale);
                }
                outputPixels[pixelIndex + 3] = 255;
            }
        } else {
            // Apply rescale and window/level transform to each pixel
            for (let i = 0; i < decoded.pixelData.length; i++) {
                let grayscaleValue;
                if (decoded.skipWindowLevel) {
                    // Already 0-255 (e.g., from JPEG baseline decode)
                    grayscaleValue = decoded.pixelData[i];
                } else {
                    // Apply rescale slope/intercept
                    // CT: converts to Hounsfield Units; MR: arbitrary signal intensity
                    let pixelValue = decoded.pixelData[i] * decoded.rescaleSlope + decoded.rescaleIntercept;
                    // Clamp to window range and scale to 0-255
                    pixelValue = Math.max(windowMin, Math.min(windowMax, pixelValue));
                    grayscaleValue = Math.round(((pixelValue - windowMin) / windowDivisor) * 255);
                }
                if (decoded.photometricInterpretation === 'MONOCHROME1') {
                    grayscaleValue = 255 - grayscaleValue;
                }
                // Set RGBA values (grayscale = R=G=B, alpha=255)
                const pixelIndex = i * 4;
                outputPixels[pixelIndex] = grayscaleValue;      // R
                outputPixels[pixelIndex + 1] = grayscaleValue;  // G
                outputPixels[pixelIndex + 2] = grayscaleValue;  // B
                outputPixels[pixelIndex + 3] = 255;             // A (opaque)
            }
        }

        // Draw to canvas and keep the measurement overlay aligned with the new image size.
        ctx.putImageData(imageData, 0, 0);
        app.tools.drawMeasurements?.();

        return buildRenderInfo(decoded, windowCenter, windowWidth);
    }

    /**
     * Render a DICOM dataset to the canvas
     * Handles decompression, window/level adjustment, and display
     *
     * @param {Object} dataSet - Parsed dicomParser dataset with pixel data
     * @param {Object|null} wlOverride - Optional {center, width} to override DICOM values
     * @returns {Promise<Object>} Rendering info {rows, cols, wc, ww, transferSyntax} or {error: true}
     */
    async function renderDicom(dataSet, wlOverride = null, frameIndex = 0, slice = null, options = {}) {
        const { displayErrors = true } = options;
        const decoded = await decodeWithFallback(dataSet, frameIndex, slice);
        if (!decoded) {
            return renderDecodeError(
                buildDecodeError('Image decode failed', 'Unknown decode error'),
                { display: displayErrors }
            );
        }
        if (decoded.error) {
            return renderDecodeError(decoded, { display: displayErrors });
        }
        return renderPixels(decoded, wlOverride);
    }


    app.rendering = {
        displayError,
        hydrateDebugSettings,
        decodeDicom,
        decodeNative,
        decodeWithFallback,
        decodeDesktopPathWithHeader,
        emitDesktopDecodeTrace,
        getActiveDecodeMode,
        getActivePreloadMode,
        getDecodeRoute,
        isViewerPreloadEnabled,
        renderDecodeError,
        renderPixels,
        renderDicom
    };
})();
