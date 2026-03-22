(() => {
    if (typeof window === 'undefined') return;

    const APP_DATA_DIRECTORY = 14;
    const DRAG_EVENTS = {
        enter: 'tauri://drag-enter',
        over: 'tauri://drag-over',
        drop: 'tauri://drag-drop',
        leave: 'tauri://drag-leave'
    };
    const MAX_ATTEMPTS = 1200;
    const RETRY_DELAY_MS = 25;

    function getInternals() {
        const internals = window.__TAURI_INTERNALS__;
        return internals?.invoke ? internals : null;
    }

    function installCompatFromInternals(internals) {
        if (window.__TAURI__ || !internals?.invoke) {
            return window.__TAURI__ || null;
        }

        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};

        function invoke(cmd, args, options) {
            return internals.invoke(cmd, args, options);
        }

        function transformCallback(callback, once = false) {
            return internals.transformCallback(callback, once);
        }

        function unregisterListener(event, eventId) {
            if (window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener) {
                window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
                return;
            }
            if (typeof internals.unregisterCallback === 'function') {
                internals.unregisterCallback(eventId);
            }
        }

        async function listen(event, handler, options = {}) {
            const target = typeof options.target === 'string'
                ? { kind: 'AnyLabel', label: options.target }
                : (options.target || { kind: 'Any' });

            const eventId = await invoke('plugin:event|listen', {
                event,
                target,
                handler: transformCallback(handler)
            });

            return async () => {
                unregisterListener(event, eventId);
                await invoke('plugin:event|unlisten', { event, eventId });
            };
        }

        function getCurrentWebviewLabel() {
            return internals.metadata?.currentWebview?.label
                || internals.metadata?.currentWindow?.label
                || 'main';
        }

        function createCurrentWebview() {
            const label = getCurrentWebviewLabel();
            return {
                async onDragDropEvent(handler) {
                    const target = { kind: 'Webview', label };
                    const unlistenEnter = await listen(DRAG_EVENTS.enter, (event) => {
                        handler({
                            ...event,
                            payload: {
                                type: 'enter',
                                paths: event.payload?.paths,
                                position: event.payload?.position
                            }
                        });
                    }, { target });
                    const unlistenOver = await listen(DRAG_EVENTS.over, (event) => {
                        handler({
                            ...event,
                            payload: {
                                type: 'over',
                                position: event.payload?.position
                            }
                        });
                    }, { target });
                    const unlistenDrop = await listen(DRAG_EVENTS.drop, (event) => {
                        handler({
                            ...event,
                            payload: {
                                type: 'drop',
                                paths: event.payload?.paths,
                                position: event.payload?.position
                            }
                        });
                    }, { target });
                    const unlistenLeave = await listen(DRAG_EVENTS.leave, (event) => {
                        handler({
                            ...event,
                            payload: { type: 'leave' }
                        });
                    }, { target });

                    return async () => {
                        await Promise.all([
                            unlistenEnter(),
                            unlistenOver(),
                            unlistenDrop(),
                            unlistenLeave()
                        ]);
                    };
                }
            };
        }

        async function readFile(path, options) {
            const bytes = await invoke('plugin:fs|read_file', { path, options });
            return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
        }

        async function stat(path, options) {
            const info = await invoke('plugin:fs|stat', { path, options });
            return {
                ...info,
                mtime: info?.mtime !== null && info?.mtime !== undefined ? new Date(info.mtime) : null,
                atime: info?.atime !== null && info?.atime !== undefined ? new Date(info.atime) : null,
                birthtime: info?.birthtime !== null && info?.birthtime !== undefined ? new Date(info.birthtime) : null
            };
        }

        async function writeFile(path, data, options) {
            await invoke('plugin:fs|write_file', data, {
                headers: {
                    path: encodeURIComponent(path),
                    options: JSON.stringify(options)
                }
            });
        }

        async function rename(fromPath, toPath, options) {
            return invoke('plugin:fs|rename', {
                fromPath,
                toPath,
                options
            });
        }

        function createSqlConnection(db) {
            return {
                async execute(query, values = []) {
                    const result = await invoke('plugin:sql|execute', {
                        db,
                        query,
                        values
                    });
                    if (Array.isArray(result)) {
                        return {
                            rowsAffected: result[0],
                            lastInsertId: result[1]
                        };
                    }
                    return result;
                },
                async select(query, values = []) {
                    return invoke('plugin:sql|select', {
                        db,
                        query,
                        values
                    });
                },
                async close() {
                    return invoke('plugin:sql|close', { db });
                }
            };
        }

        window.__TAURI__ = {
            core: {
                convertFileSrc(filePath, protocol) {
                    return internals.convertFileSrc(filePath, protocol);
                },
                invoke(command, args, options) {
                    return invoke(command, args, options);
                }
            },
            dialog: {
                async open(options = {}) {
                    if (typeof options === 'object') {
                        Object.freeze(options);
                    }
                    return invoke('plugin:dialog|open', { options });
                }
            },
            event: {
                listen
            },
            fs: {
                async exists(path, options) {
                    return invoke('plugin:fs|exists', { path, options });
                },
                async mkdir(path, options) {
                    return invoke('plugin:fs|mkdir', { path, options });
                },
                async readDir(path, options) {
                    return invoke('plugin:fs|read_dir', { path, options });
                },
                readFile,
                async remove(path, options) {
                    return invoke('plugin:fs|remove', { path, options });
                },
                rename,
                stat,
                writeFile
            },
            path: {
                async appDataDir() {
                    return invoke('plugin:path|resolve_directory', {
                        directory: APP_DATA_DIRECTORY
                    });
                },
                async join(...paths) {
                    return invoke('plugin:path|join', { paths });
                },
                async normalize(path) {
                    return invoke('plugin:path|normalize', { path });
                }
            },
            sql: {
                async load(db) {
                    await invoke('plugin:sql|load', { db });
                    return createSqlConnection(db);
                }
            },
            webview: {
                getCurrentWebview: createCurrentWebview
            }
        };

        return window.__TAURI__;
    }

    function resolveDesktopRuntime() {
        if (window.__TAURI__) return window.__TAURI__;
        return installCompatFromInternals(getInternals());
    }

    window.__DICOM_VIEWER_TAURI_READY__ = window.__DICOM_VIEWER_TAURI_READY__ || new Promise(resolve => {
        let attempts = 0;

        function finish(runtime) {
            resolve(runtime || null);
        }

        function tick() {
            const runtime = resolveDesktopRuntime();
            if (runtime) {
                finish(runtime);
                return;
            }

            if (attempts >= MAX_ATTEMPTS) {
                finish(null);
                return;
            }

            attempts += 1;
            setTimeout(tick, RETRY_DELAY_MS);
        }

        tick();
    });

    resolveDesktopRuntime();
})();
