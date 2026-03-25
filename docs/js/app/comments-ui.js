// Comments UI - comment CRUD, rendering, event handlers
// Uses record_uuid as the canonical comment identifier for sync compatibility.
// Copyright (c) 2026 Divergent Health Technologies

(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const notesApi = window.NotesAPI;
    const { escapeHtml } = app.utils;
    const { formatTimestamp, generateLocalCommentId } = app.notesUi;

    /**
     * Get the canonical identifier for a comment.
     * Prefers record_uuid (sync-era), falls back to id (legacy).
     */
    function commentIdentifier(comment) {
        return comment.record_uuid || comment.id;
    }

    function normalizeCommentId(value) {
        if (value === null || value === undefined) return null;
        // UUIDs are strings; legacy ids are numeric
        const asNumber = Number(value);
        if (!Number.isNaN(asNumber)) return asNumber;
        return String(value);
    }

    function findCommentIndex(comments, commentId) {
        const target = normalizeCommentId(commentId);
        if (target === null) return -1;
        // Match against both record_uuid and id for backward compat
        return comments.findIndex(comment => {
            if (comment.record_uuid && normalizeCommentId(comment.record_uuid) === target) return true;
            return normalizeCommentId(comment.id) === target;
        });
    }

    function renderComments(comments, studyUid, seriesUid = null) {
        if (!comments || comments.length === 0) return '';
        return comments.map(comment => {
            const cid = commentIdentifier(comment);
            return `
            <div class="comment-item" data-comment-id="${escapeHtml(cid)}">
                <div class="comment-header">
                    <span class="comment-time">${formatTimestamp(comment.time)}</span>
                    <span class="comment-actions">
                        <button class="comment-btn edit-comment" data-study-uid="${escapeHtml(studyUid)}" ${seriesUid ? `data-series-uid="${escapeHtml(seriesUid)}"` : ''} data-comment-id="${escapeHtml(cid)}">Edit</button>
                        <button class="comment-btn delete-comment" data-study-uid="${escapeHtml(studyUid)}" ${seriesUid ? `data-series-uid="${escapeHtml(seriesUid)}"` : ''} data-comment-id="${escapeHtml(cid)}">Delete</button>
                    </span>
                </div>
                <div class="comment-text">${escapeHtml(comment.text)}</div>
            </div>
        `;
        }).join('');
    }

    function updateCommentListUI(studyUid, seriesUid) {
        const comments = seriesUid
            ? state.studies[studyUid].series[seriesUid].comments
            : state.studies[studyUid].comments;

        let commentList;
        if (seriesUid) {
            const panel = document.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
            commentList = panel?.querySelector('.comment-list');
        } else {
            const panel = document.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
            commentList = panel?.querySelector('.comment-list');
        }

        if (commentList) {
            commentList.innerHTML = renderComments(comments, studyUid, seriesUid);
            commentList.querySelectorAll('.edit-comment').forEach(btn => {
                btn.onclick = e => {
                    e.stopPropagation();
                    editComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
                };
            });
            commentList.querySelectorAll('.delete-comment').forEach(btn => {
                btn.onclick = e => {
                    e.stopPropagation();
                    deleteComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
                };
            });
        }

        const count = comments.length;
        let btn;
        if (seriesUid) {
            btn = document.querySelector(`.series-comment-toggle[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
        } else {
            btn = document.querySelector(`.comment-toggle[data-study-uid="${CSS.escape(studyUid)}"]:not(.series-comment-toggle)`);
        }
        if (btn && btn.textContent !== 'Hide comments') {
            btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
        }

        let input;
        if (seriesUid) {
            input = document.querySelector(`.add-series-comment[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
        } else {
            input = document.querySelector(`.add-study-comment[data-study-uid="${CSS.escape(studyUid)}"]`);
        }
        if (input) input.value = '';
    }

    async function addComment(studyUid, seriesUid, text) {
        if (!text.trim()) return;
        const now = Date.now();
        const comment = { id: generateLocalCommentId(), text: text.trim(), time: now };
        let comments;
        if (seriesUid) {
            if (!Array.isArray(state.studies[studyUid].series[seriesUid].comments)) {
                state.studies[studyUid].series[seriesUid].comments = [];
            }
            comments = state.studies[studyUid].series[seriesUid].comments;
        } else {
            if (!Array.isArray(state.studies[studyUid].comments)) {
                state.studies[studyUid].comments = [];
            }
            comments = state.studies[studyUid].comments;
        }

        comments.push(comment);
        updateCommentListUI(studyUid, seriesUid);

        const saved = await notesApi.addComment(studyUid, {
            text: comment.text,
            time: comment.time,
            seriesUid
        });
        if (saved) {
            // Promote record_uuid (or id) from server response as canonical identifier
            if (saved.record_uuid) {
                comment.id = saved.record_uuid;
                comment.record_uuid = saved.record_uuid;
            } else if (saved.id !== undefined && saved.id !== null) {
                comment.id = saved.id;
            }
            updateCommentListUI(studyUid, seriesUid);
        }
    }

    async function deleteComment(studyUid, seriesUid, commentId) {
        const comments = seriesUid
            ? state.studies[studyUid].series[seriesUid].comments
            : state.studies[studyUid].comments;
        if (!Array.isArray(comments)) return;

        const idx = findCommentIndex(comments, commentId);
        if (idx === -1) return;
        comments.splice(idx, 1);
        updateCommentListUI(studyUid, seriesUid);
        if (!String(commentId).startsWith('local-')) {
            await notesApi.deleteComment(studyUid, commentId);
        }
    }

    async function editComment(studyUid, seriesUid, commentId) {
        const comments = seriesUid
            ? state.studies[studyUid].series[seriesUid].comments
            : state.studies[studyUid].comments;
        if (!Array.isArray(comments)) return;

        const idx = findCommentIndex(comments, commentId);
        if (idx === -1) return;

        const newText = prompt('Edit comment:', comments[idx].text);
        if (newText !== null && newText.trim()) {
            comments[idx].text = newText.trim();
            comments[idx].time = Date.now();
            updateCommentListUI(studyUid, seriesUid);
            if (!String(commentId).startsWith('local-')) {
                await notesApi.updateComment(studyUid, commentId, {
                    text: comments[idx].text,
                    time: comments[idx].time
                });
            }
        }
    }

    app.commentsUi = {
        addComment,
        deleteComment,
        editComment,
        renderComments
    };
})();
