(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { uploadProgress, progressFill, progressText, progressDetail } = app.dom;
    const { parseDicomMetadata } = app.dicom;

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
        const studies = {};
        const total = fileHandles.length;
        let processed = 0;
        let valid = 0;

        const batchSize = 100;
        for (let i = 0; i < fileHandles.length; i += batchSize) {
            const batch = fileHandles.slice(i, i + batchSize);
            await Promise.all(batch.map(async ({ handle }) => {
                const file = await handle.getFile();
                const meta = await parseDicomMetadata(file);
                processed++;

                if (processed % 200 === 0 || processed === total) {
                    const pct = Math.round((processed / total) * 100);
                    progressFill.style.width = pct + '%';
                    progressText.textContent = `Scanning... ${pct}%`;
                    progressDetail.textContent = `${processed}/${total} files (${valid} DICOM)`;
                }

                if (!meta?.studyInstanceUid) return;
                valid++;

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
                    fileHandle: handle,
                    instanceNumber: meta.instanceNumber,
                    sliceLocation: meta.sliceLocation
                });
            }));
        }

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

    async function readSliceBuffer(slice, purpose = 'load') {
        if (slice.fileHandle) {
            const file = await slice.fileHandle.getFile();
            return await file.arrayBuffer();
        }
        if (slice.blob) {
            return await slice.blob.arrayBuffer();
        }
        if (slice.apiBase) {
            const resp = await fetch(`${slice.apiBase}/dicom/${slice.studyId}/${slice.seriesId}/${slice.sliceIndex}`);
            if (!resp.ok) throw new Error(`Failed to ${purpose} slice: ${resp.status}`);
            return await resp.arrayBuffer();
        }
        throw new Error('No slice source available');
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
                        apiBase,
                        studyId: study.studyInstanceUid,
                        seriesId: series.seriesInstanceUid,
                        sliceIndex: i
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
                    blob
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
        getAllFileHandles,
        loadDroppedStudies,
        loadSampleStudies,
        processFiles,
        readSliceBuffer,
        normalizeStudiesPayload,
        loadStudiesFromApi
    };
})();
