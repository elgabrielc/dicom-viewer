(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    const DesktopLibrary = {
        CONFIG_KEY: 'dicom-viewer-library-config',

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
