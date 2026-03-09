// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';
const MR2_J2K_PATH = path.join(__dirname, '..', 'test-data', 'mri-samples', 'MR2_J2KI.dcm');
const MR2_UNCOMPRESSED_PATH = path.join(__dirname, '..', 'test-data', 'mri-samples', 'MR2_UNCI.dcm');

test('JPEG 2000 worker URL resolves relative to the app root and the decoder is no longer eagerly loaded', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate(() => ({
        workerUrl: window.DicomViewerApp.dicom.resolveJpeg2000WorkerUrl(),
        hasDecoderScriptTag: !!document.querySelector('script[src$="js/openjpegwasm_decode.js"], script[src*="openjpegwasm_decode.js"]')
    }));

    expect(result.workerUrl).toMatch(/\/js\/app\/decode-worker\.js$/);
    expect(result.hasDecoderScriptTag).toBe(false);
});

test('decodeJ2KInWorker reuses a persistent worker and posts copied frame buffers', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const originalWorker = window.Worker;
        const firstSourceFrame = new Uint8Array([1, 2, 3, 4]);
        const secondSourceFrame = new Uint8Array([5, 6, 7, 8]);
        const calls = [];
        let workerCount = 0;
        let terminatedCount = 0;

        class FakeWorker {
            constructor(url) {
                this.url = url;
                workerCount += 1;
            }

            postMessage(payload, transferList) {
                const workerCallNumber = calls.length + 1;
                calls.push({
                    requestId: payload.requestId,
                    url: this.url,
                    copiedBuffer: payload.frameData.buffer !== (workerCallNumber === 1 ? firstSourceFrame.buffer : secondSourceFrame.buffer),
                    transferCount: transferList.length,
                    transferByteLength: transferList[0]?.byteLength || 0
                });

                queueMicrotask(() => {
                    this.onmessage?.({
                        data: {
                            type: 'decoded',
                            requestId: payload.requestId,
                            pixelData: new Uint16Array([
                                workerCallNumber,
                                workerCallNumber + 10,
                                workerCallNumber + 20,
                                workerCallNumber + 30
                            ]),
                            frameInfo: { width: 2, height: 2 }
                        }
                    });
                });
            }

            terminate() {
                terminatedCount += 1;
            }
        }

        window.Worker = FakeWorker;

        try {
            const firstPixelData = await window.DicomViewerApp.dicom.decodeJ2KInWorker(firstSourceFrame, 16, 0, 2, 2);
            const secondPixelData = await window.DicomViewerApp.dicom.decodeJ2KInWorker(secondSourceFrame, 16, 0, 2, 2);
            return {
                workerCount,
                terminatedCount,
                workerCalls: calls,
                firstPixelDataType: firstPixelData.constructor.name,
                secondPixelDataType: secondPixelData.constructor.name,
                firstPixelValues: Array.from(firstPixelData),
                secondPixelValues: Array.from(secondPixelData),
                firstSourceFrame: Array.from(firstSourceFrame),
                secondSourceFrame: Array.from(secondSourceFrame)
            };
        } finally {
            window.Worker = originalWorker;
        }
    });

    expect(result.workerCount).toBe(1);
    expect(result.terminatedCount).toBe(0);
    expect(result.workerCalls).toHaveLength(2);
    expect(result.workerCalls[0].url).toMatch(/\/js\/app\/decode-worker\.js$/);
    expect(result.workerCalls[0].requestId).not.toBe(result.workerCalls[1].requestId);
    expect(result.workerCalls[0].copiedBuffer).toBe(true);
    expect(result.workerCalls[1].copiedBuffer).toBe(true);
    expect(result.workerCalls[0].transferCount).toBe(1);
    expect(result.workerCalls[1].transferCount).toBe(1);
    expect(result.workerCalls[0].transferByteLength).toBe(4);
    expect(result.workerCalls[1].transferByteLength).toBe(4);
    expect(result.firstPixelDataType).toBe('Uint16Array');
    expect(result.secondPixelDataType).toBe('Uint16Array');
    expect(result.firstPixelValues).toEqual([1, 11, 21, 31]);
    expect(result.secondPixelValues).toEqual([2, 12, 22, 32]);
    expect(result.firstSourceFrame).toEqual([1, 2, 3, 4]);
    expect(result.secondSourceFrame).toEqual([5, 6, 7, 8]);
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
            let errorStage = null;
            try {
                await window.DicomViewerApp.dicom.decodeJ2KInWorker(new Uint8Array([9, 8, 7]), 16, 0, 1, 1);
            } catch (error) {
                errorMessage = String(error?.message || error);
                errorStage = error?.stage || null;
            }

            return { errorMessage, errorStage, terminated };
        } finally {
            window.Worker = originalWorker;
            window.setTimeout = originalSetTimeout;
        }
    });

    expect(result.errorMessage).toContain('JPEG 2000 decode timeout');
    expect(result.errorMessage).toContain('3 bytes');
    expect(result.errorStage).toBe('decode-timeout');
    expect(result.terminated).toBe(true);
});

test('decodeJ2KInWorker includes the worker URL when the worker fails to load', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const originalWorker = window.Worker;
        let terminated = false;

        class BrokenWorker {
            constructor() {
                queueMicrotask(() => {
                    this.onerror?.({ message: 'Script error.' });
                });
            }

            postMessage() {}

            terminate() {
                terminated = true;
            }
        }

        window.Worker = BrokenWorker;

        try {
            let errorMessage = null;
            let errorStage = null;
            try {
                await window.DicomViewerApp.dicom.decodeJ2KInWorker(new Uint8Array([1]), 16, 0, 1, 1);
            } catch (error) {
                errorMessage = String(error?.message || error);
                errorStage = error?.stage || null;
            }

            return { errorMessage, errorStage, terminated };
        } finally {
            window.Worker = originalWorker;
        }
    });

    expect(result.errorMessage).toContain('Script error.');
    expect(result.errorMessage).toContain('/js/app/decode-worker.js');
    expect(result.errorStage).toBe('codec-init');
    expect(result.terminated).toBe(true);
});

test('decodeJpeg2000 decodes a real JPEG 2000 DICOM to the same pixels as its uncompressed companion', async ({ page }) => {
    const jpeg2000Bytes = Array.from(fs.readFileSync(MR2_J2K_PATH));
    const uncompressedBytes = Array.from(fs.readFileSync(MR2_UNCOMPRESSED_PATH));

    await page.goto(HOME_URL);

    const result = await page.evaluate(async ({ jpeg2000Bytes, uncompressedBytes }) => {
        function toUint8Array(bytes) {
            return new Uint8Array(bytes);
        }

        function readUncompressedPixels(dataSet, sampleCount) {
            const pixelElement = dataSet.elements.x7fe00010;
            const view = new DataView(
                dataSet.byteArray.buffer,
                dataSet.byteArray.byteOffset + pixelElement.dataOffset,
                sampleCount * 2
            );
            const pixels = new Uint16Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                pixels[i] = view.getUint16(i * 2, true);
            }
            return pixels;
        }

        const jpeg2000DataSet = dicomParser.parseDicom(toUint8Array(jpeg2000Bytes));
        const uncompressedDataSet = dicomParser.parseDicom(toUint8Array(uncompressedBytes));
        const rows = jpeg2000DataSet.uint16('x00280010');
        const cols = jpeg2000DataSet.uint16('x00280011');
        const sampleCount = rows * cols;
        const bitsAllocated = jpeg2000DataSet.uint16('x00280100');
        const pixelRepresentation = jpeg2000DataSet.uint16('x00280103');

        const decodedPixels = await window.DicomViewerApp.dicom.decodeJpeg2000(
            jpeg2000DataSet,
            jpeg2000DataSet.elements.x7fe00010,
            rows,
            cols,
            bitsAllocated,
            pixelRepresentation
        );
        const nativePixels = readUncompressedPixels(uncompressedDataSet, sampleCount);

        let allEqual = decodedPixels.length === nativePixels.length;
        for (let i = 0; allEqual && i < decodedPixels.length; i++) {
            if (decodedPixels[i] !== nativePixels[i]) {
                allEqual = false;
            }
        }

        return {
            decodedType: decodedPixels.constructor.name,
            sampleCount,
            allEqual,
            firstEightDecoded: Array.from(decodedPixels.slice(0, 8)),
            firstEightNative: Array.from(nativePixels.slice(0, 8)),
            checksumDecoded: decodedPixels.reduce((sum, value) => sum + value, 0),
            checksumNative: nativePixels.reduce((sum, value) => sum + value, 0)
        };
    }, { jpeg2000Bytes, uncompressedBytes });
    expect(result.decodedType).toBe('Uint16Array');
    expect(result.sampleCount).toBe(1024 * 1024);
    expect(result.allEqual).toBe(true);
    expect(result.firstEightDecoded).toEqual(result.firstEightNative);
    expect(result.checksumDecoded).toBe(result.checksumNative);
    expect(result.workerErrorMessage || null).toBeNull();
});
