/**
 * DesktopSqliteBackend - Tauri native persistence for desktop app
 *
 * Extends LocalBackend with file-system report storage via Tauri APIs
 * and sync-aware comment methods that populate record_uuid, timestamps,
 * and device_id for eventual cloud sync.
 *
 * Depends on window._NotesInternals from local.js (loaded first).
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _NotesDesktop = (() => {
    const {
        LocalBackend,
        clone,
        loadStore,
        saveStore,
        ensureStudy,
        ensureSeries,
        normalizeReportId,
        findReportMetadata,
        sanitizeFilenamePart,
        getDesktopTauriApis
    } = window._NotesInternals;

    // Cached device_id to avoid repeated lookups
    let cachedDeviceId = null;

    /**
     * Read device_id from sync_state table (localStorage-backed until SQL
     * connection is wired up by sync-core). Falls back to generating one.
     */
    function getDeviceId() {
        if (cachedDeviceId) return cachedDeviceId;
        try {
            const raw = localStorage.getItem('dicom-viewer-device-id');
            if (raw) {
                cachedDeviceId = raw;
                return cachedDeviceId;
            }
        } catch (e) {
            // localStorage may not be available
        }
        // Generate and persist a stable device_id
        cachedDeviceId = crypto.randomUUID();
        try {
            localStorage.setItem('dicom-viewer-device-id', cachedDeviceId);
        } catch (e) {
            // Best effort persistence
        }
        return cachedDeviceId;
    }

    /**
     * Find a comment by record_uuid across study and series comments.
     * Returns { comment, array } where array is the containing comment list,
     * or null if not found.
     */
    function findCommentByUuid(studyEntry, recordUuid) {
        if (!recordUuid) return null;

        // Search study-level comments
        if (Array.isArray(studyEntry.comments)) {
            const comment = studyEntry.comments.find(c => c.record_uuid === recordUuid);
            if (comment) return { comment, array: studyEntry.comments };
        }

        // Search series-level comments
        if (studyEntry.series && typeof studyEntry.series === 'object') {
            for (const seriesEntry of Object.values(studyEntry.series)) {
                if (Array.isArray(seriesEntry.comments)) {
                    const comment = seriesEntry.comments.find(c => c.record_uuid === recordUuid);
                    if (comment) return { comment, array: seriesEntry.comments };
                }
            }
        }

        return null;
    }

    // ---- DesktopBackend ----
    const DesktopBackend = {
        ...LocalBackend,

        async addComment(studyUid, payload = {}) {
            if (!studyUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            const seriesUid = payload.seriesUid || null;
            const target = seriesUid ? ensureSeries(studyEntry, seriesUid) : studyEntry;

            const now = Date.now();
            const recordUuid = crypto.randomUUID();
            const comment = {
                id: recordUuid,
                record_uuid: recordUuid,
                text: (payload.text || '').trim(),
                time: payload.time ?? now,
                created_at: payload.time ?? now,
                updated_at: payload.time ?? now,
                device_id: getDeviceId(),
                sync_version: 0
            };
            target.comments.push(comment);
            saveStore(store);
            return clone(comment);
        },

        async updateComment(studyUid, commentId, payload = {}) {
            if (!studyUid || commentId === undefined || commentId === null) return null;
            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return null;

            ensureStudy(store, studyUid);

            // Look up by record_uuid first, then fall back to id
            let found = findCommentByUuid(studyEntry, String(commentId));
            if (!found) {
                // Legacy id fallback: search by the old id field
                const { findCommentById } = window._NotesInternals;
                let comment = findCommentById(studyEntry.comments, commentId);
                if (comment) {
                    found = { comment, array: studyEntry.comments };
                } else {
                    for (const seriesEntry of Object.values(studyEntry.series || {})) {
                        comment = findCommentById(seriesEntry.comments, commentId);
                        if (comment) {
                            found = { comment, array: seriesEntry.comments };
                            break;
                        }
                    }
                }
            }
            if (!found) return null;

            const now = Date.now();
            found.comment.text = (payload.text || '').trim();
            found.comment.time = now;
            found.comment.updated_at = now;
            found.comment.device_id = getDeviceId();
            saveStore(store);
            return clone(found.comment);
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return true;

            ensureStudy(store, studyUid);

            // Find by record_uuid first, then fall back to id
            let found = findCommentByUuid(studyEntry, String(commentId));
            if (!found) {
                const { normalizeCommentId } = window._NotesInternals;
                const target = normalizeCommentId(commentId);
                // Search study-level comments
                const studyComment = Array.isArray(studyEntry.comments)
                    ? studyEntry.comments.find(c => normalizeCommentId(c.id) === target)
                    : null;
                if (studyComment) {
                    found = { comment: studyComment, array: studyEntry.comments };
                } else {
                    for (const seriesEntry of Object.values(studyEntry.series || {})) {
                        if (!Array.isArray(seriesEntry.comments)) continue;
                        const seriesComment = seriesEntry.comments.find(c => normalizeCommentId(c.id) === target);
                        if (seriesComment) {
                            found = { comment: seriesComment, array: seriesEntry.comments };
                            break;
                        }
                    }
                }
            }

            if (found) {
                // Soft delete: mark with deleted_at and remove from visible list
                const now = Date.now();
                found.comment.deleted_at = now;
                found.comment.updated_at = now;
                found.comment.device_id = getDeviceId();
                // Remove from the array so it's not visible in the UI
                const idx = found.array.indexOf(found.comment);
                if (idx !== -1) found.array.splice(idx, 1);
            }

            saveStore(store);
            return true;
        },

        async uploadReport(studyUid, file, report = {}) {
            if (!studyUid || !file || !report?.id) return null;

            const { fs, path } = getDesktopTauriApis();
            if (!fs || !path) return null;

            try {
                const appDataPath = await path.appDataDir();
                const reportsDir = await path.join(appDataPath, 'reports', studyUid);
                await fs.mkdir(reportsDir, { recursive: true });

                const filename = file.name || report.name || 'report';
                const safeFilename = sanitizeFilenamePart(filename, 'report');
                const filePath = await path.join(
                    reportsDir,
                    `${sanitizeFilenamePart(report.id, 'report')}_${safeFilename}`
                );

                const bytes = new Uint8Array(await file.arrayBuffer());
                await fs.writeFile(filePath, bytes);

                // Compute SHA-256 content hash for sync dedup/integrity
                const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                const store = loadStore();
                const studyEntry = ensureStudy(store, studyUid);
                const saved = {
                    ...report,
                    filePath,
                    contentHash,
                    storedAt: new Date().toISOString()
                };
                delete saved.blob;

                // Upsert: clear deleted_at on resurrection
                const target = normalizeReportId(saved.id);
                studyEntry.reports = studyEntry.reports.filter((entry) => normalizeReportId(entry?.id) !== target);
                delete saved.deletedAt;
                studyEntry.reports.push(saved);
                saveStore(store);
                return clone(saved);
            } catch (e) {
                console.warn('DesktopBackend: failed to upload report:', e);
                return null;
            }
        },

        async deleteReport(studyUid, reportId) {
            if (!studyUid || reportId === undefined || reportId === null) return false;

            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return true;

            ensureStudy(store, studyUid);
            const target = normalizeReportId(reportId);
            const report = studyEntry.reports.find((entry) => normalizeReportId(entry?.id) === target) || null;
            if (!report) return true;

            // Soft delete: tombstone with deletedAt, keep file on disk.
            // Physical file removal deferred to purge policy (Stage 5).
            report.deletedAt = Date.now();
            report.updatedAt = report.deletedAt;
            saveStore(store);
            return true;
        },

        getReportFileUrl(reportId) {
            const { core } = getDesktopTauriApis();
            if (!core?.convertFileSrc) return '';

            const match = findReportMetadata(loadStore(), reportId);
            const report = match?.report;
            // Skip soft-deleted reports
            if (!report || report.deletedAt) return '';
            const filePath = report.filePath;
            if (!filePath) return '';
            return core.convertFileSrc(filePath);
        }
    };

    return { DesktopBackend };
})();

if (typeof window !== 'undefined') {
    window._NotesDesktop = _NotesDesktop;
}
