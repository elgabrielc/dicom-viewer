(() => {
    const app = window.DicomViewerApp || {};
    window.DicomViewerApp = app;
    const { canvas, ctx } = app.dom;
    const { getString, getNumber, createStagedError, normalizeStagedError } = app.utils;

    // =====================================================================
    // DICOM PARSING
    // =====================================================================

    async function toDicomByteArray(input) {
        if (input instanceof Uint8Array) {
            return input;
        }

        if (input instanceof ArrayBuffer) {
            return new Uint8Array(input);
        }

        if (input?.buffer instanceof ArrayBuffer && typeof input.byteLength === 'number') {
            return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
        }

        if (input?.arrayBuffer) {
            return new Uint8Array(await input.arrayBuffer());
        }

        throw new Error('Unsupported DICOM metadata source');
    }

    async function parseDicomHeaderDataSet(input) {
        const byteArray = await toDicomByteArray(input);
        return dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
    }

    function getMetadataNumber(dataSet, tag, fallback = 0) {
        const stringValue = getNumber(dataSet, tag, Number.NaN);
        if (Number.isFinite(stringValue)) {
            return stringValue;
        }

        try {
            const uint16Value = dataSet.uint16?.(tag);
            if (Number.isFinite(uint16Value)) {
                return uint16Value;
            }
        } catch {}

        try {
            const int16Value = dataSet.int16?.(tag);
            if (Number.isFinite(int16Value)) {
                return int16Value;
            }
        } catch {}

        try {
            const uint32Value = dataSet.uint32?.(tag);
            if (Number.isFinite(uint32Value)) {
                return uint32Value;
            }
        } catch {}

        try {
            const int32Value = dataSet.int32?.(tag);
            if (Number.isFinite(int32Value)) {
                return int32Value;
            }
        } catch {}

        return fallback;
    }

    function getNumberOfFrames(dataSet) {
        const frameCount = getMetadataNumber(dataSet, 'x00280008', 1);
        return Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 1;
    }

    function getEncapsulatedFrameData(dataSet, pixelDataElement, frameIndex = 0) {
        try {
            return dicomParser.readEncapsulatedImageFrame(dataSet, pixelDataElement, frameIndex);
        } catch (error) {
            const frameCount = getNumberOfFrames(dataSet);
            const message = String(error?.message || error || '');
            const isEmptyBasicOffsetTable = message.includes('basicOffsetTable has zero entries');

            if (!isEmptyBasicOffsetTable || frameCount > 1) {
                throw error;
            }

            console.warn(
                'Falling back to fragment-concatenated encapsulated frame decode for single-frame image with empty Basic Offset Table.',
            );
            return dicomParser.readEncapsulatedPixelData(dataSet, pixelDataElement, frameIndex);
        }
    }

    /**
     * Parse DICOM file metadata without loading pixel data (fast scan)
     * Used during folder import to organize files by study/series.
     *
     * @param {File|Blob|ArrayBuffer|Uint8Array} input - Source bytes or file-like object
     * @returns {Promise<Object|null>} Metadata object or null if not valid DICOM
     */
    async function parseDicomMetadataDetailed(input) {
        try {
            const byteArray = await toDicomByteArray(input);
            const dataSet = dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
            const transferSyntax = getString(dataSet, 'x00020010');
            const rows = getMetadataNumber(dataSet, 'x00280010', 0);
            const cols = getMetadataNumber(dataSet, 'x00280011', 0);
            const pixelDataElement = dataSet.elements?.x7fe00010;
            const numberOfFrames = getNumberOfFrames(dataSet);
            return {
                meta: {
                    patientName: getString(dataSet, 'x00100010'),
                    studyDate: getString(dataSet, 'x00080020'),
                    studyDescription: getString(dataSet, 'x00081030'),
                    studyInstanceUid: getString(dataSet, 'x0020000d'),
                    seriesDescription: getString(dataSet, 'x0008103e'),
                    seriesInstanceUid: getString(dataSet, 'x0020000e'),
                    seriesNumber: getString(dataSet, 'x00200011'),
                    modality: getString(dataSet, 'x00080060'),
                    sopInstanceUid: getString(dataSet, 'x00080018'),
                    instanceNumber: getMetadataNumber(dataSet, 'x00200013', 0),
                    sliceLocation: getMetadataNumber(dataSet, 'x00201041', 0),
                    transferSyntax: transferSyntax,
                    sopClassUid: getString(dataSet, 'x00080016'),
                    rows,
                    cols,
                    numberOfFrames,
                    hasPixelData: !!pixelDataElement && rows > 0 && cols > 0,
                },
                error: null,
            };
        } catch (error) {
            return { meta: null, error };
        }
    }

    async function parseDicomMetadata(input) {
        const { meta } = await parseDicomMetadataDetailed(input);
        return meta;
    }

    function getPathDirectory(path) {
        const normalized = String(path || '').replace(/\\/g, '/');
        const lastSeparatorIndex = normalized.lastIndexOf('/');
        return lastSeparatorIndex > 0 ? normalized.slice(0, lastSeparatorIndex) : '';
    }

    function resolveDicomDirReferencedPath(dicomDirPath, referencedFileId) {
        const basePath = getPathDirectory(dicomDirPath);
        const segments = String(referencedFileId || '')
            .split(/[\\/]+/)
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (!basePath || !segments.length) {
            return '';
        }

        return segments.reduce((path, segment) => {
            return path ? `${path}/${segment}` : segment;
        }, basePath);
    }

    async function parseDicomDirectoryDetailed(input, dicomDirPath = '') {
        try {
            const byteArray = await toDicomByteArray(input);
            const dataSet = dicomParser.parseDicom(byteArray);
            const directoryRecordSequence = dataSet.elements?.x00041220;
            const recordItems = Array.isArray(directoryRecordSequence?.items) ? directoryRecordSequence.items : [];

            if (!recordItems.length) {
                return {
                    entries: [],
                    indexedPaths: [],
                    error: new Error('DICOMDIR did not contain a directory record sequence.'),
                };
            }

            const entries = [];
            const indexedPaths = [];
            let currentPatient = null;
            let currentStudy = null;
            let currentSeries = null;

            for (const item of recordItems) {
                const itemDataSet = item?.dataSet;
                if (!itemDataSet) {
                    continue;
                }

                const recordType = getString(itemDataSet, 'x00041430').trim().toUpperCase();
                switch (recordType) {
                    case 'PATIENT':
                        currentPatient = {
                            patientName: getString(itemDataSet, 'x00100010'),
                        };
                        currentStudy = null;
                        currentSeries = null;
                        break;
                    case 'STUDY':
                        currentStudy = {
                            patientName: currentPatient?.patientName || getString(itemDataSet, 'x00100010'),
                            studyDate: getString(itemDataSet, 'x00080020'),
                            studyDescription: getString(itemDataSet, 'x00081030'),
                            studyInstanceUid: getString(itemDataSet, 'x0020000d'),
                            modality: '',
                        };
                        currentSeries = null;
                        break;
                    case 'SERIES':
                        currentSeries = {
                            seriesDescription: getString(itemDataSet, 'x0008103e'),
                            seriesInstanceUid: getString(itemDataSet, 'x0020000e'),
                            seriesNumber: getString(itemDataSet, 'x00200011'),
                            modality: getString(itemDataSet, 'x00080060'),
                        };
                        if (currentStudy && !currentStudy.modality && currentSeries.modality) {
                            currentStudy.modality = currentSeries.modality;
                        }
                        break;
                    case 'IMAGE': {
                        const referencedPath = resolveDicomDirReferencedPath(
                            dicomDirPath,
                            getString(itemDataSet, 'x00041500'),
                        );
                        if (!currentStudy?.studyInstanceUid || !currentSeries?.seriesInstanceUid || !referencedPath) {
                            break;
                        }

                        indexedPaths.push(referencedPath);
                        entries.push({
                            source: {
                                kind: 'path',
                                path: referencedPath,
                            },
                            meta: {
                                patientName: currentStudy.patientName,
                                studyDate: currentStudy.studyDate,
                                studyDescription: currentStudy.studyDescription,
                                studyInstanceUid: currentStudy.studyInstanceUid,
                                seriesDescription: currentSeries.seriesDescription,
                                seriesInstanceUid: currentSeries.seriesInstanceUid,
                                seriesNumber: currentSeries.seriesNumber,
                                modality: currentSeries.modality || currentStudy.modality,
                                sopInstanceUid:
                                    getString(itemDataSet, 'x00041511') || getString(itemDataSet, 'x00080018'),
                                instanceNumber: getMetadataNumber(itemDataSet, 'x00200013', 0),
                                sliceLocation: getMetadataNumber(itemDataSet, 'x00201041', 0),
                            },
                        });
                        break;
                    }
                    default:
                        break;
                }
            }

            return {
                entries,
                indexedPaths,
                error: null,
            };
        } catch (error) {
            return {
                entries: [],
                indexedPaths: [],
                error,
            };
        }
    }

    async function parseDicomDirectory(input, dicomDirPath = '') {
        const { entries, indexedPaths } = await parseDicomDirectoryDetailed(input, dicomDirPath);
        return { entries, indexedPaths };
    }

    function isRenderableImageMetadata(meta) {
        return !!(meta?.studyInstanceUid && meta?.hasPixelData && meta?.rows > 0 && meta?.cols > 0);
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
        return transferSyntax.startsWith('1.2.840.10008.1.2.4') || transferSyntax === '1.2.840.10008.1.2.5'; // RLE
    }

    function isJpegLossless(transferSyntax) {
        // JPEG Lossless transfer syntaxes
        return (
            transferSyntax === '1.2.840.10008.1.2.4.57' || // JPEG Lossless
            transferSyntax === '1.2.840.10008.1.2.4.70'
        ); // JPEG Lossless First-Order
    }

    function isJpegBaseline(transferSyntax) {
        return (
            transferSyntax === '1.2.840.10008.1.2.4.50' || // JPEG Baseline
            transferSyntax === '1.2.840.10008.1.2.4.51'
        ); // JPEG Extended
    }

    function isJpeg2000(transferSyntax) {
        return (
            transferSyntax === '1.2.840.10008.1.2.4.90' || // JPEG 2000 Lossless
            transferSyntax === '1.2.840.10008.1.2.4.91'
        ); // JPEG 2000 Lossy
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
        CT: { windowCenter: 40, windowWidth: 400 }, // Soft tissue window
        MR: { windowCenter: 512, windowWidth: 1024 }, // Mid-range for typical MRI
        PT: { windowCenter: 256, windowWidth: 512 }, // PET
        NM: { windowCenter: 256, windowWidth: 512 }, // Nuclear Medicine
        US: { windowCenter: 128, windowWidth: 256 }, // Ultrasound (8-bit typical)
        CR: { windowCenter: 2048, windowWidth: 4096 }, // Computed Radiography
        DX: { windowCenter: 2048, windowWidth: 4096 }, // Digital X-Ray
        MG: { windowCenter: 2048, windowWidth: 4096 }, // Mammography
        XA: { windowCenter: 128, windowWidth: 256 }, // X-Ray Angiography
        RF: { windowCenter: 128, windowWidth: 256 }, // Radiofluoroscopy
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
        let min = Infinity,
            max = -Infinity;
        let sum = 0,
            count = 0;

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
        const windowWidth = Math.max(range * 0.9, 1); // 90% of range
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
        let min = Infinity,
            max = -Infinity;

        for (let i = 0; i < pixelData.length; i += 10) {
            const value = pixelData[i] * rescaleSlope + rescaleIntercept;
            if (value < min) min = value;
            if (value > max) max = value;
            // Early exit if we find variation
            if (max - min >= 1) return false;
        }

        return max - min < 1;
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
     * @param {number} bitsAllocated - Bits per pixel (8 or 16)
     * @returns {TypedArray} Decoded pixel data
     */
    function decodeJpegLossless(dataSet, pixelDataElement, bitsAllocated, frameIndex = 0) {
        try {
            let frameData;

            // Try using dicomParser's built-in function first
            if (pixelDataElement.fragments && pixelDataElement.fragments.length > 0) {
                frameData = getEncapsulatedFrameData(dataSet, pixelDataElement, frameIndex);
            } else {
                // Manually parse encapsulated pixel data
                const byteArray = dataSet.byteArray;
                let offset = pixelDataElement.dataOffset;

                // Skip the basic offset table item
                const itemTag1 = byteArray[offset] | (byteArray[offset + 1] << 8);
                const itemTag2 = byteArray[offset + 2] | (byteArray[offset + 3] << 8);

                if (itemTag1 === 0xfffe && itemTag2 === 0xe000) {
                    const botLength =
                        byteArray[offset + 4] |
                        (byteArray[offset + 5] << 8) |
                        (byteArray[offset + 6] << 16) |
                        (byteArray[offset + 7] << 24);
                    offset += 8 + botLength;

                    const fragTag1 = byteArray[offset] | (byteArray[offset + 1] << 8);
                    const fragTag2 = byteArray[offset + 2] | (byteArray[offset + 3] << 8);

                    if (fragTag1 === 0xfffe && fragTag2 === 0xe000) {
                        const fragLength =
                            byteArray[offset + 4] |
                            (byteArray[offset + 5] << 8) |
                            (byteArray[offset + 6] << 16) |
                            (byteArray[offset + 7] << 24);
                        offset += 8;
                        frameData = new Uint8Array(byteArray.buffer, byteArray.byteOffset + offset, fragLength);
                    }
                }
            }

            if (!frameData) {
                throw createStagedError('frame-extraction', 'Could not extract JPEG Lossless frame data.');
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
            throw normalizeStagedError(e, 'decode');
        }
    }

    // ---------------------------------------------------------------------
    // JPEG 2000 Decoding (OpenJPEG WebAssembly)
    // ---------------------------------------------------------------------

    const JPEG2000_DECODE_TIMEOUT_MS = 10000;
    let nextJpeg2000RequestId = 1;
    const jpeg2000WorkerState = {
        worker: null,
        workerUrl: null,
        activeRequest: null,
        queue: [],
    };

    function resolveOpenJpegAssetUrl(fileName, runtime = window) {
        const href = runtime?.location?.href;
        if (href) {
            try {
                return new URL(`js/${fileName}`, href).toString();
            } catch (e) {
                console.warn('Failed to resolve OpenJPEG asset from page URL:', href, e);
            }
        }

        return `js/${fileName}`;
    }

    function resolveJpeg2000WorkerUrl(runtime = window) {
        const href = runtime?.location?.href;
        if (href) {
            try {
                return new URL('js/app/decode-worker.js', href).toString();
            } catch (e) {
                console.warn('Failed to resolve JPEG 2000 worker URL from page URL:', href, e);
            }
        }

        return 'js/app/decode-worker.js';
    }

    function disposeJpeg2000Worker() {
        if (!jpeg2000WorkerState.worker) return;
        try {
            jpeg2000WorkerState.worker.terminate();
        } catch {}
        jpeg2000WorkerState.worker = null;
        jpeg2000WorkerState.workerUrl = null;
    }

    function formatJpeg2000WorkerError(event, workerUrl) {
        const eventMessage = event?.error?.message || event?.message || 'JPEG 2000 worker error';
        return createStagedError('codec-init', `${eventMessage} (${workerUrl})`);
    }

    function pumpJpeg2000WorkerQueue() {
        if (jpeg2000WorkerState.activeRequest || !jpeg2000WorkerState.queue.length) {
            return;
        }

        if (typeof Worker === 'undefined') {
            const error = createStagedError('codec-init', 'Web Workers are not available for JPEG 2000 decode.');
            while (jpeg2000WorkerState.queue.length) {
                jpeg2000WorkerState.queue.shift().reject(error);
            }
            return;
        }

        if (!jpeg2000WorkerState.worker) {
            jpeg2000WorkerState.workerUrl = resolveJpeg2000WorkerUrl();
            try {
                jpeg2000WorkerState.worker = new Worker(jpeg2000WorkerState.workerUrl);
            } catch (error) {
                jpeg2000WorkerState.worker = null;
                while (jpeg2000WorkerState.queue.length) {
                    jpeg2000WorkerState.queue.shift().reject(normalizeStagedError(error, 'codec-init'));
                }
                return;
            }

            jpeg2000WorkerState.worker.onmessage = (event) => {
                const payload = event?.data || {};
                const activeRequest = jpeg2000WorkerState.activeRequest;
                if (!activeRequest) {
                    return;
                }
                if (payload.requestId !== activeRequest.requestId) {
                    clearTimeout(activeRequest.timeoutId);
                    jpeg2000WorkerState.activeRequest = null;
                    disposeJpeg2000Worker();
                    activeRequest.reject(
                        createStagedError('pixel-conversion', 'JPEG 2000 worker returned an unexpected response.'),
                    );
                    pumpJpeg2000WorkerQueue();
                    return;
                }
                if (payload.type === 'error') {
                    clearTimeout(activeRequest.timeoutId);
                    jpeg2000WorkerState.activeRequest = null;
                    activeRequest.reject(
                        createStagedError(
                            payload.stage || 'decode',
                            payload.message || 'JPEG 2000 worker decode failed',
                        ),
                    );
                    pumpJpeg2000WorkerQueue();
                    return;
                }
                if (payload.type !== 'decoded' || !payload.pixelData) {
                    clearTimeout(activeRequest.timeoutId);
                    jpeg2000WorkerState.activeRequest = null;
                    disposeJpeg2000Worker();
                    activeRequest.reject(
                        createStagedError('pixel-conversion', 'JPEG 2000 worker returned an invalid response.'),
                    );
                    pumpJpeg2000WorkerQueue();
                    return;
                }

                if (
                    payload.frameInfo?.width &&
                    activeRequest.expectedCols &&
                    payload.frameInfo.width !== activeRequest.expectedCols
                ) {
                    console.warn(
                        'JPEG 2000 worker width mismatch:',
                        payload.frameInfo.width,
                        'expected',
                        activeRequest.expectedCols,
                    );
                }
                if (
                    payload.frameInfo?.height &&
                    activeRequest.expectedRows &&
                    payload.frameInfo.height !== activeRequest.expectedRows
                ) {
                    console.warn(
                        'JPEG 2000 worker height mismatch:',
                        payload.frameInfo.height,
                        'expected',
                        activeRequest.expectedRows,
                    );
                }

                clearTimeout(activeRequest.timeoutId);
                jpeg2000WorkerState.activeRequest = null;
                activeRequest.resolve(payload.pixelData);
                pumpJpeg2000WorkerQueue();
            };

            jpeg2000WorkerState.worker.onerror = (event) => {
                const activeRequest = jpeg2000WorkerState.activeRequest;
                if (activeRequest) {
                    clearTimeout(activeRequest.timeoutId);
                    jpeg2000WorkerState.activeRequest = null;
                }

                const error = formatJpeg2000WorkerError(event, jpeg2000WorkerState.workerUrl);
                disposeJpeg2000Worker();
                activeRequest?.reject(error);
                pumpJpeg2000WorkerQueue();
            };
        }

        const request = jpeg2000WorkerState.queue.shift();
        jpeg2000WorkerState.activeRequest = request;
        request.timeoutId = setTimeout(() => {
            if (jpeg2000WorkerState.activeRequest?.requestId !== request.requestId) {
                return;
            }
            jpeg2000WorkerState.activeRequest = null;
            disposeJpeg2000Worker();
            request.reject(
                createStagedError(
                    'decode-timeout',
                    `JPEG 2000 decode timeout (${JPEG2000_DECODE_TIMEOUT_MS / 1000}s, ${request.frameByteLength} bytes)`,
                ),
            );
            pumpJpeg2000WorkerQueue();
        }, JPEG2000_DECODE_TIMEOUT_MS);

        try {
            jpeg2000WorkerState.worker.postMessage(
                {
                    type: 'decode-j2k',
                    requestId: request.requestId,
                    frameData: request.frameData,
                    bitsAllocated: request.bitsAllocated,
                    pixelRepresentation: request.pixelRepresentation,
                    expectedRows: request.expectedRows,
                    expectedCols: request.expectedCols,
                },
                [request.frameData.buffer],
            );
        } catch (error) {
            clearTimeout(request.timeoutId);
            jpeg2000WorkerState.activeRequest = null;
            disposeJpeg2000Worker();
            request.reject(normalizeStagedError(error, 'decode'));
            pumpJpeg2000WorkerQueue();
        }
    }

    function decodeJ2KInWorker(frameData, bitsAllocated, pixelRepresentation, expectedRows, expectedCols) {
        return new Promise((resolve, reject) => {
            if (typeof Worker === 'undefined') {
                reject(new Error('Web Workers are not available for JPEG 2000 decode.'));
                return;
            }

            // getEncapsulatedFrameData() returns a view into the parsed dataset buffer.
            // Transfer a copy so we do not detach the cached dicomParser dataset bytes.
            const frameDataCopy = new Uint8Array(frameData);
            jpeg2000WorkerState.queue.push({
                requestId: nextJpeg2000RequestId++,
                frameData: frameDataCopy,
                frameByteLength: frameDataCopy.byteLength,
                bitsAllocated,
                pixelRepresentation,
                expectedRows,
                expectedCols,
                resolve,
                reject,
                timeoutId: null,
            });
            pumpJpeg2000WorkerQueue();
        });
    }

    /**
     * Decode JPEG 2000 compressed pixel data using OpenJPEG WASM
     *
     * @param {Object} dataSet - dicomParser dataset
     * @param {number} rows - Image height
     * @param {number} cols - Image width
     * @param {number} bitsAllocated - Bits per pixel
     * @param {number} pixelRepresentation - 0=unsigned, 1=signed
     * @returns {Promise<TypedArray>} Decoded pixel data
     */
    async function decodeJpeg2000(dataSet, rows, cols, bitsAllocated, pixelRepresentation, frameIndex = 0) {
        try {
            console.log('Attempting JPEG 2000 decode for', rows, 'x', cols, 'image');

            const jp2DataElement = dataSet.elements.x7fe00010;
            if (!jp2DataElement.encapsulatedPixelData) {
                throw createStagedError('frame-extraction', 'JPEG 2000 pixel data is not encapsulated.');
            }

            const fragments = jp2DataElement.fragments;
            if (!fragments || fragments.length === 0) {
                throw createStagedError('frame-extraction', 'No fragments found for JPEG 2000 pixel data.');
            }

            let j2kData;
            try {
                j2kData = getEncapsulatedFrameData(dataSet, jp2DataElement, frameIndex);
            } catch (error) {
                throw createStagedError(
                    'frame-extraction',
                    String(error?.message || error || 'Failed to extract encapsulated JPEG 2000 frame data.'),
                );
            }
            console.log('JPEG 2000 data length:', j2kData.length, 'bytes');

            return await decodeJ2KInWorker(j2kData, bitsAllocated, pixelRepresentation, rows, cols);
        } catch (e) {
            console.error('JPEG 2000 decode error:', e);
            throw normalizeStagedError(e, 'decode');
        }
    }

    const MONOCHROME_PHOTOMETRIC_INTERPRETATIONS = new Set(['MONOCHROME1', 'MONOCHROME2']);
    const JPEG_BASELINE_GRAYSCALE_TOLERANCE = 2;

    /**
     * Decode JPEG Baseline compressed pixel data using browser's native decoder.
     * The caller passes the current pixel data element so frame extraction stays aligned
     * with the same encapsulated frame path used by other decoders.
     *
     * @param {Object} dataSet - dicomParser dataset
     * @param {Object} pixelDataElement - Pixel data element for encapsulated frame extraction
     * @param {number} rows - Image height
     * @param {number} cols - Image width
     * @returns {Promise<Object>} Display-ready pixel payload for renderPixels()
     */
    async function decodeJpegBaseline(dataSet, pixelDataElement, rows, cols, frameIndex = 0) {
        try {
            const frames = getEncapsulatedFrameData(dataSet, pixelDataElement, frameIndex);

            const blob = new Blob([frames], { type: 'image/jpeg' });
            const bitmap = await createImageBitmap(blob);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cols;
            tempCanvas.height = rows;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(bitmap, 0, 0);

            const imageData = tempCtx.getImageData(0, 0, cols, rows);
            const pixelCount = rows * cols;
            const photometricInterpretation = getString(dataSet, 'x00280004') || 'MONOCHROME2';
            let isGrayscale = MONOCHROME_PHOTOMETRIC_INTERPRETATIONS.has(photometricInterpretation);

            if (!isGrayscale) {
                isGrayscale = true;
                for (let i = 0; i < pixelCount; i++) {
                    const rgbaIndex = i * 4;
                    const red = imageData.data[rgbaIndex];
                    const green = imageData.data[rgbaIndex + 1];
                    const blue = imageData.data[rgbaIndex + 2];
                    const channelRange = Math.max(red, green, blue) - Math.min(red, green, blue);
                    if (channelRange > JPEG_BASELINE_GRAYSCALE_TOLERANCE) {
                        isGrayscale = false;
                        break;
                    }
                }
            }

            if (isGrayscale) {
                const pixelData = new Uint8Array(pixelCount);
                for (let i = 0; i < pixelCount; i++) {
                    const rgbaIndex = i * 4;
                    pixelData[i] = Math.round(
                        (imageData.data[rgbaIndex] + imageData.data[rgbaIndex + 1] + imageData.data[rgbaIndex + 2]) / 3,
                    );
                }
                return {
                    pixelData,
                    bitsAllocated: 8,
                    bitsStored: 8,
                    samplesPerPixel: 1,
                    planarConfiguration: 0,
                    photometricInterpretation,
                    skipWindowLevel: true,
                };
            }

            const pixelData = new Uint8Array(pixelCount * 3);
            for (let i = 0; i < pixelCount; i++) {
                const rgbaIndex = i * 4;
                const rgbIndex = i * 3;
                pixelData[rgbIndex] = imageData.data[rgbaIndex];
                pixelData[rgbIndex + 1] = imageData.data[rgbaIndex + 1];
                pixelData[rgbIndex + 2] = imageData.data[rgbaIndex + 2];
            }

            return {
                pixelData,
                bitsAllocated: 8,
                bitsStored: 8,
                samplesPerPixel: 3,
                planarConfiguration: 0,
                photometricInterpretation: 'RGB',
                skipWindowLevel: true,
            };
        } catch (e) {
            console.error('JPEG Baseline decode error:', e);
            throw normalizeStagedError(e, 'decode');
        }
    }

    app.dicom = {
        parseDicomMetadata,
        parseDicomMetadataDetailed,
        parseDicomHeaderDataSet,
        parseDicomDirectory,
        parseDicomDirectoryDetailed,
        toDicomByteArray,
        getMetadataNumber,
        getNumberOfFrames,
        getEncapsulatedFrameData,
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
        decodeJ2KInWorker,
        decodeJpegBaseline,
        isRenderableImageMetadata,
        resolveOpenJpegAssetUrl,
        resolveJpeg2000WorkerUrl,
    };
})();
