(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { progressFill, progressText, progressDetail } = app.dom;
    const { parseDicomMetadata } = app.dicom;

    async function getAllFileHandles(dirHandle, path = '') {
        const files = [];
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === 'file') {
                files.push({ handle, name });
            } else if (handle.kind === 'directory') {
                files.push(...await getAllFileHandles(handle, path + name + '/'));
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
                        ...meta, series: {}, seriesCount: 0, imageCount: 0
                    };
                }
                if (!studies[studyUid].series[seriesUid]) {
                    studies[studyUid].series[seriesUid] = {
                        seriesInstanceUid: seriesUid,
                        seriesDescription: meta.seriesDescription,
                        seriesNumber: meta.seriesNumber,
                        transferSyntax: meta.transferSyntax,
                        slices: []
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

    app.sources = {
        getAllFileHandles,
        processFiles,
        readSliceBuffer,
        normalizeStudiesPayload,
        loadStudiesFromApi
    };
})();
