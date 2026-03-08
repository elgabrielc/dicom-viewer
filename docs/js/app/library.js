(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { state } = app;
    const notesApi = window.NotesAPI;
    const config = window.CONFIG;
    const {
        refreshLibraryBtn,
        libraryFolderConfig,
        libraryFolderInput,
        saveLibraryFolderBtn,
        libraryFolderStatus,
        libraryFolderMessage,
        studiesTable,
        studiesBody,
        emptyState,
        emptyStateHint,
        studyCount
    } = app.dom;
    const { escapeHtml, formatDate } = app.utils;
    const { getTransferSyntaxInfo } = app.dicom;
    const { normalizeStudiesPayload, processFilesFromSources } = app.sources;

    const openPanels = {
        studyPanels: new Set(),
        seriesPanels: new Set(),
        seriesDropdowns: new Set()
    };

    const descriptionSaveTimers = new Map();

    function scheduleDescriptionSave(key, callback) {
        const existing = descriptionSaveTimers.get(key);
        if (existing) clearTimeout(existing);
        const handle = setTimeout(() => {
            descriptionSaveTimers.delete(key);
            callback();
        }, 500);
        descriptionSaveTimers.set(key, handle);
    }

    function setLibraryFolderStatus(message, tone = '') {
        if (!message) {
            libraryFolderStatus.style.display = 'none';
            libraryFolderStatus.textContent = '';
            libraryFolderStatus.className = 'library-folder-status';
            return;
        }

        libraryFolderStatus.textContent = message;
        libraryFolderStatus.className = `library-folder-status ${tone}`.trim();
        libraryFolderStatus.style.display = 'block';
    }

    function setLibraryFolderMessage(message, tone = '') {
        if (!message) {
            libraryFolderMessage.style.display = 'none';
            libraryFolderMessage.textContent = '';
            libraryFolderMessage.className = 'library-folder-message';
            return;
        }

        libraryFolderMessage.textContent = message;
        libraryFolderMessage.className = `library-folder-message ${tone}`.trim();
        libraryFolderMessage.style.display = 'block';
    }

    function applyDesktopLibraryScan(folder, studies) {
        state.libraryFolder = folder;
        state.libraryFolderResolved = folder;
        state.libraryFolderSource = 'local';
        state.libraryAvailable = true;
        state.studies = studies;
        applyLibraryConfigPayload({
            folder,
            folderResolved: folder,
            source: 'local'
        });

        if (Object.keys(studies).length > 0) {
            app.desktopLibrary.markScanComplete(folder);
            setLibraryFolderMessage('');
            return true;
        }

        app.desktopLibrary.markScanFailed(folder);
        setLibraryFolderMessage(`No DICOM files found in ${folder}.`, 'warning');
        return false;
    }

    function applyLibraryConfigPayload(payload, options = {}) {
        const { preserveInput = false } = options;
        state.libraryConfigReachable = true;
        state.libraryFolderSource = payload.source || '';
        state.libraryFolderResolved = payload.folderResolved || '';
        state.libraryFolder = payload.folder || '';

        if (!preserveInput) {
            libraryFolderInput.value = state.libraryFolder;
        }

        if (state.libraryFolderSource === 'env') {
            setLibraryFolderStatus(
                'Currently overridden by DICOM_LIBRARY environment variable.',
                'warning'
            );
        } else {
            setLibraryFolderStatus('');
        }
    }

    async function loadLibraryConfig() {
        if (config?.deploymentMode === 'desktop') {
            libraryFolderInput.readOnly = true;
            saveLibraryFolderBtn.textContent = 'Choose...';
            const payload = app.desktopLibrary.getConfig();
            applyLibraryConfigPayload({
                folder: payload.folder || '',
                folderResolved: payload.folder || '',
                source: 'local'
            });
            return payload;
        }

        libraryFolderInput.readOnly = false;
        saveLibraryFolderBtn.textContent = 'Save';

        const response = await fetch('/api/library/config');
        if (!response.ok) throw new Error(`Failed to load library config: ${response.status}`);
        const payload = await response.json().catch(() => {
            throw new Error('Library config response was not valid JSON');
        });
        applyLibraryConfigPayload(payload);
        return payload;
    }

    async function saveLibraryFolderConfig() {
        saveLibraryFolderBtn.disabled = true;
        const previousText = saveLibraryFolderBtn.textContent;
        saveLibraryFolderBtn.textContent = config?.deploymentMode === 'desktop' ? 'Choosing...' : 'Saving...';
        setLibraryFolderMessage('');

        try {
            if (config?.deploymentMode === 'desktop') {
                const folder = await app.desktopLibrary.pickAndSetFolder();
                if (!folder) {
                    setLibraryFolderMessage('Library folder selection canceled.', 'info');
                    return;
                }

                libraryFolderInput.value = folder;

                const files = await app.desktopLibrary.scanFolder(folder);
                const studies = await processFilesFromSources(files);
                if (applyDesktopLibraryScan(folder, studies)) {
                    setLibraryFolderMessage('Library folder updated.', 'success');
                }
                await displayStudies();
                return;
            }

            const folder = libraryFolderInput.value.trim();
            if (!folder) {
                setLibraryFolderMessage('Enter a folder path.', 'error');
                return;
            }

            const response = await fetch('/api/library/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Failed to save library folder: ${response.status}`);
            }

            const result = normalizeStudiesPayload(payload, '/api/library');
            state.libraryAvailable = !!result.available;
            state.studies = result.studies;
            applyLibraryConfigPayload(payload, { preserveInput: !!payload.overridden });

            if (payload.overridden) {
                libraryFolderInput.value = folder;
                setLibraryFolderMessage(
                    'Saved. Will take effect when the DICOM_LIBRARY environment variable is removed.',
                    'info'
                );
            } else {
                setLibraryFolderMessage('Library folder updated.', 'success');
            }

            await displayStudies();
        } catch (e) {
            setLibraryFolderMessage(e.message || 'Failed to save library folder.', 'error');
        } finally {
            saveLibraryFolderBtn.disabled = false;
            saveLibraryFolderBtn.textContent = previousText;
        }
    }

    async function refreshLibrary() {
        if (state.libraryAbort) {
            state.libraryAbort.abort();
            state.libraryAbort = null;
        }

        refreshLibraryBtn.disabled = true;
        const previousText = refreshLibraryBtn.textContent;
        refreshLibraryBtn.textContent = 'Refreshing...';
        try {
            if (config?.deploymentMode === 'desktop') {
                const payload = app.desktopLibrary.getConfig();
                if (!payload.folder) {
                    throw new Error('Choose a library folder first.');
                }

                const files = await app.desktopLibrary.scanFolder(payload.folder);
                const studies = await processFilesFromSources(files);
                applyDesktopLibraryScan(payload.folder, studies);
                await displayStudies();
                return;
            }

            const response = await fetch('/api/library/refresh', { method: 'POST' });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || `Failed to refresh library: ${response.status}`);
            }
            const result = normalizeStudiesPayload(payload, '/api/library');
            state.libraryAvailable = !!result.available;
            if (result.folder) state.libraryFolder = result.folder;
            state.studies = result.studies;
            await displayStudies();
        } catch (e) {
            if (config?.deploymentMode === 'desktop') {
                app.desktopLibrary.markScanFailed(state.libraryFolder);
                state.libraryAvailable = !!state.libraryFolder;
                setLibraryFolderMessage(e.message || 'Failed to refresh library.', 'error');
                await displayStudies();
                return;
            }
            alert(`Failed to refresh library: ${e.message}`);
        } finally {
            refreshLibraryBtn.disabled = false;
            refreshLibraryBtn.textContent = previousText;
        }
    }

    async function displayStudies() {
        const notesReports = app.notesReports;
        const viewer = app.viewer;

        await notesReports.migrateIfNeeded();
        await notesReports.loadNotesForStudies();

        refreshLibraryBtn.style.display = state.libraryAvailable ? 'inline-block' : 'none';
        libraryFolderConfig.style.display = (state.libraryAvailable || state.libraryConfigReachable) ? 'block' : 'none';

        const studies = Object.values(state.studies);
        const { column, direction } = state.studySort;
        studies.sort((a, b) => {
            let aVal;
            let bVal;

            if (column === 'name') {
                aVal = (a.patientName || '').trim().toLocaleLowerCase();
                bVal = (b.patientName || '').trim().toLocaleLowerCase();
            } else {
                aVal = (a.studyDate || '').replace(/\D/g, '');
                bVal = (b.studyDate || '').replace(/\D/g, '');
            }

            if (!aVal && !bVal) {
                return (a.studyInstanceUid || '').localeCompare(b.studyInstanceUid || '');
            }
            if (!aVal) return 1;
            if (!bVal) return -1;

            const cmp = aVal.localeCompare(bVal);
            if (cmp !== 0) {
                return direction === 'asc' ? cmp : -cmp;
            }

            return (a.studyInstanceUid || '').localeCompare(b.studyInstanceUid || '');
        });

        if (!studies.length) {
            emptyState.style.display = 'block';
            studiesTable.style.display = 'none';
            studyCount.textContent = '';
            if (state.libraryAvailable) {
                const folderLabel = state.libraryFolder || 'your library folder';
                emptyStateHint.textContent = `No DICOM files found in ${folderLabel}.`;
            } else {
                emptyStateHint.textContent = 'Drop a DICOM folder above to get started';
            }
            return;
        }

        emptyState.style.display = 'none';
        studiesTable.style.display = 'table';
        studyCount.textContent = `(${studies.length})`;

        let html = '';
        for (const study of studies) {
            const seriesArr = Object.values(study.series);
            if (!Array.isArray(study.comments)) study.comments = [];
            const commentCount = study.comments.length;
            const reportCount = study.reports?.length || 0;

            html += `
                <tr class="study-row" data-uid="${escapeHtml(study.studyInstanceUid)}">
                    <td class="expand-cell"><span class="expand-icon">&#9654;</span></td>
                    <td>${escapeHtml(study.patientName || '-')}</td>
                    <td>${formatDate(study.studyDate)}</td>
                    <td>${escapeHtml(study.studyDescription || '-')}</td>
                    <td><span class="modality-badge">${escapeHtml(study.modality || '-')}</span></td>
                    <td>${study.seriesCount}</td>
                    <td>${study.imageCount}</td>
                    <td class="comment-cell" onclick="event.stopPropagation()">
                        <button class="comment-toggle" data-study-uid="${escapeHtml(study.studyInstanceUid)}">
                            ${commentCount > 0 ? `${commentCount} comment${commentCount > 1 ? 's' : ''}` : 'Add comment'}
                        </button>
                    </td>
                    <td class="report-cell" onclick="event.stopPropagation()">
                        <button class="report-toggle" data-study-uid="${escapeHtml(study.studyInstanceUid)}">
                            ${reportCount > 0 ? `${reportCount} report${reportCount > 1 ? 's' : ''}` : 'Add report'}
                        </button>
                    </td>
                </tr>
                <tr class="comment-panel-row" data-study-uid="${escapeHtml(study.studyInstanceUid)}" style="display: none;">
                    <td colspan="9">
                        <div class="detail-panel">
                            <div class="description-section">
                                <h4>Description</h4>
                                <textarea class="description-input" data-study-uid="${escapeHtml(study.studyInstanceUid)}" placeholder="Add a more detailed description...">${escapeHtml(study.description || '')}</textarea>
                            </div>
                            <div class="comment-section">
                                <h4>Comments</h4>
                                <div class="comment-list">${notesReports.renderComments(study.comments, study.studyInstanceUid)}</div>
                                <div class="comment-add">
                                    <input type="text" class="comment-input add-study-comment" data-study-uid="${escapeHtml(study.studyInstanceUid)}" placeholder="Write a comment...">
                                    <button class="comment-submit" data-study-uid="${escapeHtml(study.studyInstanceUid)}">Add</button>
                                </div>
                            </div>
                            <div class="report-section">
                                <h4>Reports</h4>
                                <div class="report-list" data-study-uid="${escapeHtml(study.studyInstanceUid)}">${notesReports.renderReports(study.reports, study.studyInstanceUid)}</div>
                                <div class="report-upload">
                                    <input type="file" class="report-file-input" data-study-uid="${escapeHtml(study.studyInstanceUid)}" accept=".pdf,.png,.jpg,.jpeg" style="display: none;">
                                    <button class="report-upload-btn" data-study-uid="${escapeHtml(study.studyInstanceUid)}">Upload Report</button>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
                <tr class="series-dropdown-row" data-study-uid="${escapeHtml(study.studyInstanceUid)}" style="display: none;">
                    <td colspan="9">
                        <div class="series-dropdown">
                            ${seriesArr.map(series => {
                                if (!Array.isArray(series.comments)) series.comments = [];
                                const seriesCommentCount = series.comments.length;
                                const tsInfo = getTransferSyntaxInfo(series.transferSyntax);
                                const warningIcon = !tsInfo.supported ? `<span class="format-warning" title="${tsInfo.name} - may not display correctly">&#9888;</span>` : '';
                                return `
                                    <div class="series-dropdown-item" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}">
                                        <div class="series-main-row">
                                            <span class="series-icon">&#128196;</span>
                                            ${warningIcon}
                                            <span class="series-name">${escapeHtml(series.seriesDescription || 'Series ' + (series.seriesNumber || '?'))}</span>
                                            <span class="series-count">${series.slices.length} slices</span>
                                            <button class="comment-toggle series-comment-toggle" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}" onclick="event.stopPropagation()">
                                                ${seriesCommentCount > 0 ? `${seriesCommentCount} comment${seriesCommentCount > 1 ? 's' : ''}` : 'Add comment'}
                                            </button>
                                        </div>
                                        <div class="series-comment-panel" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}" style="display: none;" onclick="event.stopPropagation()">
                                            <div class="detail-panel series-detail-panel">
                                                <div class="description-section">
                                                    <h4>Description</h4>
                                                    <textarea class="description-input series-description" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}" placeholder="Add a more detailed description...">${escapeHtml(series.description || '')}</textarea>
                                                </div>
                                                <div class="comment-section">
                                                    <h4>Comments</h4>
                                                    <div class="comment-list">${notesReports.renderComments(series.comments, study.studyInstanceUid, series.seriesInstanceUid)}</div>
                                                    <div class="comment-add">
                                                        <input type="text" class="comment-input add-series-comment" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}" placeholder="Write a comment...">
                                                        <button class="comment-submit" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}">Add</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </td>
                </tr>
            `;
        }

        studiesBody.innerHTML = html;

        studiesBody.querySelectorAll('.study-row').forEach(row => {
            row.onclick = e => {
                if (e.target.closest('.comment-cell') || e.target.closest('.report-cell')) return;
                const uid = row.dataset.uid;
                const dropdownRow = studiesBody.querySelector(`.series-dropdown-row[data-study-uid="${CSS.escape(uid)}"]`);
                const icon = row.querySelector('.expand-icon');
                const isExpanded = dropdownRow.style.display !== 'none';

                studiesBody.querySelectorAll('.series-dropdown-row').forEach(item => {
                    item.style.display = 'none';
                });
                studiesBody.querySelectorAll('.expand-icon').forEach(item => {
                    item.textContent = '\u25B6';
                    item.classList.remove('expanded');
                });
                openPanels.seriesDropdowns.clear();

                if (!isExpanded) {
                    dropdownRow.style.display = 'table-row';
                    icon.textContent = '\u25BC';
                    icon.classList.add('expanded');
                    openPanels.seriesDropdowns.add(uid);
                }
            };
        });

        studiesBody.querySelectorAll('.comment-toggle:not(.series-comment-toggle)').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const studyUid = btn.dataset.studyUid;
                const panel = studiesBody.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'table-row';
                if (isOpen) {
                    openPanels.studyPanels.delete(studyUid);
                    const count = state.studies[studyUid]?.comments?.length || 0;
                    btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
                } else {
                    openPanels.studyPanels.add(studyUid);
                    btn.textContent = 'Hide comments';
                }
            };
        });

        studiesBody.querySelectorAll('.series-comment-toggle').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const studyUid = btn.dataset.studyUid;
                const seriesUid = btn.dataset.seriesUid;
                const key = `${studyUid}:${seriesUid}`;
                const panel = studiesBody.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'block';
                if (isOpen) {
                    openPanels.seriesPanels.delete(key);
                    const count = state.studies[studyUid]?.series[seriesUid]?.comments?.length || 0;
                    btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
                } else {
                    openPanels.seriesPanels.add(key);
                    btn.textContent = 'Hide comments';
                }
            };
        });

        studiesBody.querySelectorAll('.series-main-row').forEach(row => {
            row.onclick = e => {
                if (e.target.closest('.comment-toggle')) return;
                const item = row.closest('.series-dropdown-item');
                viewer.openViewerWithSeries(item.dataset.studyUid, item.dataset.seriesUid);
            };
        });

        studiesBody.querySelectorAll('.comment-submit:not([data-series-uid])').forEach(btn => {
            btn.onclick = () => {
                const studyUid = btn.dataset.studyUid;
                const input = studiesBody.querySelector(`.add-study-comment[data-study-uid="${CSS.escape(studyUid)}"]`);
                notesReports.addComment(studyUid, null, input.value);
            };
        });

        studiesBody.querySelectorAll('.comment-submit[data-series-uid]').forEach(btn => {
            btn.onclick = () => {
                const studyUid = btn.dataset.studyUid;
                const seriesUid = btn.dataset.seriesUid;
                const input = studiesBody.querySelector(`.add-series-comment[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                notesReports.addComment(studyUid, seriesUid, input.value);
            };
        });

        studiesBody.querySelectorAll('.comment-input').forEach(input => {
            input.onkeydown = e => {
                if (e.key === 'Enter') {
                    const studyUid = input.dataset.studyUid;
                    const seriesUid = input.dataset.seriesUid || null;
                    notesReports.addComment(studyUid, seriesUid, input.value);
                }
            };
        });

        studiesBody.querySelectorAll('.edit-comment').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                notesReports.editComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
            };
        });
        studiesBody.querySelectorAll('.delete-comment').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                notesReports.deleteComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
            };
        });

        studiesBody.querySelectorAll('.description-input:not(.series-description)').forEach(textarea => {
            textarea.oninput = () => {
                const studyUid = textarea.dataset.studyUid;
                if (state.studies[studyUid]) {
                    state.studies[studyUid].description = textarea.value;
                    scheduleDescriptionSave(`study:${studyUid}`, () => {
                        notesApi.saveStudyDescription(studyUid, textarea.value);
                    });
                }
            };
        });

        studiesBody.querySelectorAll('.series-description').forEach(textarea => {
            textarea.oninput = () => {
                const studyUid = textarea.dataset.studyUid;
                const seriesUid = textarea.dataset.seriesUid;
                if (state.studies[studyUid]?.series[seriesUid]) {
                    state.studies[studyUid].series[seriesUid].description = textarea.value;
                    scheduleDescriptionSave(`series:${studyUid}:${seriesUid}`, () => {
                        notesApi.saveSeriesDescription(studyUid, seriesUid, textarea.value);
                    });
                }
            };
        });

        openPanels.studyPanels.forEach(studyUid => {
            const panel = studiesBody.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
            if (panel) panel.style.display = 'table-row';
            const btn = studiesBody.querySelector(`.comment-toggle[data-study-uid="${CSS.escape(studyUid)}"]:not(.series-comment-toggle)`);
            if (btn) btn.textContent = 'Hide comments';
        });
        openPanels.seriesPanels.forEach(key => {
            const [studyUid, seriesUid] = key.split(':');
            const panel = studiesBody.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
            if (panel) panel.style.display = 'block';
            const btn = studiesBody.querySelector(`.series-comment-toggle[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
            if (btn) btn.textContent = 'Hide comments';
            const dropdown = studiesBody.querySelector(`.series-dropdown-row[data-study-uid="${CSS.escape(studyUid)}"]`);
            if (dropdown) dropdown.style.display = 'table-row';
            const icon = studiesBody.querySelector(`.study-row[data-uid="${CSS.escape(studyUid)}"] .expand-icon`);
            if (icon) {
                icon.textContent = '\u25BC';
                icon.classList.add('expanded');
            }
        });
        openPanels.seriesDropdowns.forEach(studyUid => {
            const dropdown = studiesBody.querySelector(`.series-dropdown-row[data-study-uid="${CSS.escape(studyUid)}"]`);
            if (dropdown) dropdown.style.display = 'table-row';
            const icon = studiesBody.querySelector(`.study-row[data-uid="${CSS.escape(studyUid)}"] .expand-icon`);
            if (icon) {
                icon.textContent = '\u25BC';
                icon.classList.add('expanded');
            }
        });

        studiesBody.querySelectorAll('.report-toggle').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const studyUid = btn.dataset.studyUid;
                const panel = studiesBody.querySelector(`.comment-panel-row[data-study-uid="${CSS.escape(studyUid)}"]`);
                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'table-row';
                if (isOpen) {
                    openPanels.studyPanels.delete(studyUid);
                } else {
                    openPanels.studyPanels.add(studyUid);
                }
            };
        });

        studiesBody.querySelectorAll('.report-upload-btn').forEach(btn => {
            const studyUid = btn.dataset.studyUid;
            const fileInput = studiesBody.querySelector(`.report-file-input[data-study-uid="${CSS.escape(studyUid)}"]`);
            btn.onclick = e => {
                e.stopPropagation();
                fileInput.click();
            };
            fileInput.onchange = async () => {
                const file = fileInput.files[0];
                if (file) {
                    await notesReports.addReport(studyUid, file);
                    fileInput.value = '';
                }
            };
        });

        Object.keys(state.studies).forEach(studyUid => {
            notesReports.attachReportEventHandlers(studyUid);
        });

        document.querySelectorAll('.sortable').forEach(th => {
            const arrow = th.querySelector('.sort-arrow');
            if (!arrow) return;

            if (th.dataset.sort === state.studySort.column) {
                arrow.textContent = state.studySort.direction === 'asc' ? ' \u25B2' : ' \u25BC';
                th.setAttribute('aria-sort', state.studySort.direction === 'asc' ? 'ascending' : 'descending');
            } else {
                arrow.textContent = '';
                th.setAttribute('aria-sort', 'none');
            }
        });
    }

    function handleSortClick(e) {
        const th = e.target.closest('.sortable');
        if (!th) return;

        const column = th.dataset.sort;
        if (state.studySort.column === column) {
            state.studySort.direction = state.studySort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            state.studySort.column = column;
            state.studySort.direction = column === 'date' ? 'desc' : 'asc';
        }

        displayStudies();
    }

    app.library = {
        applyDesktopLibraryScan,
        applyLibraryConfigPayload,
        displayStudies,
        handleSortClick,
        loadLibraryConfig,
        refreshLibrary,
        saveLibraryFolderConfig,
        setLibraryFolderMessage,
        setLibraryFolderStatus
    };
})();
