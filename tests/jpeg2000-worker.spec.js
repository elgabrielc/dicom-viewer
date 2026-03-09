// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';

test('JPEG 2000 worker URL resolves relative to the app root and the decoder is no longer eagerly loaded', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate(() => ({
        workerUrl: window.DicomViewerApp.dicom.resolveJpeg2000WorkerUrl(),
        hasDecoderScriptTag: !!document.querySelector('script[src$="js/openjpegwasm_decode.js"], script[src*="openjpegwasm_decode.js"]')
    }));

    expect(result.workerUrl).toMatch(/\/js\/app\/decode-worker\.js$/);
    expect(result.hasDecoderScriptTag).toBe(false);
});

test('decodeJ2KInWorker posts a copied frame buffer to the worker and resolves decoded pixels', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const originalWorker = window.Worker;
        const sourceFrame = new Uint8Array([1, 2, 3, 4]);
        const calls = [];

        class FakeWorker {
            constructor(url) {
                this.url = url;
                this.terminated = false;
            }

            postMessage(payload, transferList) {
                calls.push({
                    url: this.url,
                    copiedBuffer: payload.frameData.buffer !== sourceFrame.buffer,
                    transferCount: transferList.length,
                    transferByteLength: transferList[0]?.byteLength || 0
                });

                queueMicrotask(() => {
                    this.onmessage?.({
                        data: {
                            type: 'decoded',
                            pixelData: new Uint16Array([11, 22, 33, 44]),
                            frameInfo: { width: 2, height: 2 }
                        }
                    });
                });
            }

            terminate() {
                this.terminated = true;
                if (calls.length) {
                    calls[calls.length - 1].terminated = true;
                }
            }
        }

        window.Worker = FakeWorker;

        try {
            const pixelData = await window.DicomViewerApp.dicom.decodeJ2KInWorker(sourceFrame, 16, 0, 2, 2);
            return {
                workerCall: calls[0],
                pixelDataType: pixelData.constructor.name,
                pixelValues: Array.from(pixelData),
                sourceFrame: Array.from(sourceFrame)
            };
        } finally {
            window.Worker = originalWorker;
        }
    });

    expect(result.workerCall.url).toMatch(/\/js\/app\/decode-worker\.js$/);
    expect(result.workerCall.copiedBuffer).toBe(true);
    expect(result.workerCall.transferCount).toBe(1);
    expect(result.workerCall.transferByteLength).toBe(4);
    expect(result.workerCall.terminated).toBe(true);
    expect(result.pixelDataType).toBe('Uint16Array');
    expect(result.pixelValues).toEqual([11, 22, 33, 44]);
    expect(result.sourceFrame).toEqual([1, 2, 3, 4]);
});

test('decodeJ2KInWorker times out and terminates a hanging worker', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const originalWorker = window.Worker;
        const originalSetTimeout = window.setTimeout;
        let terminated = false;

        class HangingWorker {
            postMessage() {}

            terminate() {
                terminated = true;
            }
        }

        window.Worker = HangingWorker;
        window.setTimeout = (callback, _ms, ...args) => originalSetTimeout(callback, 0, ...args);

        try {
            let errorMessage = null;
            try {
                await window.DicomViewerApp.dicom.decodeJ2KInWorker(new Uint8Array([9, 8, 7]), 16, 0, 1, 1);
            } catch (error) {
                errorMessage = String(error?.message || error);
            }

            return { errorMessage, terminated };
        } finally {
            window.Worker = originalWorker;
            window.setTimeout = originalSetTimeout;
        }
    });

    expect(result.errorMessage).toContain('JPEG 2000 decode timeout');
    expect(result.terminated).toBe(true);
});
