/**
 * NotesAPI Dispatcher - Public API that routes to the appropriate backend
 *
 * Assembles window.NotesAPI from the LocalBackend, ServerBackend, and
 * DesktopBackend modules. Must be loaded last in the persistence package.
 *
 * Depends on:
 *   window._NotesInternals (local.js)
 *   window._NotesServer    (server.js)
 *   window._NotesDesktop   (desktop.js)
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const NotesAPI = (() => {
    const { LocalBackend } = window._NotesInternals;
    const { ServerBackend, authenticatedFetch } = window._NotesServer;
    const { DesktopBackend } = window._NotesDesktop;

    // ---- Dispatcher ----
    function getBackend() {
        const mode = (typeof CONFIG !== 'undefined') ? CONFIG.deploymentMode : 'personal';
        if (mode === 'desktop') return 'desktop';
        const hasServer = (typeof CONFIG !== 'undefined' && CONFIG.features)
            ? CONFIG.features.notesServer
            : mode === 'personal' || mode === 'cloud';
        if (hasServer) return 'server';
        return 'local';
    }

    function isEnabled() {
        if (typeof CONFIG !== 'undefined' && CONFIG.shouldPersistNotes) {
            return CONFIG.shouldPersistNotes();
        }
        return true;
    }

    async function withFallback(serverCall, localCall, desktopCall = localCall) {
        const backend = getBackend();
        if (backend === 'desktop') {
            return await desktopCall();
        }
        if (backend === 'local') {
            return await localCall();
        }

        const result = await serverCall();
        // Only fall back to localStorage when the server became unreachable
        // (network error that triggered disableServer). Application-level
        // errors (4xx, 5xx) should surface as failures, not be silently
        // absorbed by the local backend -- that would create divergent data.
        if ((result === null || result === false) && !window._NotesServer.serverAvailable) {
            return await localCall();
        }
        return result;
    }

    async function loadNotes(studyUids) {
        if (!isEnabled()) return { studies: {} };
        return await withFallback(
            () => ServerBackend.loadNotes(studyUids),
            () => LocalBackend.loadNotes(studyUids)
        );
    }

    async function saveStudyDescription(studyUid, description) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.saveStudyDescription(studyUid, description),
            () => LocalBackend.saveStudyDescription(studyUid, description)
        );
    }

    async function saveSeriesDescription(studyUid, seriesUid, description) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.saveSeriesDescription(studyUid, seriesUid, description),
            () => LocalBackend.saveSeriesDescription(studyUid, seriesUid, description)
        );
    }

    async function addComment(studyUid, payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.addComment(studyUid, payload),
            () => LocalBackend.addComment(studyUid, payload)
        );
    }

    async function updateComment(studyUid, commentId, payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.updateComment(studyUid, commentId, payload),
            () => LocalBackend.updateComment(studyUid, commentId, payload)
        );
    }

    async function deleteComment(studyUid, commentId) {
        if (!isEnabled()) return false;
        return await withFallback(
            () => ServerBackend.deleteComment(studyUid, commentId),
            () => LocalBackend.deleteComment(studyUid, commentId)
        );
    }

    async function uploadReport(studyUid, file, meta) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.uploadReport(studyUid, file, meta),
            () => LocalBackend.uploadReport(studyUid, file, meta),
            () => DesktopBackend.uploadReport(studyUid, file, meta)
        );
    }

    async function deleteReport(studyUid, reportId) {
        if (!isEnabled()) return false;
        return await withFallback(
            () => ServerBackend.deleteReport(studyUid, reportId),
            () => LocalBackend.deleteReport(studyUid, reportId),
            () => DesktopBackend.deleteReport(studyUid, reportId)
        );
    }

    async function migrate(payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.migrate(payload),
            () => LocalBackend.migrate(payload)
        );
    }

    function getReportFileUrl(reportId) {
        if (!isEnabled()) return '';
        const backend = getBackend();
        if (backend === 'server') {
            return ServerBackend.getReportFileUrl(reportId);
        }
        if (backend === 'desktop') {
            return DesktopBackend.getReportFileUrl(reportId);
        }
        return LocalBackend.getReportFileUrl(reportId);
    }

    // ---- Sync helpers ----

    /**
     * Trigger an immediate sync cycle if the sync engine is running.
     * No-op when cloud sync is not active.
     * @returns {Promise<Object|undefined>} Sync result, or undefined if no engine
     */
    async function syncNow() {
        if (window.syncEngine) {
            return await window.syncEngine.syncNow();
        }
    }

    /**
     * Check whether the background sync engine is currently running.
     * @returns {boolean}
     */
    function isSyncing() {
        return window.syncEngine?.isRunning || false;
    }

    return {
        isEnabled,
        loadNotes,
        saveStudyDescription,
        saveSeriesDescription,
        addComment,
        updateComment,
        deleteComment,
        uploadReport,
        deleteReport,
        migrate,
        getReportFileUrl,
        authenticatedFetch,
        syncNow,
        isSyncing
    };
})();

if (typeof window !== 'undefined') {
    window.NotesAPI = NotesAPI;
}
