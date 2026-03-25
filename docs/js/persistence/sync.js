/**
 * Sync Outbox - Change capture for cloud sync
 *
 * Provides enqueue, dequeue, collapse, and mark-synced operations
 * for the sync outbox. Storage backend depends on deployment mode:
 *   - Desktop (Tauri): SQLite via the Tauri SQL plugin (sync_outbox
 *     and sync_state tables created by migration 006)
 *   - Browser (cloud/personal): localStorage fallback
 *
 * The outbox captures every local write as a pending change entry.
 * The SyncEngine reads, collapses, and drains these entries to the
 * server via POST /api/sync.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _SyncOutbox = (() => {
    const OUTBOX_KEY = 'dicom-viewer-sync-outbox';
    const SYNC_STATE_KEY = 'dicom-viewer-sync-state';

    // Cached SQLite connection for desktop mode (resolved lazily)
    let _dbConnection = null;
    let _dbPromise = null;

    // ---- Desktop SQLite Helpers ----

    /**
     * Check if running in desktop (Tauri) mode.
     * @returns {boolean}
     */
    function isDesktopMode() {
        if (typeof window === 'undefined') return false;
        if (typeof window.CONFIG !== 'undefined') {
            return window.CONFIG.deploymentMode === 'desktop';
        }
        return typeof window.__TAURI__ !== 'undefined';
    }

    /**
     * Get the Tauri SQL database connection, creating it on first call.
     * Returns null when not in desktop mode or if the SQL plugin is unavailable.
     * @returns {Promise<Object|null>}
     */
    async function getDb() {
        if (!isDesktopMode()) return null;

        if (_dbConnection) return _dbConnection;
        if (_dbPromise) return _dbPromise;

        _dbPromise = (async () => {
            try {
                const sql = window.__TAURI__?.sql;
                if (!sql?.load) return null;
                _dbConnection = await sql.load('sqlite:viewer.db');
                return _dbConnection;
            } catch (e) {
                console.warn('SyncOutbox: failed to open desktop SQLite:', e);
                return null;
            } finally {
                _dbPromise = null;
            }
        })();

        return _dbPromise;
    }

    // ---- localStorage Outbox Storage ----

    function loadOutboxLS() {
        try {
            const raw = localStorage.getItem(OUTBOX_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn('SyncOutbox: failed to load outbox:', e);
            return [];
        }
    }

    function saveOutboxLS(entries) {
        try {
            localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
        } catch (e) {
            console.warn('SyncOutbox: failed to save outbox:', e);
        }
    }

    // ---- localStorage Sync State Storage ----

    function loadSyncStateLS() {
        try {
            const raw = localStorage.getItem(SYNC_STATE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            console.warn('SyncOutbox: failed to load sync state:', e);
            return {};
        }
    }

    function saveSyncStateLS(state) {
        try {
            localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('SyncOutbox: failed to save sync state:', e);
        }
    }

    // ---- Unified storage: delegates to SQLite on desktop, localStorage otherwise ----

    /**
     * Load the outbox array. Uses SQLite on desktop, localStorage otherwise.
     * Synchronous callers (legacy code paths) get localStorage; async callers
     * should use loadOutboxAsync().
     * @returns {Array}
     */
    function loadOutbox() {
        // Synchronous path -- always localStorage.
        // Desktop async callers should use the async-aware public API methods.
        return loadOutboxLS();
    }

    /**
     * Load outbox from SQLite if available, falling back to localStorage.
     * @returns {Promise<Array>}
     */
    async function loadOutboxAsync() {
        const db = await getDb();
        if (!db) return loadOutboxLS();

        try {
            const rows = await db.select(
                `SELECT id, operation_uuid, table_name, record_key, operation,
                        base_sync_version, created_at, synced_at, attempts, last_error
                 FROM sync_outbox
                 ORDER BY created_at ASC`
            );
            return rows.map(row => ({
                id: String(row.id),
                operation_uuid: row.operation_uuid,
                table_name: row.table_name,
                record_key: row.record_key,
                operation: row.operation,
                base_sync_version: row.base_sync_version,
                created_at: row.created_at,
                synced_at: row.synced_at,
                attempts: row.attempts || 0,
                last_error: row.last_error
            }));
        } catch (e) {
            console.warn('SyncOutbox: SQLite outbox read failed, falling back to localStorage:', e);
            return loadOutboxLS();
        }
    }

    function saveOutbox(entries) {
        saveOutboxLS(entries);
    }

    function loadSyncState() {
        return loadSyncStateLS();
    }

    function saveSyncState(state) {
        saveSyncStateLS(state);
    }

    // ---- Public API ----

    /**
     * Enqueue a change to the outbox.
     *
     * On desktop, writes to SQLite asynchronously and mirrors to localStorage
     * as a synchronous fallback. On browser, writes to localStorage only.
     *
     * @param {string} tableName   - 'comments', 'study_notes', or 'reports'
     * @param {string} recordKey   - record UUID, study UID, or report ID
     * @param {string} operation   - 'insert', 'update', or 'delete'
     * @param {number} baseSyncVersion - sync_version at time of local change
     */
    function enqueueChange(tableName, recordKey, operation, baseSyncVersion) {
        const operationUuid = crypto.randomUUID();
        const entryId = crypto.randomUUID();
        const now = Date.now();

        const entry = {
            id: entryId,
            operation_uuid: operationUuid,
            table_name: tableName,
            record_key: String(recordKey),
            operation: operation,
            base_sync_version: baseSyncVersion || 0,
            created_at: now,
            attempts: 0,
            last_error: null
        };

        // Always write to localStorage for synchronous access
        const outbox = loadOutboxLS();
        outbox.push(entry);
        saveOutboxLS(outbox);

        // On desktop, also write to SQLite (fire-and-forget)
        if (isDesktopMode()) {
            getDb().then(db => {
                if (!db) return;
                return db.execute(
                    `INSERT INTO sync_outbox (operation_uuid, table_name, record_key, operation, base_sync_version, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [operationUuid, tableName, String(recordKey), operation, baseSyncVersion || 0, now]
                );
            }).catch(e => {
                console.warn('SyncOutbox: SQLite enqueue failed (localStorage copy exists):', e);
            });
        }
    }

    /**
     * Read all pending (un-synced) outbox entries.
     * @returns {Array} Entries sorted by created_at ascending
     */
    function readPendingChanges() {
        const outbox = loadOutboxLS();
        return outbox
            .filter(entry => !entry.synced_at)
            .sort((a, b) => a.created_at - b.created_at);
    }

    /**
     * Collapse consecutive outbox entries for the same (table, key).
     *
     * Collapsing rules:
     * - Multiple updates on same record -> keep last (one update)
     * - Insert then updates -> one insert (with latest operation_uuid)
     * - Insert then delete -> remove both (no-op, never sent to server)
     * - Update then delete -> one delete
     * - Use the oldest base_sync_version from the collapsed group
     *
     * @param {Array} entries - Pending outbox entries (sorted by created_at)
     * @returns {Array} Collapsed entries ready for sync
     */
    function collapseChanges(entries) {
        // Group entries by (table_name, record_key), preserving order
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
            // null result means the group collapsed to a no-op (insert+delete)
        }

        return collapsed;
    }

    /**
     * Collapse a group of entries for the same (table, key).
     * Returns a single collapsed entry, or null if the group is a no-op.
     *
     * @param {Array} group - Entries for the same table/key, sorted chronologically
     * @returns {Object|null} Collapsed entry or null
     */
    function collapseGroup(group) {
        if (group.length === 0) return null;
        if (group.length === 1) return group[0];

        // Track the effective operation by replaying the sequence
        const first = group[0];
        const last = group[group.length - 1];
        const oldestBaseSyncVersion = Math.min(...group.map(e => e.base_sync_version));

        // Collect all entry IDs from the group (for marking synced)
        const allIds = group.map(e => e.id);

        // Determine the starting operation type
        let effectiveOp = first.operation;

        for (let i = 1; i < group.length; i++) {
            const nextOp = group[i].operation;
            effectiveOp = mergeOperations(effectiveOp, nextOp);

            if (effectiveOp === null) {
                // insert + delete = no-op; return null but include IDs
                // so caller can still mark them synced
                return {
                    _noop: true,
                    _entry_ids: allIds,
                    table_name: first.table_name,
                    record_key: first.record_key
                };
            }
        }

        // Build the collapsed entry using the last entry as the base
        // (it has the most recent operation_uuid and created_at)
        return {
            ...last,
            operation: effectiveOp,
            base_sync_version: oldestBaseSyncVersion,
            _entry_ids: allIds
        };
    }

    /**
     * Merge two sequential operations on the same record.
     *
     * @param {string} current - Current effective operation
     * @param {string} next    - Next operation in sequence
     * @returns {string|null}  - Merged operation, or null for no-op
     */
    function mergeOperations(current, next) {
        if (current === 'insert' && next === 'update') return 'insert';
        if (current === 'insert' && next === 'delete') return null;  // no-op
        if (current === 'update' && next === 'update') return 'update';
        if (current === 'update' && next === 'delete') return 'delete';
        if (current === 'delete' && next === 'insert') return 'update'; // resurrection
        // Fallback: keep the latest operation
        return next;
    }

    /**
     * Mark outbox entries as synced.
     *
     * @param {Array<string>} entryIds - IDs of entries to mark
     * @param {number} syncedAt - Timestamp when synced
     */
    function markSynced(entryIds, syncedAt) {
        const idSet = new Set(entryIds);

        // Remove from localStorage
        const outbox = loadOutboxLS();
        const remaining = outbox.filter(entry => !idSet.has(entry.id));
        saveOutboxLS(remaining);

        // Remove from SQLite on desktop (fire-and-forget)
        if (isDesktopMode()) {
            getDb().then(db => {
                if (!db) return;
                // Delete synced entries by operation_uuid from the outbox entries
                // that were synced. Since SQLite IDs are numeric and our localStorage
                // IDs are UUIDs, we match on operation_uuid which is shared.
                const syncedEntries = outbox.filter(entry => idSet.has(entry.id));
                const deletions = syncedEntries.map(entry =>
                    db.execute(
                        'DELETE FROM sync_outbox WHERE operation_uuid = ?',
                        [entry.operation_uuid]
                    ).catch(() => { /* best effort */ })
                );
                return Promise.all(deletions);
            }).catch(e => {
                console.warn('SyncOutbox: SQLite markSynced failed:', e);
            });
        }
    }

    /**
     * Update error tracking on outbox entries after a failed sync attempt.
     *
     * @param {Array<string>} entryIds - IDs of entries that failed
     * @param {string} error - Error description
     */
    function markFailed(entryIds, error) {
        const idSet = new Set(entryIds);
        const outbox = loadOutboxLS();
        for (const entry of outbox) {
            if (idSet.has(entry.id)) {
                entry.attempts = (entry.attempts || 0) + 1;
                entry.last_error = error;
            }
        }
        saveOutboxLS(outbox);

        // Update attempts in SQLite on desktop (fire-and-forget)
        if (isDesktopMode()) {
            const failedEntries = outbox.filter(entry => idSet.has(entry.id));
            getDb().then(db => {
                if (!db) return;
                const updates = failedEntries.map(entry =>
                    db.execute(
                        'UPDATE sync_outbox SET attempts = ?, last_error = ? WHERE operation_uuid = ?',
                        [entry.attempts, error, entry.operation_uuid]
                    ).catch(() => { /* best effort */ })
                );
                return Promise.all(updates);
            }).catch(e => {
                console.warn('SyncOutbox: SQLite markFailed failed:', e);
            });
        }
    }

    /**
     * Read current row state for a record from the local notes store.
     * Used to build the `data` payload for sync requests.
     *
     * @param {string} tableName - 'comments', 'study_notes', or 'reports'
     * @param {string} recordKey - record UUID, study UID, or report ID
     * @returns {Object|null} Current record data, or null if not found
     */
    function readRecordState(tableName, recordKey) {
        const { loadStore, ensureStudy } = window._NotesInternals;
        const store = loadStore();

        if (tableName === 'study_notes') {
            const studyEntry = store.studies[recordKey];
            if (!studyEntry) return null;
            return {
                description: studyEntry.description || ''
            };
        }

        if (tableName === 'comments') {
            // Search all studies for a comment with this record_uuid
            for (const studyUid of Object.keys(store.studies)) {
                const studyEntry = ensureStudy(store, studyUid);
                const found = findCommentInStudy(studyEntry, recordKey);
                if (found) {
                    return {
                        study_uid: studyUid,
                        text: found.text || '',
                        created_at: found.created_at || found.time || 0,
                        updated_at: found.updated_at || found.time || 0,
                        deleted_at: found.deleted_at || null
                    };
                }
            }
            // Comment not in active list -- may have been soft-deleted
            // (removed from array). Return minimal tombstone data.
            return null;
        }

        if (tableName === 'reports') {
            const { findReportMetadata } = window._NotesInternals;
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
                deleted_at: report.deletedAt || null
            };
        }

        return null;
    }

    /**
     * Search for a comment by record_uuid within a study entry.
     * Checks both study-level and series-level comment arrays.
     *
     * @param {Object} studyEntry
     * @param {string} recordUuid
     * @returns {Object|null}
     */
    function findCommentInStudy(studyEntry, recordUuid) {
        if (Array.isArray(studyEntry.comments)) {
            const found = studyEntry.comments.find(c =>
                c.record_uuid === recordUuid || c.id === recordUuid
            );
            if (found) return found;
        }
        if (studyEntry.series && typeof studyEntry.series === 'object') {
            for (const seriesEntry of Object.values(studyEntry.series)) {
                if (Array.isArray(seriesEntry.comments)) {
                    const found = seriesEntry.comments.find(c =>
                        c.record_uuid === recordUuid || c.id === recordUuid
                    );
                    if (found) return found;
                }
            }
        }
        return null;
    }

    // ---- Sync State: getCursor / setCursor / getDeviceId / setDeviceId ----
    // On desktop, sync_state lives in SQLite (sync_state table).
    // On browser, sync_state lives in localStorage.
    // These methods are synchronous for backward compatibility; desktop
    // writes fire-and-forget to SQLite and always read from localStorage
    // as the synchronous cache.

    /**
     * Read a sync_state value, trying SQLite first (async, cached to
     * localStorage), with localStorage as the synchronous fallback.
     * @param {string} key
     * @returns {string|null}
     */
    function getSyncStateValue(key) {
        const state = loadSyncStateLS();
        return state[key] || null;
    }

    /**
     * Write a sync_state value to localStorage and to SQLite (on desktop).
     * @param {string} key
     * @param {*} value
     */
    function setSyncStateValue(key, value) {
        const state = loadSyncStateLS();
        state[key] = value;
        saveSyncStateLS(state);

        // Mirror to SQLite on desktop (fire-and-forget)
        if (isDesktopMode()) {
            getDb().then(db => {
                if (!db) return;
                return db.execute(
                    `INSERT OR REPLACE INTO sync_state (key, value, updated_at)
                     VALUES (?, ?, ?)`,
                    [key, value != null ? String(value) : null, Date.now()]
                );
            }).catch(e => {
                console.warn('SyncOutbox: SQLite sync_state write failed:', e);
            });
        }
    }

    /**
     * Get the delta_cursor from sync state.
     * @returns {string|null}
     */
    function getCursor() {
        return getSyncStateValue('delta_cursor');
    }

    /**
     * Store the delta_cursor in sync state.
     * @param {string|null} cursor
     */
    function setCursor(cursor) {
        setSyncStateValue('delta_cursor', cursor);
    }

    /**
     * Get the device_id from sync state.
     * @returns {string|null}
     */
    function getDeviceId() {
        return getSyncStateValue('device_id');
    }

    /**
     * Store the device_id in sync state.
     * @param {string} deviceId
     */
    function setDeviceId(deviceId) {
        setSyncStateValue('device_id', deviceId);
    }

    // ---- Desktop SQLite Hydration ----

    /**
     * On desktop startup, hydrate localStorage sync state from SQLite
     * so that synchronous readers (getDeviceId, getCursor) have fresh
     * data. Should be called once during app initialization.
     * @returns {Promise<void>}
     */
    async function hydrateFromSqlite() {
        const db = await getDb();
        if (!db) return;

        try {
            // Hydrate sync_state keys
            const stateRows = await db.select('SELECT key, value FROM sync_state');
            if (stateRows.length > 0) {
                const state = loadSyncStateLS();
                for (const row of stateRows) {
                    // SQLite is the source of truth on desktop; overwrite localStorage
                    state[row.key] = row.value;
                }
                saveSyncStateLS(state);
            }

            // Hydrate outbox entries (merge: keep union of both stores)
            const sqlRows = await db.select(
                `SELECT id, operation_uuid, table_name, record_key, operation,
                        base_sync_version, created_at, synced_at, attempts, last_error
                 FROM sync_outbox WHERE synced_at IS NULL
                 ORDER BY created_at ASC`
            );

            if (sqlRows.length > 0) {
                const lsOutbox = loadOutboxLS();
                const existingUuids = new Set(lsOutbox.map(e => e.operation_uuid));

                for (const row of sqlRows) {
                    if (!existingUuids.has(row.operation_uuid)) {
                        lsOutbox.push({
                            id: String(row.id),
                            operation_uuid: row.operation_uuid,
                            table_name: row.table_name,
                            record_key: row.record_key,
                            operation: row.operation,
                            base_sync_version: row.base_sync_version,
                            created_at: row.created_at,
                            synced_at: row.synced_at,
                            attempts: row.attempts || 0,
                            last_error: row.last_error
                        });
                    }
                }
                saveOutboxLS(lsOutbox);
            }
        } catch (e) {
            console.warn('SyncOutbox: SQLite hydration failed, using localStorage:', e);
        }
    }

    // Kick off hydration on desktop (non-blocking)
    if (isDesktopMode()) {
        hydrateFromSqlite();
    }

    return {
        enqueueChange,
        readPendingChanges,
        collapseChanges,
        markSynced,
        markFailed,
        readRecordState,
        getCursor,
        setCursor,
        getDeviceId,
        setDeviceId,
        // Desktop SQLite access for advanced callers
        hydrateFromSqlite,
        // Exposed for testing
        _loadOutbox: loadOutbox,
        _loadOutboxAsync: loadOutboxAsync,
        _saveOutbox: saveOutbox,
        _mergeOperations: mergeOperations
    };
})();

if (typeof window !== 'undefined') {
    window._SyncOutbox = _SyncOutbox;
}
