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
    const { LocalBackend, normalizeCommentId, normalizeReportId } = window._NotesInternals;
    const { ServerBackend, authenticatedFetch } = window._NotesServer;
    const {
        DesktopBackend,
        initializeDesktopStorage,
        loadDesktopLibraryConfig,
        saveDesktopLibraryConfig,
        loadDesktopScanCache,
        saveDesktopScanCacheEntries,
        saveImportJob,
        updateImportJob,
        loadRecentImportJobs,
    } = window._NotesDesktop;

    // ---- Dispatcher ----
    function getConfig() {
        if (typeof window !== 'undefined' && window.CONFIG) {
            return window.CONFIG;
        }
        if (typeof CONFIG !== 'undefined') {
            return CONFIG;
        }
        return null;
    }

    function getBackend() {
        const config = getConfig();
        const mode = config?.deploymentMode || 'personal';
        if (mode === 'desktop') return 'desktop';
        const hasServer = config?.features ? config.features.notesServer : mode === 'personal' || mode === 'cloud';
        if (hasServer) return 'server';
        return 'local';
    }

    function isEnabled() {
        const config = getConfig();
        if (config?.shouldPersistNotes) {
            return config.shouldPersistNotes();
        }
        return true;
    }

    function isCloudSyncEnabled() {
        const config = getConfig();
        return !!config?.features?.cloudSync && typeof window._SyncOutbox?.enqueueChange === 'function';
    }

    function getStudyState(studyUid) {
        return window.DicomViewerApp?.state?.studies?.[studyUid] || null;
    }

    function getBaseSyncVersion(record) {
        const value = Number(record?.sync_version);
        return Number.isFinite(value) ? value : 0;
    }

    function findCommentRecord(studyUid, commentId) {
        const studyEntry = getStudyState(studyUid);
        if (!studyEntry) return null;
        const target = normalizeCommentId(commentId);
        if (target === null) return null;

        const matches = (comment) => {
            if (comment?.record_uuid && normalizeCommentId(comment.record_uuid) === target) return true;
            return normalizeCommentId(comment?.id) === target;
        };

        if (Array.isArray(studyEntry.comments)) {
            const found = studyEntry.comments.find(matches);
            if (found) return found;
        }
        if (studyEntry.series && typeof studyEntry.series === 'object') {
            for (const seriesEntry of Object.values(studyEntry.series)) {
                if (!Array.isArray(seriesEntry?.comments)) continue;
                const found = seriesEntry.comments.find(matches);
                if (found) return found;
            }
        }
        return null;
    }

    function findReportRecord(studyUid, reportId) {
        const studyEntry = getStudyState(studyUid);
        if (!studyEntry || !Array.isArray(studyEntry.reports)) return null;
        const target = normalizeReportId(reportId);
        return studyEntry.reports.find((report) => normalizeReportId(report?.id) === target) || null;
    }

    function enqueueSyncChange(tableName, recordKey, operation, baseSyncVersion = 0) {
        if (!isCloudSyncEnabled()) return null;
        return window._SyncOutbox.enqueueChange(tableName, recordKey, operation, baseSyncVersion);
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
            () => LocalBackend.loadNotes(studyUids),
            () => DesktopBackend.loadNotes(studyUids),
        );
    }

    async function saveStudyDescription(studyUid, description) {
        if (!isEnabled()) return null;
        const baseSyncVersion = getBaseSyncVersion(getStudyState(studyUid));
        const result = await withFallback(
            () => ServerBackend.saveStudyDescription(studyUid, description),
            () => LocalBackend.saveStudyDescription(studyUid, description),
            () => DesktopBackend.saveStudyDescription(studyUid, description),
        );
        if (result) {
            enqueueSyncChange('study_notes', studyUid, 'update', baseSyncVersion);
        }
        return result;
    }

    async function saveSeriesDescription(studyUid, seriesUid, description) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.saveSeriesDescription(studyUid, seriesUid, description),
            () => LocalBackend.saveSeriesDescription(studyUid, seriesUid, description),
            () => DesktopBackend.saveSeriesDescription(studyUid, seriesUid, description),
        );
    }

    async function addComment(studyUid, payload) {
        if (!isEnabled()) return null;
        const result = await withFallback(
            () => ServerBackend.addComment(studyUid, payload),
            () => LocalBackend.addComment(studyUid, payload),
            () => DesktopBackend.addComment(studyUid, payload),
        );
        const recordKey = result?.record_uuid || result?.id || null;
        if (recordKey) {
            enqueueSyncChange('comments', recordKey, 'insert', 0);
        }
        return result;
    }

    async function updateComment(studyUid, commentId, payload) {
        if (!isEnabled()) return null;
        const comment = findCommentRecord(studyUid, commentId);
        const baseSyncVersion = getBaseSyncVersion(comment);
        const result = await withFallback(
            () => ServerBackend.updateComment(studyUid, commentId, payload),
            () => LocalBackend.updateComment(studyUid, commentId, payload),
            () => DesktopBackend.updateComment(studyUid, commentId, payload),
        );
        const recordKey = result?.record_uuid || result?.id || comment?.record_uuid || comment?.id || commentId;
        if (result && recordKey) {
            enqueueSyncChange('comments', recordKey, 'update', baseSyncVersion);
        }
        return result;
    }

    async function deleteComment(studyUid, commentId) {
        if (!isEnabled()) return false;
        const comment = findCommentRecord(studyUid, commentId);
        const baseSyncVersion = getBaseSyncVersion(comment);
        const result = await withFallback(
            () => ServerBackend.deleteComment(studyUid, commentId),
            () => LocalBackend.deleteComment(studyUid, commentId),
            () => DesktopBackend.deleteComment(studyUid, commentId),
        );
        const recordKey = comment?.record_uuid || comment?.id || commentId;
        if (result && recordKey) {
            enqueueSyncChange('comments', recordKey, 'delete', baseSyncVersion);
        }
        return result;
    }

    async function uploadReport(studyUid, file, meta) {
        if (!isEnabled()) return null;
        const result = await withFallback(
            () => ServerBackend.uploadReport(studyUid, file, meta),
            () => LocalBackend.uploadReport(studyUid, file, meta),
            () => DesktopBackend.uploadReport(studyUid, file, meta),
        );
        const recordKey = result?.id || meta?.id || null;
        if (recordKey) {
            enqueueSyncChange('reports', recordKey, 'insert', 0);
        }
        return result;
    }

    async function deleteReport(studyUid, reportId) {
        if (!isEnabled()) return false;
        const report = findReportRecord(studyUid, reportId);
        const baseSyncVersion = getBaseSyncVersion(report);
        const result = await withFallback(
            () => ServerBackend.deleteReport(studyUid, reportId),
            () => LocalBackend.deleteReport(studyUid, reportId),
            () => DesktopBackend.deleteReport(studyUid, reportId),
        );
        const recordKey = report?.id || reportId;
        if (result && recordKey) {
            enqueueSyncChange('reports', recordKey, 'delete', baseSyncVersion);
        }
        return result;
    }

    async function migrate(payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.migrate(payload),
            () => LocalBackend.migrate(payload),
            () => DesktopBackend.migrate(payload),
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

    function getReportFilePath(reportId) {
        if (!isEnabled() || getBackend() !== 'desktop') return '';
        return DesktopBackend.getReportFilePath(reportId);
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
        getReportFilePath,
        initializeDesktopStorage,
        loadDesktopLibraryConfig,
        saveDesktopLibraryConfig,
        loadDesktopScanCache,
        saveDesktopScanCacheEntries,
        saveImportJob,
        updateImportJob,
        loadRecentImportJobs,
        authenticatedFetch,
        syncNow,
        isSyncing,
    };
})();

if (typeof window !== 'undefined') {
    window.NotesAPI = NotesAPI;
}
