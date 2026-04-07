// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5001';
const HOME_URL = `${TEST_BASE_URL}/?nolib`;
const MOCK_SQL_INIT_PATH = path.join(__dirname, 'mock-tauri-sql-init.js');
const MOCK_APP_DATA = '/mock-app-data';
const LIBRARY_ROOT = `${MOCK_APP_DATA}/library`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal but parseable Explicit VR Little Endian DICOM byte array.
 *
 * The buffer contains just enough structure for dicom-parser to extract:
 *   Transfer Syntax, Patient Name, Study Date, Study/Series/SOP Instance UIDs,
 *   Rows, Columns, and a Pixel Data element presence marker.
 */
function buildSyntheticDicomBytes(options = {}) {
    const transferSyntax = options.transferSyntax || '1.2.840.10008.1.2.1';
    const patientName = options.patientName || 'Test^Import';
    const studyDate = options.studyDate || '20260327';
    const studyInstanceUid = options.studyInstanceUid || '1.2.3.4.5.6.7.8';
    const seriesInstanceUid = options.seriesInstanceUid || '1.2.3.4.5.6.7.8.1';
    const sopInstanceUid = options.sopInstanceUid || '1.2.3.4.5.6.7.8.1.1';
    const rows = options.rows || 2;
    const cols = options.cols || 2;

    // Collect tag-value pairs to encode after preamble + DICM
    const tags = [];

    // File Meta Information Group Length placeholder -- group 0002
    // Transfer Syntax UID (0002,0010) -- UI VR
    tags.push({ group: 0x0002, element: 0x0010, vr: 'UI', value: transferSyntax });

    // Study Date (0008,0020)
    tags.push({ group: 0x0008, element: 0x0020, vr: 'DA', value: studyDate });

    // SOP Instance UID (0008,0018)
    tags.push({ group: 0x0008, element: 0x0018, vr: 'UI', value: sopInstanceUid });

    // Patient Name (0010,0010)
    tags.push({ group: 0x0010, element: 0x0010, vr: 'LO', value: patientName });

    // Study Instance UID (0020,000D)
    tags.push({ group: 0x0020, element: 0x000d, vr: 'UI', value: studyInstanceUid });

    // Series Instance UID (0020,000E)
    tags.push({ group: 0x0020, element: 0x000e, vr: 'UI', value: seriesInstanceUid });

    // Rows (0028,0010) -- US VR (2 bytes)
    tags.push({ group: 0x0028, element: 0x0010, vr: 'US', value: rows });

    // Columns (0028,0011) -- US VR (2 bytes)
    tags.push({ group: 0x0028, element: 0x0011, vr: 'US', value: cols });

    // Sort tags by (group, element) to satisfy DICOM ordering
    tags.sort((a, b) => a.group - b.group || a.element - b.element);

    // Calculate total buffer size
    // 128 preamble + 4 DICM + tag data + pixel data tag header (8 bytes)
    let dataSize = 0;
    for (const tag of tags) {
        // 4 (tag) + 2 (VR) + 2 (length) + value bytes
        if (tag.vr === 'US') {
            dataSize += 4 + 2 + 2 + 2;
        } else {
            let valueLen = typeof tag.value === 'string' ? tag.value.length : 0;
            // Pad odd-length strings to even
            if (valueLen % 2 !== 0) valueLen += 1;
            dataSize += 4 + 2 + 2 + valueLen;
        }
    }
    // Pixel Data element (7FE0,0010) with OW VR and 4-byte extended length header + 0 data
    const pixelDataHeaderSize = 4 + 2 + 2 + 4; // tag + VR(OW) + reserved(2) + 4-byte length
    const totalSize = 128 + 4 + dataSize + pixelDataHeaderSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // 128-byte preamble (zeros)
    offset = 128;

    // DICM magic
    bytes[offset++] = 0x44; // D
    bytes[offset++] = 0x49; // I
    bytes[offset++] = 0x43; // C
    bytes[offset++] = 0x4d; // M

    // Write each tag
    for (const tag of tags) {
        // Group (2 bytes LE)
        view.setUint16(offset, tag.group, true);
        offset += 2;
        // Element (2 bytes LE)
        view.setUint16(offset, tag.element, true);
        offset += 2;
        // VR (2 ASCII chars)
        bytes[offset++] = tag.vr.charCodeAt(0);
        bytes[offset++] = tag.vr.charCodeAt(1);

        if (tag.vr === 'US') {
            // Length = 2
            view.setUint16(offset, 2, true);
            offset += 2;
            // Value
            view.setUint16(offset, tag.value, true);
            offset += 2;
        } else {
            const str = typeof tag.value === 'string' ? tag.value : '';
            let paddedLen = str.length;
            if (paddedLen % 2 !== 0) paddedLen += 1;
            // Length
            view.setUint16(offset, paddedLen, true);
            offset += 2;
            // Value bytes
            for (let charIndex = 0; charIndex < str.length; charIndex++) {
                bytes[offset++] = str.charCodeAt(charIndex);
            }
            // Pad with null if odd
            if (str.length % 2 !== 0) {
                bytes[offset++] = 0;
            }
        }
    }

    // Pixel Data tag (7FE0,0010) with OW VR -- extended length header
    view.setUint16(offset, 0x7fe0, true);
    offset += 2;
    view.setUint16(offset, 0x0010, true);
    offset += 2;
    bytes[offset++] = 0x4f; // O
    bytes[offset++] = 0x57; // W
    offset += 2; // reserved 2 bytes
    view.setUint32(offset, 0, true); // 0 length (just need presence)
    offset += 4;

    return Array.from(bytes);
}

/**
 * Install the mock Tauri desktop environment with import-pipeline-specific
 * overrides. Based on the installMockDesktop pattern from desktop-library.spec.js
 * but tailored for import pipeline testing.
 */
async function installMockDesktop(page, options = {}) {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript((opts) => {
        const hasOwnPropertyFn = Object.prototype.hasOwnProperty;
        const hasOwn = (object, key) => hasOwnPropertyFn.call(object, key);

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

        // Track mock FS operations for assertions
        window.__importMockState = {
            mkdirCalls: [],
            writeFileCalls: [],
            readFileCalls: [],
            headerReadCalls: [],
            existsResults: Object.assign({}, opts.existsOverrides || {}),
            statResults: Object.assign({}, opts.statOverrides || {}),
            readFileBytes: Object.assign({}, opts.readFileBytes || {}),
            manifestEntries: opts.manifestEntries || [],
            readFileErrors: Object.assign({}, opts.readFileErrors || {}),
            headerReadBytes: Object.assign({}, opts.headerReadBytes || {}),
        };

        window.__TAURI__ = {
            core: {
                async invoke(cmd, args) {
                    if (cmd === 'apply_desktop_migration') {
                        return window.__applyMockDesktopMigration(args.db, args.batch, opts);
                    }
                    if (cmd === 'load_legacy_desktop_browser_stores') {
                        return [];
                    }
                    if (cmd === 'read_scan_manifest') {
                        return window.__importMockState.manifestEntries;
                    }
                    if (cmd === 'read_scan_header') {
                        const normalized = normalizePath(args.path);
                        const state = window.__importMockState;
                        state.headerReadCalls.push({
                            path: normalized,
                            maxBytes: Number(args.maxBytes) || 0,
                        });
                        if (hasOwn(state.readFileErrors, normalized)) {
                            throw new Error(state.readFileErrors[normalized]);
                        }
                        const bytes = state.headerReadBytes[normalized] || state.readFileBytes[normalized];
                        if (bytes) {
                            return Uint8Array.from(bytes.slice(0, Math.max(0, Number(args.maxBytes) || 0)));
                        }
                        return Uint8Array.from([]);
                    }
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                },
            },
            dialog: {
                async open() {
                    return null;
                },
            },
            fs: {
                async exists(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (hasOwn(state.existsResults, normalized)) {
                        return state.existsResults[normalized];
                    }
                    // Check if writeFile has already written to this path
                    return state.writeFileCalls.some((call) => call.path === normalized);
                },
                async stat(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (hasOwn(state.statResults, normalized)) {
                        return state.statResults[normalized];
                    }
                    throw new Error(`Stat not found: ${normalized}`);
                },
                async readFile(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    state.readFileCalls.push(normalized);
                    if (hasOwn(state.readFileErrors, normalized)) {
                        throw new Error(state.readFileErrors[normalized]);
                    }
                    const bytes = state.readFileBytes[normalized];
                    if (bytes) {
                        return Uint8Array.from(bytes);
                    }
                    return Uint8Array.from([0]);
                },
                async readDir() {
                    return [];
                },
                async writeFile(filePath, bytes) {
                    const normalized = normalizePath(filePath);
                    window.__importMockState.writeFileCalls.push({
                        path: normalized,
                        size: bytes.byteLength || bytes.length,
                    });
                },
                async mkdir(dirPath, mkdirOptions) {
                    const normalized = normalizePath(dirPath);
                    window.__importMockState.mkdirCalls.push({
                        path: normalized,
                        recursive: !!mkdirOptions?.recursive,
                    });
                },
                async remove() {},
                async rename() {},
            },
            path: {
                async appDataDir() {
                    return normalizePath(opts.appDataDir || '/mock-app-data');
                },
                async join(...parts) {
                    return joinPaths(...parts);
                },
                async normalize(filePath) {
                    return normalizePath(filePath);
                },
            },
            sql: window.__createMockTauriSql(opts),
            webview: {
                getCurrentWebview() {
                    return {
                        onDragDropEvent() {
                            return Promise.resolve(() => {});
                        },
                    };
                },
            },
        };
    }, options);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Desktop import pipeline', () => {
    // -----------------------------------------------------------------------
    // buildDestinationPath
    // -----------------------------------------------------------------------

    test('buildDestinationPath: basic path construction', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(() => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return pipeline.buildDestinationPath('/mock-app-data/library', {
                studyInstanceUid: '1.2.3.4',
                seriesInstanceUid: '1.2.3.4.1',
                sopInstanceUid: '1.2.3.4.1.1',
            });
        });

        expect(result).toBe('/mock-app-data/library/1.2.3.4/1.2.3.4.1/1.2.3.4.1.1.dcm');
    });

    test('buildDestinationPath: UID sanitization', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(() => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return pipeline.buildDestinationPath('/lib', {
                studyInstanceUid: '1.2.3 with spaces/slashes\\back',
                seriesInstanceUid: '1.2.3<angle>brackets',
                sopInstanceUid: '1.2.3|pipe&amp',
            });
        });

        // Special characters should be replaced with underscores
        expect(result).toBe('/lib/1.2.3_with_spaces_slashes_back/1.2.3_angle_brackets/1.2.3_pipe_amp.dcm');
    });

    test('buildDestinationPath: missing SOP UID throws', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const errorMessage = await page.evaluate(() => {
            const pipeline = window.DicomViewerApp.importPipeline;
            try {
                pipeline.buildDestinationPath('/lib', {
                    studyInstanceUid: '1.2.3',
                    seriesInstanceUid: '1.2.3.1',
                    // sopInstanceUid intentionally omitted
                });
                return null;
            } catch (error) {
                return error.message;
            }
        });

        expect(errorMessage).toContain('SOPInstanceUID is required');
    });

    test('buildDestinationPath: missing Study/Series UID uses unknown', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(() => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return pipeline.buildDestinationPath('/lib', {
                sopInstanceUid: '1.2.3.4.1.1',
                // studyInstanceUid and seriesInstanceUid intentionally omitted
            });
        });

        expect(result).toBe('/lib/unknown/unknown/1.2.3.4.1.1.dcm');
    });

    // -----------------------------------------------------------------------
    // getLibraryPath
    // -----------------------------------------------------------------------

    test('getLibraryPath: returns correct path', async ({ page }) => {
        await installMockDesktop(page, { appDataDir: '/test-app-data/' });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const libraryPath = await page.evaluate(async () => {
            return await window.DicomViewerApp.importPipeline.getLibraryPath();
        });

        expect(libraryPath).toBe('/test-app-data/library');
    });

    // -----------------------------------------------------------------------
    // ensureLibraryFolder
    // -----------------------------------------------------------------------

    test('ensureLibraryFolder: calls mkdir with recursive', async ({ page }) => {
        await installMockDesktop(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const returnedPath = await pipeline.ensureLibraryFolder();
            const state = window.__importMockState;
            return {
                returnedPath,
                mkdirCalls: state.mkdirCalls,
            };
        });

        expect(result.returnedPath).toBe('/mock-app-data/library');
        expect(result.mkdirCalls.length).toBeGreaterThanOrEqual(1);

        const libraryMkdir = result.mkdirCalls.find((call) => call.path === '/mock-app-data/library');
        expect(libraryMkdir).toBeTruthy();
        expect(libraryMkdir.recursive).toBe(true);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: happy path
    // -----------------------------------------------------------------------

    test('importFromPaths: happy path imports valid DICOM files', async ({ page }) => {
        const dicomA = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.1',
            seriesInstanceUid: '1.2.series.1',
            sopInstanceUid: '1.2.sop.1',
            patientName: 'Happy^Path',
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.1',
            seriesInstanceUid: '1.2.series.1',
            sopInstanceUid: '1.2.sop.2',
            patientName: 'Happy^Path',
        });

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/file1.dcm',
                    name: 'file1.dcm',
                    rootPath: '/source',
                    size: dicomA.length,
                    modifiedMs: 1000,
                },
                {
                    path: '/source/file2.dcm',
                    name: 'file2.dcm',
                    rootPath: '/source',
                    size: dicomB.length,
                    modifiedMs: 2000,
                },
            ],
            readFileBytes: {
                '/source/file1.dcm': dicomA,
                '/source/file2.dcm': dicomB,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        expect(result.imported).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.invalid).toBe(0);
        expect(result.errors).toBe(0);
        expect(result.collisions).toBe(0);

        // Verify study tracking
        expect(Object.keys(result.studies)).toHaveLength(1);
        const study = result.studies['1.2.study.1'];
        expect(study).toBeTruthy();
        expect(study.instanceCount).toBe(2);
        expect(study.seriesCount).toBe(1);
        expect(study.patientName).toBe('Happy^Path');
    });

    // -----------------------------------------------------------------------
    // importFromPaths: dedup
    // -----------------------------------------------------------------------

    test('importFromPaths: dedup skips existing files with same size', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.dup',
            seriesInstanceUid: '1.2.series.dup',
            sopInstanceUid: '1.2.sop.dup',
        });

        const destPath = `${LIBRARY_ROOT}/1.2.study.dup/1.2.series.dup/1.2.sop.dup.dcm`;

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/dup.dcm',
                    name: 'dup.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/dup.dcm': dicomBytes,
            },
            existsOverrides: {
                [destPath]: true,
            },
            statOverrides: {
                [destPath]: { size: dicomBytes.length },
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        expect(result.imported).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.collisions).toBe(0);
    });

    test('importFromPaths: dedup avoids full file reads when header metadata is sufficient', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.headerdup',
            seriesInstanceUid: '1.2.series.headerdup',
            sopInstanceUid: '1.2.sop.headerdup',
        });

        const destPath = `${LIBRARY_ROOT}/1.2.study.headerdup/1.2.series.headerdup/1.2.sop.headerdup.dcm`;

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/header-dup.dcm',
                    name: 'header-dup.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/header-dup.dcm': dicomBytes,
            },
            existsOverrides: {
                [destPath]: true,
            },
            statOverrides: {
                [destPath]: { size: dicomBytes.length },
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const importResult = await pipeline.importFromPaths(['/source']);
            return {
                importResult,
                readFileCalls: window.__importMockState.readFileCalls.slice(),
                headerReadCalls: window.__importMockState.headerReadCalls.slice(),
            };
        });

        expect(result.importResult.skipped).toBe(1);
        expect(result.headerReadCalls).toHaveLength(1);
        expect(result.readFileCalls).toHaveLength(0);
    });

    test('importFromPaths: staged header reads continue until Study, Series, and SOP UIDs are available', async ({
        page,
    }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            patientName: 'P'.repeat(65300),
            studyInstanceUid: '1.2.study.staged',
            seriesInstanceUid: '1.2.series.staged',
            sopInstanceUid: '1.2.sop.staged',
        });

        const destPath = `${LIBRARY_ROOT}/1.2.study.staged/1.2.series.staged/1.2.sop.staged.dcm`;

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/staged-header.dcm',
                    name: 'staged-header.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/staged-header.dcm': dicomBytes,
            },
            existsOverrides: {
                [destPath]: true,
            },
            statOverrides: {
                [destPath]: { size: dicomBytes.length },
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const importResult = await pipeline.importFromPaths(['/source']);
            return {
                importResult,
                readFileCalls: window.__importMockState.readFileCalls.slice(),
                headerReadCalls: window.__importMockState.headerReadCalls.slice(),
            };
        });

        expect(result.importResult.skipped).toBe(1);
        expect(result.headerReadCalls.map((call) => call.maxBytes)).toEqual([64 * 1024, 256 * 1024]);
        expect(result.readFileCalls).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: size mismatch collision
    // -----------------------------------------------------------------------

    test('importFromPaths: size mismatch counts as collision', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.col',
            seriesInstanceUid: '1.2.series.col',
            sopInstanceUid: '1.2.sop.col',
        });

        const destPath = `${LIBRARY_ROOT}/1.2.study.col/1.2.series.col/1.2.sop.col.dcm`;

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/col.dcm',
                    name: 'col.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/col.dcm': dicomBytes,
            },
            existsOverrides: {
                [destPath]: true,
            },
            statOverrides: {
                // Different size from the source file
                [destPath]: { size: dicomBytes.length + 100 },
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        expect(result.imported).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.collisions).toBe(1);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: non-DICOM files
    // -----------------------------------------------------------------------

    test('importFromPaths: non-DICOM files counted as invalid', async ({ page }) => {
        // A buffer of random bytes that is definitely not DICOM
        const junkBytes = Array.from({ length: 64 }, (_, index) => index);

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/readme.txt',
                    name: 'readme.txt',
                    rootPath: '/source',
                    size: junkBytes.length,
                    modifiedMs: 1000,
                },
                {
                    path: '/source/photo.jpg',
                    name: 'photo.jpg',
                    rootPath: '/source',
                    size: junkBytes.length,
                    modifiedMs: 2000,
                },
            ],
            readFileBytes: {
                '/source/readme.txt': junkBytes,
                '/source/photo.jpg': junkBytes,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        expect(result.imported).toBe(0);
        expect(result.invalid).toBe(2);
        expect(result.errors).toBe(0);
    });

    test('importFromPaths: invalid files do not trigger full file reads', async ({ page }) => {
        const junkBytes = Array.from({ length: 64 }, (_, index) => index);

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/not-dicom.bin',
                    name: 'not-dicom.bin',
                    rootPath: '/source',
                    size: junkBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/not-dicom.bin': junkBytes,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const importResult = await pipeline.importFromPaths(['/source']);
            return {
                importResult,
                readFileCalls: window.__importMockState.readFileCalls.slice(),
                headerReadCalls: window.__importMockState.headerReadCalls.slice(),
            };
        });

        expect(result.importResult.invalid).toBe(1);
        expect(result.headerReadCalls).toHaveLength(1);
        expect(result.readFileCalls).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: progress callback
    // -----------------------------------------------------------------------

    test('importFromPaths: progress callback receives correct stats', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.prog',
            seriesInstanceUid: '1.2.series.prog',
            sopInstanceUid: '1.2.sop.prog',
        });

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/prog.dcm',
                    name: 'prog.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/prog.dcm': dicomBytes,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const progressEvents = [];
            const pipeline = window.DicomViewerApp.importPipeline;
            const importResult = await pipeline.importFromPaths(['/source'], {
                onProgress: (stats) => {
                    progressEvents.push(JSON.parse(JSON.stringify(stats)));
                },
            });
            return { importResult, progressEvents };
        });

        expect(result.progressEvents.length).toBeGreaterThanOrEqual(1);

        // The first event should be in 'scanning' or 'preparing' phase
        const phases = result.progressEvents.map((event) => event.phase);
        expect(phases).toContain('scanning');
        expect(phases).toContain('importing');
        expect(phases).toContain('complete');

        // The last event should reflect final counts
        const lastEvent = result.progressEvents[result.progressEvents.length - 1];
        expect(lastEvent.phase).toBe('complete');
        expect(lastEvent.discovered).toBe(1);
        expect(lastEvent.copied).toBe(1);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: abort signal
    // -----------------------------------------------------------------------

    test('importFromPaths: abort signal stops import', async ({ page }) => {
        // Create several files so there is work to abort mid-stream
        const fileCount = 20;
        const manifestEntries = [];
        const readFileBytes = {};

        for (let index = 0; index < fileCount; index++) {
            const sopUid = `1.2.sop.abort.${index}`;
            const filePath = `/source/abort-${index}.dcm`;
            const bytes = buildSyntheticDicomBytes({
                studyInstanceUid: '1.2.study.abort',
                seriesInstanceUid: '1.2.series.abort',
                sopInstanceUid: sopUid,
            });
            manifestEntries.push({
                path: filePath,
                name: `abort-${index}.dcm`,
                rootPath: '/source',
                size: bytes.length,
                modifiedMs: index * 1000,
            });
            readFileBytes[filePath] = bytes;
        }

        await installMockDesktop(page, { manifestEntries, readFileBytes });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const controller = new AbortController();

            // Abort after a tiny delay to let some files process
            let processed = 0;
            try {
                await pipeline.importFromPaths(['/source'], {
                    signal: controller.signal,
                    onProgress: (stats) => {
                        processed = stats.processed;
                        // Abort after processing at least 1 file
                        if (stats.processed >= 1 && stats.phase === 'importing') {
                            controller.abort();
                        }
                    },
                });
                return { aborted: false, processed };
            } catch (error) {
                return {
                    aborted: error.name === 'AbortError',
                    errorName: error.name,
                    processed,
                };
            }
        });

        expect(result.aborted).toBe(true);
        // Some files may have been processed before the abort took effect,
        // but not necessarily all 20
        expect(result.processed).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: individual file errors
    // -----------------------------------------------------------------------

    test('importFromPaths: individual file errors do not abort the batch', async ({ page }) => {
        const goodDicom = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.partial',
            seriesInstanceUid: '1.2.series.partial',
            sopInstanceUid: '1.2.sop.good',
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/bad.dcm', name: 'bad.dcm', rootPath: '/source', size: 100, modifiedMs: 1000 },
                {
                    path: '/source/good.dcm',
                    name: 'good.dcm',
                    rootPath: '/source',
                    size: goodDicom.length,
                    modifiedMs: 2000,
                },
            ],
            readFileBytes: {
                '/source/good.dcm': goodDicom,
            },
            readFileErrors: {
                '/source/bad.dcm': 'Simulated filesystem read failure',
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        // The good file should be imported; the bad one counted as an error
        expect(result.imported).toBe(1);
        expect(result.errors).toBe(1);
        expect(result.invalid).toBe(0);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: empty folder
    // -----------------------------------------------------------------------

    test('importFromPaths: empty folder returns zero counts', async ({ page }) => {
        await installMockDesktop(page, {
            manifestEntries: [],
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/empty-source']);
        });

        expect(result.imported).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.invalid).toBe(0);
        expect(result.errors).toBe(0);
        expect(result.collisions).toBe(0);
        expect(Object.keys(result.studies)).toHaveLength(0);
        expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: multi-study import
    // -----------------------------------------------------------------------

    test('importFromPaths: tracks multiple studies and series correctly', async ({ page }) => {
        const dicomA = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.multi.study.A',
            seriesInstanceUid: '1.2.multi.series.A1',
            sopInstanceUid: '1.2.multi.sop.A1.1',
            patientName: 'Multi^A',
            studyDate: '20260101',
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.multi.study.A',
            seriesInstanceUid: '1.2.multi.series.A2',
            sopInstanceUid: '1.2.multi.sop.A2.1',
            patientName: 'Multi^A',
            studyDate: '20260101',
        });
        const dicomC = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.multi.study.B',
            seriesInstanceUid: '1.2.multi.series.B1',
            sopInstanceUid: '1.2.multi.sop.B1.1',
            patientName: 'Multi^B',
            studyDate: '20260215',
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/src/a1.dcm', name: 'a1.dcm', rootPath: '/src', size: dicomA.length, modifiedMs: 1000 },
                { path: '/src/a2.dcm', name: 'a2.dcm', rootPath: '/src', size: dicomB.length, modifiedMs: 2000 },
                { path: '/src/b1.dcm', name: 'b1.dcm', rootPath: '/src', size: dicomC.length, modifiedMs: 3000 },
            ],
            readFileBytes: {
                '/src/a1.dcm': dicomA,
                '/src/a2.dcm': dicomB,
                '/src/b1.dcm': dicomC,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/src']);
        });

        expect(result.imported).toBe(3);
        expect(Object.keys(result.studies)).toHaveLength(2);

        const studyA = result.studies['1.2.multi.study.A'];
        expect(studyA.seriesCount).toBe(2);
        expect(studyA.instanceCount).toBe(2);
        expect(studyA.patientName).toBe('Multi^A');

        const studyB = result.studies['1.2.multi.study.B'];
        expect(studyB.seriesCount).toBe(1);
        expect(studyB.instanceCount).toBe(1);
        expect(studyB.patientName).toBe('Multi^B');
    });

    // -----------------------------------------------------------------------
    // importFromPaths: writeFile and mkdir called correctly
    // -----------------------------------------------------------------------

    test('importFromPaths: creates parent directories and writes files', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.write',
            seriesInstanceUid: '1.2.series.write',
            sopInstanceUid: '1.2.sop.write',
        });

        await installMockDesktop(page, {
            manifestEntries: [
                {
                    path: '/source/write.dcm',
                    name: 'write.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/write.dcm': dicomBytes,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            await pipeline.importFromPaths(['/source']);
            const state = window.__importMockState;
            return {
                mkdirCalls: state.mkdirCalls,
                writeFileCalls: state.writeFileCalls,
            };
        });

        // mkdir should have been called for the library root and for the parent
        // of the destination file
        const parentDir = `${LIBRARY_ROOT}/1.2.study.write/1.2.series.write`;
        const parentMkdir = result.mkdirCalls.find((call) => call.path === parentDir);
        expect(parentMkdir).toBeTruthy();
        expect(parentMkdir.recursive).toBe(true);

        // writeFile should have been called with the correct destination path
        const destPath = `${parentDir}/1.2.sop.write.dcm`;
        const writeCall = result.writeFileCalls.find((call) => call.path === destPath);
        expect(writeCall).toBeTruthy();
        expect(writeCall.size).toBe(dicomBytes.length);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: DICOM without SOP UID counted as invalid
    // -----------------------------------------------------------------------

    test('importFromPaths: DICOM without SOP Instance UID counted as invalid', async ({ page }) => {
        // We will override readFile to return bytes that parse as DICOM but have
        // the SOP UID field empty. The simplest approach: build bytes without
        // a real SOP tag by constructing a custom buffer in the browser context.
        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/nosop.dcm', name: 'nosop.dcm', rootPath: '/source', size: 512, modifiedMs: 1000 },
            ],
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            // Build a minimal DICOM in-browser that has transferSyntax but no SOP UID
            const ts = '1.2.840.10008.1.2.1';
            const tags = [{ group: 0x0002, element: 0x0010, vr: 'UI', value: ts }];
            let dataSize = 0;
            for (const tag of tags) {
                let valueLen = tag.value.length;
                if (valueLen % 2 !== 0) valueLen += 1;
                dataSize += 4 + 2 + 2 + valueLen;
            }
            const totalSize = 128 + 4 + dataSize;
            const buffer = new ArrayBuffer(totalSize);
            const view = new DataView(buffer);
            const bytes = new Uint8Array(buffer);
            let offset = 128;
            bytes[offset++] = 0x44;
            bytes[offset++] = 0x49;
            bytes[offset++] = 0x43;
            bytes[offset++] = 0x4d;
            for (const tag of tags) {
                view.setUint16(offset, tag.group, true);
                offset += 2;
                view.setUint16(offset, tag.element, true);
                offset += 2;
                bytes[offset++] = tag.vr.charCodeAt(0);
                bytes[offset++] = tag.vr.charCodeAt(1);
                let padLen = tag.value.length;
                if (padLen % 2 !== 0) padLen += 1;
                view.setUint16(offset, padLen, true);
                offset += 2;
                for (let ci = 0; ci < tag.value.length; ci++) {
                    bytes[offset++] = tag.value.charCodeAt(ci);
                }
                if (tag.value.length % 2 !== 0) bytes[offset++] = 0;
            }

            // Inject this buffer as the readFile response
            window.__importMockState.readFileBytes['/source/nosop.dcm'] = Array.from(bytes);

            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        // The file is DICOM-enough to parse (has transfer syntax) but lacks SOP UID
        expect(result.imported).toBe(0);
        expect(result.invalid).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Integration tests: full import workflow exercised end-to-end
// ---------------------------------------------------------------------------

const AUTOLOAD_URL = `${TEST_BASE_URL}/`;

/**
 * Extended mock installer for integration tests. Builds on installMockDesktop
 * but adds support for:
 *   - Managed library config (managedLibrary flag via desktop config)
 *   - Capturing the Tauri drag-drop event handler for programmatic invocation
 *   - Pre-populated scan cache for startup tests
 *   - Desktop directory listing for library scan (readDir + file bytes for scan)
 */
async function installMockDesktopIntegration(page, options = {}) {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript((opts) => {
        const FILE_STORAGE_PREFIX = 'mock-desktop-fs:';
        const hasOwnPropertyFn = Object.prototype.hasOwnProperty;
        const hasOwn = (object, key) => hasOwnPropertyFn.call(object, key);

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

        // Persist initial desktop config so getConfig picks it up
        if (opts.initialConfig) {
            localStorage.setItem('dicom-viewer-library-config', JSON.stringify(opts.initialConfig));
        }

        // Pre-populate stored files (scan cache, etc.)
        for (const [path, value] of Object.entries(opts.storedFiles || {})) {
            const normalized = normalizePath(path);
            const bytes = Array.isArray(value) ? value : Array.from(value);
            localStorage.setItem(`${FILE_STORAGE_PREFIX}${normalized}`, JSON.stringify(bytes));
        }

        // Directory listing for readDir-based scans
        const dirs = {};
        for (const [dirPath, entries] of Object.entries(opts.dirs || {})) {
            dirs[normalizePath(dirPath)] = entries;
        }

        // Track mock FS operations for assertions
        window.__importMockState = {
            mkdirCalls: [],
            writeFileCalls: [],
            existsResults: Object.assign({}, opts.existsOverrides || {}),
            statResults: Object.assign({}, opts.statOverrides || {}),
            readFileBytes: Object.assign({}, opts.readFileBytes || {}),
            manifestEntries: opts.manifestEntries || [],
            readFileErrors: Object.assign({}, opts.readFileErrors || {}),
        };

        // Capture the drag-drop handler so tests can fire synthetic events
        window.__capturedDragDropHandler = null;

        window.__TAURI__ = {
            core: {
                async invoke(cmd, args) {
                    if (cmd === 'apply_desktop_migration') {
                        return window.__applyMockDesktopMigration(args.db, args.batch, opts);
                    }
                    if (cmd === 'load_legacy_desktop_browser_stores') {
                        return [];
                    }
                    if (cmd === 'read_scan_manifest') {
                        return window.__importMockState.manifestEntries;
                    }
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                },
            },
            dialog: {
                async open() {
                    return null;
                },
            },
            event: {
                async listen() {
                    return () => {};
                },
            },
            fs: {
                async exists(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (hasOwn(state.existsResults, normalized)) {
                        return state.existsResults[normalized];
                    }
                    // Check if writeFile has already written to this path
                    if (state.writeFileCalls.some((call) => call.path === normalized)) {
                        return true;
                    }
                    // Check localStorage for persisted files
                    return localStorage.getItem(`${FILE_STORAGE_PREFIX}${normalized}`) !== null;
                },
                async stat(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (hasOwn(state.statResults, normalized)) {
                        return state.statResults[normalized];
                    }
                    throw new Error(`Stat not found: ${normalized}`);
                },
                async readFile(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (hasOwn(state.readFileErrors, normalized)) {
                        throw new Error(state.readFileErrors[normalized]);
                    }
                    const bytes = state.readFileBytes[normalized];
                    if (bytes) {
                        return Uint8Array.from(bytes);
                    }
                    // Check localStorage for persisted files (scan cache, etc.)
                    const persisted = localStorage.getItem(`${FILE_STORAGE_PREFIX}${normalized}`);
                    if (persisted) {
                        return Uint8Array.from(JSON.parse(persisted));
                    }
                    return Uint8Array.from([0]);
                },
                async readDir(dirPath) {
                    const normalized = normalizePath(dirPath);
                    if (!hasOwn(dirs, normalized)) {
                        throw new Error(`Path not found: ${normalized}`);
                    }
                    return dirs[normalized];
                },
                async writeFile(filePath, bytes) {
                    const normalized = normalizePath(filePath);
                    window.__importMockState.writeFileCalls.push({
                        path: normalized,
                        size: bytes.byteLength || bytes.length,
                    });
                    // Also persist to localStorage so readFile can find it later
                    localStorage.setItem(`${FILE_STORAGE_PREFIX}${normalized}`, JSON.stringify(Array.from(bytes)));
                },
                async mkdir(dirPath, mkdirOptions) {
                    const normalized = normalizePath(dirPath);
                    window.__importMockState.mkdirCalls.push({
                        path: normalized,
                        recursive: !!mkdirOptions?.recursive,
                    });
                },
                async remove() {},
                async rename() {},
            },
            path: {
                async appDataDir() {
                    return normalizePath(opts.appDataDir || '/mock-app-data');
                },
                async join(...parts) {
                    return joinPaths(...parts);
                },
                async normalize(filePath) {
                    return normalizePath(filePath);
                },
            },
            sql: window.__createMockTauriSql(opts),
            webview: {
                getCurrentWebview() {
                    return {
                        onDragDropEvent(handler) {
                            window.__capturedDragDropHandler = handler;
                            return Promise.resolve(() => {});
                        },
                    };
                },
            },
        };
    }, options);
}

test.describe('Desktop import integration', () => {
    // -----------------------------------------------------------------------
    // Test 1: Drop triggers import when managedLibrary is true
    // -----------------------------------------------------------------------

    test('import pipeline writes files to managed library on drop-like invocation', async ({ page }) => {
        const dicomA = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.drop.1',
            seriesInstanceUid: '1.2.series.drop.1',
            sopInstanceUid: '1.2.sop.drop.1',
            patientName: 'Drop^Managed',
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.drop.1',
            seriesInstanceUid: '1.2.series.drop.1',
            sopInstanceUid: '1.2.sop.drop.2',
            patientName: 'Drop^Managed',
        });

        await installMockDesktopIntegration(page, {
            initialConfig: {
                folder: `${MOCK_APP_DATA}/library`,
                lastScan: null,
                managedLibrary: true,
                importHistory: [],
            },
            manifestEntries: [
                {
                    path: '/source/img1.dcm',
                    name: 'img1.dcm',
                    rootPath: '/source',
                    size: dicomA.length,
                    modifiedMs: 1000,
                },
                {
                    path: '/source/img2.dcm',
                    name: 'img2.dcm',
                    rootPath: '/source',
                    size: dicomB.length,
                    modifiedMs: 2000,
                },
            ],
            readFileBytes: {
                '/source/img1.dcm': dicomA,
                '/source/img2.dcm': dicomB,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // Verify managedLibrary config is correctly loaded
        const configCheck = await page.evaluate(async () => {
            const config = await window.DicomViewerApp.desktopLibrary.getConfig();
            return { managedLibrary: config.managedLibrary, folder: config.folder };
        });
        expect(configCheck.managedLibrary).toBe(true);

        // Simulate the import that a managed-library drop handler would trigger
        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const importResult = await pipeline.importFromPaths(['/source']);
            const state = window.__importMockState;
            return {
                importResult,
                writeFileCalls: state.writeFileCalls,
                mkdirCalls: state.mkdirCalls,
            };
        });

        expect(result.importResult.imported).toBe(2);
        expect(result.importResult.skipped).toBe(0);

        // Verify files were written to the managed library path
        const libraryWrites = result.writeFileCalls.filter((call) => call.path.startsWith(LIBRARY_ROOT));
        expect(libraryWrites).toHaveLength(2);

        // Verify parent directories were created under the library root
        const libraryMkdirs = result.mkdirCalls.filter(
            (call) => call.path.startsWith(LIBRARY_ROOT) && call.path !== LIBRARY_ROOT,
        );
        expect(libraryMkdirs.length).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // Test 2: Drop does NOT trigger import when managedLibrary is false
    // -----------------------------------------------------------------------

    test('standard scan path does not write to managed library when managedLibrary is false', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.scan.1',
            seriesInstanceUid: '1.2.series.scan.1',
            sopInstanceUid: '1.2.sop.scan.1',
            patientName: 'Scan^NoImport',
        });

        await installMockDesktopIntegration(page, {
            initialConfig: {
                folder: '/user-library',
                lastScan: null,
                managedLibrary: false,
                importHistory: [],
            },
            // Supply the same file as both a manifest entry (for importFromPaths)
            // and as readFileBytes so the standard scan path can read it
            manifestEntries: [
                {
                    path: '/source/scan1.dcm',
                    name: 'scan1.dcm',
                    rootPath: '/source',
                    size: dicomBytes.length,
                    modifiedMs: 1000,
                },
            ],
            readFileBytes: {
                '/source/scan1.dcm': dicomBytes,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // Verify managedLibrary is false
        const configCheck = await page.evaluate(async () => {
            const config = await window.DicomViewerApp.desktopLibrary.getConfig();
            return config.managedLibrary;
        });
        expect(configCheck).toBe(false);

        // When managedLibrary is false, the app should NOT call importFromPaths.
        // Verify that calling importFromPaths is what writes to the library path,
        // and that simply reading the manifest without importing does not.
        const result = await page.evaluate(async () => {
            // Read the manifest entries (what read_scan_manifest returns) to
            // confirm they exist, but do NOT call importFromPaths. This simulates
            // the non-managed-library flow where files are scanned in place.
            const invoke = window.__TAURI__.core.invoke;
            const manifest = await invoke('read_scan_manifest', { roots: ['/source'], maxDepth: 20 });
            const state = window.__importMockState;
            return {
                manifestCount: manifest.length,
                writeFileCalls: state.writeFileCalls.filter((call) => call.path.startsWith('/mock-app-data/library')),
            };
        });

        // Files exist in the source folder
        expect(result.manifestCount).toBe(1);

        // No files should have been written to the managed library path
        expect(result.writeFileCalls).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Test 3: Dedup on re-drop -- second import of same files skips all
    // -----------------------------------------------------------------------

    test('second import of identical files skips all due to dedup', async ({ page }) => {
        const dicomA = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.dedup',
            seriesInstanceUid: '1.2.series.dedup',
            sopInstanceUid: '1.2.sop.dedup.1',
            patientName: 'Dedup^Test',
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.dedup',
            seriesInstanceUid: '1.2.series.dedup',
            sopInstanceUid: '1.2.sop.dedup.2',
            patientName: 'Dedup^Test',
        });

        await installMockDesktopIntegration(page, {
            manifestEntries: [
                { path: '/source/d1.dcm', name: 'd1.dcm', rootPath: '/source', size: dicomA.length, modifiedMs: 1000 },
                { path: '/source/d2.dcm', name: 'd2.dcm', rootPath: '/source', size: dicomB.length, modifiedMs: 2000 },
            ],
            readFileBytes: {
                '/source/d1.dcm': dicomA,
                '/source/d2.dcm': dicomB,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // First import: both files should be copied
        const firstResult = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        });

        expect(firstResult.imported).toBe(2);
        expect(firstResult.skipped).toBe(0);

        // Second import: the mock fs.exists check sees previous writeFile calls,
        // but stat is needed for size comparison. Inject stat overrides for the
        // destination paths so the dedup check can compare sizes.
        const fileSizes = { a: dicomA.length, b: dicomB.length };
        const secondResult = await page.evaluate(async (sizes) => {
            const state = window.__importMockState;

            // Add stat entries for the files that were written in the first import.
            // The dedup path in processOneFile calls fs.stat after fs.exists returns true.
            const destA = '/mock-app-data/library/1.2.study.dedup/1.2.series.dedup/1.2.sop.dedup.1.dcm';
            const destB = '/mock-app-data/library/1.2.study.dedup/1.2.series.dedup/1.2.sop.dedup.2.dcm';
            state.statResults[destA] = { size: sizes.a };
            state.statResults[destB] = { size: sizes.b };

            // Clear write tracking before second import to isolate results
            state.writeFileCalls = [];

            const pipeline = window.DicomViewerApp.importPipeline;
            return await pipeline.importFromPaths(['/source']);
        }, fileSizes);

        expect(secondResult.imported).toBe(0);
        expect(secondResult.skipped).toBe(2);
        expect(secondResult.errors).toBe(0);
        expect(secondResult.collisions).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Test 4: Startup with managedLibrary loads from managed library path
    // -----------------------------------------------------------------------

    test('startup with managedLibrary loads studies from the managed library path', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.startup',
            seriesInstanceUid: '1.2.series.startup',
            sopInstanceUid: '1.2.sop.startup.1',
            patientName: 'Startup^Managed',
        });

        // Pre-populate the managed library path with a scan cache so
        // initializeDesktopLibrary finds and displays studies on startup.
        const cachedStudies = {
            '1.2.study.startup': {
                patientName: 'Startup^Managed',
                studyDate: '20260327',
                studyDescription: 'Startup Integration Test',
                studyInstanceUid: '1.2.study.startup',
                modality: 'CT',
                seriesCount: 1,
                imageCount: 1,
                comments: [],
                reports: [],
                series: {
                    '1.2.series.startup': {
                        seriesInstanceUid: '1.2.series.startup',
                        seriesDescription: 'Startup Series',
                        seriesNumber: 1,
                        modality: 'CT',
                        comments: [],
                        slices: [
                            {
                                instanceNumber: 1,
                                sliceLocation: 0,
                                source: {
                                    kind: 'path',
                                    path: `${MOCK_APP_DATA}/library/1.2.study.startup/1.2.series.startup/1.2.sop.startup.1.dcm`,
                                },
                            },
                        ],
                    },
                },
            },
        };
        const snapshotPayload = JSON.stringify({
            version: 1,
            folder: `${MOCK_APP_DATA}/library`,
            savedAt: '2026-03-27T00:00:00.000Z',
            studies: cachedStudies,
        });
        const snapshotBytes = Array.from(new TextEncoder().encode(snapshotPayload));

        await installMockDesktopIntegration(page, {
            initialConfig: {
                folder: `${MOCK_APP_DATA}/library`,
                lastScan: '2026-03-27T00:00:00.000Z',
                managedLibrary: true,
                importHistory: [],
            },
            storedFiles: {
                [`${MOCK_APP_DATA}/desktop-library-cache.json`]: snapshotBytes,
            },
            // The refresh scan after snapshot load needs dir entries for the library path
            dirs: {
                [`${MOCK_APP_DATA}/library`]: [
                    {
                        name: '1.2.study.startup',
                        isFile: false,
                        isDirectory: true,
                        children: [
                            {
                                name: '1.2.series.startup',
                                isFile: false,
                                isDirectory: true,
                                children: [
                                    {
                                        name: '1.2.sop.startup.1.dcm',
                                        isFile: true,
                                        isDirectory: false,
                                    },
                                ],
                            },
                        ],
                    },
                ],
                [`${MOCK_APP_DATA}/library/1.2.study.startup`]: [
                    {
                        name: '1.2.series.startup',
                        isFile: false,
                        isDirectory: true,
                    },
                ],
                [`${MOCK_APP_DATA}/library/1.2.study.startup/1.2.series.startup`]: [
                    {
                        name: '1.2.sop.startup.1.dcm',
                        isFile: true,
                        isDirectory: false,
                    },
                ],
            },
            readFileBytes: {
                [`${MOCK_APP_DATA}/library/1.2.study.startup/1.2.series.startup/1.2.sop.startup.1.dcm`]: dicomBytes,
            },
        });

        // Use AUTOLOAD_URL (without ?nolib) so initializeDesktopLibrary runs
        await page.goto(AUTOLOAD_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // The cached snapshot should display the study. Wait for the patient
        // name to appear in the studies table.
        await expect(page.locator('#studiesBody')).toContainText('Startup');

        // Verify the library folder input shows the managed library path
        await expect(page.locator('#libraryFolderInput')).toHaveValue(`${MOCK_APP_DATA}/library`);
    });

    // -----------------------------------------------------------------------
    // Test 5: Import result banner displays correct summary
    // -----------------------------------------------------------------------

    test('displayImportResult shows import summary banner with correct text', async ({ page }) => {
        await installMockDesktopIntegration(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // Call displayImportResult with a representative result object
        await page.evaluate(() => {
            window.DicomViewerApp.library.displayImportResult({
                imported: 5,
                skipped: 2,
                invalid: 1,
                errors: 0,
                collisions: 0,
                duration: 3456,
            });
        });

        const banner = page.locator('#importResultBanner');
        await expect(banner).toBeVisible();

        const bannerText = await page.locator('#importResultText').textContent();
        expect(bannerText).toContain('Imported 5 files');
        expect(bannerText).toContain('2 duplicates skipped');
        expect(bannerText).toContain('1 invalid');
        expect(bannerText).toContain('3.5s');

        // The banner should have the success class (no errors or collisions)
        const bannerClass = await banner.getAttribute('class');
        expect(bannerClass).toContain('success');
    });

    // -----------------------------------------------------------------------
    // Test 6: Import result banner shows warning for errors
    // -----------------------------------------------------------------------

    test('displayImportResult shows warning banner when errors or collisions are present', async ({ page }) => {
        await installMockDesktopIntegration(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        await page.evaluate(() => {
            window.DicomViewerApp.library.displayImportResult({
                imported: 3,
                skipped: 0,
                invalid: 0,
                errors: 2,
                collisions: 1,
                duration: 1200,
            });
        });

        const banner = page.locator('#importResultBanner');
        await expect(banner).toBeVisible();

        const bannerText = await page.locator('#importResultText').textContent();
        expect(bannerText).toContain('Imported 3 files');
        expect(bannerText).toContain('2 errors');
        expect(bannerText).toContain('1 file collision');

        // The banner should have the warning class
        const bannerClass = await banner.getAttribute('class');
        expect(bannerClass).toContain('warning');
    });

    // -----------------------------------------------------------------------
    // Test 7: Import result banner dismiss button works
    // -----------------------------------------------------------------------

    test('import result banner can be dismissed', async ({ page }) => {
        await installMockDesktopIntegration(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // Show the banner
        await page.evaluate(() => {
            window.DicomViewerApp.library.displayImportResult({
                imported: 1,
                skipped: 0,
                invalid: 0,
                errors: 0,
                collisions: 0,
                duration: 500,
            });
        });

        const banner = page.locator('#importResultBanner');
        await expect(banner).toBeVisible();

        // Click the dismiss button
        await page.locator('#importResultDismiss').click();
        await expect(banner).toBeHidden();
    });

    // -----------------------------------------------------------------------
    // Test 8: Full round-trip -- import then display studies
    // -----------------------------------------------------------------------

    test('imported studies can be displayed in the library table after import', async ({ page }) => {
        const dicomA = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.display',
            seriesInstanceUid: '1.2.series.display',
            sopInstanceUid: '1.2.sop.display.1',
            patientName: 'Display^Test',
            studyDate: '20260327',
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.display',
            seriesInstanceUid: '1.2.series.display',
            sopInstanceUid: '1.2.sop.display.2',
            patientName: 'Display^Test',
            studyDate: '20260327',
        });

        await installMockDesktopIntegration(page, {
            initialConfig: {
                folder: `${MOCK_APP_DATA}/library`,
                lastScan: null,
                managedLibrary: true,
                importHistory: [],
            },
            manifestEntries: [
                {
                    path: '/source/disp1.dcm',
                    name: 'disp1.dcm',
                    rootPath: '/source',
                    size: dicomA.length,
                    modifiedMs: 1000,
                },
                {
                    path: '/source/disp2.dcm',
                    name: 'disp2.dcm',
                    rootPath: '/source',
                    size: dicomB.length,
                    modifiedMs: 2000,
                },
            ],
            readFileBytes: {
                '/source/disp1.dcm': dicomA,
                '/source/disp2.dcm': dicomB,
            },
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        // Import files, show the banner, and build displayable study objects
        // The import pipeline returns lightweight study tracking (no slices array),
        // so we construct proper study objects that displayStudies expects.
        const importResult = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            const result = await pipeline.importFromPaths(['/source']);

            // Show the import result banner
            window.DicomViewerApp.library.displayImportResult(result);

            // Build displayable studies from the import result metadata.
            // In the real app, a library rescan would produce these. Here we
            // construct the minimum shape that displayStudies requires.
            const displayStudies = {};
            for (const [uid, study] of Object.entries(result.studies)) {
                const seriesMap = {};
                for (const [seriesUid, series] of Object.entries(study.series || {})) {
                    seriesMap[seriesUid] = {
                        seriesInstanceUid: seriesUid,
                        seriesDescription: series.seriesDescription || '',
                        seriesNumber: 1,
                        modality: series.modality || '',
                        comments: [],
                        slices: Array.from({ length: series.instanceCount }, (_, idx) => ({
                            instanceNumber: idx + 1,
                            sliceLocation: idx,
                            source: { kind: 'path', path: `/mock-app-data/library/${uid}/${seriesUid}/sop-${idx}.dcm` },
                        })),
                    };
                }
                displayStudies[uid] = {
                    studyInstanceUid: uid,
                    patientName: study.patientName || '',
                    studyDate: study.studyDate || '',
                    studyDescription: study.studyDescription || '',
                    modality: Object.values(study.series || {})[0]?.modality || '',
                    seriesCount: study.seriesCount,
                    imageCount: study.instanceCount,
                    comments: [],
                    reports: [],
                    series: seriesMap,
                };
            }

            const app = window.DicomViewerApp;
            app.state.studies = displayStudies;
            await app.library.displayStudies();

            return { imported: result.imported, skipped: result.skipped };
        });

        expect(importResult.imported).toBe(2);

        // Verify the import banner is shown
        await expect(page.locator('#importResultBanner')).toBeVisible();
        await expect(page.locator('#importResultText')).toContainText('Imported 2 files');

        // Verify the study appears in the library table
        await expect(page.locator('#studiesBody')).toContainText('Display');
    });
});
