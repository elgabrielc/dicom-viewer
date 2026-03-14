// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5001';
const HOME_URL = `${TEST_BASE_URL}/?nolib`;
const AUTOLOAD_URL = `${TEST_BASE_URL}/`;
const JPEG_BASELINE_RGB_FIXTURE_PATH = path.join(
    __dirname,
    '..',
    'test-fixtures',
    'SC_RGB_JPEG_BASELINE_YBR422.dcm'
);

function normalizePath(input) {
    const text = String(input || '').replace(/\\/g, '/');
    if (!text) return '';
    const collapsed = text.replace(/\/+/g, '/');
    if (collapsed === '/') return '/';
    return collapsed.replace(/\/+$/g, '');
}

function joinPaths(...parts) {
    const cleaned = parts
        .filter((part) => part !== null && part !== undefined && part !== '')
        .map((part, index) => {
            const value = String(part).replace(/\\/g, '/');
            if (index === 0) {
                return value.replace(/\/+$/g, '') || '/';
            }
            return value.replace(/^\/+/g, '').replace(/\/+$/g, '');
        })
        .filter(Boolean);

    if (!cleaned.length) return '';
    return normalizePath(cleaned.join('/'));
}

async function installMockDesktop(page, options = {}) {
    await page.addInitScript((options) => {
        function normalizePath(input) {
            const text = String(input || '').replace(/\\/g, '/');
            if (!text) return '';
            const collapsed = text.replace(/\/+/g, '/');
            if (collapsed === '/') return '/';
            return collapsed.replace(/\/+$/g, '');
        }

        function joinPaths(...parts) {
            const cleaned = parts
                .filter((part) => part !== null && part !== undefined && part !== '')
                .map((part, index) => {
                    const value = String(part).replace(/\\/g, '/');
                    if (index === 0) {
                        return value.replace(/\/+$/g, '') || '/';
                    }
                    return value.replace(/^\/+/g, '').replace(/\/+$/g, '');
                })
                .filter(Boolean);

            if (!cleaned.length) return '';
            return normalizePath(cleaned.join('/'));
        }

        if (options.initialConfig) {
            localStorage.setItem('dicom-viewer-library-config', JSON.stringify(options.initialConfig));
        }

        const dirs = {};
        for (const [path, entries] of Object.entries(options.dirs || {})) {
            dirs[normalizePath(path)] = entries;
        }

        const readDirErrors = {};
        for (const [path, message] of Object.entries(options.readDirErrors || {})) {
            readDirErrors[normalizePath(path)] = message;
        }

        const readDirDelayMs = Number(options.readDirDelayMs || 0);

        const stats = {};
        for (const [path, value] of Object.entries(options.stats || {})) {
            stats[normalizePath(path)] = value;
        }

        const fileBytes = {};
        for (const [path, value] of Object.entries(options.fileBytes || {})) {
            fileBytes[normalizePath(path)] = value;
        }

        const readFileFailures = {};
        for (const [path, value] of Object.entries(options.readFileFailures || {})) {
            readFileFailures[normalizePath(path)] = Number(value || 0);
        }

        window.__TAURI__ = {
            dialog: {
                async open() {
                    return null;
                }
            },
            fs: {
                async readDir(path) {
                    if (readDirDelayMs > 0) {
                        await new Promise((resolve) => setTimeout(resolve, readDirDelayMs));
                    }
                    const normalized = normalizePath(path);
                    if (Object.prototype.hasOwnProperty.call(readDirErrors, normalized)) {
                        throw new Error(readDirErrors[normalized]);
                    }
                    if (!Object.prototype.hasOwnProperty.call(dirs, normalized)) {
                        throw new Error(`Path not found: ${normalized}`);
                    }
                    return dirs[normalized];
                },
                async readFile(path) {
                    const normalized = normalizePath(path);
                    const remainingFailures = readFileFailures[normalized] || 0;
                    if (remainingFailures > 0) {
                        readFileFailures[normalized] = remainingFailures - 1;
                        throw new Error(`Transient read failure: ${normalized}`);
                    }
                    const bytes = fileBytes[normalized] || [0];
                    return Uint8Array.from(bytes);
                },
                async stat(path) {
                    const normalized = normalizePath(path);
                    if (!Object.prototype.hasOwnProperty.call(stats, normalized)) {
                        throw new Error(`Stat not found: ${normalized}`);
                    }
                    return stats[normalized];
                }
            },
            path: {
                async join(...parts) {
                    return joinPaths(...parts);
                },
                async normalize(path) {
                    return normalizePath(path);
                }
            },
            webview: {
                getCurrentWebview() {
                    return {
                        onDragDropEvent() {
                            return Promise.resolve(() => {});
                        }
                    };
                }
            }
        };
    }, options);
}

test.describe('Desktop library scanning', () => {
    test('desktop path study scan starts processing before the full tree is materialized', async ({ page }) => {
        const rootEntries = [];
        const nestedEntries = [];
        const fileBytes = {};

        for (let index = 1; index <= 128; index++) {
            const name = `root-${String(index).padStart(3, '0')}.dcm`;
            rootEntries.push({ name, isDirectory: false, isFile: true, isSymlink: false });
            fileBytes[`/library/${name}`] = [index];
        }

        for (let index = 1; index <= 2; index++) {
            const name = `nested-${String(index).padStart(3, '0')}.dcm`;
            nestedEntries.push({ name, isDirectory: false, isFile: true, isSymlink: false });
            fileBytes[`/library/nested/${name}`] = [index];
        }

        rootEntries.push({ name: 'nested', isDirectory: true, isFile: false, isSymlink: false });

        await installMockDesktop(page, {
            dirs: {
                '/library': rootEntries,
                '/library/nested': nestedEntries
            },
            fileBytes
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const summary = await page.evaluate(async () => {
            const progress = [];
            const studies = await window.DicomViewerApp.sources.loadStudiesFromDesktopPaths(['/library'], {
                onProgress: (stats) => {
                    progress.push({
                        discovered: stats.discovered,
                        processed: stats.processed,
                        valid: stats.valid,
                        complete: stats.complete
                    });
                }
            });
            return {
                studyCount: Object.keys(studies).length,
                progress
            };
        });

        expect(summary.studyCount).toBe(0);
        expect(summary.progress.some((entry) => entry.discovered === 128 && entry.processed === 128)).toBe(true);
        expect(summary.progress.at(-1)).toMatchObject({
            discovered: 130,
            processed: 130,
            valid: 0,
            complete: true
        });
    });

    test('desktop path reads retry transient filesystem failures', async ({ page }) => {
        await installMockDesktop(page, {
            fileBytes: {
                '/library/image.dcm': [1, 2, 3, 4]
            },
            readFileFailures: {
                '/library/image.dcm': 2
            }
        });

        await page.goto(HOME_URL);

        const bytes = await page.evaluate(async () => {
            const buffer = await window.DicomViewerApp.sources.readSliceBuffer({
                source: { kind: 'path', path: '/library/image.dcm' }
            }, 'scan');
            return {
                isUint8Array: buffer instanceof Uint8Array,
                bytes: Array.from(buffer)
            };
        });

        expect(bytes).toEqual({
            isUint8Array: true,
            bytes: [1, 2, 3, 4]
        });
    });

    test('renderable image metadata helper excludes non-image DICOM objects', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const { isRenderableImageMetadata } = window.DicomViewerApp.sources;
            return {
                image: isRenderableImageMetadata({
                    studyInstanceUid: '1.2.3',
                    hasPixelData: true,
                    rows: 2991,
                    cols: 1580
                }),
                structuredReport: isRenderableImageMetadata({
                    studyInstanceUid: '1.2.3',
                    hasPixelData: false,
                    rows: 0,
                    cols: 0,
                    sopClassUid: '1.2.840.10008.5.1.4.1.1.88.22'
                }),
                missingDimensions: isRenderableImageMetadata({
                    studyInstanceUid: '1.2.3',
                    hasPixelData: true,
                    rows: 0,
                    cols: 1580
                })
            };
        });

        expect(result.image).toBe(true);
        expect(result.structuredReport).toBe(false);
        expect(result.missingDimensions).toBe(false);
    });

    test('metadata scan helper reads numeric DICOM tags when string access is empty', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const dataSet = {
                string(tag) {
                    const values = {
                        x00200013: '',
                        x00201041: ''
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 512,
                        x00280011: 512,
                        x00200013: 7
                    };
                    return values[tag];
                },
                elements: {
                    x7fe00010: {}
                }
            };

            const { getMetadataNumber } = window.DicomViewerApp.dicom;
            return {
                rows: getMetadataNumber(dataSet, 'x00280010', 0),
                cols: getMetadataNumber(dataSet, 'x00280011', 0),
                instanceNumber: getMetadataNumber(dataSet, 'x00200013', 0)
            };
        });

        expect(result.rows).toBe(512);
        expect(result.cols).toBe(512);
        expect(result.instanceNumber).toBe(7);
    });

    test('byte-array helper preserves typed-array inputs without cloning', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const bytes = Uint8Array.from([9, 8, 7, 6]).subarray(1, 3);
            const normalized = await window.DicomViewerApp.dicom.toDicomByteArray(bytes);
            return {
                sameReference: normalized === bytes,
                bytes: Array.from(normalized)
            };
        });

        expect(result).toEqual({
            sameReference: true,
            bytes: [8, 7]
        });
    });

    test('multi-frame metadata expands into virtual slices that share a cache key', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const source = { kind: 'path', path: '/library/multi-frame.dcm' };
            const slices = window.DicomViewerApp.sources.expandFrameSlices({
                numberOfFrames: 4,
                sopInstanceUid: '1.2.3.4',
                instanceNumber: 12,
                sliceLocation: 34.5
            }, source);

            return {
                count: slices.length,
                frameIndexes: slices.map((slice) => slice.frameIndex),
                sameSourceReference: slices.every((slice) => slice.source === source),
                dedupeKeys: slices.map((slice) => window.DicomViewerApp.sources.getSliceDedupKey(slice)),
                cacheKeys: slices.map((slice, index) =>
                    window.DicomViewerApp.sources.getSliceCacheKey(slice, index)
                )
            };
        });

        expect(result.count).toBe(4);
        expect(result.frameIndexes).toEqual([0, 1, 2, 3]);
        expect(result.sameSourceReference).toBe(true);
        expect(result.dedupeKeys).toEqual([
            '1.2.3.4|0',
            '1.2.3.4|1',
            '1.2.3.4|2',
            '1.2.3.4|3'
        ]);
        expect(new Set(result.cacheKeys)).toEqual(new Set(['path:/library/multi-frame.dcm']));
    });

    test('scan dedupes duplicate DICOM copies with the same SOP instance UID', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const summary = await page.evaluate(async () => {
            const studiesResponse = await fetch('/api/test-data/studies');
            const studiesPayload = await studiesResponse.json();
            const study = studiesPayload[0];
            const series = study.series[0];
            const dicomResponse = await fetch(
                `/api/test-data/dicom/${study.studyInstanceUid}/${series.seriesInstanceUid}/0`
            );
            const blob = await dicomResponse.blob();

            const studies = await window.DicomViewerApp.sources.processFilesFromSources([
                { name: 'first-copy.dcm', source: { kind: 'blob', blob } },
                { name: 'second-copy.dcm', source: { kind: 'blob', blob } }
            ]);

            const loadedStudy = Object.values(studies)[0];
            const loadedSeries = Object.values(loadedStudy.series)[0];
            return {
                studyCount: Object.keys(studies).length,
                seriesCount: Object.keys(loadedStudy.series).length,
                sliceCount: loadedSeries.slices.length
            };
        });

        expect(summary).toEqual({
            studyCount: 1,
            seriesCount: 1,
            sliceCount: 1
        });
    });

    test('renderDicom selects the requested frame from an uncompressed multi-frame dataset', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const frame0Pixels = Array.from({ length: 16 }, (_, index) => index * 100);
            const frame1Pixels = Array.from({ length: 16 }, (_, index) => 4000 + (index * 100));
            const buffer = new ArrayBuffer(32 * 2);
            const pixels = new Uint16Array(buffer);
            pixels.set([...frame0Pixels, ...frame1Pixels]);

            const dataSet = {
                byteArray: new Uint8Array(buffer),
                elements: {
                    x7fe00010: {
                        dataOffset: 0,
                        length: buffer.byteLength
                    }
                },
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'DX'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 4,
                        x00280011: 4,
                        x00280100: 16,
                        x00280103: 0,
                        x00280002: 1
                    };
                    return values[tag];
                }
            };

            await window.DicomViewerApp.rendering.renderDicom(dataSet, { center: 3500, width: 7000 }, 0);
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const frame0 = ctx.getImageData(0, 0, 1, 1).data[0];

            await window.DicomViewerApp.rendering.renderDicom(dataSet, { center: 3500, width: 7000 }, 1);
            const frame1 = ctx.getImageData(0, 0, 1, 1).data[0];

            return { frame0, frame1 };
        });

        expect(result.frame0).toBe(0);
        expect(result.frame1).toBeGreaterThan(result.frame0);
    });

    test('decodeDicom selects the requested frame from a 32-bit uncompressed multi-frame dataset', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const frame0Pixels = [10, 20, 30, 40];
            const frame1Pixels = [100000, 100100, 100200, 100300];
            const buffer = new ArrayBuffer(8 * 4);
            const pixels = new Uint32Array(buffer);
            pixels.set([...frame0Pixels, ...frame1Pixels]);

            const dataSet = {
                byteArray: new Uint8Array(buffer),
                elements: {
                    x7fe00010: {
                        dataOffset: 0,
                        length: buffer.byteLength
                    }
                },
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'CT',
                        x00280004: 'MONOCHROME2',
                        x00281050: '128',
                        x00281051: '256'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 2,
                        x00280011: 2,
                        x00280100: 32,
                        x00280103: 0,
                        x00280002: 1,
                        x00280008: 2
                    };
                    return values[tag];
                }
            };

            const decoded = await window.DicomViewerApp.rendering.decodeDicom(dataSet, 1);
            return {
                pixelDataType: decoded.pixelData.constructor.name,
                pixelValues: Array.from(decoded.pixelData)
            };
        });

        expect(result.pixelDataType).toBe('Uint32Array');
        expect(result.pixelValues).toEqual([100000, 100100, 100200, 100300]);
    });

    test('decodeDicom returns the normalized intermediate contract for uncompressed CT data', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const buffer = new ArrayBuffer(16 * 2);
            const pixels = new Uint16Array(buffer);
            pixels.set(Array.from({ length: 16 }, (_, index) => 1000 + (index * 10)));

            const dataSet = {
                byteArray: new Uint8Array(buffer),
                elements: {
                    x7fe00010: {
                        dataOffset: 0,
                        length: buffer.byteLength
                    }
                },
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'CT',
                        x00280004: 'MONOCHROME2',
                        x00280030: '0.7\\0.8',
                        x00281050: '40',
                        x00281051: '400',
                        x00281052: '-1024',
                        x00281053: '2'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 4,
                        x00280011: 4,
                        x00280100: 16,
                        x00280103: 0,
                        x00280002: 1
                    };
                    return values[tag];
                }
            };

            const decoded = await window.DicomViewerApp.rendering.decodeDicom(dataSet, 0);
            return {
                rows: decoded.rows,
                cols: decoded.cols,
                bitsAllocated: decoded.bitsAllocated,
                pixelRepresentation: decoded.pixelRepresentation,
                samplesPerPixel: decoded.samplesPerPixel,
                photometricInterpretation: decoded.photometricInterpretation,
                windowCenter: decoded.windowCenter,
                windowWidth: decoded.windowWidth,
                rescaleSlope: decoded.rescaleSlope,
                rescaleIntercept: decoded.rescaleIntercept,
                modality: decoded.modality,
                transferSyntax: decoded.transferSyntax,
                pixelDataType: decoded.pixelData.constructor.name,
                pixelDataLength: decoded.pixelData.length,
                pixelSpacing: decoded.pixelSpacing,
                isBlank: decoded.isBlank,
                skipWindowLevel: decoded.skipWindowLevel,
                mrMetadataKeys: Object.keys(decoded.mrMetadata).sort()
            };
        });

        expect(result).toMatchObject({
            rows: 4,
            cols: 4,
            bitsAllocated: 16,
            pixelRepresentation: 0,
            samplesPerPixel: 1,
            photometricInterpretation: 'MONOCHROME2',
            windowCenter: 40,
            windowWidth: 400,
            rescaleSlope: 2,
            rescaleIntercept: -1024,
            modality: 'CT',
            transferSyntax: '1.2.840.10008.1.2.1',
            pixelDataType: 'Uint16Array',
            pixelDataLength: 16,
            pixelSpacing: { row: 0.7, col: 0.8 },
            isBlank: false,
            skipWindowLevel: false
        });
        expect(result.mrMetadataKeys).toEqual(expect.arrayContaining([
            'echoTime',
            'flipAngle',
            'magneticFieldStrength',
            'mrAcquisitionType',
            'protocolName',
            'repetitionTime',
            'scanningSequence',
            'sequenceName',
        ]));
    });

    test('decodeDicom does not write to the canvas when it returns an error', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 2;
            canvas.height = 2;
            ctx.fillStyle = 'rgb(12, 34, 56)';
            ctx.fillRect(0, 0, 2, 2);
            const before = Array.from(ctx.getImageData(0, 0, 2, 2).data);

            const info = await window.DicomViewerApp.rendering.decodeDicom({
                elements: {},
                string() {
                    return '';
                },
                uint16() {
                    return 0;
                }
            }, 0);

            return {
                info,
                after: Array.from(ctx.getImageData(0, 0, 2, 2).data),
                canvasSize: { width: canvas.width, height: canvas.height },
                before
            };
        });

        expect(result.info).toMatchObject({
            error: true,
            errorMessage: 'No pixel data found'
        });
        expect(result.canvasSize).toEqual({ width: 2, height: 2 });
        expect(result.after).toEqual(result.before);
    });

    test('renderDicom can suppress error canvas writes for composable callers', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 2;
            canvas.height = 2;
            ctx.fillStyle = 'rgb(21, 43, 65)';
            ctx.fillRect(0, 0, 2, 2);
            const before = Array.from(ctx.getImageData(0, 0, 2, 2).data);

            const info = await window.DicomViewerApp.rendering.renderDicom({
                elements: {},
                string() {
                    return '';
                },
                uint16() {
                    return 0;
                }
            }, null, 0, null, { displayErrors: false });

            return {
                info,
                after: Array.from(ctx.getImageData(0, 0, 2, 2).data),
                canvasSize: { width: canvas.width, height: canvas.height },
                before
            };
        });

        expect(result.info).toMatchObject({
            error: true,
            errorMessage: 'No pixel data found'
        });
        expect(result.canvasSize).toEqual({ width: 2, height: 2 });
        expect(result.after).toEqual(result.before);
    });

    test('renderDicom error overlay includes stage-level diagnostics', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const ctx = document.getElementById('imageCanvas').getContext('2d');
            const drawnText = [];
            const originalFillText = ctx.fillText.bind(ctx);
            ctx.fillText = (...args) => {
                drawnText.push(String(args[0]));
                return originalFillText(...args);
            };

            try {
                const info = await window.DicomViewerApp.rendering.renderDicom({
                    elements: {},
                    string(tag) {
                        const values = {
                            x00020010: '1.2.840.10008.1.2.4.90',
                            x00080060: 'RF'
                        };
                        return values[tag] || '';
                    },
                    uint16() {
                        return 0;
                    }
                });

                return {
                    info,
                    drawnText
                };
            } finally {
                ctx.fillText = originalFillText;
            }
        });

        expect(result.info).toMatchObject({
            error: true,
            stage: 'frame-extraction'
        });
        expect(result.info.diagnosticLines).toEqual(expect.arrayContaining([
            'Stage: frame-extraction',
            'Transfer Syntax: JPEG 2000 Lossless',
            'Modality: RF'
        ]));
        expect(result.drawnText).toEqual(expect.arrayContaining([
            'Stage: frame-extraction',
            'Transfer Syntax: JPEG 2000 Lossless',
            'Modality: RF'
        ]));
    });

    test('renderDicom fallback diagnostics include both js and native failure stages', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const app = window.DicomViewerApp;
            const ctx = document.getElementById('imageCanvas').getContext('2d');
            const drawnText = [];
            const originalFillText = ctx.fillText.bind(ctx);
            ctx.fillText = (...args) => {
                drawnText.push(String(args[0]));
                return originalFillText(...args);
            };

            app.desktopDecode.decodeFrameWithPixels = async () => {
                const error = new Error('Native decoder timed out');
                error.stage = 'decode-timeout';
                throw error;
            };

            try {
                const info = await app.rendering.renderDicom({
                    elements: {},
                    string(tag) {
                        const values = {
                            x00020010: '1.2.840.10008.1.2.1',
                            x00080060: 'CT',
                            x00280004: 'MONOCHROME2'
                        };
                        return values[tag] || '';
                    },
                    uint16(tag) {
                        const values = {
                            x00280010: 4,
                            x00280011: 4,
                            x00280100: 16,
                            x00280103: 0,
                            x00280002: 1
                        };
                        return values[tag] || 0;
                    }
                }, null, 0, {
                    frameIndex: 0,
                    source: {
                        kind: 'path',
                        path: '/library/fallback-failure.dcm'
                    }
                });

                return {
                    info,
                    drawnText
                };
            } finally {
                ctx.fillText = originalFillText;
            }
        });

        expect(result.info).toMatchObject({
            error: true,
            stage: 'frame-extraction',
            jsErrorStage: 'frame-extraction',
            nativeErrorStage: 'decode-timeout'
        });
        expect(result.info.diagnosticLines).toEqual(expect.arrayContaining([
            'Stage: frame-extraction',
            'Transfer Syntax: Explicit VR Little Endian',
            'Modality: CT',
            'JS Stage: frame-extraction',
            'Native Stage: decode-timeout'
        ]));
        expect(result.drawnText).toEqual(expect.arrayContaining([
            'JS Stage: frame-extraction',
            'Native Stage: decode-timeout'
        ]));
    });

    test('decodeDicom returns a detached copy of uncompressed pixel data', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const buffer = new ArrayBuffer(4 * 2);
            const backingPixels = new Uint16Array(buffer);
            backingPixels.set([100, 200, 300, 400]);

            const dataSet = {
                byteArray: new Uint8Array(buffer),
                elements: {
                    x7fe00010: {
                        dataOffset: 0,
                        length: buffer.byteLength
                    }
                },
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'CT',
                        x00280004: 'MONOCHROME2',
                        x00281050: '40',
                        x00281051: '400'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 2,
                        x00280011: 2,
                        x00280100: 16,
                        x00280103: 0,
                        x00280002: 1,
                        x00280008: 1
                    };
                    return values[tag];
                }
            };

            const decoded = await window.DicomViewerApp.rendering.decodeDicom(dataSet, 0);
            const sharesBuffer = decoded.pixelData.buffer === buffer;
            decoded.pixelData[0] = 9999;

            return {
                sharesBuffer,
                backingFirstValue: backingPixels[0],
                decodedFirstValue: decoded.pixelData[0]
            };
        });

        expect(result.sharesBuffer).toBe(false);
        expect(result.backingFirstValue).toBe(100);
        expect(result.decodedFirstValue).toBe(9999);
    });

    test('renderPixels renders a hand-constructed decode contract to the canvas', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const { state, rendering } = window.DicomViewerApp;
            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;

            const info = rendering.renderPixels({
                pixelData: new Uint16Array([0, 1000, 2000, 3000]),
                rows: 2,
                cols: 2,
                bitsAllocated: 16,
                pixelRepresentation: 0,
                samplesPerPixel: 1,
                photometricInterpretation: 'MONOCHROME2',
                windowCenter: 1500,
                windowWidth: 3000,
                rescaleSlope: 1,
                rescaleIntercept: 0,
                modality: 'CT',
                transferSyntax: '1.2.840.10008.1.2.1',
                mrMetadata: {
                    repetitionTime: 0,
                    echoTime: 0,
                    flipAngle: 0,
                    magneticFieldStrength: 0,
                    protocolName: '',
                    sequenceName: '',
                    scanningSequence: '',
                    mrAcquisitionType: ''
                },
                pixelSpacing: { row: 0.5, col: 0.25 },
                isBlank: false,
                skipWindowLevel: false
            });

            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const imageData = Array.from(ctx.getImageData(0, 0, 2, 2).data);

            return {
                info,
                canvasSize: { width: canvas.width, height: canvas.height },
                firstChannel: imageData.filter((_, index) => index % 4 === 0),
                alphaChannel: imageData.filter((_, index) => index % 4 === 3),
                baseWindowLevel: state.baseWindowLevel,
                pixelSpacing: state.pixelSpacing
            };
        });

        expect(result.info).toMatchObject({
            rows: 2,
            cols: 2,
            wc: 1500,
            ww: 3000,
            transferSyntax: '1.2.840.10008.1.2.1',
            modality: 'CT'
        });
        expect(result.canvasSize).toEqual({ width: 2, height: 2 });
        expect(result.firstChannel).toEqual([0, 85, 170, 255]);
        expect(result.alphaChannel).toEqual([255, 255, 255, 255]);
        expect(result.baseWindowLevel).toEqual({ center: 1500, width: 3000 });
        expect(result.pixelSpacing).toEqual({ row: 0.5, col: 0.25 });
    });

    test('renderPixels inverts MONOCHROME1 grayscale after windowing', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const { state, rendering } = window.DicomViewerApp;
            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;

            const info = rendering.renderPixels({
                pixelData: new Uint16Array([0, 1000, 2000, 3000]),
                rows: 2,
                cols: 2,
                bitsAllocated: 16,
                pixelRepresentation: 0,
                samplesPerPixel: 1,
                photometricInterpretation: 'MONOCHROME1',
                windowCenter: 1500,
                windowWidth: 3000,
                rescaleSlope: 1,
                rescaleIntercept: 0,
                modality: 'CR',
                transferSyntax: '1.2.840.10008.1.2.1',
                mrMetadata: {
                    repetitionTime: 0,
                    echoTime: 0,
                    flipAngle: 0,
                    magneticFieldStrength: 0,
                    protocolName: '',
                    sequenceName: '',
                    scanningSequence: '',
                    mrAcquisitionType: ''
                },
                pixelSpacing: null,
                isBlank: false,
                skipWindowLevel: false
            });

            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const imageData = Array.from(ctx.getImageData(0, 0, 2, 2).data);

            return {
                info,
                firstChannel: imageData.filter((_, index) => index % 4 === 0),
                alphaChannel: imageData.filter((_, index) => index % 4 === 3)
            };
        });

        expect(result.info).toMatchObject({
            rows: 2,
            cols: 2,
            modality: 'CR'
        });
        expect(result.firstChannel).toEqual([255, 170, 85, 0]);
        expect(result.alphaChannel).toEqual([255, 255, 255, 255]);
    });

    test('renderPixels normalizes RGB samples using Bits Stored instead of container size', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const { state, rendering } = window.DicomViewerApp;
            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;

            const info = rendering.renderPixels({
                pixelData: new Uint16Array([
                    0, 4095, 2048,
                    4095, 0, 1024
                ]),
                rows: 1,
                cols: 2,
                bitsAllocated: 16,
                bitsStored: 12,
                pixelRepresentation: 0,
                samplesPerPixel: 3,
                planarConfiguration: 0,
                photometricInterpretation: 'RGB',
                windowCenter: 0,
                windowWidth: 1,
                rescaleSlope: 1,
                rescaleIntercept: 0,
                modality: 'OT',
                transferSyntax: '1.2.840.10008.1.2.1',
                mrMetadata: {
                    repetitionTime: 0,
                    echoTime: 0,
                    flipAngle: 0,
                    magneticFieldStrength: 0,
                    protocolName: '',
                    sequenceName: '',
                    scanningSequence: '',
                    mrAcquisitionType: ''
                },
                pixelSpacing: null,
                isBlank: false,
                skipWindowLevel: true
            });

            const rgba = Array.from(
                document.getElementById('imageCanvas').getContext('2d').getImageData(0, 0, 2, 1).data
            );

            return {
                info,
                rgba
            };
        });

        expect(result.info).toMatchObject({
            rows: 1,
            cols: 2,
            modality: 'OT'
        });
        expect(result.rgba).toEqual([
            0, 255, 128, 255,
            255, 0, 64, 255
        ]);
    });

    test('decodeDicom treats JPEG Baseline MONOCHROME1 data as grayscale even with minor RGB roundtrip drift', async ({ page }) => {
        const fixtureBytes = Array.from(fs.readFileSync(JPEG_BASELINE_RGB_FIXTURE_PATH));

        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async (fixtureBytes) => {
            const { rendering } = window.DicomViewerApp;
            const parser = globalThis.dicomParser || window.dicomParser || dicomParser;
            const dataSet = parser.parseDicom(Uint8Array.from(fixtureBytes));
            const originalString = dataSet.string.bind(dataSet);
            const originalUint16 = dataSet.uint16.bind(dataSet);
            const originalCreateElement = document.createElement.bind(document);
            const originalCreateImageBitmap = window.createImageBitmap;

            dataSet.string = (tag) => {
                if (tag === 'x00280004') {
                    return 'MONOCHROME1';
                }
                return originalString(tag);
            };
            dataSet.uint16 = (tag) => {
                if (tag === 'x00280010') return 1;
                if (tag === 'x00280011') return 2;
                return originalUint16(tag);
            };

            window.createImageBitmap = async () => ({ width: 2, height: 1 });
            document.createElement = (tagName) => {
                if (String(tagName).toLowerCase() !== 'canvas') {
                    return originalCreateElement(tagName);
                }
                return {
                    width: 0,
                    height: 0,
                    getContext() {
                        return {
                            drawImage() {},
                            getImageData() {
                                return {
                                    data: new Uint8ClampedArray([
                                        120, 121, 119, 255,
                                        15, 16, 14, 255
                                    ])
                                };
                            }
                        };
                    }
                };
            };

            try {
                const decoded = await rendering.decodeDicom(dataSet, 0);
                return {
                    error: decoded.error || false,
                    bitsAllocated: decoded.bitsAllocated,
                    bitsStored: decoded.bitsStored,
                    samplesPerPixel: decoded.samplesPerPixel,
                    photometricInterpretation: decoded.photometricInterpretation,
                    skipWindowLevel: decoded.skipWindowLevel,
                    pixels: Array.from(decoded.pixelData)
                };
            } finally {
                window.createImageBitmap = originalCreateImageBitmap;
                document.createElement = originalCreateElement;
            }
        }, fixtureBytes);

        expect(result.error).toBe(false);
        expect(result.bitsAllocated).toBe(8);
        expect(result.bitsStored).toBe(8);
        expect(result.samplesPerPixel).toBe(1);
        expect(result.photometricInterpretation).toBe('MONOCHROME1');
        expect(result.skipWindowLevel).toBe(true);
        expect(result.pixels).toEqual([120, 15]);
    });

    test('decodeDicom plus renderPixels preserves JPEG Baseline color frames as RGB', async ({ page }) => {
        const fixtureBytes = Array.from(fs.readFileSync(JPEG_BASELINE_RGB_FIXTURE_PATH));

        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async (fixtureBytes) => {
            const { state, rendering } = window.DicomViewerApp;
            const parser = globalThis.dicomParser || window.dicomParser || dicomParser;
            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;

            const dataSet = parser.parseDicom(Uint8Array.from(fixtureBytes));
            const decoded = await rendering.decodeDicom(dataSet, 0);
            const info = rendering.renderPixels(decoded);
            const ctx = document.getElementById('imageCanvas').getContext('2d');
            const redDominantPixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
            const greenDominantPixel = Array.from(ctx.getImageData(0, 21, 1, 1).data);

            return {
                decodedError: decoded.error || false,
                bitsAllocated: decoded.bitsAllocated,
                samplesPerPixel: decoded.samplesPerPixel,
                planarConfiguration: decoded.planarConfiguration,
                photometricInterpretation: decoded.photometricInterpretation,
                skipWindowLevel: decoded.skipWindowLevel,
                info,
                redDominantPixel,
                greenDominantPixel,
            };
        }, fixtureBytes);

        expect(result.decodedError).toBe(false);
        expect(result.bitsAllocated).toBe(8);
        expect(result.samplesPerPixel).toBe(3);
        expect(result.planarConfiguration).toBe(0);
        expect(result.photometricInterpretation).toBe('RGB');
        expect(result.skipWindowLevel).toBe(true);
        expect(result.info).toMatchObject({
            rows: 100,
            cols: 100,
            transferSyntax: '1.2.840.10008.1.2.4.50',
            modality: 'OT'
        });
        expect(result.redDominantPixel[0]).toBeGreaterThan(result.redDominantPixel[1] + 40);
        expect(result.redDominantPixel[0]).toBeGreaterThan(result.redDominantPixel[2] + 40);
        expect(result.redDominantPixel[3]).toBe(255);
        expect(result.greenDominantPixel[1]).toBeGreaterThan(result.greenDominantPixel[0] + 40);
        expect(result.greenDominantPixel[1]).toBeGreaterThan(result.greenDominantPixel[2] + 40);
        expect(result.greenDominantPixel[3]).toBe(255);
    });

    test('decodeDicom plus renderPixels preserves uncompressed interleaved RGB secondary-capture pixels', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const { state, rendering } = window.DicomViewerApp;
            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;

            const byteArray = new Uint8Array([
                255, 0, 0,
                0, 255, 0
            ]);
            const dataSet = {
                byteArray,
                elements: {
                    x7fe00010: {
                        dataOffset: 0,
                        length: byteArray.byteLength
                    }
                },
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'OT',
                        x00280004: 'RGB'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 1,
                        x00280011: 2,
                        x00280100: 8,
                        x00280103: 0,
                        x00280002: 3,
                        x00280006: 0
                    };
                    return values[tag] || 0;
                }
            };

            const decoded = await rendering.decodeDicom(dataSet, 0);
            const info = rendering.renderPixels(decoded);
            const canvas = document.getElementById('imageCanvas');
            const rgba = Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 1).data);

            return {
                decodedError: decoded.error || false,
                samplesPerPixel: decoded.samplesPerPixel,
                planarConfiguration: decoded.planarConfiguration,
                photometricInterpretation: decoded.photometricInterpretation,
                info,
                rgba
            };
        });

        expect(result.decodedError).toBe(false);
        expect(result.samplesPerPixel).toBe(3);
        expect(result.planarConfiguration).toBe(0);
        expect(result.photometricInterpretation).toBe('RGB');
        expect(result.info).toMatchObject({
            rows: 1,
            cols: 2,
            transferSyntax: '1.2.840.10008.1.2.1',
            modality: 'OT'
        });
        expect(result.rgba).toEqual([
            255, 0, 0, 255,
            0, 255, 0, 255
        ]);
    });

    test('decodeDicom plus renderPixels preserves planar RGB pixels and keeps MR defaults intact', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const { state, rendering } = window.DicomViewerApp;
            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;

            const byteArray = new Uint8Array([
                255, 0,
                0, 255,
                0, 0
            ]);
            const dataSet = {
                byteArray,
                elements: {
                    x7fe00010: {
                        dataOffset: 0,
                        length: byteArray.byteLength
                    }
                },
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'MR',
                        x00280004: 'RGB'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 1,
                        x00280011: 2,
                        x00280100: 8,
                        x00280103: 0,
                        x00280002: 3,
                        x00280006: 1
                    };
                    return values[tag] || 0;
                }
            };

            const decoded = await rendering.decodeDicom(dataSet, 0);
            const info = rendering.renderPixels(decoded);
            const canvas = document.getElementById('imageCanvas');
            const rgba = Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 1).data);

            return {
                decodedError: decoded.error || false,
                samplesPerPixel: decoded.samplesPerPixel,
                planarConfiguration: decoded.planarConfiguration,
                photometricInterpretation: decoded.photometricInterpretation,
                info,
                rgba
            };
        });

        expect(result.decodedError).toBe(false);
        expect(result.samplesPerPixel).toBe(3);
        expect(result.planarConfiguration).toBe(1);
        expect(result.photometricInterpretation).toBe('RGB');
        expect(result.info).toMatchObject({
            rows: 1,
            cols: 2,
            wc: 512,
            ww: 1024,
            transferSyntax: '1.2.840.10008.1.2.1',
            modality: 'MR'
        });
        expect(result.rgba).toEqual([
            255, 0, 0, 255,
            0, 255, 0, 255
        ]);
    });

    test('decodeNative rejects native payloads whose sample count does not match the geometry', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const message = await page.evaluate(async () => {
            const app = window.DicomViewerApp;
            app.desktopDecode.decodeFrameWithPixels = async () => ({
                rows: 2,
                cols: 2,
                bitsAllocated: 16,
                pixelRepresentation: 0,
                samplesPerPixel: 1,
                photometricInterpretation: 'MONOCHROME2',
                windowCenter: 50,
                windowWidth: 100,
                rescaleSlope: 1,
                rescaleIntercept: 0,
                pixelData: new Uint16Array([10, 20, 30])
            });

            try {
                await app.rendering.decodeNative({
                    string(tag) {
                        const values = {
                            x00020010: '1.2.840.10008.1.2.1',
                            x00080060: 'CT',
                            x00280004: 'MONOCHROME2',
                            x00281050: '50',
                            x00281051: '100'
                        };
                        return values[tag] || '';
                    }
                }, '/library/bad-native.dcm', 0);
                return null;
            } catch (error) {
                return String(error?.message || error);
            }
        });

        expect(message).toContain('expected 4');
    });

    test('renderDicom matches decodeDicom plus renderPixels for a known slice', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            function createDataSet() {
                const buffer = new ArrayBuffer(16 * 2);
                const pixels = new Uint16Array(buffer);
                pixels.set(Array.from({ length: 16 }, (_, index) => index * 256));

                return {
                    byteArray: new Uint8Array(buffer),
                    elements: {
                        x7fe00010: {
                            dataOffset: 0,
                            length: buffer.byteLength
                        }
                    },
                    string(tag) {
                        const values = {
                            x00020010: '1.2.840.10008.1.2.1',
                            x00080060: 'CT',
                            x00280004: 'MONOCHROME2',
                            x00280030: '0.9\\0.9',
                            x00281050: '128',
                            x00281051: '256',
                            x00281052: '0',
                            x00281053: '1'
                        };
                        return values[tag] || '';
                    },
                    uint16(tag) {
                        const values = {
                            x00280010: 4,
                            x00280011: 4,
                            x00280100: 16,
                            x00280103: 0,
                            x00280002: 1
                        };
                        return values[tag];
                    }
                };
            }

            const { rendering, state } = window.DicomViewerApp;
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const override = { center: 1024, width: 2048 };

            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;
            const decoded = await rendering.decodeDicom(createDataSet(), 0);
            const splitInfo = rendering.renderPixels(decoded, override);
            const splitPixels = Array.from(ctx.getImageData(0, 0, 4, 4).data);
            const splitBaseWindowLevel = { ...state.baseWindowLevel };
            const splitPixelSpacing = state.pixelSpacing ? { ...state.pixelSpacing } : null;

            state.baseWindowLevel = { center: null, width: null };
            state.pixelSpacing = null;
            const wrapperInfo = await rendering.renderDicom(createDataSet(), override, 0);
            const wrapperPixels = Array.from(ctx.getImageData(0, 0, 4, 4).data);

            return {
                splitInfo,
                wrapperInfo,
                splitPixels,
                wrapperPixels,
                splitBaseWindowLevel,
                wrapperBaseWindowLevel: state.baseWindowLevel,
                splitPixelSpacing,
                wrapperPixelSpacing: state.pixelSpacing
            };
        });

        expect(result.wrapperInfo).toEqual(result.splitInfo);
        expect(result.wrapperPixels).toEqual(result.splitPixels);
        expect(result.wrapperBaseWindowLevel).toEqual(result.splitBaseWindowLevel);
        expect(result.wrapperPixelSpacing).toEqual(result.splitPixelSpacing);
    });

    test('viewer loadSlice falls back to native desktop decode after an explicit js-first decode error', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const app = window.DicomViewerApp;
            const slice = {
                frameIndex: 0,
                sliceLocation: 12.34,
                source: {
                    kind: 'path',
                    path: '/library/native-fallback.dcm'
                }
            };
            const cacheKey = app.sources.getSliceCacheKey(slice, 0);
            const nativeCalls = [];

            app.state.currentStudy = {
                studyInstanceUid: 'study-1'
            };
            app.state.currentSeries = {
                seriesInstanceUid: 'series-1',
                slices: [slice]
            };
            app.state.currentSliceIndex = 0;
            app.state.windowLevel = { center: null, width: null };
            app.state.baseWindowLevel = { center: null, width: null };
            app.state.pixelSpacing = null;
            // Intentionally omit Pixel Data so the js-first route returns a decode error
            // and the viewer must fall back to the native desktop path for this slice.
            app.state.sliceCache.set(cacheKey, {
                elements: {},
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.1',
                        x00080060: 'CT',
                        x00280004: 'MONOCHROME2',
                        x00280030: '0.5\\0.25',
                        x00281050: '40',
                        x00281051: '400',
                        x00281052: '0',
                        x00281053: '1'
                    };
                    return values[tag] || '';
                },
                uint16(tag) {
                    const values = {
                        x00280010: 4,
                        x00280011: 4,
                        x00280100: 16,
                        x00280103: 0,
                        x00280002: 1
                    };
                    return values[tag] || 0;
                }
            });
            app.desktopDecode.decodeFrameWithPixels = async (path, frameIndex) => {
                nativeCalls.push({ path, frameIndex });
                return {
                    rows: 4,
                    cols: 4,
                    bitsAllocated: 16,
                    pixelRepresentation: 0,
                    samplesPerPixel: 1,
                    planarConfiguration: 0,
                    photometricInterpretation: 'MONOCHROME2',
                    windowCenter: 1500,
                    windowWidth: 3000,
                    rescaleSlope: 1,
                    rescaleIntercept: 0,
                    pixelDataLength: 32,
                    pixelData: new Uint16Array(Array.from({ length: 16 }, (_, index) => index * 200))
                };
            };

            await app.viewer.loadSlice(0);

            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const imageData = Array.from(ctx.getImageData(0, 0, 4, 4).data);

            return {
                route: app.rendering.getDecodeRoute('1.2.840.10008.1.2.1', 'CT'),
                nativeCalls,
                firstChannel: imageData.filter((_, index) => index % 4 === 0),
                baseWindowLevel: app.state.baseWindowLevel,
                pixelSpacing: app.state.pixelSpacing,
                metadataText: document.getElementById('metadataContent').textContent
            };
        });

        expect(result.route).toBe('js-first');
        expect(result.nativeCalls).toEqual([
            {
                path: '/library/native-fallback.dcm',
                frameIndex: 0
            }
        ]);
        expect(result.firstChannel).toEqual([
            0, 17, 34, 51,
            68, 85, 102, 119,
            136, 153, 170, 187,
            204, 221, 238, 255
        ]);
        expect(result.baseWindowLevel).toEqual({ center: 1500, width: 3000 });
        expect(result.pixelSpacing).toEqual({ row: 0.5, col: 0.25 });
        expect(result.metadataText).toContain('CT');
        expect(result.metadataText).toContain('4 x 4');
    });

    test('decodeWithFallback uses native-first routing for JPEG 2000 RF desktop slices', async ({ page }) => {
        const consoleMessages = [];
        page.on('console', (message) => {
            consoleMessages.push(message.text());
        });

        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(async () => {
            const app = window.DicomViewerApp;
            const nativeCalls = [];
            app.desktopDecode.decodeFrameWithPixels = async (path, frameIndex) => {
                nativeCalls.push({ path, frameIndex });
                return {
                    rows: 1,
                    cols: 2,
                    bitsAllocated: 16,
                    pixelRepresentation: 0,
                    samplesPerPixel: 1,
                    planarConfiguration: 0,
                    photometricInterpretation: 'MONOCHROME2',
                    windowCenter: 150,
                    windowWidth: 300,
                    rescaleSlope: 1,
                    rescaleIntercept: 0,
                    pixelDataLength: 4,
                    pixelData: new Uint16Array([100, 200])
                };
            };

            // This fixture is intentionally skeletal because native-first routing should
            // use the desktop path before the JS decoder ever touches Pixel Data tags.
            const dataSet = {
                elements: {},
                string(tag) {
                    const values = {
                        x00020010: '1.2.840.10008.1.2.4.90',
                        x00080060: 'RF',
                        x00280004: 'MONOCHROME2'
                    };
                    return values[tag] || '';
                },
                uint16() {
                    return 0;
                }
            };

            const decoded = await app.rendering.decodeWithFallback(dataSet, 0, {
                frameIndex: 0,
                source: {
                    kind: 'path',
                    path: '/risk/rf-j2k.dcm'
                }
            });

            return {
                route: app.rendering.getDecodeRoute('1.2.840.10008.1.2.4.90', 'RF'),
                nativeCalls,
                pixelValues: Array.from(decoded.pixelData),
                modality: decoded.modality,
                transferSyntax: decoded.transferSyntax
            };
        });

        expect(result.route).toBe('native-first');
        expect(result.nativeCalls).toEqual([
            {
                path: '/risk/rf-j2k.dcm',
                frameIndex: 0
            }
        ]);
        expect(result.pixelValues).toEqual([100, 200]);
        expect(result.modality).toBe('RF');
        expect(result.transferSyntax).toBe('1.2.840.10008.1.2.4.90');
        expect(consoleMessages.some((message) => message.includes('No pixel data element found'))).toBe(false);
    });

    test('encapsulated frame extraction falls back for single-frame files with an empty basic offset table', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);

        const result = await page.evaluate(() => {
            const parser = globalThis.dicomParser || window.dicomParser || dicomParser;
            const byteArray = Uint8Array.from([
                0xfe, 0xff, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x00,
                0xfe, 0xff, 0x00, 0xe0, 0x03, 0x00, 0x00, 0x00,
                0x07, 0x08, 0x09
            ]);

            const frame = window.DicomViewerApp.dicom.getEncapsulatedFrameData({
                byteArrayParser: parser.littleEndianByteArrayParser,
                byteArray,
                string() {
                    return '';
                }
            }, {
                tag: 'x7fe00010',
                dataOffset: 0,
                encapsulatedPixelData: true,
                hadUndefinedLength: true,
                basicOffsetTable: [],
                fragments: [{ offset: 0, position: 16, length: 3 }]
            }, 0);

            return {
                frame: Array.from(frame)
            };
        });

        expect(result.frame).toEqual([7, 8, 9]);
    });

    test('saved desktop library config is visible before startup scan completes', async ({ page }) => {
        await installMockDesktop(page, {
            initialConfig: {
                folder: '/slow-library',
                lastScan: '2026-03-07T12:00:00.000Z'
            },
            dirs: {
                '/slow-library': []
            },
            readDirDelayMs: 500
        });

        await page.goto(AUTOLOAD_URL);
        await expect(page.locator('#libraryFolderConfig')).toBeVisible();
        await expect(page.locator('#libraryFolderInput')).toHaveValue('/slow-library');
        await expect(page.locator('#libraryFolderMessage')).toContainText('Loading saved library folder...');
    });

    test('desktop auto-load does not mark empty folders as a successful scan', async ({ page }) => {
        await installMockDesktop(page, {
            dirs: {
                '/empty': []
            }
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();
        const config = await page.evaluate(async () => {
            const app = window.DicomViewerApp;
            app.desktopLibrary.saveConfig({
                folder: '/empty',
                lastScan: '2026-03-07T12:00:00.000Z'
            });
            await app.library.loadLibraryConfig();
            const files = await app.desktopLibrary.scanFolder('/empty');
            const studies = await app.sources.processFilesFromSources(files);
            app.library.applyDesktopLibraryScan('/empty', studies);
            await app.library.displayStudies();
            return JSON.parse(localStorage.getItem('dicom-viewer-library-config') || '{}');
        });

        await expect(page.locator('#emptyState')).toContainText('No DICOM files found in /empty.');
        expect(config.folder).toBe('/empty');
        expect(config.lastScan).toBeNull();
    });

    test('collectPathSources caps recursion depth and skips symlink paths', async ({ page }) => {
        const dirs = {
            '/root': [
                { name: 'root-file.dcm', isDirectory: false, isFile: true, isSymlink: false },
                { name: 'level01', isDirectory: true, isFile: false, isSymlink: false },
                { name: 'loop', isDirectory: false, isFile: false, isSymlink: true }
            ]
        };

        let currentPath = '/root';
        for (let level = 1; level <= 25; level++) {
            const name = `level${String(level).padStart(2, '0')}`;
            const nextLevel = `level${String(level + 1).padStart(2, '0')}`;
            const nextPath = joinPaths(currentPath, name);
            dirs[nextPath] = [
                { name: `file-${String(level).padStart(2, '0')}.dcm`, isDirectory: false, isFile: true, isSymlink: false }
            ];
            if (level < 25) {
                dirs[nextPath].push({ name: nextLevel, isDirectory: true, isFile: false, isSymlink: false });
            }
            currentPath = nextPath;
        }

        await installMockDesktop(page, { dirs });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const files = await page.evaluate(async () => {
            const results = await window.DicomViewerApp.sources.collectPathSources('/root');
            return results.map((entry) => entry.source.path);
        });

        expect(files).toContain('/root/root-file.dcm');
        expect(files.some((path) => path.includes('/loop'))).toBe(false);
        expect(files.some((path) => path.includes('file-20.dcm'))).toBe(true);
        expect(files.some((path) => path.includes('file-21.dcm'))).toBe(false);
    });
});
