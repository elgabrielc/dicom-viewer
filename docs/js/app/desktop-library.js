(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    const DesktopLibrary = {
        CONFIG_KEY: 'dicom-viewer-library-config',
        SCAN_TIMING_KEY: 'dicom-viewer-debug-scan-timing',

        getRuntime() {
            const tauri = window.__TAURI__;
            if (!tauri?.dialog?.open || !tauri?.fs?.readDir || !tauri?.path?.join) {
                throw new Error('Desktop runtime is not ready. Quit and reopen the app if this persists.');
            }
            return tauri;
        },

        getConfig() {
            try {
                const saved = localStorage.getItem(this.CONFIG_KEY);
                if (!saved) {
                    return { folder: null, lastScan: null };
                }

                const parsed = JSON.parse(saved);
                return {
                    folder: typeof parsed?.folder === 'string' && parsed.folder ? parsed.folder : null,
                    lastScan: typeof parsed?.lastScan === 'string' && parsed.lastScan ? parsed.lastScan : null
                };
            } catch (e) {
                console.warn('DesktopLibrary: failed to load config:', e);
                return { folder: null, lastScan: null };
            }
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

        saveConfig(config) {
            localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
            return config;
        },

        setFolder(path) {
            const config = this.getConfig();
            const nextFolder = path || null;
            if (config.folder !== nextFolder) {
                config.lastScan = null;
            }
            config.folder = nextFolder;
            if (!nextFolder) {
                config.lastScan = null;
            }
            return this.saveConfig(config);
        },

        scanFolder(folderPath) {
            this.getRuntime();
            return app.sources.collectPathSources(folderPath);
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

            return studies;
        },

        markScanComplete(folderPath) {
            const config = this.getConfig();
            config.folder = folderPath || config.folder || null;
            config.lastScan = new Date().toISOString();
            return this.saveConfig(config);
        },

        markScanFailed(folderPath) {
            const config = this.getConfig();
            config.folder = folderPath || config.folder || null;
            config.lastScan = null;
            return this.saveConfig(config);
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
            this.setFolder(folder);
            return folder;
        }
    };

    app.desktopLibrary = DesktopLibrary;
})();
