// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';

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

        const stats = {};
        for (const [path, value] of Object.entries(options.stats || {})) {
            stats[normalizePath(path)] = value;
        }

        window.__TAURI__ = {
            fs: {
                async readDir(path) {
                    const normalized = normalizePath(path);
                    if (Object.prototype.hasOwnProperty.call(readDirErrors, normalized)) {
                        throw new Error(readDirErrors[normalized]);
                    }
                    if (!Object.prototype.hasOwnProperty.call(dirs, normalized)) {
                        throw new Error(`Path not found: ${normalized}`);
                    }
                    return dirs[normalized];
                },
                async readFile() {
                    return new Uint8Array([0]);
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
