/**
 * NotesAPI - Persistence abstraction with pluggable backends
 *
 * Routes to LocalBackend (browser localStorage), DesktopSqliteBackend
 * (native desktop SQLite), or ServerBackend (Flask API) based on
 * deployment mode from CONFIG.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const NotesAPI = (() => {
    const STORAGE_KEY = 'dicom-viewer-notes-v3';
    const baseUrl = '/api/notes';
    const DESKTOP_DB_URL = 'sqlite:viewer.db';
    const DESKTOP_LIBRARY_CONFIG_KEY = 'desktop_library_config';
    const DESKTOP_LOCALSTORAGE_MIGRATION_KEY = 'localstorage_migrated';
    const DESKTOP_LEGACY_BROWSER_STORE_MIGRATION_KEY = 'legacy_desktop_browser_store_migrated';
    const DESKTOP_LIBRARY_CONFIG_STORAGE_KEY = 'dicom-viewer-library-config';
    const DESKTOP_SCAN_CACHE_VERSION = 1;
    const DESKTOP_SCAN_CACHE_CHUNK_SIZE = 256;
    const LEGACY_STORAGE_KEY = 'dicom-viewer-comments';
    const LEGACY_REPORTS_DB = 'dicom-viewer-reports';
    const LEGACY_REPORTS_STORE = 'reports';
    const REPORT_FILE_EXTENSIONS = Object.freeze({
        pdf: 'pdf',
        png: 'png',
        jpg: 'jpg'
    });
    let serverAvailable = true;
    let serverDisabledAt = 0;
    const SERVER_RETRY_MS = 60000; // Retry server after 60 seconds
    let lastCommentTimestamp = 0;
    let commentCounter = 0;
    let desktopDbPromise = null;
    let desktopMigrationPromise = null;
    const desktopReportPathCache = new Map();

    function createEmptyStore() {
        return { studies: {} };
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeCommentId(value) {
        if (value === null || value === undefined) return null;
        const asNumber = Number(value);
        if (!Number.isNaN(asNumber)) return asNumber;
        return String(value);
    }

    function createCommentId() {
        const now = Date.now();
        if (now === lastCommentTimestamp) {
            commentCounter += 1;
            return `${now}-${commentCounter}`;
        }
        lastCommentTimestamp = now;
        commentCounter = 0;
        return String(now);
    }

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return createEmptyStore();
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !parsed.studies || typeof parsed.studies !== 'object') {
                return createEmptyStore();
            }
            return parsed;
        } catch (e) {
            console.warn('LocalBackend: failed to load:', e);
            return createEmptyStore();
        }
    }

    function saveStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (e) {
            console.warn('LocalBackend: failed to save:', e);
        }
    }

    function ensureStudy(store, studyUid) {
        if (!store.studies[studyUid]) {
            store.studies[studyUid] = {
                description: '',
                comments: [],
                series: {},
                reports: []
            };
            return store.studies[studyUid];
        }

        const entry = store.studies[studyUid];
        if (typeof entry.description !== 'string') entry.description = '';
        if (!Array.isArray(entry.comments)) entry.comments = [];
        if (!entry.series || typeof entry.series !== 'object') entry.series = {};
        if (!Array.isArray(entry.reports)) entry.reports = [];
        return entry;
    }

    function ensureSeries(studyEntry, seriesUid) {
        if (!studyEntry.series[seriesUid]) {
            studyEntry.series[seriesUid] = {
                description: '',
                comments: []
            };
            return studyEntry.series[seriesUid];
        }

        const entry = studyEntry.series[seriesUid];
        if (typeof entry.description !== 'string') entry.description = '';
        if (!Array.isArray(entry.comments)) entry.comments = [];
        return entry;
    }

    function normalizeReportId(value) {
        if (value === null || value === undefined) return null;
        return String(value);
    }

    function findCommentById(comments, commentId) {
        if (!Array.isArray(comments)) return null;
        const target = normalizeCommentId(commentId);
        if (target === null) return null;
        return comments.find((comment) => normalizeCommentId(comment.id) === target) || null;
    }

    function findReportMetadata(store, reportId) {
        const target = normalizeReportId(reportId);
        if (!target || !store?.studies || typeof store.studies !== 'object') return null;

        for (const [studyUid] of Object.entries(store.studies)) {
            const studyEntry = ensureStudy(store, studyUid);
            const report = studyEntry.reports.find((entry) => normalizeReportId(entry?.id) === target) || null;
            if (report) {
                return { studyUid, studyEntry, report };
            }
        }

        return null;
    }

    function sanitizeFilenamePart(value, fallback = 'report') {
        const safe = String(value || '')
            .replace(/[^A-Za-z0-9._-]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return safe || fallback;
    }

    function getDesktopTauriApis() {
        const tauri = window.__TAURI__;
        return {
            fs: tauri?.fs || null,
            path: tauri?.path || null,
            core: tauri?.core || null,
            sql: tauri?.sql || null
        };
    }

    function normalizeDesktopLibraryConfig(config) {
        return {
            folder: typeof config?.folder === 'string' && config.folder ? config.folder : null,
            lastScan: typeof config?.lastScan === 'string' && config.lastScan ? config.lastScan : null
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
        return window.__TAURI__ || null;
    }

    async function getDesktopDb() {
        const runtime = await waitForDesktopRuntime();
        const sql = runtime?.sql;
        if (!sql?.load) {
            throw new Error('Desktop SQL runtime is not ready. Quit and reopen the app if this persists.');
        }
        if (!desktopDbPromise) {
            desktopDbPromise = sql.load(DESKTOP_DB_URL).catch((error) => {
                desktopDbPromise = null;
                throw error;
            });
        }
        return desktopDbPromise;
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

    async function migrateLegacyReportBlobs(payload) {
        const commentsBlob = payload?.comments;
        if (!commentsBlob || typeof commentsBlob !== 'object') return;

        const legacyDb = await openLegacyReportsDb();
        try {
            for (const [studyUid, stored] of Object.entries(commentsBlob)) {
                const reports = stored?.reports || [];
                for (const report of reports) {
                    if (!report?.id) continue;
                    const blob = await getLegacyReportBlob(legacyDb, report.id);
                    if (!blob) continue;
                    const filename = report.name || 'report';
                    const file = new File([blob], filename, { type: blob.type || '' });
                    await storeDesktopReport(studyUid, file, report, { skipInit: true });
                }
            }
        } finally {
            if (legacyDb) legacyDb.close();
        }
    }

    async function applyDesktopMigrationBatch(batch) {
        if (!hasDesktopMigrationRows(batch)) return true;

        const runtime = await waitForDesktopRuntime();
        const invoke = runtime?.core?.invoke;
        if (typeof invoke !== 'function') {
            throw new Error('Desktop migration runtime is not ready. Quit and reopen the app if this persists.');
        }

        // tauri-plugin-sql does not expose a pinned transaction object to JS, so
        // migration upserts run through a native command that owns one SQLite tx.
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
        return Array.isArray(stores) ? stores : [];
    }

    async function migrateDesktopLocalStorage() {
        const migrated = await getDesktopAppConfigValue(DESKTOP_LOCALSTORAGE_MIGRATION_KEY);
        if (migrated === '1') return false;

        const currentStore = safeJsonParse(safeLocalStorageGet(STORAGE_KEY), createEmptyStore());
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
            await migrateLegacyReportBlobs(legacyPayload);
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
        if (getBackend() !== 'desktop') return false;
        if (!desktopMigrationPromise) {
            desktopMigrationPromise = (async () => {
                await getDesktopDb();
                await migrateDesktopLocalStorage();
                await migrateLegacyDesktopBrowserStores();
                return true;
            })().catch((error) => {
                desktopMigrationPromise = null;
                throw error;
            });
        }
        return desktopMigrationPromise;
    }

    async function storeDesktopReport(studyUid, file, report = {}, options = {}) {
        if (!studyUid || !file || !report?.id) return null;

        if (!options.skipInit) {
            await initializeDesktopPersistence();
        }
        const db = await getDesktopDb();
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
                console.warn('DesktopSqliteBackend: failed to remove report backup file:', cleanupError);
            }
        }

        if (existing?.file_path && existing.file_path !== finalPath) {
            try {
                if (await fs.exists(existing.file_path)) {
                    await fs.remove(existing.file_path);
                }
            } catch (cleanupError) {
                console.warn('DesktopSqliteBackend: failed to remove superseded report file:', cleanupError);
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

    // ---- LocalBackend ----
    const LocalBackend = {
        async loadNotes(studyUids) {
            const list = (studyUids || []).filter(Boolean);
            if (!list.length) return createEmptyStore();

            const store = loadStore();
            const filtered = createEmptyStore();
            for (const studyUid of list) {
                if (store.studies[studyUid]) {
                    filtered.studies[studyUid] = clone(ensureStudy(store, studyUid));
                }
            }
            return filtered;
        },

        async saveStudyDescription(studyUid, description) {
            if (!studyUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            studyEntry.description = description || '';
            saveStore(store);
            return clone(studyEntry);
        },

        async saveSeriesDescription(studyUid, seriesUid, description) {
            if (!studyUid || !seriesUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            const seriesEntry = ensureSeries(studyEntry, seriesUid);
            seriesEntry.description = description || '';
            saveStore(store);
            return clone(seriesEntry);
        },

        async addComment(studyUid, payload = {}) {
            if (!studyUid) return null;
            const store = loadStore();
            const studyEntry = ensureStudy(store, studyUid);
            const seriesUid = payload.seriesUid || null;
            const target = seriesUid ? ensureSeries(studyEntry, seriesUid) : studyEntry;

            const comment = {
                id: createCommentId(),
                text: (payload.text || '').trim(),
                time: payload.time ?? Date.now()
            };
            target.comments.push(comment);
            saveStore(store);
            return clone(comment);
        },

        async updateComment(studyUid, commentId, payload = {}) {
            if (!studyUid || commentId === undefined || commentId === null) return null;
            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return null;

            ensureStudy(store, studyUid);

            let comment = findCommentById(studyEntry.comments, commentId);
            if (!comment) {
                for (const seriesEntry of Object.values(studyEntry.series)) {
                    comment = findCommentById(seriesEntry.comments, commentId);
                    if (comment) break;
                }
            }
            if (!comment) return null;

            comment.text = (payload.text || '').trim();
            comment.time = Date.now();
            saveStore(store);
            return clone(comment);
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            const store = loadStore();
            const studyEntry = store.studies[studyUid];
            if (!studyEntry) return true;

            ensureStudy(store, studyUid);
            const target = normalizeCommentId(commentId);
            studyEntry.comments = studyEntry.comments.filter((comment) => normalizeCommentId(comment.id) !== target);

            for (const seriesEntry of Object.values(studyEntry.series)) {
                if (!Array.isArray(seriesEntry.comments)) {
                    seriesEntry.comments = [];
                    continue;
                }
                seriesEntry.comments = seriesEntry.comments.filter((comment) => normalizeCommentId(comment.id) !== target);
            }

            saveStore(store);
            return true;
        },

        async uploadReport() {
            return null;
        },

        async deleteReport() {
            // No persistent report storage in localStorage, so delete is a no-op success.
            // Returning true lets the UI remove the in-memory entry without error.
            return true;
        },

        async migrate() {
            return null;
        },

        getReportFileUrl() {
            return '';
        }
    };

    // ---- DesktopSqliteBackend ----
    const DesktopSqliteBackend = {
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
                    `SELECT id, study_uid, series_uid, text, time
                     FROM comments
                     WHERE study_uid IN (${placeholders})
                     ORDER BY time ASC, id ASC`,
                    list
                ),
                db.select(
                    `SELECT id, study_uid, name, type, size, added_at, updated_at, file_path
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
                const target = row.series_uid
                    ? ensureSeries(ensureStudy(notes, row.study_uid), row.series_uid)
                    : ensureStudy(notes, row.study_uid);
                target.comments.push({
                    id: row.id,
                    text: row.text,
                    time: row.time
                });
            }

            for (const row of reportRows) {
                ensureStudy(notes, row.study_uid).reports.push({
                    id: row.id,
                    name: row.name,
                    type: row.type,
                    size: row.size,
                    filePath: row.file_path,
                    addedAt: row.added_at,
                    updatedAt: row.updated_at
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
                console.warn('DesktopSqliteBackend: failed to upload report:', error);
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
                        console.warn('DesktopSqliteBackend: failed to remove orphaned report file:', error);
                    }
                }
                return true;
            } catch (error) {
                console.warn('DesktopSqliteBackend: failed to delete report:', error);
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
        }
    };

    function disableServer() {
        serverAvailable = false;
        serverDisabledAt = Date.now();
        console.warn('NotesAPI: server unreachable, using local storage. Will retry in 60s.');
    }

    function checkServerAvailable() {
        if (serverAvailable) return true;
        // Circuit breaker: re-enable after retry interval
        if (Date.now() - serverDisabledAt >= SERVER_RETRY_MS) {
            serverAvailable = true;
            return true;
        }
        return false;
    }

    async function requestJson(url, options = {}) {
        if (!checkServerAvailable()) return null;
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                console.warn('NotesAPI request failed:', res.status, url);
                return null;
            }
            return await res.json();
        } catch (err) {
            console.warn('NotesAPI unavailable:', err);
            disableServer();
            return null;
        }
    }

    async function requestOk(url, options = {}) {
        if (!checkServerAvailable()) return false;
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                console.warn('NotesAPI request failed:', res.status, url);
                return false;
            }
            return true;
        } catch (err) {
            console.warn('NotesAPI unavailable:', err);
            disableServer();
            return false;
        }
    }

    function encodeId(value) {
        return encodeURIComponent(value);
    }

    // ---- ServerBackend ----
    const ServerBackend = {
        async loadNotes(studyUids) {
            const list = (studyUids || []).filter(Boolean);
            if (!list.length) return { studies: {} };
            const query = list.map(encodeId).join(',');
            const data = await requestJson(`${baseUrl}/?studies=${query}`);
            return data || null;
        },

        async saveStudyDescription(studyUid, description) {
            if (!studyUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/description`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description })
            });
        },

        async saveSeriesDescription(studyUid, seriesUid, description) {
            if (!studyUid || !seriesUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/series/${encodeId(seriesUid)}/description`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description })
            });
        },

        async addComment(studyUid, payload) {
            if (!studyUid) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        async updateComment(studyUid, commentId, payload) {
            if (!studyUid || commentId === undefined || commentId === null) return null;
            return await requestJson(`${baseUrl}/${encodeId(studyUid)}/comments/${encodeId(commentId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        async deleteComment(studyUid, commentId) {
            if (!studyUid || commentId === undefined || commentId === null) return false;
            return await requestOk(`${baseUrl}/${encodeId(studyUid)}/comments/${encodeId(commentId)}`, {
                method: 'DELETE'
            });
        },

        async uploadReport(studyUid, file, meta = {}) {
            if (!studyUid || !file) return null;
            if (!checkServerAvailable()) return null;

            const form = new FormData();
            const filename = meta.name || file.name || 'report';
            form.append('file', file, filename);
            if (meta.id) form.append('id', meta.id);
            if (meta.name) form.append('name', meta.name);
            if (meta.type) form.append('type', meta.type);
            if (meta.size !== undefined && meta.size !== null) form.append('size', meta.size);
            if (meta.addedAt !== undefined && meta.addedAt !== null) form.append('addedAt', meta.addedAt);
            if (meta.updatedAt !== undefined && meta.updatedAt !== null) form.append('updatedAt', meta.updatedAt);

            try {
                const res = await fetch(`${baseUrl}/${encodeId(studyUid)}/reports`, {
                    method: 'POST',
                    body: form
                });
                if (!res.ok) {
                    console.warn('NotesAPI report upload failed:', res.status);
                    return null;
                }
                return await res.json();
            } catch (err) {
                console.warn('NotesAPI unavailable:', err);
                disableServer();
                return null;
            }
        },

        async deleteReport(studyUid, reportId) {
            if (!studyUid || !reportId) return false;
            return await requestOk(`${baseUrl}/${encodeId(studyUid)}/reports/${encodeId(reportId)}`, {
                method: 'DELETE'
            });
        },

        async migrate(payload) {
            return await requestJson(`${baseUrl}/migrate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        getReportFileUrl(reportId) {
            if (!reportId) return '';
            return `${baseUrl}/reports/${encodeId(reportId)}/file`;
        }
    };

    // ---- Dispatcher ----
    function getBackend() {
        const mode = (typeof CONFIG !== 'undefined') ? CONFIG.deploymentMode : 'personal';
        if (mode === 'desktop') return 'desktop';
        const hasServer = (typeof CONFIG !== 'undefined' && CONFIG.features)
            ? CONFIG.features.notesServer
            : mode === 'personal' || mode === 'cloud';
        if (hasServer) return 'server';
        return 'local';
    }

    function isEnabled() {
        if (typeof CONFIG !== 'undefined' && CONFIG.shouldPersistNotes) {
            return CONFIG.shouldPersistNotes();
        }
        return true;
    }

    async function withFallback(serverCall, localCall, desktopCall = localCall) {
        const backend = getBackend();
        if (backend === 'desktop') {
            return await desktopCall();
        }
        if (backend === 'local') {
            return await localCall();
        }

        const result = await serverCall();
        // Only fall back to localStorage when the server became unreachable
        // (network error that triggered disableServer). Application-level
        // errors (4xx, 5xx) should surface as failures, not be silently
        // absorbed by the local backend -- that would create divergent data.
        if ((result === null || result === false) && !serverAvailable) {
            return await localCall();
        }
        return result;
    }

    async function loadNotes(studyUids) {
        if (!isEnabled()) return { studies: {} };
        return await withFallback(
            () => ServerBackend.loadNotes(studyUids),
            () => LocalBackend.loadNotes(studyUids),
            () => DesktopSqliteBackend.loadNotes(studyUids)
        );
    }

    async function saveStudyDescription(studyUid, description) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.saveStudyDescription(studyUid, description),
            () => LocalBackend.saveStudyDescription(studyUid, description),
            () => DesktopSqliteBackend.saveStudyDescription(studyUid, description)
        );
    }

    async function saveSeriesDescription(studyUid, seriesUid, description) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.saveSeriesDescription(studyUid, seriesUid, description),
            () => LocalBackend.saveSeriesDescription(studyUid, seriesUid, description),
            () => DesktopSqliteBackend.saveSeriesDescription(studyUid, seriesUid, description)
        );
    }

    async function addComment(studyUid, payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.addComment(studyUid, payload),
            () => LocalBackend.addComment(studyUid, payload),
            () => DesktopSqliteBackend.addComment(studyUid, payload)
        );
    }

    async function updateComment(studyUid, commentId, payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.updateComment(studyUid, commentId, payload),
            () => LocalBackend.updateComment(studyUid, commentId, payload),
            () => DesktopSqliteBackend.updateComment(studyUid, commentId, payload)
        );
    }

    async function deleteComment(studyUid, commentId) {
        if (!isEnabled()) return false;
        return await withFallback(
            () => ServerBackend.deleteComment(studyUid, commentId),
            () => LocalBackend.deleteComment(studyUid, commentId),
            () => DesktopSqliteBackend.deleteComment(studyUid, commentId)
        );
    }

    async function uploadReport(studyUid, file, meta) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.uploadReport(studyUid, file, meta),
            () => LocalBackend.uploadReport(studyUid, file, meta),
            () => DesktopSqliteBackend.uploadReport(studyUid, file, meta)
        );
    }

    async function deleteReport(studyUid, reportId) {
        if (!isEnabled()) return false;
        return await withFallback(
            () => ServerBackend.deleteReport(studyUid, reportId),
            () => LocalBackend.deleteReport(studyUid, reportId),
            () => DesktopSqliteBackend.deleteReport(studyUid, reportId)
        );
    }

    async function migrate(payload) {
        if (!isEnabled()) return null;
        return await withFallback(
            () => ServerBackend.migrate(payload),
            () => LocalBackend.migrate(payload),
            () => DesktopSqliteBackend.migrate(payload)
        );
    }

    function getReportFileUrl(reportId) {
        if (!isEnabled()) return '';
        const backend = getBackend();
        if (backend === 'server') {
            return ServerBackend.getReportFileUrl(reportId);
        }
        if (backend === 'desktop') {
            return DesktopSqliteBackend.getReportFileUrl(reportId);
        }
        return LocalBackend.getReportFileUrl(reportId);
    }

    async function initializeDesktopStorage() {
        return await initializeDesktopPersistence();
    }

    return {
        isEnabled,
        loadNotes,
        saveStudyDescription,
        saveSeriesDescription,
        addComment,
        updateComment,
        deleteComment,
        uploadReport,
        deleteReport,
        migrate,
        getReportFileUrl,
        initializeDesktopStorage,
        loadDesktopLibraryConfig,
        saveDesktopLibraryConfig,
        loadDesktopScanCache,
        saveDesktopScanCacheEntries
    };
})();

if (typeof window !== 'undefined') {
    window.NotesAPI = NotesAPI;
}
