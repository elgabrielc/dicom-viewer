// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';

async function installMockDesktopDecode(page, options = {}) {
    await page.addInitScript((opts) => {
        let callbackId = 1;
        const callbacks = new Map();
        const defaultMetadata = {
            decodeId: 'decode-1',
            rows: 2,
            cols: 1,
            bitsAllocated: 16,
            pixelRepresentation: 0,
            samplesPerPixel: 1,
            planarConfiguration: 0,
            photometricInterpretation: 'MONOCHROME2',
            windowCenter: 42,
            windowWidth: 84,
            rescaleSlope: 1,
            rescaleIntercept: -1024,
            pixelDataLength: 4
        };
        const metadata = { ...defaultMetadata, ...(opts.metadata || {}) };
        const decodedFrames = new Map(
            (opts.decodedFrames || [['decode-1', [0x34, 0x12, 0x78, 0x56]]])
                .map(([decodeId, bytes]) => [decodeId, new Uint8Array(bytes).buffer])
        );
        const invokeCalls = [];
        const binaryResponseMode = opts.binaryResponseMode || 'data-object';
        const combinedMetadata = {
            rows: metadata.rows,
            cols: metadata.cols,
            bitsAllocated: metadata.bitsAllocated,
            pixelRepresentation: metadata.pixelRepresentation,
            samplesPerPixel: metadata.samplesPerPixel,
            planarConfiguration: metadata.planarConfiguration,
            photometricInterpretation: metadata.photometricInterpretation,
            windowCenter: metadata.windowCenter,
            windowWidth: metadata.windowWidth,
            rescaleSlope: metadata.rescaleSlope,
            rescaleIntercept: metadata.rescaleIntercept,
            pixelDataLength: metadata.pixelDataLength
        };

        function createCombinedDecodePayload() {
            const decodeId = metadata.decodeId;
            const frame = decodedFrames.get(decodeId);
            if (!frame) {
                throw new Error(`Decoded frame not found: ${decodeId}`);
            }

            const metadataBytes = new TextEncoder().encode(JSON.stringify(combinedMetadata));
            const pixelBytes = new Uint8Array(frame);
            const payload = new Uint8Array(4 + metadataBytes.byteLength + pixelBytes.byteLength);
            new DataView(payload.buffer).setUint32(0, metadataBytes.byteLength, true);
            payload.set(metadataBytes, 4);
            payload.set(pixelBytes, 4 + metadataBytes.byteLength);
            return payload;
        }

        window.__desktopDecodeInvokeCalls = invokeCalls;

        window.__TAURI_INTERNALS__ = {
            metadata: {
                currentWindow: { label: 'main' },
                currentWebview: { label: 'main', windowLabel: 'main' }
            },
            convertFileSrc(filePath, protocol = 'asset') {
                return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
            },
            transformCallback(callback, once = false) {
                const id = callbackId++;
                callbacks.set(id, (payload) => {
                    if (once) {
                        callbacks.delete(id);
                    }
                    return callback(payload);
                });
                return id;
            },
            unregisterCallback(id) {
                callbacks.delete(id);
            },
            async invoke(cmd, args) {
                invokeCalls.push({ cmd, args });
                switch (cmd) {
                    case 'plugin:event|listen':
                        return args.handler;
                    case 'plugin:event|unlisten':
                        return null;
                    case 'decode_frame_with_pixels': {
                        if (opts.decodeFrameError) {
                            throw opts.decodeFrameError;
                        }
                        const payload = createCombinedDecodePayload();
                        if (binaryResponseMode === 'uint8array') {
                            return payload;
                        }
                        if (binaryResponseMode === 'arraybuffer') {
                            return payload.buffer;
                        }
                        if (binaryResponseMode === 'data-object') {
                            return { data: Array.from(payload) };
                        }
                        if (binaryResponseMode === 'invalid-object') {
                            return { bogus: [1, 2, 3] };
                        }
                        throw new Error(`Unhandled binaryResponseMode: ${binaryResponseMode}`);
                    }
                    case 'decode_frame':
                        if (opts.decodeFrameError) {
                            throw opts.decodeFrameError;
                        }
                        return metadata;
                    case 'take_decoded_frame': {
                        if (opts.takeDecodedFrameError) {
                            throw opts.takeDecodedFrameError;
                        }
                        const frame = decodedFrames.get(args.decodeId);
                        if (!frame) {
                            throw new Error(`Decoded frame not found: ${args.decodeId}`);
                        }

                        if (binaryResponseMode === 'uint8array') {
                            return new Uint8Array(frame);
                        }
                        if (binaryResponseMode === 'arraybuffer') {
                            return frame;
                        }
                        if (binaryResponseMode === 'data-object') {
                            return { data: Array.from(new Uint8Array(frame)) };
                        }
                        if (binaryResponseMode === 'invalid-object') {
                            return { bogus: [1, 2, 3] };
                        }
                        throw new Error(`Unhandled binaryResponseMode: ${binaryResponseMode}`);
                    }
                    default:
                        throw new Error(`Unhandled command: ${cmd}`);
                }
            }
        };

        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
            unregisterListener(_event, id) {
                callbacks.delete(id);
            }
        };
    }, options);
}

test('desktop decode bridge coerces LE bytes into unsigned 16-bit samples', async ({ page }) => {
    await installMockDesktopDecode(page);
    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const decoded = await window.DicomViewerApp.desktopDecode.decodeFrameWithPixels('/mock/study/MR2_J2KI.dcm', 3);
        return {
            metadata: {
                rows: decoded.rows,
                cols: decoded.cols,
                bitsAllocated: decoded.bitsAllocated,
                pixelDataLength: decoded.pixelDataLength
            },
            pixelDataType: decoded.pixelData.constructor.name,
            pixelSamples: Array.from(decoded.pixelData),
            invokeCalls: window.__desktopDecodeInvokeCalls
                .filter(call => !call.cmd.startsWith('plugin:'))
                .map(call => ({ cmd: call.cmd, args: call.args }))
        };
    });

    expect(result.metadata).toEqual({
        rows: 2,
        cols: 1,
        bitsAllocated: 16,
        pixelDataLength: 4
    });
    expect(result.pixelDataType).toBe('Uint16Array');
    expect(result.pixelSamples).toEqual([0x1234, 0x5678]);
    expect(result.invokeCalls).toEqual([
        {
            cmd: 'decode_frame_with_pixels',
            args: {
                path: '/mock/study/MR2_J2KI.dcm',
                frameIndex: 3
            }
        }
    ]);
});

test('desktop decode bridge preserves signed sample types', async ({ page }) => {
    await installMockDesktopDecode(page, {
        metadata: {
            pixelRepresentation: 1
        },
        decodedFrames: [['decode-1', [0xfe, 0xff, 0x00, 0x80]]]
    });
    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const decoded = await window.DicomViewerApp.desktopDecode.decodeFrameWithPixels('/mock/study/signed.dcm', 0);
        return {
            pixelDataType: decoded.pixelData.constructor.name,
            pixelSamples: Array.from(decoded.pixelData)
        };
    });

    expect(result.pixelDataType).toBe('Int16Array');
    expect(result.pixelSamples).toEqual([-2, -32768]);
});

test('desktop decode bridge surfaces a runtime-ready error when invoke is unavailable', async ({ page }) => {
    await page.goto(HOME_URL);

    const message = await page.evaluate(async () => {
        try {
            await window.DicomViewerApp.desktopDecode.decodeFrame('/mock/no-runtime.dcm', 0);
            return {};
        } catch (error) {
            return {
                message: String(error?.message || error),
                stage: error?.stage || null
            };
        }
    });

    expect(message.message).toContain('Desktop decode runtime is not ready');
    expect(message.stage).toBe('codec-init');
});

test('desktop decode bridge preserves structured native error stages', async ({ page }) => {
    await installMockDesktopDecode(page, {
        decodeFrameError: {
            stage: 'decode-timeout',
            message: 'Native decode timed out after 30s.'
        }
    });
    await page.goto(HOME_URL);

    const failure = await page.evaluate(async () => {
        try {
            await window.DicomViewerApp.desktopDecode.decodeFrame('/mock/study/timeout.dcm', 0);
            return {};
        } catch (error) {
            return {
                message: String(error?.message || error),
                stage: error?.stage || null
            };
        }
    });

    expect(failure.message).toContain('Native decode timed out after 30s.');
    expect(failure.stage).toBe('decode-timeout');
});

test('desktop decode bridge surfaces invalid decode ids', async ({ page }) => {
    await installMockDesktopDecode(page);
    await page.goto(HOME_URL);

    const failure = await page.evaluate(async () => {
        try {
            await window.DicomViewerApp.desktopDecode.takeDecodedFrame('missing-decode-id');
            return {};
        } catch (error) {
            return {
                message: String(error?.message || error),
                stage: error?.stage || null
            };
        }
    });

    expect(failure.message).toContain('Decoded frame not found: missing-decode-id');
    expect(failure.stage).toBe('pixel-transfer');
});

test('desktop decode bridge rejects malformed binary payloads', async ({ page }) => {
    await installMockDesktopDecode(page, { binaryResponseMode: 'invalid-object' });
    await page.goto(HOME_URL);

    const failure = await page.evaluate(async () => {
        try {
            await window.DicomViewerApp.desktopDecode.decodeFrameWithPixels('/mock/study/bad-payload.dcm', 0);
            return {};
        } catch (error) {
            return {
                message: String(error?.message || error),
                stage: error?.stage || null
            };
        }
    });

    expect(failure.message).toContain('Unexpected decoded frame payload shape');
    expect(failure.message).toContain('bogus');
    expect(failure.stage).toBe('pixel-conversion');
});
