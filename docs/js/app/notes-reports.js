(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const config = window.CONFIG;
    const notesApi = window.NotesAPI;
    const { $, studiesBody } = app.dom;
    const { escapeHtml, generateUUID } = app.utils;

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

    function normalizeCommentId(value) {
        if (value === null || value === undefined) return null;
        const asNumber = Number(value);
        if (!Number.isNaN(asNumber)) return asNumber;
        return String(value);
    }

    function findCommentIndex(comments, commentId) {
        const target = normalizeCommentId(commentId);
        if (target === null) return -1;
        return comments.findIndex(comment => normalizeCommentId(comment.id) === target);
    }

    function generateLocalCommentId() {
        return `local-${crypto.randomUUID()}`;
    }

    function renderComments(comments, studyUid, seriesUid = null) {
        if (!comments || comments.length === 0) return '';
        return comments.map(comment => `
            <div class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
                <div class="comment-header">
                    <span class="comment-time">${formatTimestamp(comment.time)}</span>
                    <span class="comment-actions">
                        <button class="comment-btn edit-comment" data-study-uid="${escapeHtml(studyUid)}" ${seriesUid ? `data-series-uid="${escapeHtml(seriesUid)}"` : ''} data-comment-id="${escapeHtml(comment.id)}">Edit</button>
                        <button class="comment-btn delete-comment" data-study-uid="${escapeHtml(studyUid)}" ${seriesUid ? `data-series-uid="${escapeHtml(seriesUid)}"` : ''} data-comment-id="${escapeHtml(comment.id)}">Delete</button>
                    </span>
                </div>
                <div class="comment-text">${escapeHtml(comment.text)}</div>
            </div>
        `).join('');
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
        if (saved?.id !== undefined && saved?.id !== null) {
            comment.id = saved.id;
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

    function getReportType(file) {
        const mime = file.type;
        if (mime === 'application/pdf') return 'pdf';
        if (mime === 'image/png') return 'png';
        if (mime === 'image/jpeg') return 'jpg';

        const ext = file.name.toLowerCase().split('.').pop();
        if (ext === 'pdf') return 'pdf';
        if (ext === 'png') return 'png';
        if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
        return null;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    async function addReport(studyUid, file) {
        const type = getReportType(file);
        if (!type) {
            alert('Unsupported file type. Please use PDF, PNG, or JPG.');
            return;
        }

        if (!state.studies[studyUid].reports) {
            state.studies[studyUid].reports = [];
        }

        const now = Date.now();
        const report = {
            id: generateUUID(),
            name: file.name,
            type,
            size: file.size,
            addedAt: now,
            updatedAt: now,
            blob: null
        };

        const saved = await notesApi.uploadReport(studyUid, file, report);
        if (saved) {
            Object.assign(report, saved);
        } else {
            report.blob = file;
        }

        state.studies[studyUid].reports.push(report);
        updateReportListUI(studyUid);
    }

    async function deleteReport(studyUid, reportId) {
        const reports = state.studies[studyUid].reports;
        if (!reports) return;

        const idx = reports.findIndex(report => report.id === reportId);
        if (idx === -1) return;

        const removed = reports.splice(idx, 1)[0];
        updateReportListUI(studyUid);

        const result = await notesApi.deleteReport(studyUid, reportId);
        if (!result && notesApi.isEnabled()) {
            reports.splice(idx, 0, removed);
            updateReportListUI(studyUid);
            alert('Failed to delete report. Please try again.');
        }
    }

    function renderReports(reports, studyUid) {
        if (!reports || reports.length === 0) {
            return '<p class="report-empty">No reports attached</p>';
        }

        return reports.map(report => {
            const icon = report.type === 'pdf' ? '&#128196;' : '&#128247;';
            return `
                <div class="report-item" data-report-id="${escapeHtml(report.id)}">
                    <span class="report-icon">${icon}</span>
                    <span class="report-name">${escapeHtml(report.name)}</span>
                    <span class="report-size">${formatFileSize(report.size)}</span>
                    <span class="report-actions">
                        <button class="report-btn view-report" data-study-uid="${escapeHtml(studyUid)}" data-report-id="${escapeHtml(report.id)}">View</button>
                        <button class="report-btn delete-report" data-study-uid="${escapeHtml(studyUid)}" data-report-id="${escapeHtml(report.id)}">Delete</button>
                    </span>
                </div>
            `;
        }).join('');
    }

    function updateReportListUI(studyUid) {
        const reportList = document.querySelector(`.report-list[data-study-uid="${CSS.escape(studyUid)}"]`);
        if (reportList) {
            reportList.innerHTML = renderReports(state.studies[studyUid].reports, studyUid);
            attachReportEventHandlers(studyUid);
        }

        const btn = document.querySelector(`.report-toggle[data-study-uid="${CSS.escape(studyUid)}"]`);
        if (btn) {
            const count = state.studies[studyUid].reports?.length || 0;
            btn.textContent = count > 0 ? `${count} report${count > 1 ? 's' : ''}` : 'Add report';
        }
    }

    async function viewReport(studyUid, reportId) {
        const report = state.studies[studyUid].reports?.find(item => item.id === reportId);
        if (!report) return;

        const viewer = $('reportViewer');
        const pdfFrame = $('reportPdfFrame');
        const imageView = $('reportImageView');
        const title = $('reportViewerTitle');

        if (viewer.dataset.objectUrl) {
            URL.revokeObjectURL(viewer.dataset.objectUrl);
            delete viewer.dataset.objectUrl;
        }

        let url = '';
        if (report.blob) {
            url = URL.createObjectURL(report.blob);
            viewer.dataset.objectUrl = url;
        } else {
            url = notesApi.getReportFileUrl(report.id);
        }

        if (!url) {
            alert('Report file not available.');
            return;
        }

        pdfFrame.style.display = 'none';
        imageView.style.display = 'none';
        title.textContent = report.name;

        if (report.type === 'pdf') {
            pdfFrame.src = url;
            pdfFrame.style.display = 'block';
        } else {
            imageView.src = url;
            imageView.style.display = 'block';
        }

        viewer.style.display = 'flex';
    }

    function closeReportViewer() {
        const viewer = $('reportViewer');
        const pdfFrame = $('reportPdfFrame');
        const imageView = $('reportImageView');

        if (viewer.dataset.objectUrl) {
            URL.revokeObjectURL(viewer.dataset.objectUrl);
            delete viewer.dataset.objectUrl;
        }

        pdfFrame.src = '';
        imageView.src = '';
        viewer.style.display = 'none';
    }

    function attachReportEventHandlers(studyUid) {
        studiesBody.querySelectorAll(`.view-report[data-study-uid="${CSS.escape(studyUid)}"]`).forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                viewReport(studyUid, btn.dataset.reportId);
            };
        });

        studiesBody.querySelectorAll(`.delete-report[data-study-uid="${CSS.escape(studyUid)}"]`).forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                if (confirm('Delete this report?')) {
                    deleteReport(studyUid, btn.dataset.reportId);
                }
            };
        });
    }

    app.notesReports = {
        addComment,
        addReport,
        attachReportEventHandlers,
        closeReportViewer,
        deleteComment,
        deleteReport,
        editComment,
        loadNotesForStudies,
        migrateIfNeeded,
        renderComments,
        renderReports
    };
})();
