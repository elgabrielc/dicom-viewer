(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    function createNativeError(message, stage = 'decode', extra = {}) {
        const error = new Error(message);
        error.stage = stage;
        Object.assign(error, extra);
        return error;
    }

    function normalizeNativeError(error, fallbackStage = 'decode') {
        if (error instanceof Error) {
            if (typeof error.stage !== 'string' || !error.stage) {
                error.stage = fallbackStage;
            }
            return error;
        }

        if (error && typeof error === 'object') {
            return createNativeError(
                String(error.message || 'Unknown native decode error'),
                typeof error.stage === 'string' && error.stage ? error.stage : fallbackStage,
                { details: error.details }
            );
        }

        return createNativeError(String(error || 'Unknown native decode error'), fallbackStage);
    }

    function describeBinaryPayload(payload) {
        if (payload === null) {
            return 'null';
        }
        if (typeof payload !== 'object') {
            return typeof payload;
        }

        const tag = Object.prototype.toString.call(payload);
        const keys = Object.keys(payload);
        return keys.length > 0 ? `${tag} keys=${keys.join(',')}` : tag;
    }

    function normalizeBinaryResponse(bytes) {
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
        if (bytes && Object.prototype.hasOwnProperty.call(bytes, 'data')) {
            return normalizeBinaryResponse(bytes.data);
        }

        throw createNativeError(
            `Unexpected decoded frame payload shape: ${describeBinaryPayload(bytes)}`,
            'pixel-conversion'
        );
    }

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
        throw new Error(`Unsupported Bits Allocated value from native decode: ${bitsAllocated}`);
    }

    function coercePixelData(bytes, bitsAllocated, pixelRepresentation) {
        if (!Number.isFinite(bitsAllocated) || bitsAllocated <= 0 || bitsAllocated % 8 !== 0) {
            throw createNativeError(
                `Native decode returned a non-byte-aligned Bits Allocated value: ${bitsAllocated}`,
                'pixel-conversion'
            );
        }

        const bytesPerSample = bitsAllocated / 8;
        if (bytes.byteLength % bytesPerSample !== 0) {
            throw createNativeError(
                `Decoded frame payload length ${bytes.byteLength} is not aligned to ${bitsAllocated}-bit samples.`,
                'pixel-conversion'
            );
        }

        const sampleCount = bytes.byteLength / bytesPerSample;
        const PixelArrayType = getPixelDataArrayType(bitsAllocated, pixelRepresentation);
        return new PixelArrayType(bytes.buffer, bytes.byteOffset, sampleCount).slice();
    }

    const DesktopDecode = {
        getRuntime() {
            const tauri = window.__TAURI__;
            if (typeof tauri?.core?.invoke !== 'function') {
                throw createNativeError(
                    'Desktop decode runtime is not ready. Quit and reopen the app if this persists.',
                    'codec-init'
                );
            }
            return tauri;
        },

        async decodeFrame(path, frameIndex = 0) {
            try {
                return await this.getRuntime().core.invoke('decode_frame', { path, frameIndex });
            } catch (error) {
                throw normalizeNativeError(error, 'decode');
            }
        },

        async takeDecodedFrame(decodeId) {
            try {
                const bytes = await this.getRuntime().core.invoke('take_decoded_frame', { decodeId });
                return normalizeBinaryResponse(bytes);
            } catch (error) {
                throw normalizeNativeError(error, 'pixel-transfer');
            }
        },

        async decodeFrameWithPixels(path, frameIndex = 0) {
            const metadata = await this.decodeFrame(path, frameIndex);
            if (!metadata?.decodeId) {
                throw createNativeError('Native decode response did not include a decodeId.', 'pixel-transfer');
            }
            const pixelBytes = await this.takeDecodedFrame(metadata.decodeId);
            if (Number.isFinite(metadata.pixelDataLength) && metadata.pixelDataLength !== pixelBytes.byteLength) {
                throw createNativeError(
                    `Decoded frame payload length mismatch: expected ${metadata.pixelDataLength} byte(s), received ${pixelBytes.byteLength}.`,
                    'pixel-conversion'
                );
            }

            const pixelData = coercePixelData(
                pixelBytes,
                Number(metadata.bitsAllocated),
                Number(metadata.pixelRepresentation)
            );
            return {
                ...metadata,
                pixelData
            };
        }
    };

    app.desktopDecode = DesktopDecode;
})();
