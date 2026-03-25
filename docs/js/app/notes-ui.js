// Notes UI - coordination layer, shared helpers, migration logic
// Copyright (c) 2026 Divergent Health Technologies

(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const config = window.CONFIG;
    const notesApi = window.NotesAPI;

    const MIGRATION_FLAG_KEY = 'dicom-viewer-migrated';
    const LEGACY_STORAGE_KEY = 'dicom-viewer-comments';
    const LEGACY_REPORTS_DB = 'dicom-viewer-reports';
    const LEGACY_REPORTS_STORE = 'reports';

    function formatTimestamp(date) {
        return new Date(date).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    function generateLocalCommentId() {
        return `local-${crypto.randomUUID()}`;
    }

    async function loadNotesForStudies() {
        const studyUids = Object.keys(state.studies);
        if (!studyUids.length) return;

        const result = await notesApi.loadNotes(studyUids);
        const notes = result?.studies || {};

        for (const [studyUid, entry] of Object.entries(notes)) {
            const study = state.studies[studyUid];
            if (!study) continue;

            if (entry.description !== undefined) {
                study.description = entry.description || '';
            }
            if (Array.isArray(entry.comments)) {
                study.comments = entry.comments;
                study.comments.forEach(comment => {
                    if (comment.id === undefined || comment.id === null) {
                        comment.id = generateLocalCommentId();
                    }
                });
            }
            if (Array.isArray(entry.reports)) {
                study.reports = entry.reports;
            }

            if (entry.series && typeof entry.series === 'object') {
                for (const [seriesUid, seriesEntry] of Object.entries(entry.series)) {
                    const series = study.series[seriesUid];
                    if (!series) continue;
                    if (seriesEntry.description !== undefined) {
                        series.description = seriesEntry.description || '';
                    }
                    if (Array.isArray(seriesEntry.comments)) {
                        series.comments = seriesEntry.comments;
                        series.comments.forEach(comment => {
                            if (comment.id === undefined || comment.id === null) {
                                comment.id = generateLocalCommentId();
                            }
                        });
                    }
                }
            }
        }
    }

    async function openLegacyReportsDB() {
        if (!('indexedDB' in window)) return null;
        return new Promise(resolve => {
            const request = indexedDB.open(LEGACY_REPORTS_DB, 1);
            request.onerror = () => resolve(null);
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(LEGACY_REPORTS_STORE)) {
                    db.close();
                    resolve(null);
                    return;
                }
                resolve(db);
            };
            request.onupgradeneeded = () => resolve(null);
        });
    }

    async function getLegacyReportBlob(db, reportId) {
        if (!db) return null;
        return new Promise(resolve => {
            const tx = db.transaction(LEGACY_REPORTS_STORE, 'readonly');
            const request = tx.objectStore(LEGACY_REPORTS_STORE).get(reportId);
            request.onsuccess = () => resolve(request.result?.blob || null);
            request.onerror = () => resolve(null);
        });
    }

    async function migrateIfNeeded() {
        if (!notesApi.isEnabled()) return;
        if (config && !config.features.notesServer) return;

        let alreadyMigrated = false;
        try {
            alreadyMigrated = !!localStorage.getItem(MIGRATION_FLAG_KEY);
        } catch {
            return;
        }
        if (alreadyMigrated) return;

        let raw;
        try {
            raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        } catch {
            return;
        }
        if (!raw) {
            localStorage.setItem(MIGRATION_FLAG_KEY, '1');
            return;
        }

        let payload;
        try {
            payload = JSON.parse(raw);
        } catch (e) {
            console.warn('Failed to parse legacy notes for migration:', e);
            return;
        }

        const migrated = await notesApi.migrate(payload);
        if (!migrated) return;

        if (payload?.version === 2 && payload?.comments) {
            const db = await openLegacyReportsDB();
            const uploadTasks = [];

            for (const [studyUid, stored] of Object.entries(payload.comments)) {
                const reports = stored?.reports || [];
                for (const report of reports) {
                    if (!report?.id) continue;
                    uploadTasks.push((async () => {
                        const blob = await getLegacyReportBlob(db, report.id);
                        if (!blob) return;
                        const filename = report.name || 'report';
                        const file = new File([blob], filename, { type: blob.type || '' });
                        await notesApi.uploadReport(studyUid, file, report);
                    })());
                }
            }

            if (db) db.close();

            if (uploadTasks.length) {
                const results = await Promise.allSettled(uploadTasks);
                if (results.every(result => result.status === 'fulfilled')) {
                    localStorage.setItem(MIGRATION_FLAG_KEY, '1');
                }
                return;
            }
        }

        localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    }

    app.notesUi = {
        formatTimestamp,
        generateLocalCommentId,
        loadNotesForStudies,
        migrateIfNeeded
    };
})();
