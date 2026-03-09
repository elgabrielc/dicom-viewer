(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    function normalizeBinaryResponse(bytes) {
        if (bytes instanceof Uint8Array) {
            return bytes;
        }
        if (bytes instanceof ArrayBuffer) {
            return new Uint8Array(bytes);
        }
        return Uint8Array.from(bytes || []);
    }

    const DesktopDecode = {
        getRuntime() {
            const tauri = window.__TAURI__;
            if (typeof tauri?.core?.invoke !== 'function') {
                throw new Error('Desktop decode runtime is not ready. Quit and reopen the app if this persists.');
            }
            return tauri;
        },

        decodeFrame(path, frameIndex = 0) {
            return this.getRuntime().core.invoke('decode_frame', { path, frameIndex });
        },

        async takeDecodedFrame(decodeId) {
            const bytes = await this.getRuntime().core.invoke('take_decoded_frame', { decodeId });
            return normalizeBinaryResponse(bytes);
        },

        async decodeFrameWithPixels(path, frameIndex = 0) {
            const metadata = await this.decodeFrame(path, frameIndex);
            const pixelData = await this.takeDecodedFrame(metadata.decodeId);
            return {
                ...metadata,
                pixelData
            };
        }
    };

    app.desktopDecode = DesktopDecode;
})();
