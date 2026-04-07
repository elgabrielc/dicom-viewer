/**
 * ServerBackend - Flask REST API client for server-side persistence
 *
 * Includes session token management and authenticated fetch wrapper.
 * Depends on window._NotesInternals from local.js (loaded first).
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _NotesServer = (() => {
    const baseUrl = '/api/notes';
    let serverAvailable = true;
    let serverDisabledAt = 0;
    const SERVER_RETRY_MS = 60000; // Retry server after 60 seconds

    // Session token for server authentication (fetched once at boot).
    // The server generates a per-process token; the frontend includes it
    // as X-Session-Token on all PHI-bearing API requests.
    let sessionToken = null;
    let sessionTokenPromise = null;

    async function fetchSessionToken() {
        try {
            const res = await fetch('/api/session');
            if (!res.ok) {
                console.warn('NotesAPI: failed to fetch session token:', res.status);
                return null;
            }
            const data = await res.json();
            sessionToken = data.token || null;
            return sessionToken;
        } catch (err) {
            console.warn('NotesAPI: session token fetch failed:', err);
            return null;
        }
    }

    function ensureSessionToken() {
        if (sessionToken) return Promise.resolve(sessionToken);
        if (!sessionTokenPromise) {
            sessionTokenPromise = fetchSessionToken().finally(() => {
                sessionTokenPromise = null;
            });
        }
        return sessionTokenPromise;
    }

    function authHeaders(extra = {}) {
        const headers = { ...extra };
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }
        return headers;
    }

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

    async function requestJson(url, options = {}, retried = false) {
        if (!checkServerAvailable()) return null;
        await ensureSessionToken();
        try {
            options.headers = authHeaders(options.headers || {});
            const res = await fetch(url, options);
            if (res.status === 401 && !retried) {
                // Token may have expired (server restarted). Re-fetch and retry once.
                sessionToken = null;
                await fetchSessionToken();
                return requestJson(url, options, true);
            }
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

    async function requestOk(url, options = {}, retried = false) {
        if (!checkServerAvailable()) return false;
        await ensureSessionToken();
        try {
            options.headers = authHeaders(options.headers || {});
            const res = await fetch(url, options);
            if (res.status === 401 && !retried) {
                sessionToken = null;
                await fetchSessionToken();
                return requestOk(url, options, true);
            }
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
                body: JSON.stringify({ description }),
            });
        },

        async saveSeriesDescription(studyUid, seriesUid, description) {
            if (!studyUid || !seriesUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/series/${encodeId(seriesUid)}/description`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description }),
            });
        },

        async addComment(studyUid, payload) {
            if (!studyUid) return null;
            const result = await requestJson(`${baseUrl}/${encodeId(studyUid)}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            // Promote record_uuid to id for canonical identifier usage
            if (result?.record_uuid) {
                result.id = result.record_uuid;
            }
            return result;
        },

        async updateComment(studyUid, commentId, payload) {
            if (!studyUid || commentId === undefined || commentId === null) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/comments/${encodeId(commentId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            return await requestOk(`${baseUrl}/${encodeId(studyUid)}/comments/${encodeId(commentId)}`, {
                method: 'DELETE',
            });
        },

        async uploadReport(studyUid, file, meta = {}) {
            if (!studyUid || !file) return null;
            if (!checkServerAvailable()) return null;
            await ensureSessionToken();

            const form = new FormData();
            const filename = meta.name || file.name || 'report';
            form.append('file', file, filename);
            if (meta.id) form.append('id', meta.id);
            if (meta.name) form.append('name', meta.name);
            if (meta.type) form.append('type', meta.type);
            if (meta.size !== undefined && meta.size !== null) form.append('size', meta.size);
            if (meta.addedAt !== undefined && meta.addedAt !== null) form.append('addedAt', meta.addedAt);
            if (meta.updatedAt !== undefined && meta.updatedAt !== null) form.append('updatedAt', meta.updatedAt);

            const headers = authHeaders();

            async function doUpload(retried) {
                try {
                    const res = await fetch(`${baseUrl}/${encodeId(studyUid)}/reports`, {
                        method: 'POST',
                        headers,
                        body: form,
                    });
                    if (res.status === 401 && !retried) {
                        sessionToken = null;
                        await fetchSessionToken();
                        headers['X-Session-Token'] = sessionToken || '';
                        return doUpload(true);
                    }
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
            }
            return doUpload(false);
        },

        async deleteReport(studyUid, reportId) {
            if (!studyUid || !reportId) return false;
            return await requestOk(`${baseUrl}/${encodeId(studyUid)}/reports/${encodeId(reportId)}`, {
                method: 'DELETE',
            });
        },

        async migrate(payload) {
            return await requestJson(`${baseUrl}/migrate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        },

        getReportFileUrl(reportId) {
            if (!reportId) return '';
            return `${baseUrl}/reports/${encodeId(reportId)}/file`;
        },
    };

    /**
     * Fetch wrapper that injects the session token header.
     * Other modules (library.js, sources.js) use this for PHI-bearing
     * API requests that go through plain fetch rather than NotesAPI.
     * Automatically retries once on 401 (server restart = new token).
     */
    async function authenticatedFetch(url, options = {}, retried = false) {
        await ensureSessionToken();
        const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers || {});
        if (sessionToken) {
            headers.set('X-Session-Token', sessionToken);
        }
        const mergedOptions = { ...options, headers };
        const res = await fetch(url, mergedOptions);
        if (res.status === 401 && !retried) {
            sessionToken = null;
            await fetchSessionToken();
            return authenticatedFetch(url, options, true);
        }
        return res;
    }

    return {
        ServerBackend,
        authenticatedFetch,
        // Exposed for dispatcher's withFallback to check circuit-breaker state
        get serverAvailable() {
            return serverAvailable;
        },
    };
})();

if (typeof window !== 'undefined') {
    window._NotesServer = _NotesServer;
}
