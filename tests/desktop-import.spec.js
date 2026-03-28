// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const path = require('path');
const { test, expect } = require('@playwright/test');

const TEST_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5001';
const HOME_URL = `${TEST_BASE_URL}/?nolib`;
const MOCK_SQL_INIT_PATH = path.join(__dirname, 'mock-tauri-sql-init.js');
const MOCK_APP_DATA = '/mock-app-data';
const LIBRARY_ROOT = `${MOCK_APP_DATA}/library`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    tags.push({ group: 0x0020, element: 0x000D, vr: 'UI', value: studyInstanceUid });

    // Series Instance UID (0020,000E)
    tags.push({ group: 0x0020, element: 0x000E, vr: 'UI', value: seriesInstanceUid });

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
    bytes[offset++] = 0x4D; // M

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
    view.setUint16(offset, 0x7FE0, true);
    offset += 2;
    view.setUint16(offset, 0x0010, true);
    offset += 2;
    bytes[offset++] = 0x4F; // O
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
        const FILE_STORAGE_PREFIX = 'mock-desktop-fs:';

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
            existsResults: Object.assign({}, opts.existsOverrides || {}),
            statResults: Object.assign({}, opts.statOverrides || {}),
            readFileBytes: Object.assign({}, opts.readFileBytes || {}),
            manifestEntries: opts.manifestEntries || [],
            readFileErrors: Object.assign({}, opts.readFileErrors || {})
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
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                }
            },
            dialog: {
                async open() { return null; }
            },
            fs: {
                async exists(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (Object.prototype.hasOwnProperty.call(state.existsResults, normalized)) {
                        return state.existsResults[normalized];
                    }
                    // Check if writeFile has already written to this path
                    return state.writeFileCalls.some((call) => call.path === normalized);
                },
                async stat(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (Object.prototype.hasOwnProperty.call(state.statResults, normalized)) {
                        return state.statResults[normalized];
                    }
                    throw new Error(`Stat not found: ${normalized}`);
                },
                async readFile(filePath) {
                    const normalized = normalizePath(filePath);
                    const state = window.__importMockState;
                    if (Object.prototype.hasOwnProperty.call(state.readFileErrors, normalized)) {
                        throw new Error(state.readFileErrors[normalized]);
                    }
                    const bytes = state.readFileBytes[normalized];
                    if (bytes) {
                        return Uint8Array.from(bytes);
                    }
                    return Uint8Array.from([0]);
                },
                async readDir() { return []; },
                async writeFile(filePath, bytes) {
                    const normalized = normalizePath(filePath);
                    window.__importMockState.writeFileCalls.push({
                        path: normalized,
                        size: bytes.byteLength || bytes.length
                    });
                },
                async mkdir(dirPath, mkdirOptions) {
                    const normalized = normalizePath(dirPath);
                    window.__importMockState.mkdirCalls.push({
                        path: normalized,
                        recursive: !!(mkdirOptions && mkdirOptions.recursive)
                    });
                },
                async remove() {},
                async rename() {}
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
                }
            },
            sql: window.__createMockTauriSql(opts),
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
                sopInstanceUid: '1.2.3.4.1.1'
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
                sopInstanceUid: '1.2.3|pipe&amp'
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
                    seriesInstanceUid: '1.2.3.1'
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
                sopInstanceUid: '1.2.3.4.1.1'
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
                mkdirCalls: state.mkdirCalls
            };
        });

        expect(result.returnedPath).toBe('/mock-app-data/library');
        expect(result.mkdirCalls.length).toBeGreaterThanOrEqual(1);

        const libraryMkdir = result.mkdirCalls.find(
            (call) => call.path === '/mock-app-data/library'
        );
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
            patientName: 'Happy^Path'
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.1',
            seriesInstanceUid: '1.2.series.1',
            sopInstanceUid: '1.2.sop.2',
            patientName: 'Happy^Path'
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/file1.dcm', name: 'file1.dcm', rootPath: '/source', size: dicomA.length, modifiedMs: 1000 },
                { path: '/source/file2.dcm', name: 'file2.dcm', rootPath: '/source', size: dicomB.length, modifiedMs: 2000 }
            ],
            readFileBytes: {
                '/source/file1.dcm': dicomA,
                '/source/file2.dcm': dicomB
            }
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
            sopInstanceUid: '1.2.sop.dup'
        });

        const destPath = `${LIBRARY_ROOT}/1.2.study.dup/1.2.series.dup/1.2.sop.dup.dcm`;

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/dup.dcm', name: 'dup.dcm', rootPath: '/source', size: dicomBytes.length, modifiedMs: 1000 }
            ],
            readFileBytes: {
                '/source/dup.dcm': dicomBytes
            },
            existsOverrides: {
                [destPath]: true
            },
            statOverrides: {
                [destPath]: { size: dicomBytes.length }
            }
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

    // -----------------------------------------------------------------------
    // importFromPaths: size mismatch collision
    // -----------------------------------------------------------------------

    test('importFromPaths: size mismatch counts as collision', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.col',
            seriesInstanceUid: '1.2.series.col',
            sopInstanceUid: '1.2.sop.col'
        });

        const destPath = `${LIBRARY_ROOT}/1.2.study.col/1.2.series.col/1.2.sop.col.dcm`;

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/col.dcm', name: 'col.dcm', rootPath: '/source', size: dicomBytes.length, modifiedMs: 1000 }
            ],
            readFileBytes: {
                '/source/col.dcm': dicomBytes
            },
            existsOverrides: {
                [destPath]: true
            },
            statOverrides: {
                // Different size from the source file
                [destPath]: { size: dicomBytes.length + 100 }
            }
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
                { path: '/source/readme.txt', name: 'readme.txt', rootPath: '/source', size: junkBytes.length, modifiedMs: 1000 },
                { path: '/source/photo.jpg', name: 'photo.jpg', rootPath: '/source', size: junkBytes.length, modifiedMs: 2000 }
            ],
            readFileBytes: {
                '/source/readme.txt': junkBytes,
                '/source/photo.jpg': junkBytes
            }
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

    // -----------------------------------------------------------------------
    // importFromPaths: progress callback
    // -----------------------------------------------------------------------

    test('importFromPaths: progress callback receives correct stats', async ({ page }) => {
        const dicomBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.prog',
            seriesInstanceUid: '1.2.series.prog',
            sopInstanceUid: '1.2.sop.prog'
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/prog.dcm', name: 'prog.dcm', rootPath: '/source', size: dicomBytes.length, modifiedMs: 1000 }
            ],
            readFileBytes: {
                '/source/prog.dcm': dicomBytes
            }
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const progressEvents = [];
            const pipeline = window.DicomViewerApp.importPipeline;
            const importResult = await pipeline.importFromPaths(['/source'], {
                onProgress: (stats) => {
                    progressEvents.push(JSON.parse(JSON.stringify(stats)));
                }
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
                sopInstanceUid: sopUid
            });
            manifestEntries.push({
                path: filePath,
                name: `abort-${index}.dcm`,
                rootPath: '/source',
                size: bytes.length,
                modifiedMs: index * 1000
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
                    }
                });
                return { aborted: false, processed };
            } catch (error) {
                return {
                    aborted: error.name === 'AbortError',
                    errorName: error.name,
                    processed
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
            sopInstanceUid: '1.2.sop.good'
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/bad.dcm', name: 'bad.dcm', rootPath: '/source', size: 100, modifiedMs: 1000 },
                { path: '/source/good.dcm', name: 'good.dcm', rootPath: '/source', size: goodDicom.length, modifiedMs: 2000 }
            ],
            readFileBytes: {
                '/source/good.dcm': goodDicom
            },
            readFileErrors: {
                '/source/bad.dcm': 'Simulated filesystem read failure'
            }
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
            manifestEntries: []
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
            studyDate: '20260101'
        });
        const dicomB = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.multi.study.A',
            seriesInstanceUid: '1.2.multi.series.A2',
            sopInstanceUid: '1.2.multi.sop.A2.1',
            patientName: 'Multi^A',
            studyDate: '20260101'
        });
        const dicomC = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.multi.study.B',
            seriesInstanceUid: '1.2.multi.series.B1',
            sopInstanceUid: '1.2.multi.sop.B1.1',
            patientName: 'Multi^B',
            studyDate: '20260215'
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/src/a1.dcm', name: 'a1.dcm', rootPath: '/src', size: dicomA.length, modifiedMs: 1000 },
                { path: '/src/a2.dcm', name: 'a2.dcm', rootPath: '/src', size: dicomB.length, modifiedMs: 2000 },
                { path: '/src/b1.dcm', name: 'b1.dcm', rootPath: '/src', size: dicomC.length, modifiedMs: 3000 }
            ],
            readFileBytes: {
                '/src/a1.dcm': dicomA,
                '/src/a2.dcm': dicomB,
                '/src/b1.dcm': dicomC
            }
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
            sopInstanceUid: '1.2.sop.write'
        });

        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/write.dcm', name: 'write.dcm', rootPath: '/source', size: dicomBytes.length, modifiedMs: 1000 }
            ],
            readFileBytes: {
                '/source/write.dcm': dicomBytes
            }
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            const pipeline = window.DicomViewerApp.importPipeline;
            await pipeline.importFromPaths(['/source']);
            const state = window.__importMockState;
            return {
                mkdirCalls: state.mkdirCalls,
                writeFileCalls: state.writeFileCalls
            };
        });

        // mkdir should have been called for the library root and for the parent
        // of the destination file
        const parentDir = `${LIBRARY_ROOT}/1.2.study.write/1.2.series.write`;
        const parentMkdir = result.mkdirCalls.find(
            (call) => call.path === parentDir
        );
        expect(parentMkdir).toBeTruthy();
        expect(parentMkdir.recursive).toBe(true);

        // writeFile should have been called with the correct destination path
        const destPath = `${parentDir}/1.2.sop.write.dcm`;
        const writeCall = result.writeFileCalls.find(
            (call) => call.path === destPath
        );
        expect(writeCall).toBeTruthy();
        expect(writeCall.size).toBe(dicomBytes.length);
    });

    // -----------------------------------------------------------------------
    // importFromPaths: DICOM without SOP UID counted as invalid
    // -----------------------------------------------------------------------

    test('importFromPaths: DICOM without SOP Instance UID counted as invalid', async ({ page }) => {
        // Build a DICOM-like buffer that has study/series UIDs but no SOP UID.
        // We need the transfer syntax so hasLikelyDicomMetadata returns true,
        // but the SOP Instance UID check in processOneFile should reject it.
        const noSopBytes = buildSyntheticDicomBytes({
            studyInstanceUid: '1.2.study.nosop',
            seriesInstanceUid: '1.2.series.nosop',
            sopInstanceUid: '1.2.sop.nosop' // will be present in bytes
        });

        // We will override readFile to return bytes that parse as DICOM but have
        // the SOP UID field empty. The simplest approach: build bytes without
        // a real SOP tag by constructing a custom buffer in the browser context.
        await installMockDesktop(page, {
            manifestEntries: [
                { path: '/source/nosop.dcm', name: 'nosop.dcm', rootPath: '/source', size: 512, modifiedMs: 1000 }
            ]
        });

        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async () => {
            // Build a minimal DICOM in-browser that has transferSyntax but no SOP UID
            const ts = '1.2.840.10008.1.2.1';
            const tags = [
                { group: 0x0002, element: 0x0010, vr: 'UI', value: ts }
            ];
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
            bytes[offset++] = 0x44; bytes[offset++] = 0x49;
            bytes[offset++] = 0x43; bytes[offset++] = 0x4D;
            for (const tag of tags) {
                view.setUint16(offset, tag.group, true); offset += 2;
                view.setUint16(offset, tag.element, true); offset += 2;
                bytes[offset++] = tag.vr.charCodeAt(0);
                bytes[offset++] = tag.vr.charCodeAt(1);
                let padLen = tag.value.length;
                if (padLen % 2 !== 0) padLen += 1;
                view.setUint16(offset, padLen, true); offset += 2;
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
