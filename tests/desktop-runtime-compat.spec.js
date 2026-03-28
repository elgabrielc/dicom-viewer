// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'http://127.0.0.1:5001/';
const MOCK_SQL_INIT_PATH = path.join(__dirname, 'mock-tauri-sql-init.js');

async function installMockTauriInternals(page) {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        const listeners = new Map();
        const callbacks = new Map();
        let callbackId = 1;

        function registerCallback(callback, once = false) {
            const id = callbackId++;
            callbacks.set(id, (payload) => {
                if (once) {
                    callbacks.delete(id);
                }
                return callback(payload);
            });
            return id;
        }

        function normalizePath(path) {
            const text = String(path || '').replace(/\\/g, '/');
            return text.replace(/\/+/g, '/');
        }

        window.__TAURI_INTERNALS__ = {
            metadata: {
                currentWindow: { label: 'main' },
                currentWebview: { label: 'main', windowLabel: 'main' }
            },
            convertFileSrc(filePath, protocol = 'asset') {
                return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
            },
            transformCallback: registerCallback,
            unregisterCallback(id) {
                callbacks.delete(id);
            },
            async invoke(cmd, args, options) {
                switch (cmd) {
                    case 'plugin:dialog|open':
                        return null;
                    case 'plugin:event|listen':
                        if (!listeners.has(args.event)) listeners.set(args.event, []);
                        listeners.get(args.event).push(args.handler);
                        return args.handler;
                    case 'plugin:event|unlisten':
                        return null;
                    case 'plugin:fs|exists':
                        return false;
                    case 'plugin:fs|mkdir':
                    case 'plugin:fs|rename':
                    case 'plugin:fs|remove':
                        return null;
                    case 'plugin:fs|read_dir':
                        return [];
                    case 'plugin:fs|read_file':
                        return new Uint8Array([0]);
                    case 'plugin:fs|stat':
                        return {
                            isFile: false,
                            isDirectory: true,
                            isSymlink: false,
                            size: 0,
                            mtime: null,
                            atime: null,
                            birthtime: null,
                            readonly: false,
                            fileAttributes: null,
                            dev: null,
                            ino: null,
                            mode: null,
                            nlink: null,
                            uid: null,
                            gid: null,
                            rdev: null,
                            blksize: null,
                            blocks: null
                        };
                    case 'plugin:fs|write_file':
                        return null;
                    case 'plugin:path|resolve_directory':
                        return '/mock/appdata';
                    case 'plugin:path|join':
                        return args.paths.map(normalizePath).join('/').replace(/\/+/g, '/');
                    case 'plugin:path|normalize':
                        return normalizePath(args.path);
                    case 'plugin:sql|load':
                    case 'plugin:sql|select':
                    case 'plugin:sql|execute':
                    case 'plugin:sql|close':
                        return window.__handleMockTauriSqlCommand(cmd, args);
                    case 'apply_desktop_migration':
                        return window.__applyMockDesktopMigration(args.db, args.batch);
                    case 'load_legacy_desktop_browser_stores':
                        return [];
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
    });
}

test('desktop runtime shim enables desktop mode when only __TAURI_INTERNALS__ is present', async ({ page }) => {
    await installMockTauriInternals(page);
    await page.goto(HOME_URL);
    await expect(page.locator('#libraryView')).toBeVisible();

    const result = await page.evaluate(() => ({
        deploymentMode: window.CONFIG.deploymentMode,
        hasGlobalTauri: typeof window.__TAURI__ !== 'undefined',
        hasCoreInvoke: typeof window.__TAURI__?.core?.invoke === 'function',
        hasDialogApi: typeof window.__TAURI__?.dialog?.open === 'function',
        hasFsApi: typeof window.__TAURI__?.fs?.readDir === 'function',
    }));

    expect(result.deploymentMode).toBe('desktop');
    expect(result.hasGlobalTauri).toBe(true);
    expect(result.hasCoreInvoke).toBe(true);
    expect(result.hasDialogApi).toBe(true);
    expect(result.hasFsApi).toBe(true);
});

test('deployment mode detects packaged Tauri origins before globals are ready', async ({ page }) => {
    await page.goto('http://127.0.0.1:5001/?nolib');

    const modes = await page.evaluate(() => ({
        tauriScheme: window.CONFIG.detectDeploymentMode({
            location: { protocol: 'tauri:', hostname: 'localhost' }
        }),
        tauriHost: window.CONFIG.detectDeploymentMode({
            location: { protocol: 'https:', hostname: 'tauri.localhost' }
        }),
        personal: window.CONFIG.detectDeploymentMode({
            location: { protocol: 'http:', hostname: '127.0.0.1' }
        })
    }));

    expect(modes.tauriScheme).toBe('desktop');
    expect(modes.tauriHost).toBe('desktop');
    expect(modes.personal).toBe('personal');
});

test('tauri runtime shim installs when internals arrive after the script loads', async ({ page }) => {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.goto('http://127.0.0.1:5001/?nolib');

    await page.evaluate(() => {
        const listeners = new Map();
        const callbacks = new Map();
        let callbackId = 1;

        function registerCallback(callback, once = false) {
            const id = callbackId++;
            callbacks.set(id, payload => {
                if (once) {
                    callbacks.delete(id);
                }
                return callback(payload);
            });
            return id;
        }

        function normalizePath(path) {
            const text = String(path || '').replace(/\\/g, '/');
            return text.replace(/\/+/g, '/');
        }

        setTimeout(() => {
            window.__TAURI_INTERNALS__ = {
                metadata: {
                    currentWindow: { label: 'main' },
                    currentWebview: { label: 'main', windowLabel: 'main' }
                },
                convertFileSrc(filePath, protocol = 'asset') {
                    return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
                },
                transformCallback: registerCallback,
                unregisterCallback(id) {
                    callbacks.delete(id);
                },
                async invoke(cmd, args) {
                    switch (cmd) {
                        case 'plugin:dialog|open':
                            return null;
                        case 'plugin:event|listen':
                            if (!listeners.has(args.event)) listeners.set(args.event, []);
                            listeners.get(args.event).push(args.handler);
                            return args.handler;
                        case 'plugin:event|unlisten':
                            return null;
                        case 'plugin:fs|exists':
                            return false;
                        case 'plugin:fs|mkdir':
                        case 'plugin:fs|rename':
                        case 'plugin:fs|remove':
                            return null;
                        case 'plugin:fs|read_dir':
                            return [];
                        case 'plugin:fs|read_file':
                            return new Uint8Array([0]);
                        case 'plugin:fs|stat':
                            return {
                                isFile: false,
                                isDirectory: true,
                                isSymlink: false,
                                size: 0,
                                mtime: null,
                                atime: null,
                                birthtime: null,
                                readonly: false,
                                fileAttributes: null,
                                dev: null,
                                ino: null,
                                mode: null,
                                nlink: null,
                                uid: null,
                                gid: null,
                                rdev: null,
                                blksize: null,
                                blocks: null
                            };
                        case 'plugin:fs|write_file':
                            return null;
                        case 'plugin:path|resolve_directory':
                            return '/mock/appdata';
                        case 'plugin:path|join':
                            return args.paths.map(normalizePath).join('/').replace(/\/+/g, '/');
                        case 'plugin:path|normalize':
                            return normalizePath(args.path);
                        case 'plugin:sql|load':
                        case 'plugin:sql|select':
                        case 'plugin:sql|execute':
                        case 'plugin:sql|close':
                            return window.__handleMockTauriSqlCommand(cmd, args);
                        case 'apply_desktop_migration':
                            return window.__applyMockDesktopMigration(args.db, args.batch);
                        case 'load_legacy_desktop_browser_stores':
                            return [];
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
        }, 50);
    });

    const result = await page.evaluate(async () => {
        const runtime = await window.__DICOM_VIEWER_TAURI_READY__;
        return {
            hasReadyPromise: typeof window.__DICOM_VIEWER_TAURI_READY__?.then === 'function',
            hasGlobalTauri: typeof window.__TAURI__ !== 'undefined',
            hasCoreInvoke: typeof runtime?.core?.invoke === 'function',
            hasDialogApi: typeof runtime?.dialog?.open === 'function',
            hasFsApi: typeof runtime?.fs?.readDir === 'function'
        };
    });

    expect(result.hasReadyPromise).toBe(true);
    expect(result.hasGlobalTauri).toBe(true);
    expect(result.hasCoreInvoke).toBe(true);
    expect(result.hasDialogApi).toBe(true);
    expect(result.hasFsApi).toBe(true);
});

test('desktop runtime shim augments a partial global Tauri object', async ({ page }) => {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        window.__TAURI__ = {
            core: {
                invoke() {
                    return Promise.resolve('native-invoke');
                }
            }
        };

        window.__TAURI_INTERNALS__ = {
            metadata: {
                currentWindow: { label: 'main' },
                currentWebview: { label: 'main', windowLabel: 'main' }
            },
            convertFileSrc(filePath, protocol = 'asset') {
                return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
            },
            transformCallback(callback) {
                return callback;
            },
            unregisterCallback() {},
            async invoke(cmd, args) {
                switch (cmd) {
                    case 'plugin:dialog|open':
                        return null;
                    case 'plugin:event|listen':
                    case 'plugin:event|unlisten':
                        return null;
                    case 'plugin:fs|exists':
                        return false;
                    case 'plugin:fs|mkdir':
                    case 'plugin:fs|rename':
                    case 'plugin:fs|remove':
                        return null;
                    case 'plugin:fs|read_dir':
                        return [];
                    case 'plugin:fs|read_file':
                        return new Uint8Array([0]);
                    case 'plugin:fs|stat':
                        return {
                            isFile: false,
                            isDirectory: true,
                            isSymlink: false,
                            size: 0,
                            mtime: null,
                            atime: null,
                            birthtime: null,
                            readonly: false,
                            fileAttributes: null,
                            dev: null,
                            ino: null,
                            mode: null,
                            nlink: null,
                            uid: null,
                            gid: null,
                            rdev: null,
                            blksize: null,
                            blocks: null
                        };
                    case 'plugin:fs|write_file':
                        return null;
                    case 'plugin:path|resolve_directory':
                        return '/mock/appdata';
                    case 'plugin:path|join':
                        return args.paths.join('/');
                    case 'plugin:path|normalize':
                        return args.path;
                    case 'plugin:sql|load':
                    case 'plugin:sql|select':
                    case 'plugin:sql|execute':
                    case 'plugin:sql|close':
                        return window.__handleMockTauriSqlCommand(cmd, args);
                    case 'apply_desktop_migration':
                        return window.__applyMockDesktopMigration(args.db, args.batch);
                    case 'load_legacy_desktop_browser_stores':
                        return [];
                    default:
                        throw new Error(`Unhandled command: ${cmd}`);
                }
            }
        };
    });

    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const runtime = await window.__DICOM_VIEWER_TAURI_READY__;
        return {
            preservedCoreInvoke: await runtime.core.invoke('ignored'),
            hasDialogApi: typeof runtime?.dialog?.open === 'function',
            hasFsApi: typeof runtime?.fs?.readDir === 'function',
            hasPathApi: typeof runtime?.path?.appDataDir === 'function',
            hasSqlApi: typeof runtime?.sql?.load === 'function'
        };
    });

    expect(result.preservedCoreInvoke).toBe('native-invoke');
    expect(result.hasDialogApi).toBe(true);
    expect(result.hasFsApi).toBe(true);
    expect(result.hasPathApi).toBe(true);
    expect(result.hasSqlApi).toBe(true);
});

test('desktop runtime ready promise waits for a partial global Tauri object to finish initializing', async ({ page }) => {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        window.__TAURI__ = {
            core: {
                invoke() {
                    return Promise.resolve('native-invoke');
                }
            }
        };

        setTimeout(() => {
            window.__TAURI__.dialog = {
                async open() {
                    return null;
                }
            };
            window.__TAURI__.fs = {
                async readDir() {
                    return [];
                }
            };
            window.__TAURI__.path = {
                async appDataDir() {
                    return '/mock/appdata';
                }
            };
            window.__TAURI__.sql = window.__createMockTauriSql();
            window.__TAURI__.webview = {
                getCurrentWebview() {
                    return {
                        onDragDropEvent() {
                            return Promise.resolve(() => {});
                        }
                    };
                }
            };
        }, 150);
    });

    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const settledEarly = await Promise.race([
            window.__DICOM_VIEWER_TAURI_READY__.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 25))
        ]);
        const runtime = await window.__DICOM_VIEWER_TAURI_READY__;
        return {
            settledEarly,
            hasDialogApi: typeof runtime?.dialog?.open === 'function',
            hasFsApi: typeof runtime?.fs?.readDir === 'function',
            hasPathApi: typeof runtime?.path?.appDataDir === 'function',
            hasSqlApi: typeof runtime?.sql?.load === 'function'
        };
    });

    expect(result.settledEarly).toBe(false);
    expect(result.hasDialogApi).toBe(true);
    expect(result.hasFsApi).toBe(true);
    expect(result.hasPathApi).toBe(true);
    expect(result.hasSqlApi).toBe(true);
});

test('desktop storage ready promise resolves before the full desktop shell is available', async ({ page }) => {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        window.__TAURI__ = {
            core: {
                invoke() {
                    return Promise.resolve('native-invoke');
                }
            },
            fs: {
                async exists() {
                    return false;
                },
                async remove() {
                    return null;
                },
                async rename() {
                    return null;
                },
                async writeFile() {
                    return null;
                }
            },
            path: {
                async appDataDir() {
                    return '/mock/appdata';
                },
                async join(...parts) {
                    return parts.join('/');
                }
            },
            sql: window.__createMockTauriSql()
        };
    });

    await page.goto(HOME_URL);

    const result = await page.evaluate(async () => {
        const storageRuntime = await window.__DICOM_VIEWER_TAURI_STORAGE_READY__;
        const fullSettledEarly = await Promise.race([
            window.__DICOM_VIEWER_TAURI_READY__.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 25))
        ]);

        return {
            hasStorageReadyPromise: typeof window.__DICOM_VIEWER_TAURI_STORAGE_READY__?.then === 'function',
            hasCoreInvoke: typeof storageRuntime?.core?.invoke === 'function',
            hasFsWriteFile: typeof storageRuntime?.fs?.writeFile === 'function',
            hasPathJoin: typeof storageRuntime?.path?.join === 'function',
            hasSqlApi: typeof storageRuntime?.sql?.load === 'function',
            fullSettledEarly
        };
    });

    expect(result.hasStorageReadyPromise).toBe(true);
    expect(result.hasCoreInvoke).toBe(true);
    expect(result.hasFsWriteFile).toBe(true);
    expect(result.hasPathJoin).toBe(true);
    expect(result.hasSqlApi).toBe(true);
    expect(result.fullSettledEarly).toBe(false);
});

test('OpenJPEG asset URL resolves when the decoder bundle is worker-loaded', async ({ page }) => {
    await page.goto('http://127.0.0.1:5001/?nolib');

    const result = await page.evaluate(() => window.DicomViewerApp.dicom.resolveOpenJpegAssetUrl('openjpegwasm_decode.wasm'));

    expect(result).toMatch(/\/js\/openjpegwasm_decode\.wasm$/);
});

test('desktop CSP allows the JPEG 2000 worker to load OpenJPEG WASM', async () => {
    const tauriConfigPath = path.join(__dirname, '..', 'desktop', 'src-tauri', 'tauri.conf.json');
    const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));

    expect(tauriConfig.app.security.csp).toContain("worker-src 'self' 'wasm-unsafe-eval'");
    expect(tauriConfig.app.security.devCsp).toContain("worker-src 'self' 'wasm-unsafe-eval'");
});

// Regression: the cloud-sync PR removed read_scan_manifest and read_scan_header from the
// invoke_handler! macro in main.rs. The JS called these commands but received "Command not
// found", causing the scan to fall back to slow fs.readDir walks instead of using the native
// manifest path. Fix: both commands are re-added to the invoke handler.
test('Tauri invoke handler registers both scan commands inside generate_handler block', async () => {
    const mainRsPath = path.join(__dirname, '..', 'desktop', 'src-tauri', 'src', 'main.rs');
    const mainRsContent = fs.readFileSync(mainRsPath, 'utf8');

    // Extract the generate_handler! block to verify commands are inside it (not just anywhere in the file)
    const handlerBlockMatch = mainRsContent.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/);
    expect(handlerBlockMatch).not.toBeNull();

    const handlerBlock = handlerBlockMatch[1];
    expect(handlerBlock).toContain('scan::read_scan_manifest');
    expect(handlerBlock).toContain('decode::read_scan_header');
});

// Regression: the desktop scan falls back to slow fs.readDir when read_scan_manifest or
// read_scan_header throw "Command not found". Verify the scan pipeline exercises both
// commands through production code (loadStudiesFromDesktopPaths), not just direct invocation.
test('desktop scan uses read_scan_manifest and read_scan_header through production code path', async ({ page }) => {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        window.__scanCommandsCalled = { manifest: false, header: [] };
        window.__TAURI__ = {
            core: {
                async invoke(cmd, args) {
                    if (cmd === 'read_scan_manifest') {
                        window.__scanCommandsCalled.manifest = true;
                        return [
                            { path: '/library/IMG001.dcm', name: 'IMG001.dcm', rootPath: '/library', size: 100, modifiedMs: 1000 }
                        ];
                    }
                    if (cmd === 'read_scan_header') {
                        window.__scanCommandsCalled.header.push(args.path);
                        // Return a minimal byte array; the parser will reject it and fall through to full read
                        return new Uint8Array([0, 0, 0, 0]);
                    }
                    if (cmd === 'apply_desktop_migration') {
                        return window.__applyMockDesktopMigration(args.db, args.batch);
                    }
                    if (cmd === 'load_legacy_desktop_browser_stores') {
                        return [];
                    }
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                }
            },
            dialog: { async open() { return null; } },
            fs: {
                async exists() { return false; },
                async readDir() { return []; },
                async readFile() { return new Uint8Array([0]); },
                async writeFile() {},
                async mkdir() {},
                async remove() {},
                async stat() { throw new Error('Not found'); },
                async rename() {}
            },
            path: {
                async appDataDir() { return '/appdata'; },
                async join(...parts) { return parts.join('/').replace(/\/+/g, '/'); },
                async normalize(p) { return p; }
            },
            sql: window.__createMockTauriSql(),
            webview: {
                getCurrentWebview() {
                    return {
                        onDragDropEvent() { return Promise.resolve(() => {}); }
                    };
                }
            }
        };
    });

    await page.goto('http://127.0.0.1:5001/?nolib');
    await expect(page.locator('#libraryView')).toBeVisible();

    const result = await page.evaluate(async () => {
        // Run the actual production scan pipeline
        await window.DicomViewerApp.sources.loadStudiesFromDesktopPaths(['/library']);
        return {
            manifestCalled: window.__scanCommandsCalled.manifest,
            headerPaths: window.__scanCommandsCalled.header
        };
    });

    // read_scan_manifest must be called (not skipped / "Command not found")
    expect(result.manifestCalled).toBe(true);
    // read_scan_header must be called for the file in the manifest
    expect(result.headerPaths.length).toBeGreaterThan(0);
    expect(result.headerPaths).toContain('/library/IMG001.dcm');
});

// Regression: waitForDesktopRuntime() did a one-shot check for window.__TAURI__.sql.load
// and returned null immediately if it wasn't there yet. On cold start the SQL plugin is
// injected asynchronously, so getDesktopDb() would throw before the plugin was ready.
// Fix: waitForDesktopRuntime() now polls up to 5 seconds before giving up.
test('waitForDesktopRuntime polls until sql.load is available instead of failing immediately', async ({ page }) => {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        // Start with __TAURI__ present but sql missing — simulates cold-start race
        // where the Tauri SQL plugin hasn't been injected yet.
        window.__TAURI__ = {
            core: {
                async invoke(cmd, args) {
                    if (cmd === 'apply_desktop_migration') {
                        return window.__applyMockDesktopMigration(args.db, args.batch);
                    }
                    if (cmd === 'load_legacy_desktop_browser_stores') {
                        return [];
                    }
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                }
            },
            dialog: { async open() { return null; } },
            fs: {
                async exists() { return false; },
                async readDir() { return []; },
                async readFile() { return new Uint8Array([0]); },
                async writeFile() {},
                async mkdir() {},
                async remove() {},
                async stat() { throw new Error('Not found'); },
                async rename() {}
            },
            path: {
                async appDataDir() { return '/appdata'; },
                async join(...parts) { return parts.join('/').replace(/\/+/g, '/'); },
                async normalize(p) { return p; }
            },
            // sql is intentionally absent here — this is the race condition that caused the bug
            webview: {
                getCurrentWebview() {
                    return {
                        onDragDropEvent() { return Promise.resolve(() => {}); }
                    };
                }
            }
        };

        // Inject sql after a short delay to simulate the plugin arriving asynchronously.
        setTimeout(() => {
            window.__TAURI__.sql = window.__createMockTauriSql();
        }, 200);
    });

    await page.goto('http://127.0.0.1:5001/?nolib');
    await expect(page.locator('#libraryView')).toBeVisible();

    const result = await page.evaluate(async () => {
        // Before the fix, getDesktopDb() would throw immediately because sql.load was absent
        // at call time. The fix polls for up to 5 seconds, so injecting sql after 200ms works.
        let dbError = null;
        let dbSuccess = false;
        try {
            // initializeDesktopStorage wraps initializeDesktopPersistence, which calls
            // waitForDesktopRuntime internally. If the polling fix is absent, this throws.
            await window.NotesAPI.initializeDesktopStorage();
            dbSuccess = true;
        } catch (error) {
            dbError = error.message;
        }

        return {
            sqlLoadPresent: typeof window.__TAURI__?.sql?.load === 'function',
            dbSuccess,
            dbError
        };
    });

    expect(result.sqlLoadPresent).toBe(true);
    // If the bug is present, dbError would be 'Desktop SQL runtime is not ready...'
    // because the one-shot check found sql absent and returned null.
    expect(result.dbError).toBeNull();
    expect(result.dbSuccess).toBe(true);
});

test('waitForDesktopRuntime throws a descriptive error when sql never becomes available', async ({ page }) => {
    // This test triggers the 5-second polling timeout inside waitForDesktopRuntime.
    test.setTimeout(20000);
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(() => {
        // __TAURI__ present but sql never injected — simulates a permanent failure such as
        // a plugin crash or missing build artifact that prevents sql from loading.
        window.__TAURI__ = {
            core: {
                async invoke(cmd, args) {
                    if (cmd === 'apply_desktop_migration') {
                        return window.__applyMockDesktopMigration(args.db, args.batch);
                    }
                    if (cmd === 'load_legacy_desktop_browser_stores') {
                        return [];
                    }
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                }
            },
            dialog: { async open() { return null; } },
            fs: {
                async exists() { return false; },
                async readDir() { return []; },
                async readFile() { return new Uint8Array([0]); },
                async writeFile() {},
                async mkdir() {},
                async remove() {},
                async stat() { throw new Error('Not found'); },
                async rename() {}
            },
            path: {
                async appDataDir() { return '/appdata'; },
                async join(...parts) { return parts.join('/').replace(/\/+/g, '/'); },
                async normalize(p) { return p; }
            }
            // sql is permanently absent — no setTimeout injection
        };

        // Pre-resolve the storage ready promise with null to bypass the 30-second
        // tauri-compat.js polling loop. This isolates the test to waitForDesktopRuntime's
        // own 5-second deadline, which is the behavior under test.
        window.__DICOM_VIEWER_TAURI_STORAGE_READY__ = Promise.resolve(null);
    });

    await page.goto('http://127.0.0.1:5001/?nolib');
    await expect(page.locator('#libraryView')).toBeVisible();

    const result = await page.evaluate(async () => {
        // Pre-resolve the ready promise again in case tauri-compat.js reset it during page load.
        // This ensures waitForDesktopRuntime falls through immediately to its own polling loop.
        window.__DICOM_VIEWER_TAURI_STORAGE_READY__ = Promise.resolve(null);

        let dbError = null;
        const startedAt = performance.now();
        try {
            await window._NotesDesktop.getDesktopDb();
        } catch (error) {
            dbError = error.message;
        }
        const elapsedMs = performance.now() - startedAt;

        return { dbError, elapsedMs };
    });

    // The error must contain the actionable "not ready" message — not a cryptic JS error.
    expect(result.dbError).not.toBeNull();
    expect(result.dbError).toContain('Desktop SQL runtime is not ready');
    // The polling fix means getDesktopDb now waits at least 5 seconds before throwing,
    // rather than failing immediately on the first check (the regression behavior).
    expect(result.elapsedMs).toBeGreaterThan(4000);
});

test('desktop fs scope includes the native decode cache directory', async () => {
    const capabilityPath = path.join(__dirname, '..', 'desktop', 'src-tauri', 'capabilities', 'default.json');
    const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
    const fsScope = capability.permissions.find(
        permission => permission && typeof permission === 'object' && permission.identifier === 'fs:scope'
    );

    // NEW: fs:scope uses $APPDATA and $APPDATA/** which covers decode-cache
    expect(fsScope?.allow).toEqual(expect.arrayContaining([
        { path: '$APPDATA' },
        { path: '$APPDATA/**' }
    ]));
});
