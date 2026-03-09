(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { createStagedError, normalizeStagedError, getPixelDataArrayType } = app.utils;

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

        throw createStagedError(
            'pixel-conversion',
            `Unexpected decoded frame payload shape: ${describeBinaryPayload(bytes)}`,
        );
    }

    function coercePixelData(bytes, bitsAllocated, pixelRepresentation) {
        if (!Number.isFinite(bitsAllocated) || bitsAllocated <= 0 || bitsAllocated % 8 !== 0) {
            throw createStagedError(
                'pixel-conversion',
                `Native decode returned a non-byte-aligned Bits Allocated value: ${bitsAllocated}`,
            );
        }

        const bytesPerSample = bitsAllocated / 8;
        if (bytes.byteLength % bytesPerSample !== 0) {
            throw createStagedError(
                'pixel-conversion',
                `Decoded frame payload length ${bytes.byteLength} is not aligned to ${bitsAllocated}-bit samples.`,
            );
        }

        const sampleCount = bytes.byteLength / bytesPerSample;
        const PixelArrayType = getPixelDataArrayType(
            bitsAllocated,
            pixelRepresentation,
            'Unsupported Bits Allocated value from native decode'
        );
        return new PixelArrayType(bytes.buffer, bytes.byteOffset, sampleCount).slice();
    }

    const DesktopDecode = {
        getRuntime() {
            const tauri = window.__TAURI__;
            if (typeof tauri?.core?.invoke !== 'function') {
                throw createStagedError(
                    'codec-init',
                    'Desktop decode runtime is not ready. Quit and reopen the app if this persists.'
                );
            }
            return tauri;
        },

        async decodeFrame(path, frameIndex = 0) {
            try {
                return await this.getRuntime().core.invoke('decode_frame', { path, frameIndex });
            } catch (error) {
                throw normalizeStagedError(error, 'decode');
            }
        },

        async takeDecodedFrame(decodeId) {
            try {
                const bytes = await this.getRuntime().core.invoke('take_decoded_frame', { decodeId });
                return normalizeBinaryResponse(bytes);
            } catch (error) {
                throw normalizeStagedError(error, 'pixel-transfer');
            }
        },

        async decodeFrameWithPixels(path, frameIndex = 0) {
            const metadata = await this.decodeFrame(path, frameIndex);
            if (!metadata?.decodeId) {
                throw createStagedError('pixel-transfer', 'Native decode response did not include a decodeId.');
            }
            const pixelBytes = await this.takeDecodedFrame(metadata.decodeId);
            if (Number.isFinite(metadata.pixelDataLength) && metadata.pixelDataLength !== pixelBytes.byteLength) {
                throw createStagedError(
                    'pixel-conversion',
                    `Decoded frame payload length mismatch: expected ${metadata.pixelDataLength} byte(s), received ${pixelBytes.byteLength}.`
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
