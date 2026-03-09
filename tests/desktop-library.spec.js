// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';
const AUTOLOAD_URL = 'http://127.0.0.1:5001/';

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
            return Array.from(new Uint8Array(buffer));
        });

        expect(bytes).toEqual([1, 2, 3, 4]);
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
