(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    const DesktopLibrary = {
        CONFIG_KEY: 'dicom-viewer-library-config',

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
            config.folder = path || null;
            if (!path) {
                config.lastScan = null;
            }
            return this.saveConfig(config);
        },

        scanFolder(folderPath) {
            return app.sources.collectPathSources(folderPath);
        },

        markScanComplete(folderPath) {
            const config = this.getConfig();
            config.folder = folderPath || config.folder || null;
            config.lastScan = new Date().toISOString();
            return this.saveConfig(config);
        },

        async pickAndSetFolder() {
            const selected = await window.__TAURI__.dialog.open({
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
