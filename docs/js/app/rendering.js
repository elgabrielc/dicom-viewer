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

    function getPixelDataArrayType(bitsAllocated, pixelRepresentation) {
        if (bitsAllocated <= 8) {
            return pixelRepresentation === 1 ? Int8Array : Uint8Array;
        }
        if (bitsAllocated <= 16) {
            return pixelRepresentation === 1 ? Int16Array : Uint16Array;
        }
        if (bitsAllocated <= 32) {
            return pixelRepresentation === 1 ? Int32Array : Uint32Array;
        }
        throw new Error(`Unsupported Bits Allocated value: ${bitsAllocated}`);
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
            ...extra
        };
    }

    function renderDecodeError(errorInfo) {
        state.pixelSpacing = null;
        app.tools.updateCalibrationWarning();
        displayError(errorInfo.errorMessage, errorInfo.errorDetails);
        app.tools.drawMeasurements?.();
        return errorInfo;
    }

    async function decodeDicom(dataSet, frameIndex = 0) {
        // Extract image dimensions and pixel format from DICOM tags
        const rows = dataSet.uint16('x00280010');              // (0028,0010) Rows
        const cols = dataSet.uint16('x00280011');              // (0028,0011) Columns
        const bitsAllocated = dataSet.uint16('x00280100') || 16;  // (0028,0100) Bits Allocated
        const pixelRepresentation = dataSet.uint16('x00280103') || 0;  // (0028,0103) 0=unsigned, 1=signed
        const samplesPerPixel = dataSet.uint16('x00280002') || 1;
        const photometricInterpretation = getString(dataSet, 'x00280004');

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

        // Extract MRI-specific metadata
        const mrMetadata = {
            repetitionTime: getNumber(dataSet, 'x00180080', 0),     // (0018,0080) TR
            echoTime: getNumber(dataSet, 'x00180081', 0),          // (0018,0081) TE
            flipAngle: getNumber(dataSet, 'x00181314', 0),         // (0018,1314) Flip Angle
            magneticFieldStrength: getNumber(dataSet, 'x00180087', 0), // (0018,0087) Field Strength
            protocolName: getString(dataSet, 'x00181030'),         // (0018,1030) Protocol Name
            sequenceName: getString(dataSet, 'x00180024'),         // (0018,0024) Sequence Name
            scanningSequence: getString(dataSet, 'x00180020'),     // (0018,0020) Scanning Sequence
            mrAcquisitionType: getString(dataSet, 'x00180023')    // (0018,0023) MR Acquisition Type (2D/3D)
        };

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
                { transferSyntax, tsInfo: transferSyntaxInfo }
            );
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
                    return buildDecodeError(
                        'JPEG 2000 decode failed',
                        transferSyntaxInfo.name,
                        { transferSyntax, tsInfo: transferSyntaxInfo }
                    );
                }
            } else if (isJpegLossless(transferSyntax)) {
                pixelData = decodeJpegLossless(dataSet, pixelDataElement, rows, cols, bitsAllocated, frameIndex);
                if (!pixelData) {
                    return buildDecodeError(
                        'JPEG Lossless decode failed',
                        transferSyntaxInfo.name,
                        { transferSyntax, tsInfo: transferSyntaxInfo }
                    );
                }
            } else if (isJpegBaseline(transferSyntax)) {
                const result = await decodeJpegBaseline(dataSet, pixelDataElement, rows, cols, frameIndex);
                if (!result) {
                    return buildDecodeError(
                        'JPEG decode failed',
                        transferSyntaxInfo.name,
                        { transferSyntax, tsInfo: transferSyntaxInfo }
                    );
                }
                pixelData = result.pixels;
                skipWindowLevel = result.isRgb; // Already 0-255 from JPEG decode
            } else {
                // Unsupported compression format
                return buildDecodeError(
                    'Unsupported compression format',
                    transferSyntaxInfo.name,
                    { transferSyntax, tsInfo: transferSyntaxInfo }
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
                    String(error?.message || error || 'Unknown native decode error'),
                    { transferSyntax, tsInfo: transferSyntaxInfo }
                );
            }
        }

        // Check for blank/uniform slices (common in MPR reconstructions as padding)
        // This must be done before window/level calculations
        if (isBlankSlice(pixelData, rescaleSlope, rescaleIntercept)) {
            console.log('Detected blank slice (all pixels same value)');
            return {
                pixelData,
                rows,
                cols,
                bitsAllocated,
                pixelRepresentation,
                samplesPerPixel,
                photometricInterpretation,
                windowCenter,
                windowWidth,
                rescaleSlope,
                rescaleIntercept,
                transferSyntax, modality,
                mrMetadata,
                pixelSpacing,
                isBlank: true,
                skipWindowLevel
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

        return {
            pixelData,
            rows,
            cols,
            bitsAllocated,
            pixelRepresentation,
            samplesPerPixel,
            photometricInterpretation,
            windowCenter,
            windowWidth,
            rescaleSlope,
            rescaleIntercept,
            modality,
            transferSyntax,
            mrMetadata,
            pixelSpacing,
            isBlank: false,
            skipWindowLevel
        };
    }

    function renderPixels(decoded, wlOverride = null) {
        let windowCenter = decoded.windowCenter;
        let windowWidth = decoded.windowWidth;

        state.pixelSpacing = decoded.pixelSpacing || null;
        app.tools.updateCalibrationWarning();

        if (decoded.isBlank) {
            displayBlankSlice(decoded.rows, decoded.cols);
            app.tools.drawMeasurements?.();
            return buildRenderInfo(decoded, windowCenter, windowWidth, { isBlank: true });
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
        canvas.width = decoded.cols;
        canvas.height = decoded.rows;

        // Create image data buffer for canvas
        const imageData = ctx.createImageData(decoded.cols, decoded.rows);
        const outputPixels = imageData.data;

        // Calculate window/level range (min/max displayable values)
        const windowMin = windowCenter - windowWidth / 2;
        const windowMax = windowCenter + windowWidth / 2;
        const windowDivisor = Math.max(windowMax - windowMin, 1);

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
            // Set RGBA values (grayscale = R=G=B, alpha=255)
            const pixelIndex = i * 4;
            outputPixels[pixelIndex] = grayscaleValue;      // R
            outputPixels[pixelIndex + 1] = grayscaleValue;  // G
            outputPixels[pixelIndex + 2] = grayscaleValue;  // B
            outputPixels[pixelIndex + 3] = 255;             // A (opaque)
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
    async function renderDicom(dataSet, wlOverride = null, frameIndex = 0) {
        const decoded = await decodeDicom(dataSet, frameIndex);
        if (!decoded) {
            return renderDecodeError(buildDecodeError('Image decode failed', 'Unknown decode error'));
        }
        if (decoded.error) {
            return renderDecodeError(decoded);
        }
        return renderPixels(decoded, wlOverride);
    }


    app.rendering = {
        displayError,
        decodeDicom,
        renderPixels,
        renderDicom
    };
})();
