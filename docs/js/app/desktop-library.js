(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const notesApi = window.NotesAPI;
    const LEGACY_LIBRARY_CONFIG_KEY = 'dicom-viewer-library-config';

    function normalizeDesktopConfig(config) {
        return {
            folder: typeof config?.folder === 'string' && config.folder ? config.folder : null,
            lastScan: typeof config?.lastScan === 'string' && config.lastScan ? config.lastScan : null
        };
    }

    function loadLegacyDesktopConfig() {
        try {
            const raw = localStorage.getItem(LEGACY_LIBRARY_CONFIG_KEY);
            return normalizeDesktopConfig(raw ? JSON.parse(raw) : null);
        } catch {
            return normalizeDesktopConfig(null);
        }
    }

    function saveLegacyDesktopConfig(config) {
        try {
            localStorage.setItem(LEGACY_LIBRARY_CONFIG_KEY, JSON.stringify(normalizeDesktopConfig(config)));
        } catch {}
    }

    const DesktopLibrary = {
        SCAN_TIMING_KEY: 'dicom-viewer-debug-scan-timing',
        SNAPSHOT_VERSION: 1,
        SNAPSHOT_FILENAME: 'desktop-library-cache.json',

        getRuntime() {
            const tauri = window.__TAURI__;
            if (!tauri?.dialog?.open || !tauri?.fs?.readDir || !tauri?.path?.join) {
                throw new Error('Desktop runtime is not ready. Quit and reopen the app if this persists.');
            }
            return tauri;
        },

        async getConfig() {
            let nativeConfig = null;
            try {
                nativeConfig = normalizeDesktopConfig(await notesApi.loadDesktopLibraryConfig());
                if (nativeConfig.folder || nativeConfig.lastScan) {
                    saveLegacyDesktopConfig(nativeConfig);
                    return nativeConfig;
                }
            } catch (e) {
                console.warn('DesktopLibrary: failed to load config:', e);
            }

            const legacyConfig = loadLegacyDesktopConfig();
            if (legacyConfig.folder || legacyConfig.lastScan) {
                try {
                    await notesApi.saveDesktopLibraryConfig(legacyConfig);
                } catch (error) {
                    console.warn('DesktopLibrary: failed to repair native config from local fallback:', error);
                }
                return legacyConfig;
            }

            return nativeConfig || { folder: null, lastScan: null };
        },

        isScanTimingEnabled() {
            try {
                const queryValue = new URLSearchParams(window.location.search).get('scanTiming');
                if (queryValue !== null) {
                    return !['0', 'false', 'off', 'no'].includes(queryValue.toLowerCase());
                }
            } catch {}

            try {
                const saved = localStorage.getItem(this.SCAN_TIMING_KEY);
                return saved === '1' || saved === 'true';
            } catch {
                return false;
            }
        },

        async saveConfig(config) {
            const normalized = normalizeDesktopConfig(config);
            saveLegacyDesktopConfig(normalized);
            try {
                return normalizeDesktopConfig(await notesApi.saveDesktopLibraryConfig(normalized));
            } catch (error) {
                console.warn('DesktopLibrary: failed to save native config, keeping local fallback:', error);
                return normalized;
            }
        },

        async setFolder(path) {
            const config = await this.getConfig();
            const nextFolder = path || null;
            if (config.folder !== nextFolder) {
                config.lastScan = null;
            }
            config.folder = nextFolder;
            if (!nextFolder) {
                config.lastScan = null;
            }
            return await this.saveConfig(config);
        },

        scanFolder(folderPath) {
            this.getRuntime();
            return app.sources.collectPathSources(folderPath);
        },

        async getSnapshotPath() {
            const tauri = this.getRuntime();
            const appDataPath = await tauri.path.appDataDir();
            return await tauri.path.join(appDataPath, this.SNAPSHOT_FILENAME);
        },

        async loadCachedStudies(folderPath) {
            if (!folderPath) {
                return null;
            }

            const tauri = this.getRuntime();
            const snapshotPath = await this.getSnapshotPath();
            let bytes;
            try {
                bytes = await tauri.fs.readFile(snapshotPath);
            } catch {
                return null;
            }

            try {
                const text = new TextDecoder().decode(bytes);
                const payload = JSON.parse(text);
                if (payload?.version !== this.SNAPSHOT_VERSION) {
                    return null;
                }
                if (payload?.folder !== folderPath) {
                    return null;
                }
                if (!payload?.studies || typeof payload.studies !== 'object') {
                    return null;
                }
                return payload.studies;
            } catch (error) {
                console.warn('DesktopLibrary: failed to read cached library snapshot:', error);
                return null;
            }
        },

        async saveCachedStudies(folderPath, studies) {
            if (!folderPath) {
                return;
            }

            const tauri = this.getRuntime();
            const snapshotPath = await this.getSnapshotPath();
            const payload = {
                version: this.SNAPSHOT_VERSION,
                folder: folderPath,
                savedAt: new Date().toISOString(),
                studies: studies || {}
            };
            const bytes = new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
            await tauri.fs.writeFile(snapshotPath, bytes);
        },

        async writeScanTimingReport(report) {
            const tauri = this.getRuntime();
            const appDataPath = await tauri.path.appDataDir();
            const reportsDir = await tauri.path.join(appDataPath, 'reports');
            await tauri.fs.mkdir(reportsDir, { recursive: true });

            const filePath = await tauri.path.join(reportsDir, 'scan-timing.json');
            const bytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
            await tauri.fs.writeFile(filePath, bytes);
        },

        async loadStudies(folderPath, options = {}) {
            this.getRuntime();

            const { onProgress, ...restOptions } = options;
            const captureTiming = this.isScanTimingEnabled();
            let lastProgress = null;
            const startedAt = captureTiming ? performance.now() : 0;
            const studies = await app.sources.loadStudiesFromDesktopPaths([folderPath], {
                ...restOptions,
                captureTiming,
                onProgress: (stats) => {
                    if (captureTiming) {
                        lastProgress = stats;
                    }
                    if (typeof onProgress === 'function') {
                        onProgress(stats);
                    }
                }
            });

            if (captureTiming && lastProgress) {
                const report = {
                    totalMs: Math.round(performance.now() - startedAt),
                    readDirMs: Math.round(lastProgress.readDirMs || 0),
                    readFileMs: Math.round(lastProgress.readFileMs || 0),
                    headerReadMs: Math.round(lastProgress.headerReadMs || 0),
                    fullReadMs: Math.round(lastProgress.fullReadMs || 0),
                    parseMs: Math.round(lastProgress.parseMs || 0),
                    finalizeMs: Math.round(lastProgress.finalizeMs || 0),
                    headerReadCount: lastProgress.headerReadCount || 0,
                    headerHitCount: lastProgress.headerHitCount || 0,
                    headerShortCount: lastProgress.headerShortCount || 0,
                    headerFallbackCount: lastProgress.headerFallbackCount || 0,
                    headerRejectedCount: lastProgress.headerRejectedCount || 0,
                    discovered: lastProgress.discovered || 0,
                    valid: lastProgress.valid || 0
                };

                try {
                    await this.writeScanTimingReport(report);
                } catch (error) {
                    console.warn('DesktopLibrary: failed to write scan timing report:', error);
                }
            }

            try {
                await this.saveCachedStudies(folderPath, studies);
            } catch (error) {
                console.warn('DesktopLibrary: failed to save cached library snapshot:', error);
            }

            return studies;
        },

        async markScanComplete(folderPath) {
            const config = await this.getConfig();
            config.folder = folderPath || config.folder || null;
            config.lastScan = new Date().toISOString();
            return await this.saveConfig(config);
        },

        async markScanFailed(folderPath) {
            const config = await this.getConfig();
            config.folder = folderPath || config.folder || null;
            config.lastScan = null;
            return await this.saveConfig(config);
        },

        async pickAndSetFolder() {
            const tauri = this.getRuntime();
            const selected = await tauri.dialog.open({
                directory: true,
                recursive: true,
                title: 'Choose DICOM Library Folder'
            });
            const folder = Array.isArray(selected) ? selected[0] : selected;
            if (!folder) return null;
            await this.setFolder(folder);
            return folder;
        }
    };

    app.desktopLibrary = DesktopLibrary;
})();
