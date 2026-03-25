/**
 * DesktopSqliteBackend - Tauri native persistence for desktop app
 *
 * Extends LocalBackend with file-system report storage via Tauri APIs.
 * Depends on window._NotesInternals from local.js (loaded first).
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _NotesDesktop = (() => {
    const {
        LocalBackend,
        clone,
        loadStore,
        saveStore,
        ensureStudy,
        normalizeReportId,
        findReportMetadata,
        sanitizeFilenamePart,
        getDesktopTauriApis
    } = window._NotesInternals;

    // ---- DesktopBackend ----
    const DesktopBackend = {
        ...LocalBackend,

        async uploadReport(studyUid, file, report = {}) {
            if (!studyUid || !file || !report?.id) return null;

            const { fs, path } = getDesktopTauriApis();
            if (!fs || !path) return null;

            try {
                const appDataPath = await path.appDataDir();
                const reportsDir = await path.join(appDataPath, 'reports', studyUid);
                await fs.mkdir(reportsDir, { recursive: true });

                const filename = file.name || report.name || 'report';
                const safeFilename = sanitizeFilenamePart(filename, 'report');
                const filePath = await path.join(
                    reportsDir,
                    `${sanitizeFilenamePart(report.id, 'report')}_${safeFilename}`
                );

                const bytes = new Uint8Array(await file.arrayBuffer());
                await fs.writeFile(filePath, bytes);

                const store = loadStore();
                const studyEntry = ensureStudy(store, studyUid);
                const saved = {
                    ...report,
                    filePath,
                    storedAt: new Date().toISOString()
                };
                delete saved.blob;

                const target = normalizeReportId(saved.id);
                studyEntry.reports = studyEntry.reports.filter((entry) => normalizeReportId(entry?.id) !== target);
                studyEntry.reports.push(saved);
                saveStore(store);
                return clone(saved);
            } catch (e) {
                console.warn('DesktopBackend: failed to upload report:', e);
                return null;
            }
        },

        async deleteReport(studyUid, reportId) {
            if (!studyUid || reportId === undefined || reportId === null) return false;

            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return true;

            ensureStudy(store, studyUid);
            const target = normalizeReportId(reportId);
            const report = studyEntry.reports.find((entry) => normalizeReportId(entry?.id) === target) || null;
            if (!report) return true;

            if (report.filePath) {
                const { fs } = getDesktopTauriApis();
                if (!fs) return false;

                try {
                    if (await fs.exists(report.filePath)) {
                        await fs.remove(report.filePath);
                    }
                } catch (e) {
                    console.warn('DesktopBackend: failed to delete report file:', e);
                    return false;
                }
            }

            studyEntry.reports = studyEntry.reports.filter((entry) => normalizeReportId(entry?.id) !== target);
            saveStore(store);
            return true;
        },

        getReportFileUrl(reportId) {
            const { core } = getDesktopTauriApis();
            if (!core?.convertFileSrc) return '';

            const match = findReportMetadata(loadStore(), reportId);
            const filePath = match?.report?.filePath;
            if (!filePath) return '';
            return core.convertFileSrc(filePath);
        }
    };

    return { DesktopBackend };
})();

if (typeof window !== 'undefined') {
    window._NotesDesktop = _NotesDesktop;
}
