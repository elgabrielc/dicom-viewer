// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'http://127.0.0.1:5001/';

async function installMockTauriInternals(page) {
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
        hasDialogApi: typeof window.__TAURI__?.dialog?.open === 'function',
        hasFsApi: typeof window.__TAURI__?.fs?.readDir === 'function',
        libraryConfigVisible: getComputedStyle(document.getElementById('libraryFolderConfig')).display !== 'none'
    }));

    expect(result.deploymentMode).toBe('desktop');
    expect(result.hasGlobalTauri).toBe(true);
    expect(result.hasDialogApi).toBe(true);
    expect(result.hasFsApi).toBe(true);
    expect(result.libraryConfigVisible).toBe(true);
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
            hasDialogApi: typeof runtime?.dialog?.open === 'function',
            hasFsApi: typeof runtime?.fs?.readDir === 'function'
        };
    });

    expect(result.hasReadyPromise).toBe(true);
    expect(result.hasGlobalTauri).toBe(true);
    expect(result.hasDialogApi).toBe(true);
    expect(result.hasFsApi).toBe(true);
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
