/**
 * NotesAPI - Persistence abstraction with pluggable backends
 *
 * Routes to LocalBackend (localStorage) or ServerBackend (Flask API)
 * based on deployment mode from CONFIG.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const NotesAPI = (() => {
    const STORAGE_KEY = 'dicom-viewer-notes-v3';
    const baseUrl = '/api/notes';
    let serverAvailable = true;
    let serverDisabledAt = 0;
    const SERVER_RETRY_MS = 60000; // Retry server after 60 seconds
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

    function findCommentById(comments, commentId) {
        if (!Array.isArray(comments)) return null;
        const target = normalizeCommentId(commentId);
        if (target === null) return null;
        return comments.find((comment) => normalizeCommentId(comment.id) === target) || null;
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

    function disableServer() {
        serverAvailable = false;
        serverDisabledAt = Date.now();
        console.warn('NotesAPI: server unreachable, using local storage. Will retry in 60s.');
    }

    function checkServerAvailable() {
        if (serverAvailable) return true;
        // Circuit breaker: re-enable after retry interval
        if (Date.now() - serverDisabledAt >= SERVER_RETRY_MS) {
            serverAvailable = true;
            return true;
        }
        return false;
    }

    async function requestJson(url, options = {}) {
        if (!checkServerAvailable()) return null;
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                console.warn('NotesAPI request failed:', res.status, url);
                return null;
            }
            return await res.json();
        } catch (err) {
            console.warn('NotesAPI unavailable:', err);
            disableServer();
            return null;
        }
    }

    async function requestOk(url, options = {}) {
        if (!checkServerAvailable()) return false;
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                console.warn('NotesAPI request failed:', res.status, url);
                return false;
            }
            return true;
        } catch (err) {
            console.warn('NotesAPI unavailable:', err);
            disableServer();
            return false;
        }
    }

    function encodeId(value) {
        return encodeURIComponent(value);
    }

    // ---- ServerBackend ----
    const ServerBackend = {
        async loadNotes(studyUids) {
            const list = (studyUids || []).filter(Boolean);
            if (!list.length) return { studies: {} };
            const query = list.map(encodeId).join(',');
            const data = await requestJson(`${baseUrl}/?studies=${query}`);
            return data || null;
        },

        async saveStudyDescription(studyUid, description) {
            if (!studyUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/description`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description })
            });
        },

        async saveSeriesDescription(studyUid, seriesUid, description) {
            if (!studyUid || !seriesUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/series/${encodeId(seriesUid)}/description`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description })
            });
        },

        async addComment(studyUid, payload) {
            if (!studyUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        async updateComment(studyUid, commentId, payload) {
            if (!studyUid || commentId === undefined || commentId === null) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/comments/${encodeId(commentId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            return await requestOk(`${baseUrl}/${encodeId(studyUid)}/comments/${encodeId(commentId)}`, {
                method: 'DELETE'
            });
        },

        async uploadReport(studyUid, file, meta = {}) {
            if (!studyUid || !file) return null;
            if (!checkServerAvailable()) return null;

            const form = new FormData();
            const filename = meta.name || file.name || 'report';
            form.append('file', file, filename);
            if (meta.id) form.append('id', meta.id);
            if (meta.name) form.append('name', meta.name);
            if (meta.type) form.append('type', meta.type);
            if (meta.size !== undefined && meta.size !== null) form.append('size', meta.size);
            if (meta.addedAt !== undefined && meta.addedAt !== null) form.append('addedAt', meta.addedAt);
            if (meta.updatedAt !== undefined && meta.updatedAt !== null) form.append('updatedAt', meta.updatedAt);

            try {
                const res = await fetch(`${baseUrl}/${encodeId(studyUid)}/reports`, {
                    method: 'POST',
                    body: form
                });
                if (!res.ok) {
                    console.warn('NotesAPI report upload failed:', res.status);
                    return null;
                }
                return await res.json();
            } catch (err) {
                console.warn('NotesAPI unavailable:', err);
                disableServer();
                return null;
            }
        },

        async deleteReport(studyUid, reportId) {
            if (!studyUid || !reportId) return false;
            return await requestOk(`${baseUrl}/${encodeId(studyUid)}/reports/${encodeId(reportId)}`, {
                method: 'DELETE'
            });
        },

        async migrate(payload) {
            return await requestJson(`${baseUrl}/migrate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        getReportFileUrl(reportId) {
            if (!reportId) return '';
            return `${baseUrl}/reports/${encodeId(reportId)}/file`;
        }
    };

    // ---- Dispatcher ----
    function getBackend() {
        const mode = (typeof CONFIG !== 'undefined') ? CONFIG.deploymentMode : 'personal';
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

    async function withFallback(serverCall, localCall) {
        if (getBackend() === 'local') {
            return await localCall();
        }

        const result = await serverCall();
        // Only fall back to localStorage when the server became unreachable
        // (network error that triggered disableServer). Application-level
        // errors (4xx, 5xx) should surface as failures, not be silently
        // absorbed by the local backend -- that would create divergent data.
        if ((result === null || result === false) && !serverAvailable) {
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
            () => LocalBackend.uploadReport(studyUid, file, meta)
        );
    }

    async function deleteReport(studyUid, reportId) {
        if (!isEnabled()) return false;
        return await withFallback(
            () => ServerBackend.deleteReport(studyUid, reportId),
            () => LocalBackend.deleteReport(studyUid, reportId)
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
        if (getBackend() === 'server') {
            return ServerBackend.getReportFileUrl(reportId);
        }
        return LocalBackend.getReportFileUrl(reportId);
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
        getReportFileUrl
    };
})();

if (typeof window !== 'undefined') {
    window.NotesAPI = NotesAPI;
}
