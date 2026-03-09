(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const { canvas, ctx } = app.dom;
    const { getString, getNumber } = app.utils;
    const {
        isCompressed,
        isJpegLossless,
        isJpegBaseline,
        isJpeg2000,
        getTransferSyntaxInfo,
        getModalityDefaults,
        calculateAutoWindowLevel,
        isBlankSlice,
        displayBlankSlice,
        decodeJpegLossless,
        decodeJpeg2000,
        decodeJpegBaseline
    } = app.dicom;

    function getUncompressedFramePixelData(dataSet, pixelDataElement, rows, cols, bitsAllocated, pixelRepresentation, frameIndex = 0) {
        const samplesPerPixel = dataSet.uint16('x00280002') || 1;
        const framePixelCount = rows * cols * samplesPerPixel;
        const bytesPerSample = bitsAllocated > 8 ? 2 : 1;
        const frameOffset = pixelDataElement.dataOffset + (frameIndex * framePixelCount * bytesPerSample);

        if (bitsAllocated === 16) {
            return pixelRepresentation === 1
                ? new Int16Array(dataSet.byteArray.buffer, frameOffset, framePixelCount)
                : new Uint16Array(dataSet.byteArray.buffer, frameOffset, framePixelCount);
        }

        return new Uint8Array(dataSet.byteArray.buffer, frameOffset, framePixelCount);
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
    function displayError(message, details) {
        canvas.width = 512;
        canvas.height = 512;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#f0ad4e';
        ctx.font = 'bold 18px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ Unable to Display Image', canvas.width / 2, 200);

        ctx.fillStyle = '#ccc';
        ctx.font = '14px -apple-system, sans-serif';
        ctx.fillText(message, canvas.width / 2, 240);

        if (details) {
            ctx.fillStyle = '#888';
            ctx.font = '12px -apple-system, sans-serif';
            ctx.fillText(details, canvas.width / 2, 270);
        }

        ctx.fillStyle = '#666';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillText('This format may require additional decoders', canvas.width / 2, 310);
    }

    /**
     * Render a DICOM dataset to the canvas
     * Handles decompression, window/level adjustment, and display
     *
     * @param {Object} dataSet - Parsed dicomParser dataset with pixel data
     * @param {Object|null} wlOverride - Optional {center, width} to override DICOM values
     * @returns {Promise<Object>} Rendering info {rows, cols, wc, ww, transferSyntax} or {error: true}
     */
    async function renderDicom(dataSet, wlOverride = null, frameIndex = 0) {
        // Extract image dimensions and pixel format from DICOM tags
        const rows = dataSet.uint16('x00280010');              // (0028,0010) Rows
        const cols = dataSet.uint16('x00280011');              // (0028,0011) Columns
        const bitsAllocated = dataSet.uint16('x00280100') || 16;  // (0028,0100) Bits Allocated
        const pixelRepresentation = dataSet.uint16('x00280103') || 0;  // (0028,0103) 0=unsigned, 1=signed

        // Get modality for appropriate defaults
        const modality = getString(dataSet, 'x00080060');  // (0008,0060) Modality

        // Rescale slope/intercept for converting stored values
        // CT: converts to Hounsfield Units; MR: arbitrary signal intensity
        const rescaleSlope = getNumber(dataSet, 'x00281053', 1);     // (0028,1053)
        const rescaleIntercept = getNumber(dataSet, 'x00281052', 0); // (0028,1052)

        // Window/level for display - use modality-appropriate defaults
        const modalityDefaults = getModalityDefaults(modality);
        let windowCenter = getNumber(dataSet, 'x00281050', 0);  // (0028,1050)
        let windowWidth = getNumber(dataSet, 'x00281051', 0);   // (0028,1051)

        // If window/level not in DICOM, use modality defaults
        // (we'll potentially override with auto-calculation for MRI later)
        const hasWindowLevel = windowCenter !== 0 || windowWidth !== 0;
        if (!hasWindowLevel) {
            windowCenter = modalityDefaults.windowCenter;
            windowWidth = modalityDefaults.windowWidth;
        }

        // Extract pixel spacing for measurement calibration
        const pixelSpacing = app.tools.extractPixelSpacing(dataSet);
        state.pixelSpacing = pixelSpacing;
        app.tools.updateCalibrationWarning();

        // Extract MRI-specific metadata
        const mrMetadata = {
            repetitionTime: getNumber(dataSet, 'x00180080', 0),     // (0018,0080) TR
            echoTime: getNumber(dataSet, 'x00180081', 0),          // (0018,0081) TE
            flipAngle: getNumber(dataSet, 'x00181314', 0),         // (0018,1314) Flip Angle
            magneticFieldStrength: getNumber(dataSet, 'x00180087', 0), // (0018,0087) Field Strength
            protocolName: getString(dataSet, 'x00181030'),         // (0018,1030) Protocol Name
            sequenceName: getString(dataSet, 'x00180024'),         // (0018,0024) Sequence Name
            scanningSequence: getString(dataSet, 'x00180020'),     // (0018,0020) Scanning Sequence
            mrAcquisitionType: getString(dataSet, 'x00180023'),    // (0018,0023) MR Acquisition Type (2D/3D)
        };

        // Get transfer syntax to determine compression format
        const transferSyntax = getString(dataSet, 'x00020010');  // (0002,0010)
        console.log('Transfer Syntax:', transferSyntax, 'Compressed:', isCompressed(transferSyntax));

        // Get pixel data element
        const pixelDataElement = dataSet.elements.x7fe00010;  // (7FE0,0010) Pixel Data
        const transferSyntaxInfo = getTransferSyntaxInfo(transferSyntax);

        if (!pixelDataElement) {
            console.error('No pixel data element found');
            displayError('No pixel data found', 'The DICOM file may be corrupted or incomplete');
            return { error: true };
        }

        let pixelData;
        let skipWindowLevel = false;

        // Determine if pixel data is compressed based on transfer syntax
        const isCompressedData = isCompressed(transferSyntax);

        if (isCompressedData) {
            // Decode compressed pixel data using appropriate decoder
            if (isJpeg2000(transferSyntax)) {
                pixelData = await decodeJpeg2000(
                    dataSet,
                    pixelDataElement,
                    rows,
                    cols,
                    bitsAllocated,
                    pixelRepresentation,
                    frameIndex
                );
                if (!pixelData) {
                    displayError('JPEG 2000 decode failed', transferSyntaxInfo.name);
                    return { error: true, transferSyntax, tsInfo: transferSyntaxInfo };
                }
            } else if (isJpegLossless(transferSyntax)) {
                pixelData = decodeJpegLossless(dataSet, pixelDataElement, rows, cols, bitsAllocated, frameIndex);
                if (!pixelData) {
                    displayError('JPEG Lossless decode failed', transferSyntaxInfo.name);
                    return { error: true, transferSyntax, tsInfo: transferSyntaxInfo };
                }
            } else if (isJpegBaseline(transferSyntax)) {
                const result = await decodeJpegBaseline(dataSet, pixelDataElement, rows, cols, frameIndex);
                if (!result) {
                    displayError('JPEG decode failed', transferSyntaxInfo.name);
                    return { error: true, transferSyntax, tsInfo: transferSyntaxInfo };
                }
                pixelData = result.pixels;
                skipWindowLevel = result.isRgb; // Already 0-255 from JPEG decode
            } else {
                // Unsupported compression format
                displayError('Unsupported compression format', transferSyntaxInfo.name);
                return { error: true, transferSyntax, tsInfo: transferSyntaxInfo };
            }
        } else {
            // Uncompressed pixel data - create typed array view directly on buffer
            pixelData = getUncompressedFramePixelData(
                dataSet,
                pixelDataElement,
                rows,
                cols,
                bitsAllocated,
                pixelRepresentation,
                frameIndex
            );
        }

        // Check for blank/uniform slices (common in MPR reconstructions as padding)
        // This must be done before window/level calculations
        if (isBlankSlice(pixelData, rescaleSlope, rescaleIntercept)) {
            console.log('Detected blank slice (all pixels same value)');
            displayBlankSlice(rows, cols);
            return {
                rows, cols,
                wc: windowCenter, ww: windowWidth,
                transferSyntax, modality,
                mrMetadata,
                isBlank: true
            };
        }

        // For MRI without window/level in DICOM, calculate auto window/level
        // based on actual pixel data statistics
        if (!hasWindowLevel && (modality === 'MR' || modality === 'PT' || modality === 'NM')) {
            const autoWL = calculateAutoWindowLevel(pixelData, rescaleSlope, rescaleIntercept);
            windowCenter = autoWL.windowCenter;
            windowWidth = autoWL.windowWidth;
            console.log(`Auto window/level for ${modality}: C=${windowCenter} W=${windowWidth}`);
        }

        // Store base W/L values for reset (only on first render, not re-renders)
        if (state.baseWindowLevel.center === null) {
            state.baseWindowLevel = { center: windowCenter, width: windowWidth };
        }

        // Apply W/L override if provided (from user drag adjustment)
        if (wlOverride && wlOverride.center !== null && wlOverride.width !== null) {
            windowCenter = wlOverride.center;
            windowWidth = wlOverride.width;
        }

        // Set canvas size to match image dimensions
        canvas.width = cols;
        canvas.height = rows;

        // Create image data buffer for canvas
        const imageData = ctx.createImageData(cols, rows);
        const outputPixels = imageData.data;

        // Calculate window/level range (min/max displayable values)
        const windowMin = windowCenter - windowWidth / 2;
        const windowMax = windowCenter + windowWidth / 2;

        // Apply rescale and window/level transform to each pixel
        for (let i = 0; i < pixelData.length; i++) {
            let grayscaleValue;
            if (skipWindowLevel) {
                // Already 0-255 (e.g., from JPEG baseline decode)
                grayscaleValue = pixelData[i];
            } else {
                // Apply rescale slope/intercept
                // CT: converts to Hounsfield Units; MR: arbitrary signal intensity
                let pixelValue = pixelData[i] * rescaleSlope + rescaleIntercept;
                // Clamp to window range and scale to 0-255
                pixelValue = Math.max(windowMin, Math.min(windowMax, pixelValue));
                grayscaleValue = Math.round(((pixelValue - windowMin) / (windowMax - windowMin)) * 255);
            }
            // Set RGBA values (grayscale = R=G=B, alpha=255)
            const pixelIndex = i * 4;
            outputPixels[pixelIndex] = grayscaleValue;      // R
            outputPixels[pixelIndex + 1] = grayscaleValue;  // G
            outputPixels[pixelIndex + 2] = grayscaleValue;  // B
            outputPixels[pixelIndex + 3] = 255;             // A (opaque)
        }

        // Draw to canvas
        ctx.putImageData(imageData, 0, 0);

        return {
            rows, cols,
            wc: windowCenter, ww: windowWidth,
            transferSyntax, modality,
            mrMetadata
        };
    }


    app.rendering = {
        displayError,
        renderDicom
    };
})();
