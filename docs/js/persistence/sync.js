/**
 * Sync Outbox - Change capture for cloud sync
 *
 * Browser mode stores sync state in localStorage. Desktop mode uses SQLite as
 * the source of truth for sync_outbox and sync_state, with localStorage used
 * only as a one-time migration source.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _SyncOutbox = (() => {
    const OUTBOX_KEY = 'dicom-viewer-sync-outbox';
    const SYNC_STATE_KEY = 'dicom-viewer-sync-state';
    const LEGACY_DEVICE_ID_KEY = 'dicom-viewer-device-id';

    let dbConnection = null;
    let dbPromise = null;
    let hydrationPromise = null;
    let legacyCleanupScheduled = false;
    const desktopCache = {
        hydrated: false,
        outbox: [],
        syncState: {},
    };

    function mapDesktopOutboxRow(row) {
        return {
            id: String(row.id),
            operation_uuid: row.operation_uuid,
            table_name: row.table_name,
            record_key: row.record_key,
            operation: row.operation,
            base_sync_version: row.base_sync_version,
            created_at: row.created_at,
            synced_at: row.synced_at,
            attempts: row.attempts || 0,
            last_error: row.last_error,
        };
    }

    function mergeHydratedSyncState(stateRows) {
        for (const row of stateRows) {
            if (!Object.hasOwn(desktopCache.syncState, row.key)) {
                desktopCache.syncState[row.key] = row.value;
            }
        }
    }

    function mergeHydratedOutbox(outboxRows) {
        const existingOperationIds = new Set(desktopCache.outbox.map((entry) => entry?.operation_uuid).filter(Boolean));

        for (const row of outboxRows) {
            if (!existingOperationIds.has(row.operation_uuid)) {
                desktopCache.outbox.push(mapDesktopOutboxRow(row));
            }
        }

        desktopCache.outbox.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    }

    function isDesktopMode() {
        if (typeof window === 'undefined') return false;
        if (typeof window.CONFIG !== 'undefined') {
            return window.CONFIG.deploymentMode === 'desktop';
        }
        return typeof window.__TAURI__ !== 'undefined';
    }

    async function getDb() {
        if (!isDesktopMode()) return null;
        if (dbConnection) return dbConnection;
        if (dbPromise) return dbPromise;

        dbPromise = (async () => {
            try {
                if (window._NotesDesktop?.getDesktopDb) {
                    dbConnection = await window._NotesDesktop.getDesktopDb();
                    return dbConnection;
                }
                const sql = window.__TAURI__?.sql;
                if (!sql?.load) return null;
                dbConnection = await sql.load('sqlite:viewer.db');
                return dbConnection;
            } catch (error) {
                console.warn('SyncOutbox: failed to open desktop SQLite:', error);
                return null;
            } finally {
                dbPromise = null;
            }
        })();

        return dbPromise;
    }

    function loadOutboxLS() {
        try {
            const raw = localStorage.getItem(OUTBOX_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('SyncOutbox: failed to load localStorage outbox:', error);
            return [];
        }
    }

    function saveOutboxLS(entries) {
        try {
            localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
        } catch (error) {
            console.warn('SyncOutbox: failed to save localStorage outbox:', error);
        }
    }

    function clearOutboxLS() {
        try {
            localStorage.removeItem(OUTBOX_KEY);
        } catch {}
    }

    function loadSyncStateLS() {
        try {
            const raw = localStorage.getItem(SYNC_STATE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.warn('SyncOutbox: failed to load localStorage sync state:', error);
            return {};
        }
    }

    function saveSyncStateLS(state) {
        try {
            localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('SyncOutbox: failed to save localStorage sync state:', error);
        }
    }

    function clearSyncStateLS() {
        try {
            localStorage.removeItem(SYNC_STATE_KEY);
            localStorage.removeItem(LEGACY_DEVICE_ID_KEY);
        } catch {}
    }

    function scrubLegacyDesktopStorage() {
        clearOutboxLS();
        clearSyncStateLS();
    }

    function scheduleLegacyDesktopStorageCleanup() {
        if (!isDesktopMode()) return;
        scrubLegacyDesktopStorage();
        if (legacyCleanupScheduled || typeof window === 'undefined') {
            return;
        }
        legacyCleanupScheduled = true;

        queueMicrotask(() => {
            scrubLegacyDesktopStorage();
        });

        window.setTimeout(() => {
            scrubLegacyDesktopStorage();
            legacyCleanupScheduled = false;
        }, 0);
    }

    function cloneEntries(entries) {
        return entries.map((entry) => ({ ...entry }));
    }

    function dispatchSyncEvent(type, detail) {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent(type, detail === undefined ? undefined : { detail }));
    }

    function normalizeRecordKey(recordKey) {
        if (recordKey === null || recordKey === undefined) return null;
        const normalized = String(recordKey).trim();
        return normalized || null;
    }

    async function migrateLegacyDesktopStorage(db) {
        const legacyState = loadSyncStateLS();
        try {
            const legacyDeviceId = localStorage.getItem(LEGACY_DEVICE_ID_KEY);
            if (legacyDeviceId && !legacyState.device_id) {
                legacyState.device_id = legacyDeviceId;
            }
        } catch {}

        for (const [key, value] of Object.entries(legacyState)) {
            const existing = await db.select('SELECT key, value FROM sync_state WHERE key = ?', [key]);
            if (existing.length > 0) continue;
            await db.execute('INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)', [
                key,
                value != null ? String(value) : null,
                Date.now(),
            ]);
        }

        const existingOutboxRows = await db.select(
            `SELECT id, operation_uuid, table_name, record_key, operation,
                    base_sync_version, created_at, synced_at, attempts, last_error
             FROM sync_outbox`,
        );
        const existingOpUuids = new Set(existingOutboxRows.map((row) => row.operation_uuid).filter(Boolean));

        for (const entry of loadOutboxLS()) {
            const operationUuid = entry.operation_uuid || crypto.randomUUID();
            if (existingOpUuids.has(operationUuid)) continue;
            await db.execute(
                `INSERT INTO sync_outbox (operation_uuid, table_name, record_key, operation, base_sync_version, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    operationUuid,
                    entry.table_name,
                    String(entry.record_key),
                    entry.operation,
                    entry.base_sync_version || 0,
                    entry.created_at || Date.now(),
                ],
            );
            existingOpUuids.add(operationUuid);
        }

        scrubLegacyDesktopStorage();
    }

    async function hydrateFromSqlite() {
        if (!isDesktopMode()) return;
        if (desktopCache.hydrated) return;
        if (hydrationPromise) return hydrationPromise;

        hydrationPromise = (async () => {
            const db = await getDb();
            if (!db) {
                return;
            }

            await migrateLegacyDesktopStorage(db);

            const stateRows = await db.select('SELECT key, value FROM sync_state');
            const outboxRows = await db.select(
                `SELECT id, operation_uuid, table_name, record_key, operation,
                        base_sync_version, created_at, synced_at, attempts, last_error
                 FROM sync_outbox
                 ORDER BY created_at ASC`,
            );

            mergeHydratedSyncState(stateRows);
            mergeHydratedOutbox(outboxRows);

            desktopCache.hydrated = true;
            scheduleLegacyDesktopStorageCleanup();
        })().finally(() => {
            hydrationPromise = null;
        });

        return hydrationPromise;
    }

    function loadOutbox() {
        return isDesktopMode() ? cloneEntries(desktopCache.outbox) : loadOutboxLS();
    }

    async function loadOutboxAsync() {
        if (isDesktopMode()) {
            await hydrateFromSqlite();
            return cloneEntries(desktopCache.outbox);
        }
        return loadOutboxLS();
    }

    function saveOutbox(entries) {
        if (isDesktopMode()) {
            desktopCache.outbox = cloneEntries(Array.isArray(entries) ? entries : []);
            scheduleLegacyDesktopStorageCleanup();
            return;
        }
        saveOutboxLS(entries);
    }

    function loadSyncState() {
        return isDesktopMode() ? { ...desktopCache.syncState } : loadSyncStateLS();
    }

    function saveSyncState(state) {
        if (isDesktopMode()) {
            desktopCache.syncState = { ...(state || {}) };
            scheduleLegacyDesktopStorageCleanup();
            return;
        }
        saveSyncStateLS(state);
    }

    function enqueueChange(tableName, recordKey, operation, baseSyncVersion) {
        const normalizedRecordKey = normalizeRecordKey(recordKey);
        if (!normalizedRecordKey) {
            console.warn(`SyncOutbox: refusing to enqueue ${tableName} ${operation} with empty record key`);
            return null;
        }

        const entry = {
            id: crypto.randomUUID(),
            operation_uuid: crypto.randomUUID(),
            table_name: tableName,
            record_key: normalizedRecordKey,
            operation,
            base_sync_version: baseSyncVersion || 0,
            created_at: Date.now(),
            synced_at: null,
            attempts: 0,
            last_error: null,
        };

        if (isDesktopMode()) {
            desktopCache.outbox.push(entry);
            scheduleLegacyDesktopStorageCleanup();
            getDb()
                .then(async (db) => {
                    if (!db) return;
                    await hydrateFromSqlite();
                    await db.execute(
                        `INSERT INTO sync_outbox (operation_uuid, table_name, record_key, operation, base_sync_version, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            entry.operation_uuid,
                            entry.table_name,
                            entry.record_key,
                            entry.operation,
                            entry.base_sync_version,
                            entry.created_at,
                        ],
                    );
                })
                .catch((error) => {
                    console.warn('SyncOutbox: failed to persist desktop outbox entry:', error);
                });
            dispatchSyncEvent('sync:pending', { tableName, recordKey: normalizedRecordKey, operation });
            return entry;
        }

        const outbox = loadOutboxLS();
        outbox.push(entry);
        saveOutboxLS(outbox);
        dispatchSyncEvent('sync:pending', { tableName, recordKey: normalizedRecordKey, operation });
        return entry;
    }

    function readPendingChanges() {
        return loadOutbox()
            .filter((entry) => !entry.synced_at)
            .sort((a, b) => a.created_at - b.created_at);
    }

    async function readPendingChangesAsync() {
        if (isDesktopMode()) {
            await hydrateFromSqlite();
        }
        return readPendingChanges();
    }

    function collapseChanges(entries) {
        const groups = new Map();
        for (const entry of entries) {
            const groupKey = `${entry.table_name}::${entry.record_key}`;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(entry);
        }

        const collapsed = [];
        for (const [, group] of groups) {
            const result = collapseGroup(group);
            if (result) {
                collapsed.push(result);
            }
        }

        return collapsed;
    }

    function collapseGroup(group) {
        if (group.length === 0) return null;
        if (group.length === 1) return group[0];

        const first = group[0];
        const last = group[group.length - 1];
        const oldestBaseSyncVersion = Math.min(...group.map((entry) => entry.base_sync_version));
        const allIds = group.map((entry) => entry.id);

        let effectiveOp = first.operation;
        for (let index = 1; index < group.length; index += 1) {
            effectiveOp = mergeOperations(effectiveOp, group[index].operation);
            if (effectiveOp === null) {
                return {
                    _noop: true,
                    _entry_ids: allIds,
                    table_name: first.table_name,
                    record_key: first.record_key,
                };
            }
        }

        return {
            ...last,
            operation: effectiveOp,
            base_sync_version: oldestBaseSyncVersion,
            _entry_ids: allIds,
        };
    }

    function mergeOperations(current, next) {
        if (current === 'insert' && next === 'update') return 'insert';
        if (current === 'insert' && next === 'delete') return null;
        if (current === 'update' && next === 'update') return 'update';
        if (current === 'update' && next === 'delete') return 'delete';
        if (current === 'delete' && next === 'insert') return 'update';
        return next;
    }

    function markSynced(entryIds, syncedAt) {
        const idSet = new Set(entryIds);
        if (isDesktopMode()) {
            const syncedEntries = desktopCache.outbox.filter((entry) => idSet.has(entry.id));
            desktopCache.outbox = desktopCache.outbox.filter((entry) => !idSet.has(entry.id));
            getDb()
                .then((db) => {
                    if (!db) return;
                    return Promise.all(
                        syncedEntries.map((entry) =>
                            db.execute('DELETE FROM sync_outbox WHERE operation_uuid = ?', [entry.operation_uuid]),
                        ),
                    );
                })
                .catch((error) => {
                    console.warn('SyncOutbox: failed to delete synced desktop outbox rows:', error);
                });
            return;
        }

        const outbox = loadOutboxLS();
        const remaining = outbox.filter((entry) => !idSet.has(entry.id));
        saveOutboxLS(remaining);
    }

    function markFailed(entryIds, error) {
        const idSet = new Set(entryIds);
        if (isDesktopMode()) {
            const failedEntries = [];
            for (const entry of desktopCache.outbox) {
                if (idSet.has(entry.id)) {
                    entry.attempts = (entry.attempts || 0) + 1;
                    entry.last_error = error;
                    failedEntries.push(entry);
                }
            }
            getDb()
                .then((db) => {
                    if (!db) return;
                    return Promise.all(
                        failedEntries.map((entry) =>
                            db.execute('UPDATE sync_outbox SET attempts = ?, last_error = ? WHERE operation_uuid = ?', [
                                entry.attempts,
                                error,
                                entry.operation_uuid,
                            ]),
                        ),
                    );
                })
                .catch((dbError) => {
                    console.warn('SyncOutbox: failed to persist desktop outbox error state:', dbError);
                });
            return;
        }

        const outbox = loadOutboxLS();
        for (const entry of outbox) {
            if (idSet.has(entry.id)) {
                entry.attempts = (entry.attempts || 0) + 1;
                entry.last_error = error;
            }
        }
        saveOutboxLS(outbox);
    }

    function findCommentInStudy(studyEntry, recordUuid) {
        if (Array.isArray(studyEntry.comments)) {
            const found = studyEntry.comments.find(
                (comment) => comment.record_uuid === recordUuid || comment.id === recordUuid,
            );
            if (found) return found;
        }
        if (studyEntry.series && typeof studyEntry.series === 'object') {
            for (const seriesEntry of Object.values(studyEntry.series)) {
                if (!Array.isArray(seriesEntry.comments)) continue;
                const found = seriesEntry.comments.find(
                    (comment) => comment.record_uuid === recordUuid || comment.id === recordUuid,
                );
                if (found) return found;
            }
        }
        return null;
    }

    function readRecordState(tableName, recordKey) {
        const { loadStore, ensureStudy, findReportMetadata } = window._NotesInternals;
        const store = loadStore();

        if (tableName === 'study_notes') {
            const studyEntry = store.studies[recordKey];
            if (!studyEntry) return null;
            return { description: studyEntry.description || '' };
        }

        if (tableName === 'comments') {
            for (const studyUid of Object.keys(store.studies)) {
                const studyEntry = ensureStudy(store, studyUid);
                const found = findCommentInStudy(studyEntry, recordKey);
                if (found) {
                    return {
                        study_uid: studyUid,
                        text: found.text || '',
                        created_at: found.created_at || found.time || 0,
                        updated_at: found.updated_at || found.time || 0,
                        deleted_at: found.deletedAt || found.deleted_at || null,
                    };
                }
            }
            return null;
        }

        if (tableName === 'reports') {
            const match = findReportMetadata(store, recordKey);
            if (!match) return null;
            const report = match.report;
            return {
                study_uid: match.studyUid,
                name: report.name || '',
                type: report.type || '',
                size: report.size || 0,
                content_hash: report.contentHash || null,
                created_at: report.addedAt ? new Date(report.addedAt).getTime() : 0,
                updated_at: report.updatedAt || 0,
                deleted_at: report.deletedAt || report.deleted_at || null,
            };
        }

        return null;
    }

    async function readRecordStateAsync(tableName, recordKey) {
        if (!isDesktopMode()) {
            return readRecordState(tableName, recordKey);
        }

        const db = await getDb();
        if (!db) {
            return readRecordState(tableName, recordKey);
        }

        if (tableName === 'study_notes') {
            const rows = await db.select('SELECT study_uid, description FROM study_notes WHERE study_uid = ? LIMIT 1', [
                recordKey,
            ]);
            return rows[0] ? { description: rows[0].description || '' } : null;
        }

        if (tableName === 'comments') {
            const rows = await db.select(
                `SELECT record_uuid, study_uid, series_uid, text, time, created_at, updated_at, deleted_at
                 FROM comments
                 WHERE record_uuid = ? LIMIT 1`,
                [recordKey],
            );
            if (!rows[0]) return null;
            return {
                study_uid: rows[0].study_uid,
                series_uid: rows[0].series_uid || null,
                text: rows[0].text || '',
                created_at: rows[0].created_at || rows[0].time || 0,
                updated_at: rows[0].updated_at || rows[0].time || 0,
                deleted_at: rows[0].deleted_at || null,
            };
        }

        if (tableName === 'reports') {
            const rows = await db.select(
                `SELECT id, study_uid, name, type, size, content_hash, added_at, updated_at, deleted_at
                 FROM reports
                 WHERE id = ? LIMIT 1`,
                [recordKey],
            );
            if (!rows[0]) return null;
            return {
                study_uid: rows[0].study_uid,
                name: rows[0].name || '',
                type: rows[0].type || '',
                size: rows[0].size || 0,
                content_hash: rows[0].content_hash || null,
                created_at: rows[0].added_at || 0,
                updated_at: rows[0].updated_at || 0,
                deleted_at: rows[0].deleted_at || null,
            };
        }

        return null;
    }

    function getSyncStateValue(key) {
        if (isDesktopMode()) {
            if (Object.hasOwn(desktopCache.syncState, key)) {
                return desktopCache.syncState[key];
            }
            if (desktopCache.hydrated) {
                return null;
            }
            const legacyState = loadSyncStateLS();
            if (Object.hasOwn(legacyState, key)) {
                return legacyState[key];
            }
            if (key === 'device_id') {
                try {
                    return localStorage.getItem(LEGACY_DEVICE_ID_KEY);
                } catch {
                    return null;
                }
            }
            return null;
        }

        const state = loadSyncStateLS();
        return state[key] || null;
    }

    function setSyncStateValue(key, value) {
        if (isDesktopMode()) {
            desktopCache.syncState[key] = value;
            scheduleLegacyDesktopStorageCleanup();
            getDb()
                .then(async (db) => {
                    if (!db) return;
                    await hydrateFromSqlite();
                    await db.execute('INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)', [
                        key,
                        value != null ? String(value) : null,
                        Date.now(),
                    ]);
                })
                .catch((error) => {
                    console.warn('SyncOutbox: failed to persist desktop sync state:', error);
                });
            return;
        }

        const state = loadSyncStateLS();
        state[key] = value;
        saveSyncStateLS(state);
    }

    function getCursor() {
        return getSyncStateValue('delta_cursor');
    }

    function setCursor(cursor) {
        setSyncStateValue('delta_cursor', cursor);
    }

    function getDeviceId() {
        return getSyncStateValue('device_id');
    }

    function setDeviceId(deviceId) {
        setSyncStateValue('device_id', deviceId);
    }

    if (isDesktopMode()) {
        hydrateFromSqlite().catch((error) => {
            console.warn('SyncOutbox: failed to hydrate desktop sync state:', error);
        });
    }

    return {
        enqueueChange,
        readPendingChanges,
        readPendingChangesAsync,
        collapseChanges,
        markSynced,
        markFailed,
        readRecordState,
        readRecordStateAsync,
        getCursor,
        setCursor,
        getDeviceId,
        setDeviceId,
        hydrateFromSqlite,
        _loadOutbox: loadOutbox,
        _loadOutboxAsync: loadOutboxAsync,
        _saveOutbox: saveOutbox,
        _loadSyncState: loadSyncState,
        _saveSyncState: saveSyncState,
        _mergeOperations: mergeOperations,
        dispatchSyncEvent,
    };
})();

if (typeof window !== 'undefined') {
    window._SyncOutbox = _SyncOutbox;
}
