(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { uploadProgress, progressFill, progressText, progressDetail } = app.dom;
    const { parseDicomMetadata } = app.dicom;
    const DESKTOP_MAX_SCAN_DEPTH = 20;

    function updateScanProgress(processed, total, valid) {
        if (processed % 200 !== 0 && processed !== total) return;

        const pct = Math.round((processed / total) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = `Scanning... ${pct}%`;
        progressDetail.textContent = `${processed}/${total} files (${valid} DICOM)`;
    }

    function addSliceToStudies(studies, meta, source) {
        const studyUid = meta.studyInstanceUid;
        const seriesUid = meta.seriesInstanceUid || 'default';

        if (!studies[studyUid]) {
            studies[studyUid] = {
                ...meta,
                series: {},
                seriesCount: 0,
                imageCount: 0,
                comments: [],
                reports: []
            };
        }
        if (!studies[studyUid].series[seriesUid]) {
            studies[studyUid].series[seriesUid] = {
                seriesInstanceUid: seriesUid,
                seriesDescription: meta.seriesDescription,
                seriesNumber: meta.seriesNumber,
                transferSyntax: meta.transferSyntax,
                slices: [],
                comments: []
            };
        }
        studies[studyUid].series[seriesUid].slices.push({
            source,
            instanceNumber: meta.instanceNumber,
            sliceLocation: meta.sliceLocation
        });
    }

    function finalizeStudies(studies) {
        for (const study of Object.values(studies)) {
            let count = 0;
            for (const series of Object.values(study.series)) {
                series.slices.sort((a, b) => a.instanceNumber - b.instanceNumber || a.sliceLocation - b.sliceLocation);
                count += series.slices.length;
            }
            study.seriesCount = Object.keys(study.series).length;
            study.imageCount = count;
        }
        return studies;
    }

    async function joinPath(parent, child) {
        const pathApi = window.__TAURI__?.path;
        if (pathApi?.join) {
            return pathApi.join(parent, child);
        }

        const separator = parent.includes('\\') ? '\\' : '/';
        return parent.endsWith(separator) ? `${parent}${child}` : `${parent}${separator}${child}`;
    }

    async function normalizePath(path) {
        const pathApi = window.__TAURI__?.path;
        if (pathApi?.normalize) {
            try {
                return await pathApi.normalize(path);
            } catch (e) {
                console.warn('Failed to normalize desktop path:', path, e);
            }
        }
        return path;
    }

    function getPathName(path) {
        return path.split(/[\\/]/).pop() || path;
    }

    async function getAllFileHandles(dirHandle) {
        const files = [];
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === 'file') {
                files.push({ handle, name });
            } else if (handle.kind === 'directory') {
                files.push(...await getAllFileHandles(handle));
            }
        }
        return files;
    }

    async function processFiles(fileHandles) {
        const files = fileHandles.map(({ handle, name }) => ({
            name,
            source: { kind: 'handle', handle }
        }));
        return processFilesFromSources(files);
    }

    async function processFilesFromSources(files) {
        const studies = {};
        const total = files.length;
        let processed = 0;
        let valid = 0;

        const batchSize = 100;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(async ({ name, source }) => {
                try {
                    const buffer = await readSliceBuffer({ source }, 'scan');
                    const meta = await parseDicomMetadata(new Blob([buffer], { type: 'application/dicom' }));
                    if (!meta?.studyInstanceUid) return;
                    valid++;
                    addSliceToStudies(studies, meta, source);
                } catch (e) {
                    console.warn(`Skipping unreadable DICOM file during scan: ${name}`, e);
                } finally {
                    processed++;
                    updateScanProgress(processed, total, valid);
                }
            }));
        }

        return finalizeStudies(studies);
    }

    async function readSliceBuffer(slice, purpose = 'load') {
        const source = slice.source;

        switch (source?.kind) {
            case 'handle':
                return (await source.handle.getFile()).arrayBuffer();
            case 'blob':
                return source.blob.arrayBuffer();
            case 'api': {
                const resp = await fetch(
                    `${source.apiBase}/dicom/${source.studyId}/${source.seriesId}/${source.sliceIndex}`
                );
                if (!resp.ok) throw new Error(`Failed to ${purpose} slice: ${resp.status}`);
                return resp.arrayBuffer();
            }
            case 'path': {
                const bytes = await window.__TAURI__.fs.readFile(source.path);
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            }
            default:
                throw new Error(`Unknown source kind: ${source?.kind}`);
        }
    }

    function normalizeStudiesPayload(payload, apiBase) {
        const studiesArray = Array.isArray(payload) ? payload : (payload.studies || []);
        const studies = {};

        for (const study of studiesArray) {
            const seriesMap = {};
            for (const series of (study.series || [])) {
                seriesMap[series.seriesInstanceUid] = {
                    seriesInstanceUid: series.seriesInstanceUid,
                    seriesDescription: series.seriesDescription,
                    seriesNumber: series.seriesNumber,
                    modality: series.modality,
                    comments: [],
                    slices: Array.from({ length: series.sliceCount }, (_, i) => ({
                        instanceNumber: i + 1,
                        sliceLocation: 0,
                        source: {
                            kind: 'api',
                            apiBase,
                            studyId: study.studyInstanceUid,
                            seriesId: series.seriesInstanceUid,
                            sliceIndex: i
                        }
                    }))
                };
            }

            studies[study.studyInstanceUid] = {
                patientName: study.patientName,
                studyDate: study.studyDate,
                studyDescription: study.studyDescription,
                studyInstanceUid: study.studyInstanceUid,
                modality: study.modality,
                seriesCount: study.seriesCount,
                imageCount: study.imageCount,
                comments: [],
                reports: [],
                series: seriesMap
            };
        }

        if (Array.isArray(payload)) {
            return { studies, available: true, folder: '' };
        }

        return {
            studies,
            available: !!payload.available,
            folder: payload.folder || ''
        };
    }

    async function loadStudiesFromApi(apiBase, options = {}) {
        const response = await fetch(`${apiBase}/studies`, options);
        if (!response.ok) throw new Error(`Failed to load studies: ${response.status}`);
        const payload = await response.json();
        return normalizeStudiesPayload(payload, apiBase);
    }

    async function loadDroppedStudies(items) {
        uploadProgress.style.display = 'flex';
        progressText.textContent = 'Reading folder...';
        progressDetail.textContent = '';
        progressFill.style.width = '0%';

        try {
            if (!items?.[0]?.getAsFileSystemHandle) {
                throw new Error('Please use Chrome or Edge for folder drop support');
            }

            const handle = await items[0].getAsFileSystemHandle();
            if (handle.kind !== 'directory') {
                throw new Error('Please drop a folder, not a file');
            }

            progressText.textContent = 'Finding files...';
            const fileHandles = await getAllFileHandles(handle);
            progressDetail.textContent = `Found ${fileHandles.length} files`;

            if (!fileHandles.length) {
                throw new Error('No files found');
            }

            return await processFiles(fileHandles);
        } finally {
            uploadProgress.style.display = 'none';
        }
    }

    async function resolveDesktopPathSource(fs, path, readError) {
        if (!fs?.stat) {
            return [{
                name: getPathName(path),
                source: { kind: 'path', path }
            }];
        }

        try {
            const info = await fs.stat(path);
            if (info?.isFile) {
                return [{
                    name: getPathName(path),
                    source: { kind: 'path', path }
                }];
            }

            if (info?.isDirectory) {
                throw new Error(`Failed to read directory: ${path}`);
            }
        } catch (statError) {
            if (statError?.message === `Failed to read directory: ${path}`) {
                throw statError;
            }
        }

        if (readError instanceof Error) {
            throw readError;
        }
        throw new Error(`Failed to access path: ${path}`);
    }

    async function collectPathSources(path, options = {}) {
        const fs = window.__TAURI__?.fs;
        if (!fs?.readDir) {
            throw new Error('Desktop file APIs unavailable');
        }

        const {
            depth = 0,
            maxDepth = DESKTOP_MAX_SCAN_DEPTH,
            visited = new Set()
        } = options;
        const normalizedPath = await normalizePath(path);

        if (visited.has(normalizedPath)) {
            console.warn('Skipping already-visited desktop scan path:', normalizedPath);
            return [];
        }
        visited.add(normalizedPath);

        let entries;
        try {
            entries = await fs.readDir(normalizedPath);
        } catch (readError) {
            return await resolveDesktopPathSource(fs, normalizedPath, readError);
        }

        const files = [];
        for (const entry of entries) {
            const entryPath = await joinPath(normalizedPath, entry.name);
            if (entry.isSymlink) {
                console.warn('Skipping symlink during desktop scan:', entryPath);
                continue;
            }

            if (entry.isDirectory) {
                if (depth >= maxDepth) {
                    console.warn('Skipping path beyond desktop scan depth limit:', entryPath);
                    continue;
                }
                files.push(...await collectPathSources(entryPath, {
                    depth: depth + 1,
                    maxDepth,
                    visited
                }));
            } else if (entry.isFile) {
                files.push({
                    name: entry.name,
                    source: { kind: 'path', path: entryPath }
                });
            }
        }
        return files;
    }

    async function loadDroppedPaths(paths) {
        uploadProgress.style.display = 'flex';
        progressText.textContent = 'Reading folder...';
        progressDetail.textContent = '';
        progressFill.style.width = '0%';

        try {
            progressText.textContent = 'Finding files...';
            const files = [];
            for (const path of paths) {
                files.push(...await collectPathSources(path));
            }
            progressDetail.textContent = `Found ${files.length} files`;

            if (!files.length) {
                throw new Error('No files found');
            }

            return await processFilesFromSources(files);
        } finally {
            uploadProgress.style.display = 'none';
        }
    }

    async function loadSampleStudies(samplePath, button, buttonLabel) {
        button.disabled = true;
        button.textContent = 'Loading...';
        uploadProgress.style.display = 'flex';
        progressText.textContent = 'Loading sample scan...';
        progressDetail.textContent = '';
        progressFill.style.width = '0%';

        try {
            const manifestRes = await fetch(`${samplePath}/manifest.json`);
            const fileNames = await manifestRes.json();

            progressText.textContent = 'Downloading DICOM files...';
            progressDetail.textContent = `0/${fileNames.length} files`;

            const filePromises = fileNames.map(async (name, i) => {
                const res = await fetch(`${samplePath}/${name}`);
                const blob = await res.blob();
                if ((i + 1) % 5 === 0 || i === fileNames.length - 1) {
                    const pct = Math.round(((i + 1) / fileNames.length) * 50);
                    progressFill.style.width = `${pct}%`;
                    progressDetail.textContent = `${i + 1}/${fileNames.length} files`;
                }
                return { name, blob };
            });

            const files = await Promise.all(filePromises);
            progressText.textContent = 'Processing DICOM files...';
            progressFill.style.width = '50%';

            const studies = {};
            let processed = 0;

            for (const { blob } of files) {
                const meta = await parseDicomMetadata(blob);
                processed++;

                const pct = 50 + Math.round((processed / files.length) * 50);
                progressFill.style.width = `${pct}%`;
                progressDetail.textContent = `Processing ${processed}/${files.length}`;

                if (!meta?.studyInstanceUid) continue;

                const studyUid = meta.studyInstanceUid;
                const seriesUid = meta.seriesInstanceUid;

                if (!studies[studyUid]) {
                    studies[studyUid] = {
                        ...meta,
                        series: {},
                        comments: []
                    };
                }

                if (!studies[studyUid].series[seriesUid]) {
                    studies[studyUid].series[seriesUid] = {
                        seriesInstanceUid: seriesUid,
                        seriesNumber: meta.seriesNumber,
                        seriesDescription: meta.seriesDescription,
                        modality: meta.modality,
                        transferSyntax: meta.transferSyntax,
                        slices: [],
                        comments: []
                    };
                }

                studies[studyUid].series[seriesUid].slices.push({
                    instanceNumber: meta.instanceNumber,
                    sliceLocation: meta.sliceLocation,
                    source: { kind: 'blob', blob }
                });
            }

            for (const study of Object.values(studies)) {
                let imageCount = 0;
                for (const series of Object.values(study.series)) {
                    series.slices.sort((a, b) =>
                        (a.sliceLocation ?? a.instanceNumber ?? 0) -
                        (b.sliceLocation ?? b.instanceNumber ?? 0)
                    );
                    imageCount += series.slices.length;
                }
                study.seriesCount = Object.keys(study.series).length;
                study.imageCount = imageCount;
            }

            return studies;
        } finally {
            uploadProgress.style.display = 'none';
            button.textContent = buttonLabel;
            button.disabled = false;
        }
    }

    app.sources = {
        collectPathSources,
        getAllFileHandles,
        loadDroppedStudies,
        loadDroppedPaths,
        loadSampleStudies,
        processFiles,
        processFilesFromSources,
        readSliceBuffer,
        normalizeStudiesPayload,
        loadStudiesFromApi
    };
})();
