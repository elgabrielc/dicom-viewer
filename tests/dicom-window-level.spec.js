// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');

const TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5001';
const HOME_URL = `${TEST_BASE_URL}/?nolib`;

function placeholderDxValues(index) {
    return 1000 + ((index * 37) % 2000);
}

const DX_PIXEL_VALUES = Array.from({ length: 100 }, (_, index) => placeholderDxValues(index));

test('isPlaceholderWindowLevel detects full-range no-op windows', async ({ page }) => {
    await page.goto(HOME_URL);

    const results = await page.evaluate(() => {
        const { isPlaceholderWindowLevel } = window.DicomViewerApp.dicom;
        const cases = [
            {
                name: '16-bit unsigned BUG-012 placeholder',
                args: [32767, 65536, 16, 0, 1, 0],
                expected: true,
            },
            {
                name: '12-bit signed placeholder',
                args: [0, 4096, 12, 1, 1, 0],
                expected: true,
            },
            {
                name: '8-bit unsigned placeholder',
                args: [128, 256, 8, 0, 1, 0],
                expected: true,
            },
            {
                name: '12-bit unsigned full-range window',
                args: [2048, 4096, 12, 0, 1, 0],
                expected: true,
            },
            {
                name: 'CT soft-tissue window with rescale intercept',
                args: [40, 400, 12, 0, 1, -1024],
                expected: false,
            },
            {
                name: 'narrow raw window',
                args: [40, 400, 12, 0, 1, 0],
                expected: false,
            },
            {
                name: 'missing bits stored',
                args: [32767, 65536, undefined, 0, 1, 0],
                expected: false,
            },
            {
                name: 'invalid center',
                args: [Number.NaN, 65536, 16, 0, 1, 0],
                expected: false,
            },
            {
                name: 'invalid width',
                args: [32767, Number.NaN, 16, 0, 1, 0],
                expected: false,
            },
        ];

        return cases.map((testCase) => ({
            name: testCase.name,
            actual: isPlaceholderWindowLevel(...testCase.args),
            expected: testCase.expected,
        }));
    });

    for (const result of results) {
        expect(result.actual, result.name).toBe(result.expected);
    }
});

test('decodeDicom auto-windows DX images with stored full-range placeholder W/L', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate((pixelValues) => {
        const pixels = Uint16Array.from(pixelValues);

        const dataSet = {
            byteArray: new Uint8Array(pixels.buffer),
            elements: {
                x7fe00010: {
                    dataOffset: 0,
                    length: pixels.byteLength,
                },
            },
            string(tag) {
                const values = {
                    x00020010: '1.2.840.10008.1.2.1',
                    x00080060: 'DX',
                    x00280004: 'MONOCHROME2',
                    x00281050: '32767',
                    x00281051: '65536',
                    x00281052: '0',
                    x00281053: '1',
                };
                return values[tag] || '';
            },
            uint16(tag) {
                const values = {
                    x00280010: 10,
                    x00280011: 10,
                    x00280100: 16,
                    x00280101: 16,
                    x00280103: 0,
                    x00280002: 1,
                    x00280008: 1,
                };
                return values[tag];
            },
        };

        return window.DicomViewerApp.rendering.decodeDicom(dataSet, 0).then((decoded) => {
            const expected = window.DicomViewerApp.dicom.calculateAutoWindowLevel(pixels, 1, 0);
            return {
                windowCenter: decoded.windowCenter,
                windowWidth: decoded.windowWidth,
                expectedCenter: expected.windowCenter,
                expectedWidth: expected.windowWidth,
                isBlank: decoded.isBlank,
            };
        });
    }, DX_PIXEL_VALUES);

    expect(result.isBlank).toBe(false);
    expect(result.windowCenter).toBe(result.expectedCenter);
    expect(result.windowWidth).toBe(result.expectedWidth);
    expect(result.windowCenter).not.toBe(32767);
    expect(result.windowWidth).not.toBe(65536);
    expect(result.windowWidth).toBeLessThan(10000);
});

test('decodeNative auto-windows DX images when native W/L only echoes the stored placeholder', async ({ page }) => {
    await page.goto(HOME_URL);

    const result = await page.evaluate((pixelValues) => {
        const app = window.DicomViewerApp;
        const pixels = Uint16Array.from(pixelValues);

        app.desktopDecode.decodeFrameWithPixels = async () => ({
            pixelData: pixels.slice(),
            rows: 10,
            cols: 10,
            bitsAllocated: 16,
            bitsStored: 16,
            pixelRepresentation: 0,
            samplesPerPixel: 1,
            planarConfiguration: 0,
            photometricInterpretation: 'MONOCHROME2',
            windowCenter: 32767,
            windowWidth: 65536,
            rescaleSlope: 1,
            rescaleIntercept: 0,
        });

        const dataSet = {
            string(tag) {
                const values = {
                    x00020010: '1.2.840.10008.1.2.1',
                    x00080060: 'DX',
                    x00280004: 'MONOCHROME2',
                    x00281050: '32767',
                    x00281051: '65536',
                    x00281052: '0',
                    x00281053: '1',
                };
                return values[tag] || '';
            },
            uint16(tag) {
                const values = {
                    x00280101: 16,
                };
                return values[tag];
            },
        };

        return app.rendering.decodeNative(dataSet, '/mock/full-range-dx.dcm', 0).then((decoded) => {
            const expected = app.dicom.calculateAutoWindowLevel(pixels, 1, 0);
            return {
                windowCenter: decoded.windowCenter,
                windowWidth: decoded.windowWidth,
                expectedCenter: expected.windowCenter,
                expectedWidth: expected.windowWidth,
                isBlank: decoded.isBlank,
            };
        });
    }, DX_PIXEL_VALUES);

    expect(result.isBlank).toBe(false);
    expect(result.windowCenter).toBe(result.expectedCenter);
    expect(result.windowWidth).toBe(result.expectedWidth);
    expect(result.windowCenter).not.toBe(32767);
    expect(result.windowWidth).not.toBe(65536);
    expect(result.windowWidth).toBeLessThan(10000);
});
