/**
 * DesktopBackend - Tauri native SQLite persistence for desktop app
 *
 * Restores the pre-split desktop storage path: native SQLite for notes,
 * comments, reports, app config, and scan cache, plus one-time migration
 * from legacy browser/localStorage stores.
 *
 * Depends on window._NotesInternals from local.js (loaded first).
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _NotesDesktop = (() => {
    const {
        createEmptyStore,
        clone,
        normalizeCommentId,
        loadStore,
        ensureStudy,
        ensureSeries,
        normalizeReportId,
        sanitizeFilenamePart,
        getDesktopTauriApis
    } = window._NotesInternals;

    const DESKTOP_DB_URL = 'sqlite:viewer.db';
    const DESKTOP_LIBRARY_CONFIG_KEY = 'desktop_library_config';
    const DESKTOP_LOCALSTORAGE_MIGRATION_KEY = 'localstorage_migrated';
    const DESKTOP_LEGACY_BROWSER_STORE_MIGRATION_KEY = 'legacy_desktop_browser_store_migrated';
    const DESKTOP_LIBRARY_CONFIG_STORAGE_KEY = 'dicom-viewer-library-config';
    const DESKTOP_SCAN_CACHE_VERSION = 1;
    const DESKTOP_SCAN_CACHE_CHUNK_SIZE = 256;
    const DESKTOP_INIT_RETRY_MS = 5000;
    const LEGACY_STORAGE_KEY = 'dicom-viewer-comments';
    const LEGACY_REPORTS_DB = 'dicom-viewer-reports';
    const LEGACY_REPORTS_STORE = 'reports';
    const REPORT_FILE_EXTENSIONS = Object.freeze({
        pdf: 'pdf',
        png: 'png',
        jpg: 'jpg'
    });

    let desktopDbPromise = null;
    let desktopDbFailure = null;
    let desktopDbRetryAt = 0;
    let desktopMigrationPromise = null;
    let desktopMigrationFailure = null;
    let desktopMigrationRetryAt = 0;
    const desktopReportPathCache = new Map();

    function isDesktopMode() {
        return typeof CONFIG !== 'undefined' && CONFIG.deploymentMode === 'desktop';
    }

    function normalizeDesktopLibraryConfig(config) {
        return {
            folder: typeof config?.folder === 'string' && config.folder ? config.folder : null,
            lastScan: typeof config?.lastScan === 'string' && config.lastScan ? config.lastScan : null,
            managedLibrary: config?.managedLibrary !== false,
            importHistory: Array.isArray(config?.importHistory) ? config.importHistory.filter(entry =>
                entry && typeof entry === 'object'
                && typeof entry.sourcePath === 'string'
                && typeof entry.importedAt === 'string'
                && typeof entry.fileCount === 'number'
                && typeof entry.studyCount === 'number'
            ) : []
        };
    }

    function parseInteger(value, fallback) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function safeLocalStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function safeJsonParse(raw, fallback = null) {
        if (!raw) return fallback;
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    function sortLegacyDesktopStores(stores) {
        return (Array.isArray(stores) ? stores.slice() : []).sort((left, right) => {
            const leftModified = Number.isFinite(Number(left?.modifiedMs))
                ? Number(left.modifiedMs)
                : (Number.isFinite(Number(left?.modified_ms)) ? Number(left.modified_ms) : -1);
            const rightModified = Number.isFinite(Number(right?.modifiedMs))
                ? Number(right.modifiedMs)
                : (Number.isFinite(Number(right?.modified_ms)) ? Number(right.modified_ms) : -1);
            return leftModified - rightModified
                || String(left?.sourcePath || '').localeCompare(String(right?.sourcePath || ''));
        });
    }

    function hasStudyNotes(entry) {
        if (!entry || typeof entry !== 'object') return false;
        if ((entry.description || '').trim()) return true;
        if (Array.isArray(entry.comments) && entry.comments.length) return true;
        if (Array.isArray(entry.reports) && entry.reports.length) return true;
        if (entry.series && typeof entry.series === 'object') {
            return Object.values(entry.series).some((seriesEntry) => {
                if (!seriesEntry || typeof seriesEntry !== 'object') return false;
                if ((seriesEntry.description || '').trim()) return true;
                return Array.isArray(seriesEntry.comments) && seriesEntry.comments.length > 0;
            });
        }
        return false;
    }

    function createEmptyDesktopMigrationBatch() {
        return {
            studyNotes: [],
            seriesNotes: [],
            comments: [],
            reports: [],
            appConfig: []
        };
    }

    function hasDesktopMigrationRows(batch) {
        return !!(
            batch.studyNotes.length
            || batch.seriesNotes.length
            || batch.comments.length
            || batch.reports.length
            || batch.appConfig.length
        );
    }

    async function waitForDesktopRuntime() {
        const ready = window.__DICOM_VIEWER_TAURI_STORAGE_READY__ || window.__DICOM_VIEWER_TAURI_READY__;
        if (ready && typeof ready.then === 'function') {
            await ready;
        }
        if (window.__TAURI__?.sql?.load) return window.__TAURI__;

        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
            if (window.__TAURI__?.sql?.load) return window.__TAURI__;
            await new Promise(r => setTimeout(r, 50));
        }
        return window.__TAURI__ || null;
    }

    async function getDesktopDb() {
        const runtime = await waitForDesktopRuntime();
        const sql = runtime?.sql;
        if (!sql?.load) {
            throw new Error('Desktop SQL runtime is not ready. Quit and reopen the app if this persists.');
        }
        if (desktopDbFailure && Date.now() < desktopDbRetryAt) {
            throw desktopDbFailure;
        }
        if (!desktopDbPromise) {
            desktopDbPromise = sql.load(DESKTOP_DB_URL).catch((error) => {
                desktopDbPromise = null;
                desktopDbFailure = error;
                desktopDbRetryAt = Date.now() + DESKTOP_INIT_RETRY_MS;
                throw error;
            });
        }
        try {
            const db = await desktopDbPromise;
            desktopDbFailure = null;
            desktopDbRetryAt = 0;
            return db;
        } catch (error) {
            throw error;
        }
    }

    async function getDesktopAppConfigValue(key) {
        const db = await getDesktopDb();
        const rows = await db.select(
            'SELECT value FROM app_config WHERE key = ? LIMIT 1',
            [key]
        );
        return rows[0]?.value ?? null;
    }

    async function setDesktopAppConfigValue(key, value) {
        const db = await getDesktopDb();
        await db.execute(
            `INSERT INTO app_config (key, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = excluded.updated_at`,
            [key, value, Date.now()]
        );
        return value;
    }

    async function loadDesktopLibraryConfig() {
        await initializeDesktopPersistence();
        const raw = await getDesktopAppConfigValue(DESKTOP_LIBRARY_CONFIG_KEY);
        return normalizeDesktopLibraryConfig(safeJsonParse(raw, {}));
    }

    async function saveDesktopLibraryConfig(config) {
        const normalized = normalizeDesktopLibraryConfig(config);
        await initializeDesktopPersistence();
        await setDesktopAppConfigValue(
            DESKTOP_LIBRARY_CONFIG_KEY,
            JSON.stringify(normalized)
        );
        return normalized;
    }

    async function loadDesktopScanCache(rootPaths, scannerVersion = DESKTOP_SCAN_CACHE_VERSION) {
        const roots = Array.from(new Set(
            (Array.isArray(rootPaths) ? rootPaths : [rootPaths]).filter(
                (rootPath) => typeof rootPath === 'string' && rootPath
            )
        ));
        if (!roots.length) return [];

        await initializeDesktopPersistence();
        const db = await getDesktopDb();
        const placeholders = roots.map(() => '?').join(', ');
        return await db.select(
            `SELECT path, size, modified_ms, renderable, meta_json
             FROM desktop_scan_cache
             WHERE root_path IN (${placeholders}) AND scanner_version = ?`,
            [...roots, scannerVersion]
        );
    }

    async function saveDesktopScanCacheEntries(entries, scannerVersion = DESKTOP_SCAN_CACHE_VERSION) {
        const rows = (Array.isArray(entries) ? entries : []).filter((entry) => {
            return !!(
                entry
                && typeof entry.path === 'string'
                && entry.path
                && typeof entry.rootPath === 'string'
                && entry.rootPath
            );
        });
        if (!rows.length) return 0;

        await initializeDesktopPersistence();
        const db = await getDesktopDb();
        let totalRowsAffected = 0;

        for (let index = 0; index < rows.length; index += DESKTOP_SCAN_CACHE_CHUNK_SIZE) {
            const chunk = rows.slice(index, index + DESKTOP_SCAN_CACHE_CHUNK_SIZE);
            const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const values = [];

            for (const row of chunk) {
                values.push(
                    row.path,
                    row.rootPath,
                    parseInteger(row.size, 0),
                    row.modifiedMs ?? null,
                    scannerVersion,
                    row.renderable ? 1 : 0,
                    typeof row.metaJson === 'string' ? row.metaJson : null,
                    Date.now()
                );
            }

            const result = await db.execute(
                `INSERT INTO desktop_scan_cache (
                    path,
                    root_path,
                    size,
                    modified_ms,
                    scanner_version,
                    renderable,
                    meta_json,
                    updated_at
                ) VALUES ${placeholders}
                 ON CONFLICT(path) DO UPDATE SET
                    root_path = excluded.root_path,
                    size = excluded.size,
                    modified_ms = excluded.modified_ms,
                    scanner_version = excluded.scanner_version,
                    renderable = excluded.renderable,
                    meta_json = excluded.meta_json,
                    updated_at = excluded.updated_at`,
                values
            );
            totalRowsAffected += Number(result?.rowsAffected) || chunk.length;
        }

        return totalRowsAffected;
    }

    async function saveImportJob(job) {
        if (!job || typeof job.id !== 'string' || !job.id) {
            throw new Error('saveImportJob requires a job with a string id');
        }
        await initializeDesktopPersistence();
        const db = await getDesktopDb();
        await db.execute(
            `INSERT INTO import_jobs (id, source_path, started_at, completed_at, imported_count, skipped_count, error_count, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                job.id,
                job.source_path || '',
                typeof job.started_at === 'number' ? job.started_at : Date.now(),
                job.completed_at ?? null,
                parseInteger(job.imported_count, 0),
                parseInteger(job.skipped_count, 0),
                parseInteger(job.error_count, 0),
                typeof job.status === 'string' && job.status ? job.status : 'running'
            ]
        );
        return job;
    }

    async function updateImportJob(id, updates) {
        if (!id || typeof id !== 'string') {
            throw new Error('updateImportJob requires a string id');
        }
        if (!updates || typeof updates !== 'object') return;
        await initializeDesktopPersistence();
        const db = await getDesktopDb();
        const setClauses = [];
        const values = [];
        if ('completed_at' in updates) {
            setClauses.push('completed_at = ?');
            values.push(updates.completed_at ?? null);
        }
        if ('imported_count' in updates) {
            setClauses.push('imported_count = ?');
            values.push(parseInteger(updates.imported_count, 0));
        }
        if ('skipped_count' in updates) {
            setClauses.push('skipped_count = ?');
            values.push(parseInteger(updates.skipped_count, 0));
        }
        if ('error_count' in updates) {
            setClauses.push('error_count = ?');
            values.push(parseInteger(updates.error_count, 0));
        }
        if ('status' in updates) {
            setClauses.push('status = ?');
            values.push(typeof updates.status === 'string' ? updates.status : 'running');
        }
        if (!setClauses.length) return;
        values.push(id);
        await db.execute(
            `UPDATE import_jobs SET ${setClauses.join(', ')} WHERE id = ?`,
            values
        );
    }

    async function loadRecentImportJobs(limit) {
        const rowLimit = parseInteger(limit, 20);
        await initializeDesktopPersistence();
        const db = await getDesktopDb();
        return await db.select(
            'SELECT id, source_path, started_at, completed_at, imported_count, skipped_count, error_count, status FROM import_jobs ORDER BY started_at DESC LIMIT ?',
            [rowLimit]
        );
    }

    function getReportExtension(reportType, file) {
        const explicitType = typeof reportType === 'string' ? reportType.trim().toLowerCase() : '';
        if (REPORT_FILE_EXTENSIONS[explicitType]) {
            return REPORT_FILE_EXTENSIONS[explicitType];
        }
        const mime = typeof file?.type === 'string' ? file.type : '';
        if (mime === 'application/pdf') return 'pdf';
        if (mime === 'image/png') return 'png';
        if (mime === 'image/jpeg') return 'jpg';
        const name = (file?.name || '').toLowerCase();
        if (name.endsWith('.pdf')) return 'pdf';
        if (name.endsWith('.png')) return 'png';
        if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpg';
        return null;
    }

    async function openLegacyReportsDb() {
        return await new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') {
                resolve(null);
                return;
            }
            const request = indexedDB.open(LEGACY_REPORTS_DB);
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
        return await new Promise((resolve) => {
            const tx = db.transaction(LEGACY_REPORTS_STORE, 'readonly');
            const request = tx.objectStore(LEGACY_REPORTS_STORE).get(reportId);
            request.onsuccess = () => resolve(request.result?.blob || null);
            request.onerror = () => resolve(null);
        });
    }

    async function appendCurrentStoreToDesktopMigration(batch, store, fsApi) {
        if (!store?.studies || typeof store.studies !== 'object') return;
        const now = Date.now();

        for (const [studyUid, stored] of Object.entries(store.studies)) {
            if (!hasStudyNotes(stored)) continue;

            const description = (stored?.description || '').trim();
            if (description) {
                batch.studyNotes.push({
                    studyUid,
                    description,
                    updatedAt: now
                });
            }

            for (const comment of stored?.comments || []) {
                const text = (comment?.text || '').trim();
                if (!text) continue;
                batch.comments.push({
                    studyUid,
                    seriesUid: '',
                    text,
                    time: parseInteger(comment?.time, now)
                });
            }

            if (stored?.series && typeof stored.series === 'object') {
                for (const [seriesUid, seriesEntry] of Object.entries(stored.series)) {
                    const seriesDescription = (seriesEntry?.description || '').trim();
                    if (seriesDescription) {
                        batch.seriesNotes.push({
                            studyUid,
                            seriesUid,
                            description: seriesDescription,
                            updatedAt: now
                        });
                    }

                    for (const comment of seriesEntry?.comments || []) {
                        const text = (comment?.text || '').trim();
                        if (!text) continue;
                        batch.comments.push({
                            studyUid,
                            seriesUid,
                            text,
                            time: parseInteger(comment?.time, now)
                        });
                    }
                }
            }

            for (const report of stored?.reports || []) {
                if (!report?.id || !report?.filePath) continue;
                let fileExists = true;
                if (fsApi?.exists) {
                    try {
                        fileExists = await fsApi.exists(report.filePath);
                    } catch {
                        fileExists = false;
                    }
                }
                if (!fileExists) continue;

                batch.reports.push({
                    id: normalizeReportId(report.id),
                    studyUid,
                    name: report.name || 'report',
                    type: report.type || 'pdf',
                    size: parseInteger(report.size, 0),
                    filePath: report.filePath,
                    addedAt: parseInteger(report.addedAt, now),
                    updatedAt: parseInteger(report.updatedAt, now)
                });
            }
        }
    }

    function appendLegacyStoreToDesktopMigration(batch, payload) {
        const commentsBlob = payload?.comments;
        if (!commentsBlob || typeof commentsBlob !== 'object') return;
        const now = Date.now();

        for (const [studyUid, stored] of Object.entries(commentsBlob)) {
            if (!stored || typeof stored !== 'object') continue;

            const description = (stored.description || '').trim();
            if (description) {
                batch.studyNotes.push({
                    studyUid,
                    description,
                    updatedAt: now
                });
            }

            for (const comment of stored.study || []) {
                const text = (comment?.text || '').trim();
                if (!text) continue;
                batch.comments.push({
                    studyUid,
                    seriesUid: '',
                    text,
                    time: parseInteger(comment?.time, now)
                });
            }

            const seriesBlob = stored.series || {};
            if (seriesBlob && typeof seriesBlob === 'object') {
                for (const [seriesUid, seriesData] of Object.entries(seriesBlob)) {
                    const seriesDescription = Array.isArray(seriesData)
                        ? ''
                        : (seriesData?.description || '').trim();
                    const seriesComments = Array.isArray(seriesData)
                        ? seriesData
                        : (seriesData?.comments || []);

                    if (seriesDescription) {
                        batch.seriesNotes.push({
                            studyUid,
                            seriesUid,
                            description: seriesDescription,
                            updatedAt: now
                        });
                    }

                    for (const comment of seriesComments) {
                        const text = (comment?.text || '').trim();
                        if (!text) continue;
                        batch.comments.push({
                            studyUid,
                            seriesUid,
                            text,
                            time: parseInteger(comment?.time, now)
                        });
                    }
                }
            }
        }
    }

    function appendDesktopLibraryConfigToMigration(batch, config) {
        const normalized = normalizeDesktopLibraryConfig(config);
        if (!normalized.folder && !normalized.lastScan) return;
        batch.appConfig.push({
            key: DESKTOP_LIBRARY_CONFIG_KEY,
            value: JSON.stringify(normalized),
            updatedAt: Date.now()
        });
    }

    async function migrateLegacyReportBlobs(payload, db) {
        const commentsBlob = payload?.comments;
        if (!commentsBlob || typeof commentsBlob !== 'object') return 0;

        const legacyDb = await openLegacyReportsDb();
        let failures = 0;
        try {
            for (const [studyUid, stored] of Object.entries(commentsBlob)) {
                const reports = stored?.reports || [];
                for (const report of reports) {
                    if (!report?.id) continue;
                    const blob = await getLegacyReportBlob(legacyDb, report.id);
                    if (!blob) continue;
                    try {
                        const filename = report.name || 'report';
                        const file = new File([blob], filename, { type: blob.type || '' });
                        await storeDesktopReportWithDb(db, studyUid, file, report);
                    } catch (error) {
                        failures += 1;
                        console.warn(
                            `DesktopBackend: failed to migrate legacy report blob ${report.id} for ${studyUid}:`,
                            error
                        );
                    }
                }
            }
        } finally {
            if (legacyDb) legacyDb.close();
        }
        return failures;
    }

    async function applyDesktopMigrationBatch(batch) {
        if (!hasDesktopMigrationRows(batch)) return true;

        const runtime = await waitForDesktopRuntime();
        const invoke = runtime?.core?.invoke;
        if (typeof invoke !== 'function') {
            throw new Error('Desktop migration runtime is not ready. Quit and reopen the app if this persists.');
        }

        return await invoke('apply_desktop_migration', {
            db: DESKTOP_DB_URL,
            batch
        });
    }

    async function loadLegacyDesktopBrowserStores() {
        const runtime = await waitForDesktopRuntime();
        const invoke = runtime?.core?.invoke;
        if (typeof invoke !== 'function') {
            throw new Error('Desktop migration runtime is not ready. Quit and reopen the app if this persists.');
        }

        const stores = await invoke('load_legacy_desktop_browser_stores');
        return sortLegacyDesktopStores(stores);
    }

    async function migrateDesktopLocalStorage() {
        const migrated = await getDesktopAppConfigValue(DESKTOP_LOCALSTORAGE_MIGRATION_KEY);
        if (migrated === '1') return false;

        const currentStore = safeJsonParse(safeLocalStorageGet('dicom-viewer-notes-v3'), createEmptyStore());
        const legacyPayload = safeJsonParse(safeLocalStorageGet(LEGACY_STORAGE_KEY), null);
        const libraryConfig = normalizeDesktopLibraryConfig(
            safeJsonParse(safeLocalStorageGet(DESKTOP_LIBRARY_CONFIG_STORAGE_KEY), {})
        );

        const hasCurrentStore = Object.values(currentStore?.studies || {}).some(hasStudyNotes);
        const hasLegacyStore = !!(legacyPayload?.comments && typeof legacyPayload.comments === 'object');
        const hasLibraryConfig = !!(libraryConfig.folder || libraryConfig.lastScan);

        if (!hasCurrentStore && !hasLegacyStore && !hasLibraryConfig) {
            await setDesktopAppConfigValue(DESKTOP_LOCALSTORAGE_MIGRATION_KEY, '1');
            return false;
        }

        const { fs } = getDesktopTauriApis();
        const batch = createEmptyDesktopMigrationBatch();
        await appendCurrentStoreToDesktopMigration(batch, currentStore, fs);
        appendLegacyStoreToDesktopMigration(batch, legacyPayload);
        if (hasLibraryConfig) {
            appendDesktopLibraryConfigToMigration(batch, libraryConfig);
        }

        await applyDesktopMigrationBatch(batch);

        if (hasLegacyStore) {
            const db = await getDesktopDb();
            const blobFailures = await migrateLegacyReportBlobs(legacyPayload, db);
            if (blobFailures > 0) {
                console.warn(
                    `DesktopBackend: deferred completion of legacy localStorage migration after ${blobFailures} legacy report blob failure(s).`
                );
                return true;
            }
        }

        await setDesktopAppConfigValue(DESKTOP_LOCALSTORAGE_MIGRATION_KEY, '1');
        return true;
    }

    async function migrateLegacyDesktopBrowserStores() {
        const migrated = await getDesktopAppConfigValue(DESKTOP_LEGACY_BROWSER_STORE_MIGRATION_KEY);
        if (migrated === '1') return false;

        const stores = await loadLegacyDesktopBrowserStores();
        if (!stores.length) {
            await setDesktopAppConfigValue(DESKTOP_LEGACY_BROWSER_STORE_MIGRATION_KEY, '1');
            return false;
        }

        const { fs } = getDesktopTauriApis();
        const batch = createEmptyDesktopMigrationBatch();
        for (const store of stores) {
            const notesStore = safeJsonParse(store?.notesJson, createEmptyStore());
            const libraryConfig = normalizeDesktopLibraryConfig(
                safeJsonParse(store?.libraryConfigJson, {})
            );

            await appendCurrentStoreToDesktopMigration(batch, notesStore, fs);
            if (libraryConfig.folder || libraryConfig.lastScan) {
                appendDesktopLibraryConfigToMigration(batch, libraryConfig);
            }
        }

        if (hasDesktopMigrationRows(batch)) {
            await applyDesktopMigrationBatch(batch);
        }

        await setDesktopAppConfigValue(DESKTOP_LEGACY_BROWSER_STORE_MIGRATION_KEY, '1');
        return hasDesktopMigrationRows(batch);
    }

    async function initializeDesktopPersistence() {
        if (!isDesktopMode()) return false;
        if (desktopMigrationFailure && Date.now() < desktopMigrationRetryAt) {
            throw desktopMigrationFailure;
        }
        if (!desktopMigrationPromise) {
            desktopMigrationPromise = (async () => {
                await getDesktopDb();
                await migrateDesktopLocalStorage();
                await migrateLegacyDesktopBrowserStores();
                desktopMigrationFailure = null;
                desktopMigrationRetryAt = 0;
                return true;
            })().catch((error) => {
                desktopMigrationPromise = null;
                desktopMigrationFailure = error;
                desktopMigrationRetryAt = Date.now() + DESKTOP_INIT_RETRY_MS;
                throw error;
            });
        }
        return desktopMigrationPromise;
    }

    async function storeDesktopReportWithDb(db, studyUid, file, report = {}) {
        if (!studyUid || !file || !report?.id) return null;
        const { fs, path } = getDesktopTauriApis();
        if (!fs || !path || typeof fs.writeFile !== 'function' || typeof fs.rename !== 'function') {
            throw new Error('Desktop filesystem runtime is not ready.');
        }

        const extension = getReportExtension(report.type, file);
        if (!extension) {
            throw new Error('Unsupported report file type.');
        }

        const appDataPath = await path.appDataDir();
        const reportsDir = await path.join(appDataPath, 'reports', studyUid);
        await fs.mkdir(reportsDir, { recursive: true });

        const reportId = normalizeReportId(report.id);
        const filenameBase = sanitizeFilenamePart(reportId, 'report');
        const finalPath = await path.join(reportsDir, `${filenameBase}.${extension}`);
        const tempPath = await path.join(reportsDir, `${filenameBase}.${extension}.tmp-${Date.now()}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const existingRows = await db.select(
            'SELECT file_path, added_at FROM reports WHERE id = ? LIMIT 1',
            [reportId]
        );
        const existing = existingRows[0] || null;
        const now = Date.now();
        const addedAt = parseInteger(report.addedAt, parseInteger(existing?.added_at, now));
        const updatedAt = parseInteger(report.updatedAt, now);
        const name = (report.name || file.name || 'report').trim() || 'report';
        const type = report.type || extension;
        const size = parseInteger(report.size, file.size ?? bytes.length);

        await fs.writeFile(tempPath, bytes);
        let backupPath = null;

        try {
            if (await fs.exists(finalPath)) {
                backupPath = await path.join(reportsDir, `${filenameBase}.${extension}.bak-${Date.now()}`);
                await fs.rename(finalPath, backupPath);
            }
            await fs.rename(tempPath, finalPath);
        } catch (error) {
            if (backupPath) {
                try {
                    if (await fs.exists(backupPath)) {
                        await fs.rename(backupPath, finalPath);
                    }
                } catch {}
            }
            try {
                if (await fs.exists(tempPath)) {
                    await fs.remove(tempPath);
                }
            } catch {}
            throw error;
        }

        try {
            await db.execute(
                `INSERT INTO reports (id, study_uid, name, type, size, file_path, added_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                     study_uid = excluded.study_uid,
                     name = excluded.name,
                     type = excluded.type,
                     size = excluded.size,
                     file_path = excluded.file_path,
                     added_at = excluded.added_at,
                     updated_at = excluded.updated_at`,
                [reportId, studyUid, name, type, size, finalPath, addedAt, updatedAt]
            );
        } catch (error) {
            try {
                if (await fs.exists(finalPath)) {
                    await fs.remove(finalPath);
                }
            } catch {}
            if (backupPath) {
                try {
                    if (await fs.exists(backupPath)) {
                        await fs.rename(backupPath, finalPath);
                    }
                } catch {}
            }
            throw error;
        }

        if (backupPath) {
            try {
                if (await fs.exists(backupPath)) {
                    await fs.remove(backupPath);
                }
            } catch (cleanupError) {
                console.warn('DesktopBackend: failed to remove report backup file:', cleanupError);
            }
        }

        if (existing?.file_path && existing.file_path !== finalPath) {
            try {
                if (await fs.exists(existing.file_path)) {
                    await fs.remove(existing.file_path);
                }
            } catch (cleanupError) {
                console.warn('DesktopBackend: failed to remove superseded report file:', cleanupError);
            }
        }

        desktopReportPathCache.set(reportId, finalPath);
        return {
            id: reportId,
            name,
            type,
            size,
            filePath: finalPath,
            addedAt,
            updatedAt
        };
    }

    async function storeDesktopReport(studyUid, file, report = {}) {
        if (!studyUid || !file || !report?.id) return null;
        await initializeDesktopPersistence();
        const db = await getDesktopDb();
        return await storeDesktopReportWithDb(db, studyUid, file, report);
    }

    const DesktopBackend = {
        async loadNotes(studyUids) {
            const list = (studyUids || []).filter(Boolean);
            if (!list.length) return createEmptyStore();

            await initializeDesktopPersistence();
            const db = await getDesktopDb();
            const placeholders = list.map(() => '?').join(', ');

            const [studyRows, seriesRows, commentRows, reportRows] = await Promise.all([
                db.select(
                    `SELECT study_uid, description
                     FROM study_notes
                     WHERE study_uid IN (${placeholders})`,
                    list
                ),
                db.select(
                    `SELECT study_uid, series_uid, description
                     FROM series_notes
                     WHERE study_uid IN (${placeholders})`,
                    list
                ),
                db.select(
                    `SELECT id, record_uuid, study_uid, series_uid, text, time, created_at, updated_at, deleted_at
                     FROM comments
                     WHERE study_uid IN (${placeholders})
                     ORDER BY time ASC, id ASC`,
                    list
                ),
                db.select(
                    `SELECT id, study_uid, name, type, size, content_hash, added_at, updated_at, deleted_at, file_path
                     FROM reports
                     WHERE study_uid IN (${placeholders})
                     AND file_path IS NOT NULL
                     ORDER BY added_at ASC, id ASC`,
                    list
                )
            ]);

            const notes = createEmptyStore();
            for (const row of studyRows) {
                ensureStudy(notes, row.study_uid).description = row.description || '';
            }

            for (const row of seriesRows) {
                ensureSeries(ensureStudy(notes, row.study_uid), row.series_uid).description = row.description || '';
            }

            for (const row of commentRows) {
                if (row.deleted_at) continue;
                const target = row.series_uid
                    ? ensureSeries(ensureStudy(notes, row.study_uid), row.series_uid)
                    : ensureStudy(notes, row.study_uid);
                target.comments.push({
                    id: row.id,
                    record_uuid: row.record_uuid || null,
                    text: row.text,
                    time: row.time,
                    created_at: row.created_at || row.time,
                    updated_at: row.updated_at || row.time,
                    deletedAt: null
                });
            }

            for (const row of reportRows) {
                if (row.deleted_at) continue;
                ensureStudy(notes, row.study_uid).reports.push({
                    id: row.id,
                    name: row.name,
                    type: row.type,
                    size: row.size,
                    contentHash: row.content_hash || null,
                    filePath: row.file_path,
                    addedAt: row.added_at,
                    updatedAt: row.updated_at,
                    deletedAt: null
                });
                desktopReportPathCache.set(normalizeReportId(row.id), row.file_path);
            }

            return notes;
        },

        async saveStudyDescription(studyUid, description) {
            if (!studyUid) return null;
            await initializeDesktopPersistence();
            const db = await getDesktopDb();
            const value = (description || '').trim();
            if (value) {
                await db.execute(
                    `INSERT INTO study_notes (study_uid, description, updated_at)
                     VALUES (?, ?, ?)
                     ON CONFLICT(study_uid) DO UPDATE SET
                         description = excluded.description,
                         updated_at = excluded.updated_at`,
                    [studyUid, value, Date.now()]
                );
            } else {
                await db.execute(
                    'DELETE FROM study_notes WHERE study_uid = ?',
                    [studyUid]
                );
            }
            return { description: value, comments: [], series: {}, reports: [] };
        },

        async saveSeriesDescription(studyUid, seriesUid, description) {
            if (!studyUid || !seriesUid) return null;
            await initializeDesktopPersistence();
            const db = await getDesktopDb();
            const value = (description || '').trim();
            if (value) {
                await db.execute(
                    `INSERT INTO series_notes (study_uid, series_uid, description, updated_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT(study_uid, series_uid) DO UPDATE SET
                         description = excluded.description,
                         updated_at = excluded.updated_at`,
                    [studyUid, seriesUid, value, Date.now()]
                );
            } else {
                await db.execute(
                    'DELETE FROM series_notes WHERE study_uid = ? AND series_uid = ?',
                    [studyUid, seriesUid]
                );
            }
            return { description: value, comments: [] };
        },

        async addComment(studyUid, payload = {}) {
            if (!studyUid) return null;
            await initializeDesktopPersistence();
            const db = await getDesktopDb();
            const text = (payload.text || '').trim();
            if (!text) return null;
            const seriesUid = payload.seriesUid || '';
            const time = parseInteger(payload.time, Date.now());
            const result = await db.execute(
                'INSERT INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)',
                [studyUid, seriesUid, text, time]
            );
            return {
                id: result?.lastInsertId ?? null,
                text,
                time
            };
        },

        async updateComment(studyUid, commentId, payload = {}) {
            if (!studyUid || commentId === undefined || commentId === null) return null;
            await initializeDesktopPersistence();
            const db = await getDesktopDb();
            const text = (payload.text || '').trim();
            if (!text) return null;
            const time = parseInteger(payload.time, Date.now());
            const result = await db.execute(
                'UPDATE comments SET text = ?, time = ? WHERE id = ? AND study_uid = ?',
                [text, time, normalizeCommentId(commentId), studyUid]
            );
            if (!result?.rowsAffected) return null;
            return {
                id: normalizeCommentId(commentId),
                text,
                time
            };
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            await initializeDesktopPersistence();
            const db = await getDesktopDb();
            await db.execute(
                'DELETE FROM comments WHERE id = ? AND study_uid = ?',
                [normalizeCommentId(commentId), studyUid]
            );
            return true;
        },

        async uploadReport(studyUid, file, report = {}) {
            try {
                return await storeDesktopReport(studyUid, file, report);
            } catch (error) {
                console.warn('DesktopBackend: failed to upload report:', error);
                return null;
            }
        },

        async deleteReport(studyUid, reportId) {
            if (!studyUid || reportId === undefined || reportId === null) return false;
            try {
                await initializeDesktopPersistence();
                const db = await getDesktopDb();
                const { fs } = getDesktopTauriApis();
                const rows = await db.select(
                    'SELECT file_path FROM reports WHERE id = ? AND study_uid = ? LIMIT 1',
                    [normalizeReportId(reportId), studyUid]
                );
                if (!rows.length) {
                    desktopReportPathCache.delete(normalizeReportId(reportId));
                    return true;
                }

                await db.execute(
                    'DELETE FROM reports WHERE id = ? AND study_uid = ?',
                    [normalizeReportId(reportId), studyUid]
                );
                desktopReportPathCache.delete(normalizeReportId(reportId));

                const filePath = rows[0]?.file_path;
                if (filePath && fs?.exists && fs?.remove) {
                    try {
                        if (await fs.exists(filePath)) {
                            await fs.remove(filePath);
                        }
                    } catch (error) {
                        console.warn('DesktopBackend: failed to remove orphaned report file:', error);
                    }
                }
                return true;
            } catch (error) {
                console.warn('DesktopBackend: failed to delete report:', error);
                return false;
            }
        },

        async migrate(payload) {
            await initializeDesktopPersistence();
            const batch = createEmptyDesktopMigrationBatch();
            appendLegacyStoreToDesktopMigration(batch, payload);
            if (!hasDesktopMigrationRows(batch)) return false;
            await applyDesktopMigrationBatch(batch);
            return true;
        },

        getReportFileUrl(reportId) {
            const { core } = getDesktopTauriApis();
            if (!core?.convertFileSrc) return '';
            const filePath = desktopReportPathCache.get(normalizeReportId(reportId)) || '';
            return filePath ? core.convertFileSrc(filePath) : '';
        },

        getReportFilePath(reportId) {
            return desktopReportPathCache.get(normalizeReportId(reportId)) || '';
        }
    };

    async function initializeDesktopStorage() {
        return await initializeDesktopPersistence();
    }

    return {
        DesktopBackend,
        initializeDesktopStorage,
        loadDesktopLibraryConfig,
        saveDesktopLibraryConfig,
        loadDesktopScanCache,
        saveDesktopScanCacheEntries,
        saveImportJob,
        updateImportJob,
        loadRecentImportJobs,
        getDesktopDb,
        initializeDesktopPersistence
    };
})();

if (typeof window !== 'undefined') {
    window._NotesDesktop = _NotesDesktop;
}
