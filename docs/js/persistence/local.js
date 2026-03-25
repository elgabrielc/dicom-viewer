/**
 * LocalBackend - localStorage persistence for demo/preview/offline modes
 *
 * Also exports shared helpers used by other persistence backends via
 * window._NotesInternals. This file must be loaded first in the
 * persistence package.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _NotesInternals = (() => {
    const STORAGE_KEY = 'dicom-viewer-notes-v3';
    let lastCommentTimestamp = 0;
    let commentCounter = 0;

    function createEmptyStore() {
        return { studies: {} };
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeCommentId(value) {
        if (value === null || value === undefined) return null;
        const asNumber = Number(value);
        if (!Number.isNaN(asNumber)) return asNumber;
        return String(value);
    }

    function createCommentId() {
        const now = Date.now();
        if (now === lastCommentTimestamp) {
            commentCounter += 1;
            return `${now}-${commentCounter}`;
        }
        lastCommentTimestamp = now;
        commentCounter = 0;
        return String(now);
    }

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return createEmptyStore();
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !parsed.studies || typeof parsed.studies !== 'object') {
                return createEmptyStore();
            }
            return parsed;
        } catch (e) {
            console.warn('LocalBackend: failed to load:', e);
            return createEmptyStore();
        }
    }

    function saveStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (e) {
            console.warn('LocalBackend: failed to save:', e);
        }
    }

    function ensureStudy(store, studyUid) {
        if (!store.studies[studyUid]) {
            store.studies[studyUid] = {
                description: '',
                comments: [],
                series: {},
                reports: []
            };
            return store.studies[studyUid];
        }

        const entry = store.studies[studyUid];
        if (typeof entry.description !== 'string') entry.description = '';
        if (!Array.isArray(entry.comments)) entry.comments = [];
        if (!entry.series || typeof entry.series !== 'object') entry.series = {};
        if (!Array.isArray(entry.reports)) entry.reports = [];
        return entry;
    }

    function ensureSeries(studyEntry, seriesUid) {
        if (!studyEntry.series[seriesUid]) {
            studyEntry.series[seriesUid] = {
                description: '',
                comments: []
            };
            return studyEntry.series[seriesUid];
        }

        const entry = studyEntry.series[seriesUid];
        if (typeof entry.description !== 'string') entry.description = '';
        if (!Array.isArray(entry.comments)) entry.comments = [];
        return entry;
    }

    function normalizeReportId(value) {
        if (value === null || value === undefined) return null;
        return String(value);
    }

    function findCommentById(comments, commentId) {
        if (!Array.isArray(comments)) return null;
        const target = normalizeCommentId(commentId);
        if (target === null) return null;
        return comments.find((comment) => normalizeCommentId(comment.id) === target) || null;
    }

    function findReportMetadata(store, reportId) {
        const target = normalizeReportId(reportId);
        if (!target || !store?.studies || typeof store.studies !== 'object') return null;

        for (const [studyUid] of Object.entries(store.studies)) {
            const studyEntry = ensureStudy(store, studyUid);
            const report = studyEntry.reports.find((entry) => normalizeReportId(entry?.id) === target) || null;
            if (report) {
                return { studyUid, studyEntry, report };
            }
        }

        return null;
    }

    function sanitizeFilenamePart(value, fallback = 'report') {
        const safe = String(value || '')
            .replace(/[^A-Za-z0-9._-]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return safe || fallback;
    }

    function getDesktopTauriApis() {
        const tauri = window.__TAURI__;
        return {
            fs: tauri?.fs || null,
            path: tauri?.path || null,
            core: tauri?.core || null
        };
    }

    // ---- LocalBackend ----
    const LocalBackend = {
        async loadNotes(studyUids) {
            const list = (studyUids || []).filter(Boolean);
            if (!list.length) return createEmptyStore();

            const store = loadStore();
            const filtered = createEmptyStore();
            for (const studyUid of list) {
                if (store.studies[studyUid]) {
                    filtered.studies[studyUid] = clone(ensureStudy(store, studyUid));
                }
            }
            return filtered;
        },

        async saveStudyDescription(studyUid, description) {
            if (!studyUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            studyEntry.description = description || '';
            saveStore(store);
            return clone(studyEntry);
        },

        async saveSeriesDescription(studyUid, seriesUid, description) {
            if (!studyUid || !seriesUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            const seriesEntry = ensureSeries(studyEntry, seriesUid);
            seriesEntry.description = description || '';
            saveStore(store);
            return clone(seriesEntry);
        },

        async addComment(studyUid, payload = {}) {
            if (!studyUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            const seriesUid = payload.seriesUid || null;
            const target = seriesUid ? ensureSeries(studyEntry, seriesUid) : studyEntry;

            const comment = {
                id: createCommentId(),
                text: (payload.text || '').trim(),
                time: payload.time ?? Date.now()
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

            let comment = findCommentById(studyEntry.comments, commentId);
            if (!comment) {
                for (const seriesEntry of Object.values(studyEntry.series)) {
                    comment = findCommentById(seriesEntry.comments, commentId);
                    if (comment) break;
                }
            }
            if (!comment) return null;

            comment.text = (payload.text || '').trim();
            comment.time = Date.now();
            saveStore(store);
            return clone(comment);
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return true;

            ensureStudy(store, studyUid);
            const target = normalizeCommentId(commentId);
            studyEntry.comments = studyEntry.comments.filter((comment) => normalizeCommentId(comment.id) !== target);

            for (const seriesEntry of Object.values(studyEntry.series)) {
                if (!Array.isArray(seriesEntry.comments)) {
                    seriesEntry.comments = [];
                    continue;
                }
                seriesEntry.comments = seriesEntry.comments.filter((comment) => normalizeCommentId(comment.id) !== target);
            }

            saveStore(store);
            return true;
        },

        async uploadReport() {
            return null;
        },

        async deleteReport() {
            // No persistent report storage in localStorage, so delete is a no-op success.
            // Returning true lets the UI remove the in-memory entry without error.
            return true;
        },

        async migrate() {
            return null;
        },

        getReportFileUrl() {
            return '';
        }
    };

    return {
        // Shared helpers (used by server.js and desktop.js)
        createEmptyStore,
        clone,
        normalizeCommentId,
        createCommentId,
        loadStore,
        saveStore,
        ensureStudy,
        ensureSeries,
        normalizeReportId,
        findCommentById,
        findReportMetadata,
        sanitizeFilenamePart,
        getDesktopTauriApis,
        // Backend
        LocalBackend
    };
})();

if (typeof window !== 'undefined') {
    window._NotesInternals = _NotesInternals;
}
