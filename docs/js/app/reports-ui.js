// Reports UI - report CRUD, rendering, viewer modal, event handlers
// Copyright (c) 2026 Divergent Health Technologies

(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const notesApi = window.NotesAPI;
    const { $, studiesBody } = app.dom;
    const { escapeHtml, generateUUID } = app.utils;

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

    app.reportsUi = {
        addReport,
        attachReportEventHandlers,
        closeReportViewer,
        deleteReport,
        renderReports,
        viewReport
    };
})();
