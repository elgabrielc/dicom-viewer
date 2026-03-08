(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { canvas, ctx } = app.dom;
    const { getString, getNumber } = app.utils;

    // =====================================================================
    // DICOM PARSING
    // =====================================================================

    /**
     * Parse DICOM file metadata without loading pixel data (fast scan)
     * Used during folder import to organize files by study/series.
     *
     * @param {File} file - File object from File System Access API
     * @returns {Promise<Object|null>} Metadata object or null if not valid DICOM
     */
    async function parseDicomMetadata(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const byteArray = new Uint8Array(arrayBuffer);
            const dataSet = dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
            const transferSyntax = getString(dataSet, 'x00020010');
            return {
                patientName: getString(dataSet, 'x00100010'),
                studyDate: getString(dataSet, 'x00080020'),
                studyDescription: getString(dataSet, 'x00081030'),
                studyInstanceUid: getString(dataSet, 'x0020000d'),
                seriesDescription: getString(dataSet, 'x0008103e'),
                seriesInstanceUid: getString(dataSet, 'x0020000e'),
                seriesNumber: getString(dataSet, 'x00200011'),
                modality: getString(dataSet, 'x00080060'),
                instanceNumber: getNumber(dataSet, 'x00200013', 0),
                sliceLocation: getNumber(dataSet, 'x00201041', 0),
                transferSyntax: transferSyntax,
            };
        } catch { return null; }
    }


    // =====================================================================
    // TRANSFER SYNTAX SUPPORT
    // DICOM images can be stored in various compression formats.
    // The Transfer Syntax UID (0002,0010) identifies the format.
    // =====================================================================

    /**
     * Check if a transfer syntax indicates compressed pixel data
     * @param {string} transferSyntax - Transfer Syntax UID
     * @returns {boolean} True if compressed
     */
    function isCompressed(transferSyntax) {
        if (!transferSyntax) return false;
        // JPEG Lossless, JPEG 2000, JPEG Baseline, RLE, etc.
        return transferSyntax.startsWith('1.2.840.10008.1.2.4') ||
               transferSyntax === '1.2.840.10008.1.2.5'; // RLE
    }

    function isJpegLossless(transferSyntax) {
        // JPEG Lossless transfer syntaxes
        return transferSyntax === '1.2.840.10008.1.2.4.57' || // JPEG Lossless
               transferSyntax === '1.2.840.10008.1.2.4.70';   // JPEG Lossless First-Order
    }

    function isJpegBaseline(transferSyntax) {
        return transferSyntax === '1.2.840.10008.1.2.4.50' || // JPEG Baseline
               transferSyntax === '1.2.840.10008.1.2.4.51';   // JPEG Extended
    }

    function isJpeg2000(transferSyntax) {
        return transferSyntax === '1.2.840.10008.1.2.4.90' || // JPEG 2000 Lossless
               transferSyntax === '1.2.840.10008.1.2.4.91';   // JPEG 2000 Lossy
    }

    // Transfer syntax names and support status
    const TRANSFER_SYNTAX_INFO = {
        // Uncompressed - Supported
        '1.2.840.10008.1.2': { name: 'Implicit VR Little Endian', supported: true },
        '1.2.840.10008.1.2.1': { name: 'Explicit VR Little Endian', supported: true },
        '1.2.840.10008.1.2.2': { name: 'Explicit VR Big Endian', supported: true },
        // JPEG Lossless - Supported
        '1.2.840.10008.1.2.4.57': { name: 'JPEG Lossless', supported: true },
        '1.2.840.10008.1.2.4.70': { name: 'JPEG Lossless (First-Order Prediction)', supported: true },
        // JPEG Baseline - Supported
        '1.2.840.10008.1.2.4.50': { name: 'JPEG Baseline (8-bit)', supported: true },
        '1.2.840.10008.1.2.4.51': { name: 'JPEG Extended (12-bit)', supported: true },
        // JPEG 2000 - Supported
        '1.2.840.10008.1.2.4.90': { name: 'JPEG 2000 Lossless', supported: true },
        '1.2.840.10008.1.2.4.91': { name: 'JPEG 2000 Lossy', supported: true },
        // RLE - Not supported
        '1.2.840.10008.1.2.5': { name: 'RLE Lossless', supported: false },
        // JPEG-LS - Not supported
        '1.2.840.10008.1.2.4.80': { name: 'JPEG-LS Lossless', supported: false },
        '1.2.840.10008.1.2.4.81': { name: 'JPEG-LS Near-Lossless', supported: false },
        // MPEG - Not supported
        '1.2.840.10008.1.2.4.100': { name: 'MPEG-2', supported: false },
        '1.2.840.10008.1.2.4.101': { name: 'MPEG-2 HD', supported: false },
        '1.2.840.10008.1.2.4.102': { name: 'MPEG-4', supported: false },
        '1.2.840.10008.1.2.4.103': { name: 'MPEG-4 BD', supported: false },
        // Deflated - Not supported
        '1.2.840.10008.1.2.1.99': { name: 'Deflated Explicit VR Little Endian', supported: false },
        // HEVC - Not supported
        '1.2.840.10008.1.2.4.107': { name: 'HEVC/H.265', supported: false },
    };

    function getTransferSyntaxInfo(transferSyntax) {
        if (!transferSyntax) {
            return { name: 'Unknown', supported: false, unknown: true };
        }
        const info = TRANSFER_SYNTAX_INFO[transferSyntax];
        if (info) {
            return { ...info, uid: transferSyntax, unknown: false };
        }
        return { name: `Unknown (${transferSyntax})`, supported: false, unknown: true, uid: transferSyntax };
    }

    // =====================================================================
    // MODALITY-SPECIFIC DEFAULTS
    // Different imaging modalities require different window/level settings
    // =====================================================================

    /**
     * Default window/level values by modality
     * CT uses Hounsfield Units (-1000 air, 0 water, +1000 bone)
     * MR uses arbitrary signal intensity (depends on sequence)
     * Other modalities have their own ranges
     */
    const MODALITY_DEFAULTS = {
        'CT': { windowCenter: 40, windowWidth: 400 },      // Soft tissue window
        'MR': { windowCenter: 512, windowWidth: 1024 },    // Mid-range for typical MRI
        'PT': { windowCenter: 256, windowWidth: 512 },     // PET
        'NM': { windowCenter: 256, windowWidth: 512 },     // Nuclear Medicine
        'US': { windowCenter: 128, windowWidth: 256 },     // Ultrasound (8-bit typical)
        'CR': { windowCenter: 2048, windowWidth: 4096 },   // Computed Radiography
        'DX': { windowCenter: 2048, windowWidth: 4096 },   // Digital X-Ray
        'MG': { windowCenter: 2048, windowWidth: 4096 },   // Mammography
        'XA': { windowCenter: 128, windowWidth: 256 },     // X-Ray Angiography
        'RF': { windowCenter: 128, windowWidth: 256 },     // Radiofluoroscopy
    };

    /**
     * Get default window/level for a modality
     * @param {string} modality - DICOM modality code (CT, MR, etc.)
     * @returns {Object} {windowCenter, windowWidth}
     */
    function getModalityDefaults(modality) {
        return MODALITY_DEFAULTS[modality] || { windowCenter: 128, windowWidth: 256 };
    }

    /**
     * Calculate auto window/level from pixel data statistics
     * Useful for MRI and other modalities without standard units
     * @param {TypedArray} pixelData - Raw pixel values
     * @param {number} rescaleSlope - Rescale slope
     * @param {number} rescaleIntercept - Rescale intercept
     * @returns {Object} {windowCenter, windowWidth, isBlank}
     */
    function calculateAutoWindowLevel(pixelData, rescaleSlope = 1, rescaleIntercept = 0) {
        // Sample pixels for speed (every 10th pixel)
        let min = Infinity, max = -Infinity;
        let sum = 0, count = 0;

        for (let i = 0; i < pixelData.length; i += 10) {
            const value = pixelData[i] * rescaleSlope + rescaleIntercept;
            if (value < min) min = value;
            if (value > max) max = value;
            sum += value;
            count++;
        }

        const mean = sum / count;
        const range = max - min;

        // Detect blank/uniform slices (all pixels have same or nearly same value)
        // This commonly occurs in MPR reconstructions as padding slices
        const isBlank = range < 1;

        // Use percentile-based windowing to handle outliers
        // Center at mean, width covers most of the dynamic range
        const windowWidth = Math.max(range * 0.9, 1);  // 90% of range
        const windowCenter = mean;

        return { windowCenter: Math.round(windowCenter), windowWidth: Math.round(windowWidth), isBlank };
    }

    /**
     * Check if pixel data represents a blank/uniform slice
     * @param {TypedArray} pixelData - Raw pixel values
     * @param {number} rescaleSlope - Rescale slope
     * @param {number} rescaleIntercept - Rescale intercept
     * @returns {boolean} True if slice is blank (all pixels same value)
     */
    function isBlankSlice(pixelData, rescaleSlope = 1, rescaleIntercept = 0) {
        // Sample pixels for speed (every 10th pixel)
        let min = Infinity, max = -Infinity;

        for (let i = 0; i < pixelData.length; i += 10) {
            const value = pixelData[i] * rescaleSlope + rescaleIntercept;
            if (value < min) min = value;
            if (value > max) max = value;
            // Early exit if we find variation
            if (max - min >= 1) return false;
        }

        return (max - min) < 1;
    }

    /**
     * Display a blank slice as black (like Horos)
     * @param {number} rows - Image height
     * @param {number} cols - Image width
     */
    function displayBlankSlice(rows, cols) {
        canvas.width = cols;
        canvas.height = rows;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // =====================================================================
    // IMAGE DECODING
    // Different compression formats require different decoders
    // =====================================================================

    /**
     * Decode JPEG Lossless compressed pixel data
     * Uses the jpeg-lossless-decoder-js library
     *
     * @param {Object} dataSet - dicomParser dataset
     * @param {Object} pixelDataElement - Pixel data element (x7fe00010)
     * @param {number} rows - Image height
     * @param {number} cols - Image width
     * @param {number} bitsAllocated - Bits per pixel (8 or 16)
     * @returns {TypedArray|null} Decoded pixel data or null on failure
     */
    function decodeJpegLossless(dataSet, pixelDataElement, rows, cols, bitsAllocated) {
        try {
            let frameData;

            // Try using dicomParser's built-in function first
            if (pixelDataElement.fragments && pixelDataElement.fragments.length > 0) {
                frameData = dicomParser.readEncapsulatedPixelDataFromFragments(
                    dataSet, pixelDataElement, 0
                );
            } else {
                // Manually parse encapsulated pixel data
                const byteArray = dataSet.byteArray;
                let offset = pixelDataElement.dataOffset;

                // Skip the basic offset table item
                const itemTag1 = byteArray[offset] | (byteArray[offset+1] << 8);
                const itemTag2 = byteArray[offset+2] | (byteArray[offset+3] << 8);

                if (itemTag1 === 0xFFFE && itemTag2 === 0xE000) {
                    const botLength = byteArray[offset+4] | (byteArray[offset+5] << 8) |
                                     (byteArray[offset+6] << 16) | (byteArray[offset+7] << 24);
                    offset += 8 + botLength;

                    const fragTag1 = byteArray[offset] | (byteArray[offset+1] << 8);
                    const fragTag2 = byteArray[offset+2] | (byteArray[offset+3] << 8);

                    if (fragTag1 === 0xFFFE && fragTag2 === 0xE000) {
                        const fragLength = byteArray[offset+4] | (byteArray[offset+5] << 8) |
                                          (byteArray[offset+6] << 16) | (byteArray[offset+7] << 24);
                        offset += 8;
                        frameData = new Uint8Array(byteArray.buffer, byteArray.byteOffset + offset, fragLength);
                    }
                }
            }

            if (!frameData) {
                console.error('Could not extract frame data');
                return null;
            }

            const decoder = new jpeg.lossless.Decoder();
            const decodedData = decoder.decode(frameData.buffer, frameData.byteOffset, frameData.length);

            // Handle the decoded output based on bits allocated
            if (bitsAllocated === 16) {
                return new Int16Array(decodedData.buffer);
            } else {
                return new Uint8Array(decodedData.buffer);
            }
        } catch (e) {
            console.error('JPEG Lossless decode error:', e);
            return null;
        }
    }

    // ---------------------------------------------------------------------
    // JPEG 2000 Decoding (OpenJPEG WebAssembly)
    // ---------------------------------------------------------------------

    /** Cached OpenJPEG WASM module instance */
    let openjpegModule = null;
    /** Promise for OpenJPEG initialization (prevents multiple init) */
    let openjpegInitPromise = null;

    /**
     * Initialize the OpenJPEG WebAssembly decoder
     * Lazily loaded on first JPEG 2000 image
     * @returns {Promise<Object>} Initialized OpenJPEG module
     */
    async function initOpenJPEG() {
        if (openjpegModule) return openjpegModule;
        if (openjpegInitPromise) return openjpegInitPromise;

        openjpegInitPromise = (async () => {
            try {
                console.log('Initializing OpenJPEG WASM...');
                // OpenJPEGWASM is loaded from the script tag
                if (typeof OpenJPEGWASM === 'function') {
                    openjpegModule = await OpenJPEGWASM({
                        locateFile: (path) => 'js/' + path
                    });
                    console.log('OpenJPEG WASM initialized successfully');
                    return openjpegModule;
                }
                throw new Error('OpenJPEGWASM not found');
            } catch (e) {
                console.error('Failed to initialize OpenJPEG:', e);
                throw e;
            }
        })();

        return openjpegInitPromise;
    }

    /**
     * Decode JPEG 2000 compressed pixel data using OpenJPEG WASM
     *
     * @param {Object} dataSet - dicomParser dataset
     * @param {Object} pixelDataElement - Pixel data element (unused, uses dataSet.elements)
     * @param {number} rows - Image height
     * @param {number} cols - Image width
     * @param {number} bitsAllocated - Bits per pixel
     * @param {number} pixelRepresentation - 0=unsigned, 1=signed
     * @returns {Promise<TypedArray|null>} Decoded pixel data or null on failure
     */
    async function decodeJpeg2000(dataSet, pixelDataElement, rows, cols, bitsAllocated, pixelRepresentation) {
        try {
            console.log('Attempting JPEG 2000 decode for', rows, 'x', cols, 'image');

            const jp2DataElement = dataSet.elements.x7fe00010;
            if (!jp2DataElement.encapsulatedPixelData) {
                console.error('Pixel data is not encapsulated');
                return null;
            }

            const fragments = jp2DataElement.fragments;
            if (!fragments || fragments.length === 0) {
                console.error('No fragments found for JPEG 2000');
                return null;
            }

            // Get the first fragment (single frame)
            const fragment = fragments[0];
            const j2kData = new Uint8Array(dataSet.byteArray.buffer, fragment.position, fragment.length);
            console.log('JPEG 2000 data length:', j2kData.length, 'bytes');

            // Initialize and use OpenJPEG decoder
            const oj = await initOpenJPEG();

            // Use the J2KDecoder class from the WASM module
            const decoder = new oj.J2KDecoder();
            const encodedBuffer = decoder.getEncodedBuffer(j2kData.length);
            encodedBuffer.set(j2kData);

            decoder.decode();

            const decoded = decoder.getDecodedBuffer();
            const frameInfo = decoder.getFrameInfo();

            console.log('JPEG 2000 decoded:', frameInfo.width, 'x', frameInfo.height,
                        'components:', frameInfo.componentCount, 'bpp:', frameInfo.bitsPerSample);

            // Copy decoded data to a new array before cleanup
            let pixelData;
            if (frameInfo.bitsPerSample > 8) {
                if (frameInfo.isSigned) {
                    pixelData = new Int16Array(decoded.length / 2);
                    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
                    for (let i = 0; i < pixelData.length; i++) {
                        pixelData[i] = view.getInt16(i * 2, true);
                    }
                } else {
                    pixelData = new Uint16Array(decoded.length / 2);
                    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
                    for (let i = 0; i < pixelData.length; i++) {
                        pixelData[i] = view.getUint16(i * 2, true);
                    }
                }
            } else {
                pixelData = new Uint8Array(decoded);
            }

            decoder.delete();
            return pixelData;

        } catch (e) {
            console.error('JPEG 2000 decode error:', e);
            return null;
        }
    }

    /**
     * Decode JPEG Baseline compressed pixel data using browser's native decoder
     * Creates a Blob from the JPEG data and uses createImageBitmap to decode
     *
     * @param {Object} dataSet - dicomParser dataset
     * @param {Object} pixelDataElement - Pixel data element (unused)
     * @param {number} rows - Image height
     * @param {number} cols - Image width
     * @returns {Promise<Object|null>} {pixels, isRgb} or null on failure
     */
    async function decodeJpegBaseline(dataSet, pixelDataElement, rows, cols) {
        try {
            const frames = dicomParser.readEncapsulatedPixelDataFromFragments(
                dataSet, dataSet.elements.x7fe00010, 0
            );

            const blob = new Blob([frames], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cols;
            tempCanvas.height = rows;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(bitmap, 0, 0);

            const imageData = tempCtx.getImageData(0, 0, cols, rows);
            // Convert RGBA to grayscale values
            const pixels = new Int16Array(rows * cols);
            for (let i = 0; i < pixels.length; i++) {
                pixels[i] = imageData.data[i * 4]; // Just use red channel
            }
            return { pixels, isRgb: true };
        } catch (e) {
            console.error('JPEG Baseline decode error:', e);
            return null;
        }
    }


    app.dicom = {
        parseDicomMetadata,
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
    };
})();
