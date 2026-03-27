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
        // Filter out soft-deleted reports before rendering
        const activeReports = (reports || []).filter(report => !report.deletedAt);
        if (activeReports.length === 0) {
            return '<p class="report-empty">No reports attached</p>';
        }

        return activeReports.map(report => {
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
            const count = (state.studies[studyUid].reports || []).filter(r => !r.deletedAt).length;
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

    // -- Context menu (shared helpers on app.contextMenu) --

    if (!app.contextMenu) {
        let activeMenu = null;
        app.contextMenu = {
            dismiss() {
                if (activeMenu) {
                    activeMenu.remove();
                    activeMenu = null;
                }
            },
            show(e, items = []) {
                e.preventDefault();
                e.stopPropagation();
                app.contextMenu.dismiss();

                if (!Array.isArray(items) || items.length === 0) {
                    return;
                }

                const menu = document.createElement('div');
                menu.className = 'report-context-menu';

                for (const item of items) {
                    if (item.separator) {
                        const sep = document.createElement('div');
                        sep.className = 'report-context-sep';
                        menu.appendChild(sep);
                        continue;
                    }

                    if (item.meta) {
                        const meta = document.createElement('div');
                        meta.className = 'report-context-meta';
                        meta.textContent = item.meta;
                        menu.appendChild(meta);
                        continue;
                    }

                    const actionItem = document.createElement('div');
                    actionItem.className = 'report-context-item';
                    actionItem.textContent = item.label;
                    actionItem.addEventListener('click', () => {
                        app.contextMenu.dismiss();
                        item.action();
                    });
                    menu.appendChild(actionItem);
                }

                menu.style.visibility = 'hidden';
                document.body.appendChild(menu);
                const rect = menu.getBoundingClientRect();
                const x = Math.min(e.clientX, window.innerWidth - rect.width - 8);
                const y = Math.min(e.clientY, window.innerHeight - rect.height - 8);
                menu.style.left = `${x}px`;
                menu.style.top = `${y}px`;
                menu.style.visibility = '';
                activeMenu = menu;
            }
        };

        document.addEventListener('click', () => app.contextMenu.dismiss());
        document.addEventListener('contextmenu', (e) => {
            if (activeMenu && !activeMenu.contains(e.target)) {
                app.contextMenu.dismiss();
            }
        });
    }

    if (!app.desktopBridge) {
        app.desktopBridge = {
            async getRuntime() {
                const runtime = window.__TAURI__;
                if (typeof runtime?.core?.invoke === 'function') {
                    return runtime;
                }

                const ready = window.__DICOM_VIEWER_TAURI_READY__;
                if (ready && typeof ready.then === 'function') {
                    const resolved = await ready;
                    if (typeof resolved?.core?.invoke === 'function') {
                        return resolved;
                    }
                }

                return window.__TAURI__ || null;
            },
            async revealInFinder(path) {
                if (!path) return false;

                try {
                    const runtime = await this.getRuntime();
                    const invoke = runtime?.core?.invoke;
                    if (typeof invoke !== 'function') {
                        return false;
                    }

                    await invoke('reveal_in_finder', { path });
                    return true;
                } catch (err) {
                    console.error('Failed to reveal in Finder:', err);
                    return false;
                }
            }
        };
    }

    const { show: showContextMenu } = app.contextMenu;

    function formatTimestamp(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const year = String(d.getFullYear()).slice(2);
        let hours = d.getHours();
        const mins = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${month}/${day}/${year} ${hours}:${mins} ${ampm}`;
    }

    function showReportContextMenu(e, studyUid, reportId) {
        const report = state.studies[studyUid]?.reports?.find(r => r.id === reportId);
        if (!report) return;

        const isDesktop = typeof CONFIG !== 'undefined' && CONFIG.deploymentMode === 'desktop';
        const items = [];

        if (isDesktop) {
            items.push({ label: 'Reveal in Finder', action: () => revealReportInFinder(reportId) });
        }

        const addedAt = report.addedAt || report.added_at;
        if (addedAt) {
            if (isDesktop) items.push({ separator: true });
            items.push({ meta: `Added ${formatTimestamp(addedAt)}` });
        }

        showContextMenu(e, items);
    }

    async function revealReportInFinder(reportId) {
        const filePath = notesApi.getReportFilePath(reportId);
        if (!filePath) return;
        await app.desktopBridge.revealInFinder(filePath);
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

        studiesBody.querySelectorAll(`.report-item[data-report-id]`).forEach(item => {
            item.oncontextmenu = e => {
                e.preventDefault();
                e.stopPropagation();
                const reportId = item.dataset.reportId;
                const studyEl = item.closest('.report-list');
                const uid = studyEl?.dataset.studyUid || studyUid;
                showReportContextMenu(e, uid, reportId);
            };
        });

        // Right-click on the "1 report" toggle button
        const toggle = studiesBody.querySelector(`.report-toggle[data-study-uid="${CSS.escape(studyUid)}"]`);
        if (toggle) {
            toggle.oncontextmenu = e => {
                e.preventDefault();
                e.stopPropagation();

                const reports = (state.studies[studyUid]?.reports || []).filter(r => !r.deletedAt);
                if (reports.length === 0) return;

                // Single report: show context menu directly
                if (reports.length === 1) {
                    showReportContextMenu(e, studyUid, reports[0].id);
                    return;
                }

                // Multiple reports: expand the panel so user can right-click individual items
                toggle.click();
            };
        }
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
