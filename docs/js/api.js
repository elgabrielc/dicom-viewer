/**
 * NotesAPI - server-side persistence abstraction
 * Wraps fetch calls to the Flask backend with graceful fallbacks.
 */

const NotesAPI = (() => {
    let serverAvailable = true;
    const baseUrl = '/api/notes';

    function isEnabled() {
        if (typeof CONFIG !== 'undefined' && CONFIG.shouldPersistNotes) {
            return CONFIG.shouldPersistNotes();
        }
        const hostname = window.location.hostname;
        return !hostname.endsWith('github.io') && !hostname.endsWith('vercel.app');
    }

    function disableForSession() {
        serverAvailable = false;
    }

    async function requestJson(url, options = {}) {
        if (!isEnabled() || !serverAvailable) return null;
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                console.warn('NotesAPI request failed:', res.status, url);
                return null;
            }
            return await res.json();
        } catch (err) {
            console.warn('NotesAPI unavailable:', err);
            disableForSession();
            return null;
        }
    }

    async function requestOk(url, options = {}) {
        if (!isEnabled() || !serverAvailable) return false;
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                console.warn('NotesAPI request failed:', res.status, url);
                return false;
            }
            return true;
        } catch (err) {
            console.warn('NotesAPI unavailable:', err);
            disableForSession();
            return false;
        }
    }

    function encodeId(value) {
        return encodeURIComponent(value);
    }

    return {
        isEnabled,
        async loadNotes(studyUids) {
            const list = (studyUids || []).filter(Boolean);
            if (!list.length) return { studies: {} };
            const query = list.map(encodeId).join(',');
            const data = await requestJson(`${baseUrl}/?studies=${query}`);
            return data || { studies: {} };
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
            if (!isEnabled() || !serverAvailable) return null;

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
                disableForSession();
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
})();

if (typeof window !== 'undefined') {
    window.NotesAPI = NotesAPI;
}
