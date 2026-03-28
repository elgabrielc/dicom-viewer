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
    const { normalizeStudiesPayload } = app.sources;

    // -- Reveal in Finder helpers --

    function normalizeFinderPath(path) {
        return String(path || '')
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/');
    }

    function getParentDirectory(path) {
        const normalized = normalizeFinderPath(path);
        if (!normalized) return '';

        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash < 0) return '';
        if (lastSlash === 0) return '/';
        return normalized.slice(0, lastSlash);
    }

    function getSharedParentDirectory(paths) {
        const normalizedPaths = paths
            .map(normalizeFinderPath)
            .filter(Boolean);
        if (!normalizedPaths.length) return '';
        if (normalizedPaths.length === 1) return normalizedPaths[0];

        const splitPaths = normalizedPaths.map((path) => {
            const hasRoot = path.startsWith('/');
            const body = hasRoot ? path.slice(1) : path;
            const segments = body ? body.split('/') : [];
            return hasRoot ? [''].concat(segments) : segments;
        });

        let sharedLength = splitPaths[0].length;
        for (const segments of splitPaths.slice(1)) {
            let index = 0;
            while (
                index < sharedLength
                && index < segments.length
                && segments[index] === splitPaths[0][index]
            ) {
                index += 1;
            }
            sharedLength = index;
            if (sharedLength === 0) break;
        }

        if (sharedLength === 0) return '';

        const sharedSegments = splitPaths[0].slice(0, sharedLength);
        if (sharedSegments.length === 1 && sharedSegments[0] === '') {
            return '/';
        }
        return sharedSegments.join('/');
    }

    function getStudyFolderPath(studyUid) {
        const study = state.studies[studyUid];
        if (!study?.series) return '';

        const directories = [];
        for (const series of Object.values(study.series)) {
            const filePath = series.slices?.[0]?.source?.path;
            const parentDir = getParentDirectory(filePath);
            if (parentDir) {
                directories.push(parentDir);
            }
        }

        if (directories.length === 0) return '';
        if (directories.length === 1) return directories[0];
        return getSharedParentDirectory(directories) || directories[0];
    }

    function getSeriesFilePath(studyUid, seriesUid) {
        return state.studies[studyUid]?.series?.[seriesUid]?.slices?.[0]?.source?.path || '';
    }

    async function revealInFinder(path) {
        if (!path || typeof app.desktopBridge?.revealInFinder !== 'function') return;
        await app.desktopBridge.revealInFinder(path);
    }

    const openPanels = {
        studyPanels: new Set(),
        seriesPanels: new Map(),
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

    function rememberOpenSeriesPanel(studyUid, seriesUid) {
        let seriesUids = openPanels.seriesPanels.get(studyUid);
        if (!seriesUids) {
            seriesUids = new Set();
            openPanels.seriesPanels.set(studyUid, seriesUids);
        }
        seriesUids.add(seriesUid);
    }

    function forgetOpenSeriesPanel(studyUid, seriesUid) {
        const seriesUids = openPanels.seriesPanels.get(studyUid);
        if (!seriesUids) return;
        seriesUids.delete(seriesUid);
        if (!seriesUids.size) {
            openPanels.seriesPanels.delete(studyUid);
        }
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

    function applyDesktopLibraryStudies(folder, studies) {
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
    }

    async function applyDesktopLibraryScan(folder, studies) {
        applyDesktopLibraryStudies(folder, studies);
        state.lastScan = Date.now();
        if (Object.keys(studies).length > 0) {
            await app.desktopLibrary.markScanComplete(folder);
            setLibraryFolderMessage('');
            updateLibraryStatusFooter();
            return true;
        }

        await app.desktopLibrary.markScanFailed(folder);
        setLibraryFolderMessage(`No DICOM files found in ${folder}.`, 'warning');
        updateLibraryStatusFooter();
        return false;
    }

    async function applyDesktopLibrarySnapshot(folder, studies) {
        applyDesktopLibraryStudies(folder, studies);
        return Object.keys(studies).length > 0;
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

    function updateDesktopScanMessage(stats, label = 'Scanning library folder...') {
        if (!stats) {
            setLibraryFolderMessage(label, 'info');
            return;
        }

        if (!stats.discovered) {
            setLibraryFolderMessage(label, 'info');
            return;
        }

        setLibraryFolderMessage(
            `${label} ${stats.processed}/${stats.discovered} files processed (${stats.valid} viewable DICOM).`,
            'info'
        );
    }

    async function loadLibraryConfig() {
        // Wire the "choose a folder" link (once)
        const chooseLink = document.getElementById('chooseImportFolder');
        if (chooseLink && !chooseLink._wired) {
            chooseLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                saveLibraryFolderConfig();
            });
            chooseLink._wired = true;
        }

        if (config?.deploymentMode === 'desktop') {
            libraryFolderInput.readOnly = true;
            saveLibraryFolderBtn.textContent = 'Choose...';

            // In managed mode, hide the folder config section and show
            // consumer-friendly UI elements instead
            if (state.managedLibrary) {
                libraryFolderConfig.style.display = 'none';
                if (chooseLink) chooseLink.style.display = 'inline-block';
                const mainText = document.querySelector('#folderZone .main-text');
                if (mainText) mainText.textContent = 'Drop a folder to import';
            } else {
                if (chooseLink) chooseLink.style.display = 'none';
            }

            const payload = await app.desktopLibrary.getConfig();
            applyLibraryConfigPayload({
                folder: payload.folder || '',
                folderResolved: payload.folder || '',
                source: 'local'
            });
            return payload;
        }

        // Non-desktop modes: hide managed-only elements
        if (chooseLink) chooseLink.style.display = 'none';

        libraryFolderInput.readOnly = false;
        saveLibraryFolderBtn.textContent = 'Save';

        const response = await notesApi.authenticatedFetch('/api/library/config');
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

                if (state.managedLibrary) {
                    // Import already ran inside pickAndSetFolder; now rescan the managed library
                    const libraryPath = await app.importPipeline.getLibraryPath();
                    const studies = await app.desktopLibrary.loadStudies(libraryPath, {
                        onProgress: stats => updateDesktopScanMessage(stats)
                    });
                    await applyDesktopLibraryScan(libraryPath, studies);
                    setLibraryFolderMessage('Import complete. Library updated.', 'success');
                } else {
                    libraryFolderInput.value = folder;
                    const studies = await app.desktopLibrary.loadStudies(folder, {
                        onProgress: stats => updateDesktopScanMessage(stats)
                    });
                    if (await applyDesktopLibraryScan(folder, studies)) {
                        setLibraryFolderMessage('Library folder updated.', 'success');
                    }
                }
                await displayStudies();
                return;
            }

            const folder = libraryFolderInput.value.trim();
            if (!folder) {
                setLibraryFolderMessage('Enter a folder path.', 'error');
                return;
            }

            const response = await notesApi.authenticatedFetch('/api/library/config', {
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
                let scanFolder;
                if (state.managedLibrary) {
                    scanFolder = await app.importPipeline.getLibraryPath();
                } else {
                    const payload = await app.desktopLibrary.getConfig();
                    if (!payload.folder) {
                        throw new Error('Choose a library folder first.');
                    }
                    scanFolder = payload.folder;
                }

                const studies = await app.desktopLibrary.loadStudies(scanFolder, {
                    onProgress: stats => updateDesktopScanMessage(stats)
                });
                await applyDesktopLibraryScan(scanFolder, studies);
                await displayStudies();
                return;
            }

            const response = await notesApi.authenticatedFetch('/api/library/refresh', { method: 'POST' });
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
                await app.desktopLibrary.markScanFailed(state.libraryFolder);
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
        const notesUi = app.notesUi;
        const commentsUi = app.commentsUi;
        const reportsUi = app.reportsUi;
        const viewer = app.viewer;

        await notesUi.migrateIfNeeded();
        await notesUi.loadNotesForStudies();

        refreshLibraryBtn.style.display = state.libraryAvailable ? 'inline-block' : 'none';

        // In managed desktop mode, keep folder config hidden
        if (config?.deploymentMode === 'desktop' && state.managedLibrary) {
            libraryFolderConfig.style.display = 'none';
        } else {
            libraryFolderConfig.style.display = (state.libraryAvailable || state.libraryConfigReachable) ? 'block' : 'none';
        }

        // Toggle compact drop zone and de-emphasized samples in managed mode
        const folderZone = document.getElementById('folderZone');
        const sampleSection = document.querySelector('.sample-section');
        const hasStudies = Object.keys(state.studies).length > 0;

        if (state.managedLibrary && hasStudies) {
            if (folderZone) folderZone.classList.add('compact');
            if (sampleSection) sampleSection.classList.add('de-emphasized');
        } else {
            if (folderZone) folderZone.classList.remove('compact');
            if (sampleSection) sampleSection.classList.remove('de-emphasized');
        }

        updateLibraryStatusFooter();

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
                    <td class="comment-cell" onclick="event.stopPropagation()" oncontextmenu="event.preventDefault(); event.stopPropagation()">
                        <button class="comment-toggle" data-study-uid="${escapeHtml(study.studyInstanceUid)}" oncontextmenu="event.preventDefault(); event.stopPropagation()">
                            ${commentCount > 0 ? `${commentCount} comment${commentCount > 1 ? 's' : ''}` : 'Add comment'}
                        </button>
                    </td>
                    <td class="report-cell" onclick="event.stopPropagation()" oncontextmenu="event.preventDefault(); event.stopPropagation()">
                        <button class="report-toggle" data-study-uid="${escapeHtml(study.studyInstanceUid)}" oncontextmenu="event.preventDefault(); event.stopPropagation()">
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
                                <div class="comment-list">${commentsUi.renderComments(study.comments, study.studyInstanceUid)}</div>
                                <div class="comment-add">
                                    <input type="text" class="comment-input add-study-comment" data-study-uid="${escapeHtml(study.studyInstanceUid)}" placeholder="Write a comment...">
                                    <button class="comment-submit" data-study-uid="${escapeHtml(study.studyInstanceUid)}">Add</button>
                                </div>
                            </div>
                            <div class="report-section">
                                <h4>Reports</h4>
                                <div class="report-list" data-study-uid="${escapeHtml(study.studyInstanceUid)}">${reportsUi.renderReports(study.reports, study.studyInstanceUid)}</div>
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
                                            <button class="comment-toggle series-comment-toggle" data-study-uid="${escapeHtml(study.studyInstanceUid)}" data-series-uid="${escapeHtml(series.seriesInstanceUid)}" onclick="event.stopPropagation()" oncontextmenu="event.preventDefault(); event.stopPropagation()">
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
                                                    <div class="comment-list">${commentsUi.renderComments(series.comments, study.studyInstanceUid, series.seriesInstanceUid)}</div>
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
                const panel = studiesBody.querySelector(`.series-comment-panel[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'block';
                if (isOpen) {
                    forgetOpenSeriesPanel(studyUid, seriesUid);
                    const count = state.studies[studyUid]?.series[seriesUid]?.comments?.length || 0;
                    btn.textContent = count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Add comment';
                } else {
                    rememberOpenSeriesPanel(studyUid, seriesUid);
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

        if (config?.deploymentMode === 'desktop' && app.contextMenu) {
            studiesBody.oncontextmenu = (e) => {
                const seriesCommentToggle = e.target.closest('.series-comment-toggle');
                const commentCell = e.target.closest('.comment-cell');
                const reportCell = e.target.closest('.report-cell');
                const seriesMainRow = e.target.closest('.series-main-row');
                const studyRow = e.target.closest('.study-row');

                if (!(seriesCommentToggle || commentCell || reportCell || seriesMainRow || studyRow)) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                if (seriesCommentToggle || commentCell || reportCell) {
                    return;
                }

                if (seriesMainRow) {
                    const item = seriesMainRow.closest('.series-dropdown-item');
                    const filePath = getSeriesFilePath(item.dataset.studyUid, item.dataset.seriesUid);
                    if (!filePath) return;

                    app.contextMenu.show(e, [
                        { label: 'Reveal in Finder', action: () => revealInFinder(filePath) }
                    ]);
                    return;
                }

                if (studyRow) {
                    const folderPath = getStudyFolderPath(studyRow.dataset.uid);
                    if (!folderPath) return;

                    app.contextMenu.show(e, [
                        { label: 'Reveal in Finder', action: () => revealInFinder(folderPath) }
                    ]);
                    return;
                }
            };
        } else {
            studiesBody.oncontextmenu = null;
        }

        studiesBody.querySelectorAll('.comment-submit:not([data-series-uid])').forEach(btn => {
            btn.onclick = () => {
                const studyUid = btn.dataset.studyUid;
                const input = studiesBody.querySelector(`.add-study-comment[data-study-uid="${CSS.escape(studyUid)}"]`);
                commentsUi.addComment(studyUid, null, input.value);
            };
        });

        studiesBody.querySelectorAll('.comment-submit[data-series-uid]').forEach(btn => {
            btn.onclick = () => {
                const studyUid = btn.dataset.studyUid;
                const seriesUid = btn.dataset.seriesUid;
                const input = studiesBody.querySelector(`.add-series-comment[data-study-uid="${CSS.escape(studyUid)}"][data-series-uid="${CSS.escape(seriesUid)}"]`);
                commentsUi.addComment(studyUid, seriesUid, input.value);
            };
        });

        studiesBody.querySelectorAll('.comment-input').forEach(input => {
            input.onkeydown = e => {
                if (e.key === 'Enter') {
                    const studyUid = input.dataset.studyUid;
                    const seriesUid = input.dataset.seriesUid || null;
                    commentsUi.addComment(studyUid, seriesUid, input.value);
                }
            };
        });

        studiesBody.querySelectorAll('.edit-comment').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                commentsUi.editComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
            };
        });
        studiesBody.querySelectorAll('.delete-comment').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                commentsUi.deleteComment(btn.dataset.studyUid, btn.dataset.seriesUid || null, btn.dataset.commentId);
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
        openPanels.seriesPanels.forEach((seriesUids, studyUid) => {
            seriesUids.forEach(seriesUid => {
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
                    await reportsUi.addReport(studyUid, file);
                    fileInput.value = '';
                }
            };
        });

        Object.keys(state.studies).forEach(studyUid => {
            reportsUi.attachReportEventHandlers(studyUid);
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

    function updateLibraryStatusFooter() {
        const footer = document.getElementById('libraryStatusFooter');
        const statsEl = document.getElementById('libraryStatusStats');
        const timestampEl = document.getElementById('libraryStatusTimestamp');
        if (!footer || !statsEl || !timestampEl) return;

        const studyKeys = Object.keys(state.studies);
        if (!state.managedLibrary || studyKeys.length === 0) {
            footer.style.display = 'none';
            return;
        }

        footer.style.display = 'flex';
        const count = studyKeys.length;
        statsEl.textContent = `${count} ${count === 1 ? 'study' : 'studies'}`;

        // Relative timestamp from state.lastScan (only show when we have a real value)
        if (state.lastScan && typeof state.lastScan === 'number') {
            const elapsed = Date.now() - state.lastScan;
            if (elapsed < 60000) {
                timestampEl.textContent = 'Last updated just now';
            } else if (elapsed < 3600000) {
                const mins = Math.floor(elapsed / 60000);
                timestampEl.textContent = `Last updated ${mins}m ago`;
            } else {
                const hours = Math.floor(elapsed / 3600000);
                timestampEl.textContent = `Last updated ${hours}h ago`;
            }
        } else {
            timestampEl.textContent = '';
        }
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

    // -- Import progress & result UI --

    let dismissHandlerWired = false;

    function updateImportProgress(stats) {
        const container = document.getElementById('importProgress');
        const textEl = document.getElementById('importProgressText');
        const detailEl = document.getElementById('importProgressDetail');
        const fillEl = document.getElementById('importProgressFill');
        if (!container || !textEl || !detailEl || !fillEl) return;

        if (!stats || stats.phase === 'complete') {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';

        // Phase-appropriate heading
        if (stats.phase === 'scanning') {
            textEl.textContent = 'Scanning source folder...';
        } else if (stats.phase === 'importing') {
            textEl.textContent = 'Importing files...';
        } else if (stats.phase === 'preparing') {
            textEl.textContent = 'Preparing import...';
        } else {
            textEl.textContent = 'Importing...';
        }

        // Detail line: processed/discovered with breakdown
        const processed = stats.processed || 0;
        const discovered = stats.discovered || 0;
        const copied = stats.copied || 0;
        const skipped = stats.skipped || 0;
        const invalid = stats.invalid || 0;
        const errors = stats.errors || 0;

        const parts = [];
        if (copied > 0) parts.push(`${copied} copied`);
        if (skipped > 0) parts.push(`${skipped} skipped`);
        if (invalid > 0) parts.push(`${invalid} invalid`);
        if (errors > 0) parts.push(`${errors} errors`);

        let detail = `${processed}/${discovered} files processed`;
        if (parts.length > 0) {
            detail += ` (${parts.join(', ')})`;
        }
        detailEl.textContent = detail;

        // Progress bar width
        const pct = discovered > 0 ? Math.min(100, Math.round((processed / discovered) * 100)) : 0;
        fillEl.style.width = `${pct}%`;
        // Override the pulse animation with a determinate bar
        fillEl.style.animation = 'none';
    }

    function hideImportProgress() {
        const container = document.getElementById('importProgress');
        if (container) container.style.display = 'none';
    }

    function displayImportResult(result) {
        const banner = document.getElementById('importResultBanner');
        const textEl = document.getElementById('importResultText');
        const dismissBtn = document.getElementById('importResultDismiss');
        if (!banner || !textEl) return;

        const imported = result.imported || 0;
        const skipped = result.skipped || 0;
        const invalid = result.invalid || 0;
        const errors = result.errors || 0;
        const collisions = result.collisions || 0;
        const duration = result.duration;

        // Build summary message
        const messageParts = [];
        messageParts.push(`Imported ${imported} file${imported !== 1 ? 's' : ''}`);
        if (skipped > 0) {
            messageParts.push(`${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped`);
        }
        if (invalid > 0) {
            messageParts.push(`${invalid} invalid`);
        }
        if (errors > 0) {
            messageParts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
        }

        let message = messageParts.join('. ') + '.';
        if (duration != null) {
            const seconds = (duration / 1000).toFixed(1);
            message += ` (${seconds}s)`;
        }
        if (collisions > 0) {
            message += ` Warning: ${collisions} file collision${collisions !== 1 ? 's' : ''} detected.`;
        }

        textEl.textContent = message;

        // Tone: warning if there were errors or collisions, success otherwise
        const hasIssues = errors > 0 || collisions > 0;
        banner.className = `import-result-banner ${hasIssues ? 'warning' : 'success'}`;
        banner.style.display = 'flex';

        // Wire dismiss button on first call
        if (!dismissHandlerWired && dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                banner.style.display = 'none';
            });
            dismissHandlerWired = true;
        }
    }

    app.library = {
        applyDesktopLibraryScan,
        applyDesktopLibrarySnapshot,
        applyLibraryConfigPayload,
        displayImportResult,
        displayStudies,
        handleSortClick,
        hideImportProgress,
        loadLibraryConfig,
        refreshLibrary,
        saveLibraryFolderConfig,
        setLibraryFolderMessage,
        setLibraryFolderStatus,
        updateDesktopScanMessage,
        updateImportProgress,
        updateLibraryStatusFooter
    };
})();
