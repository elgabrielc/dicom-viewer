(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { createStagedError, normalizeStagedError, getPixelDataArrayType } = app.utils;
    let activeQueuedNativeDecode = null;
    let activeQueuedNativeDecodeRequest = null;
    const pendingQueuedNativeDecodeRequests = [];

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
        // Unlike import header probing, the decode bridge cannot recover from an absent or malformed
        // payload here. Treat unexpected shapes as a hard error so callers never consume partial pixels.
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

    function parseDecodedFrameWithPixelsResponse(payload) {
        const bytes = normalizeBinaryResponse(payload);
        if (bytes.byteLength < 4) {
            throw createStagedError(
                'pixel-transfer',
                'Native decode payload was too short to include a metadata header.'
            );
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const metadataLength = view.getUint32(0, true);
        const metadataOffset = 4;
        const pixelOffset = metadataOffset + metadataLength;
        if (metadataLength === 0 || pixelOffset > bytes.byteLength) {
            throw createStagedError(
                'pixel-transfer',
                `Native decode payload declared an invalid metadata header length: ${metadataLength}.`
            );
        }

        let metadata;
        try {
            const metadataJson = new TextDecoder().decode(bytes.subarray(metadataOffset, pixelOffset));
            metadata = JSON.parse(metadataJson);
        } catch (error) {
            throw createStagedError(
                'pixel-transfer',
                `Failed to parse native decoded frame metadata: ${error?.message || error}`
            );
        }

        return {
            metadata,
            pixelBytes: bytes.subarray(pixelOffset)
        };
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

    function findQueuedNativeDecodeRequest(path, frameIndex) {
        if (
            activeQueuedNativeDecodeRequest &&
            activeQueuedNativeDecodeRequest.path === path &&
            activeQueuedNativeDecodeRequest.frameIndex === frameIndex
        ) {
            return activeQueuedNativeDecodeRequest;
        }

        return pendingQueuedNativeDecodeRequests.find((request) =>
            request.path === path && request.frameIndex === frameIndex
        ) || null;
    }

    function drainQueuedNativeDecodes(runtime) {
        if (activeQueuedNativeDecode) {
            return activeQueuedNativeDecode;
        }

        activeQueuedNativeDecode = (async () => {
            while (pendingQueuedNativeDecodeRequests.length > 0) {
                const request = pendingQueuedNativeDecodeRequests.shift();
                activeQueuedNativeDecodeRequest = request;

                try {
                    const payload = await runtime.core.invoke('decode_frame_with_pixels', {
                        path: request.path,
                        frameIndex: request.frameIndex
                    });
                    for (const waiter of request.waiters) {
                        waiter.resolve(payload);
                    }
                } catch (error) {
                    const normalizedError = normalizeStagedError(error, 'decode');
                    for (const waiter of request.waiters) {
                        waiter.reject(normalizedError);
                    }
                } finally {
                    activeQueuedNativeDecodeRequest = null;
                }
            }
        })().finally(() => {
            activeQueuedNativeDecode = null;
            activeQueuedNativeDecodeRequest = null;
            if (pendingQueuedNativeDecodeRequests.length > 0) {
                void drainQueuedNativeDecodes(runtime);
            }
        });

        return activeQueuedNativeDecode;
    }

    function queueNativeDecodeWithPixels(runtime, path, frameIndex = 0) {
        return new Promise((resolve, reject) => {
            const existingRequest = findQueuedNativeDecodeRequest(path, frameIndex);
            if (existingRequest) {
                existingRequest.waiters.push({ resolve, reject });
                return;
            }

            pendingQueuedNativeDecodeRequests.push({
                path,
                frameIndex,
                waiters: [{ resolve, reject }]
            });
            void drainQueuedNativeDecodes(runtime);
        });
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
            const payload = await queueNativeDecodeWithPixels(this.getRuntime(), path, frameIndex);
            const { metadata, pixelBytes } = parseDecodedFrameWithPixelsResponse(payload);
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
