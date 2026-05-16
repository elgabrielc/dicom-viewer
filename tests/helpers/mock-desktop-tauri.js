// Copyright (c) 2026 Divergent Health Technologies
//
// Shared Node-side installer for the browser-side mock Tauri desktop runtime.
// The harness owns desktop plumbing; specs still own domain fixtures.
const path = require('node:path');

const MOCK_SQL_INIT_PATH = path.join(__dirname, '..', 'mock-tauri-sql-init.js');

const READY_PROMISE_NAMES = Object.freeze(['__DICOM_VIEWER_TAURI_STORAGE_READY__', '__DICOM_VIEWER_TAURI_READY__']);

async function installMockDesktopTauri(page, options = {}) {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript(
        ({ options, readyPromiseNames }) => {
            const FILE_STORAGE_PREFIX = 'mock-tauri-fs:';
            const SECURE_AUTH_STORAGE_KEY = 'mock-tauri-secure-auth-state';
            const fsOptions = options.fs || {};
            const invokeOptions = options.invoke || {};
            const sqlOptions = options.sql || {};
            const appDataDir = options.appDataDir || '/mock/appdata';
            const failRemoveAll = !!fsOptions.failRemoveAll;
            const failWritePatterns = Array.isArray(fsOptions.failWritePatterns) ? fsOptions.failWritePatterns : [];
            const failRemovePatterns = Array.isArray(fsOptions.failRemovePatterns) ? fsOptions.failRemovePatterns : [];
            const readDirEntries =
                fsOptions.readDirEntries && typeof fsOptions.readDirEntries === 'object'
                    ? fsOptions.readDirEntries
                    : {};
            const seedFiles = fsOptions.files && typeof fsOptions.files === 'object' ? fsOptions.files : {};
            const seedDirectories = Array.isArray(fsOptions.directories) ? fsOptions.directories : [];
            const selectDelayMs = Number.isFinite(Number(sqlOptions.selectDelayMs))
                ? Number(sqlOptions.selectDelayMs)
                : 0;
            const selectDelayPatterns = Array.isArray(sqlOptions.selectDelayPatterns)
                ? sqlOptions.selectDelayPatterns.map((pattern) => String(pattern).toLowerCase())
                : [];
            const tauriSqlOptions = {
                initialState: sqlOptions.initialState || {},
                sqlLoadError: sqlOptions.loadError || sqlOptions.sqlLoadError || null,
            };

            function joinPaths(...parts) {
                const cleaned = parts
                    .filter((part) => part !== null && part !== undefined && part !== '')
                    .map((part, index) => {
                        const text = String(part).replace(/\\/g, '/');
                        if (index === 0) {
                            return text.replace(/\/+$/g, '') || '/';
                        }
                        return text.replace(/^\/+/g, '').replace(/\/+$/g, '');
                    })
                    .filter(Boolean);

                if (!cleaned.length) return '';
                const joined = cleaned.join('/').replace(/\/+/g, '/');
                return joined.startsWith('/') ? joined : `/${joined}`;
            }

            function makeMissingFileError(filePath) {
                return `No such file or directory: ${filePath}`;
            }

            function serializeBytes(bytes) {
                if (typeof bytes === 'string') {
                    return JSON.stringify(Array.from(new TextEncoder().encode(bytes)));
                }
                return JSON.stringify(Array.from(bytes || []));
            }

            function seedFile(filePath, bytes) {
                localStorage.setItem(`${FILE_STORAGE_PREFIX}${filePath}`, serializeBytes(bytes));
            }

            window.__mockDesktopTauriState = {
                files: seedFiles,
                reads: [],
                writes: [],
                invokeCalls: [],
                mkdirCalls: [],
                removeCalls: [],
                renameCalls: [],
                secureAuthState: options.secureAuthState || null,
            };

            window.__mockDesktopTauriDirectories = new Set(seedDirectories.map((dir) => joinPaths(dir)));
            for (const [filePath, bytes] of Object.entries(seedFiles)) {
                seedFile(filePath, bytes);
            }

            if (options.secureAuthState) {
                localStorage.setItem(SECURE_AUTH_STORAGE_KEY, JSON.stringify(options.secureAuthState));
            }

            const sqlPlugin = window.__createMockTauriSql(tauriSqlOptions);
            if (selectDelayMs > 0) {
                const originalLoad = sqlPlugin.load.bind(sqlPlugin);
                sqlPlugin.load = async (db) => {
                    const connection = await originalLoad(db);
                    const originalSelect = connection.select.bind(connection);
                    connection.select = async (query, values) => {
                        const normalizedQuery = String(query || '').toLowerCase();
                        const shouldDelay =
                            !selectDelayPatterns.length ||
                            selectDelayPatterns.some((pattern) => normalizedQuery.includes(pattern));

                        if (shouldDelay) {
                            await new Promise((resolve) => setTimeout(resolve, selectDelayMs));
                        }

                        return originalSelect(query, values);
                    };
                    return connection;
                };
            }

            window.__TAURI__ = {
                core: {
                    convertFileSrc(filePath) {
                        return `asset://local/${encodeURIComponent(filePath)}`;
                    },
                    async invoke(cmd, args = {}) {
                        window.__mockDesktopTauriState.invokeCalls.push({ cmd, args });
                        if (cmd === 'apply_desktop_migration') {
                            return window.__applyMockDesktopMigration(args.db, args.batch, tauriSqlOptions);
                        }
                        if (cmd === 'load_legacy_desktop_browser_stores') {
                            return invokeOptions.legacyDesktopStores || [];
                        }
                        if (cmd === 'load_secure_auth_state') {
                            const raw = localStorage.getItem(SECURE_AUTH_STORAGE_KEY);
                            return raw
                                ? JSON.parse(raw)
                                : {
                                      access_token: null,
                                      refresh_token: null,
                                      user_email: null,
                                      user_name: null,
                                  };
                        }
                        if (cmd === 'store_secure_auth_state') {
                            const nextState = args.state || {};
                            localStorage.setItem(SECURE_AUTH_STORAGE_KEY, JSON.stringify(nextState));
                            window.__mockDesktopTauriState.secureAuthState = nextState;
                            return true;
                        }
                        if (cmd === 'clear_secure_auth_state') {
                            localStorage.removeItem(SECURE_AUTH_STORAGE_KEY);
                            window.__mockDesktopTauriState.secureAuthState = null;
                            return true;
                        }
                        throw new Error(`Unhandled core invoke: ${cmd}`);
                    },
                },
                fs: {
                    async exists(filePath) {
                        return (
                            localStorage.getItem(`${FILE_STORAGE_PREFIX}${filePath}`) !== null ||
                            window.__mockDesktopTauriDirectories.has(joinPaths(filePath)) ||
                            Object.hasOwn(readDirEntries, filePath)
                        );
                    },
                    async readFile(filePath) {
                        window.__mockDesktopTauriState.reads.push(filePath);
                        const raw = localStorage.getItem(`${FILE_STORAGE_PREFIX}${filePath}`);
                        if (raw === null) {
                            throw makeMissingFileError(filePath);
                        }
                        return Uint8Array.from(JSON.parse(raw));
                    },
                    async readDir(dirPath) {
                        return readDirEntries[dirPath] || [];
                    },
                    async stat(filePath) {
                        const raw = localStorage.getItem(`${FILE_STORAGE_PREFIX}${filePath}`);
                        const isFile = raw !== null;
                        const isDirectory =
                            window.__mockDesktopTauriDirectories.has(joinPaths(filePath)) ||
                            Object.hasOwn(readDirEntries, filePath);
                        if (!isFile && !isDirectory) {
                            throw makeMissingFileError(filePath);
                        }
                        return {
                            isFile,
                            isDirectory,
                            isSymlink: false,
                            size: isFile ? JSON.parse(raw).length : 0,
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
                            blocks: null,
                        };
                    },
                    async mkdir(dirPath, options = {}) {
                        const normalized = joinPaths(dirPath);
                        window.__mockDesktopTauriState.mkdirCalls.push({ dirPath: normalized, options });
                        window.__mockDesktopTauriDirectories.add(normalized);
                        return undefined;
                    },
                    async remove(filePath) {
                        window.__mockDesktopTauriState.removeCalls.push(filePath);
                        if (
                            failRemoveAll ||
                            failRemovePatterns.some((pattern) => String(filePath).includes(String(pattern)))
                        ) {
                            throw new Error(`Mock remove failure for ${filePath}`);
                        }
                        localStorage.removeItem(`${FILE_STORAGE_PREFIX}${filePath}`);
                    },
                    async rename(fromPath, toPath) {
                        window.__mockDesktopTauriState.renameCalls.push({ fromPath, toPath });
                        const raw = localStorage.getItem(`${FILE_STORAGE_PREFIX}${fromPath}`);
                        if (raw === null) {
                            throw makeMissingFileError(fromPath);
                        }
                        localStorage.setItem(`${FILE_STORAGE_PREFIX}${toPath}`, raw);
                        localStorage.removeItem(`${FILE_STORAGE_PREFIX}${fromPath}`);
                    },
                    async writeFile(filePath, bytes) {
                        window.__mockDesktopTauriState.writes.push({ filePath, byteLength: bytes?.length || 0 });
                        if (failWritePatterns.some((pattern) => String(filePath).includes(String(pattern)))) {
                            throw new Error(`Mock write failure for ${filePath}`);
                        }
                        localStorage.setItem(`${FILE_STORAGE_PREFIX}${filePath}`, serializeBytes(bytes));
                    },
                },
                path: {
                    async appDataDir() {
                        return appDataDir;
                    },
                    async join(...parts) {
                        return joinPaths(...parts);
                    },
                    async normalize(filePath) {
                        return joinPaths(filePath);
                    },
                },
                sql: sqlPlugin,
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

            for (const name of readyPromiseNames) {
                window[name] = Promise.resolve(window.__TAURI__);
            }

            window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
                unregisterListener() {},
            };
        },
        { options, readyPromiseNames: READY_PROMISE_NAMES },
    );
}

async function gotoMockDesktopPage(page) {
    await page.route('http://mock.local/blank', async (route) => {
        await route.fulfill({
            contentType: 'text/html',
            body: '<html><body>mock</body></html>',
        });
    });
    await page.goto('http://mock.local/blank');
}

module.exports = {
    READY_PROMISE_NAMES,
    gotoMockDesktopPage,
    installMockDesktopTauri,
};
