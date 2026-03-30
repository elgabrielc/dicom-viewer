(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    const utils = {
        formatDate: s => s?.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : s || '-',
        escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
        getString: (ds, tag) => {
            try {
                return ds.string(tag) || '';
            } catch {
                return '';
            }
        },
        getNumber: (ds, tag, def = 0) => {
            try {
                const v = ds.string(tag);
                return v ? parseFloat(v) : def;
            } catch {
                return def;
            }
        },
        generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },
        createStagedError(stage, message, extra = {}) {
            const error = new Error(message);
            error.stage = stage;
            Object.assign(error, extra);
            return error;
        },
        normalizeStagedError(error, fallbackStage = 'decode') {
            if (error instanceof Error) {
                if (typeof error.stage !== 'string' || !error.stage) {
                    error.stage = fallbackStage;
                }
                return error;
            }

            if (error && typeof error === 'object') {
                return utils.createStagedError(
                    typeof error.stage === 'string' && error.stage ? error.stage : fallbackStage,
                    String(error.message || 'Unknown decode error'),
                    { details: error.details }
                );
            }

            return utils.createStagedError(fallbackStage, String(error || 'Unknown decode error'));
        },
        getPixelDataArrayType(bitsAllocated, pixelRepresentation, errorPrefix = 'Unsupported Bits Allocated value') {
            if (bitsAllocated <= 8) {
                return pixelRepresentation === 1 ? Int8Array : Uint8Array;
            }
            if (bitsAllocated <= 16) {
                return pixelRepresentation === 1 ? Int16Array : Uint16Array;
            }
            if (bitsAllocated <= 32) {
                return pixelRepresentation === 1 ? Int32Array : Uint32Array;
            }
            throw new Error(`${errorPrefix}: ${bitsAllocated}`);
        },
        /**
         * Normalize a binary response into a Uint8Array.
         * Handles Uint8Array, ArrayBuffer, typed array views, plain arrays,
         * and {data: ...} wrappers. Returns null if none match.
         */
        normalizeBinaryResponse(bytes, depth = 0) {
            if (bytes instanceof Uint8Array) {
                return bytes;
            }
            if (bytes instanceof ArrayBuffer) {
                return new Uint8Array(bytes);
            }
            if (bytes?.buffer instanceof ArrayBuffer && typeof bytes.byteLength === 'number') {
                return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
            }
            if (Array.isArray(bytes)) {
                return Uint8Array.from(bytes);
            }
            if (depth < 3 && bytes && Object.prototype.hasOwnProperty.call(bytes, 'data')) {
                return utils.normalizeBinaryResponse(bytes.data, depth + 1);
            }
            return null;
        },
        /**
         * Minimal DICOM metadata plausibility check.
         * Returns true if the metadata object contains at least one recognized
         * DICOM UID or transfer syntax field.
         */
        hasLikelyDicomMetadata(meta) {
            return !!(
                meta?.transferSyntax ||
                meta?.studyInstanceUid ||
                meta?.seriesInstanceUid ||
                meta?.sopClassUid ||
                meta?.sopInstanceUid
            );
        }
    };

    app.utils = utils;
})();
