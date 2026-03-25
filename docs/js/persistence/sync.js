/**
 * Sync Outbox - localStorage-backed change capture for cloud sync
 *
 * Provides enqueue, dequeue, collapse, and mark-synced operations
 * for the sync outbox. All state is stored in localStorage alongside
 * the main notes store.
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

    // ---- Outbox Storage ----

    /**
     * Load the raw outbox array from localStorage.
     * @returns {Array} Pending outbox entries
     */
    function loadOutbox() {
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

    /**
     * Save the outbox array to localStorage.
     * @param {Array} entries
     */
    function saveOutbox(entries) {
        try {
            localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
        } catch (e) {
            console.warn('SyncOutbox: failed to save outbox:', e);
        }
    }

    // ---- Sync State Storage ----

    /**
     * Load sync state (delta_cursor, device_id, etc.) from localStorage.
     * @returns {Object}
     */
    function loadSyncState() {
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

    /**
     * Save sync state to localStorage.
     * @param {Object} state
     */
    function saveSyncState(state) {
        try {
            localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('SyncOutbox: failed to save sync state:', e);
        }
    }

    // ---- Public API ----

    /**
     * Enqueue a change to the outbox.
     *
     * @param {string} tableName   - 'comments', 'study_notes', or 'reports'
     * @param {string} recordKey   - record UUID, study UID, or report ID
     * @param {string} operation   - 'insert', 'update', or 'delete'
     * @param {number} baseSyncVersion - sync_version at time of local change
     */
    function enqueueChange(tableName, recordKey, operation, baseSyncVersion) {
        const entry = {
            id: crypto.randomUUID(),
            operation_uuid: crypto.randomUUID(),
            table_name: tableName,
            record_key: String(recordKey),
            operation: operation,
            base_sync_version: baseSyncVersion || 0,
            created_at: Date.now(),
            attempts: 0,
            last_error: null
        };

        const outbox = loadOutbox();
        outbox.push(entry);
        saveOutbox(outbox);
    }

    /**
     * Read all pending (un-synced) outbox entries.
     * @returns {Array} Entries sorted by created_at ascending
     */
    function readPendingChanges() {
        const outbox = loadOutbox();
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
        const outbox = loadOutbox();
        // Remove synced entries from the outbox entirely to keep it lean
        const remaining = outbox.filter(entry => !idSet.has(entry.id));
        saveOutbox(remaining);
    }

    /**
     * Update error tracking on outbox entries after a failed sync attempt.
     *
     * @param {Array<string>} entryIds - IDs of entries that failed
     * @param {string} error - Error description
     */
    function markFailed(entryIds, error) {
        const idSet = new Set(entryIds);
        const outbox = loadOutbox();
        for (const entry of outbox) {
            if (idSet.has(entry.id)) {
                entry.attempts = (entry.attempts || 0) + 1;
                entry.last_error = error;
            }
        }
        saveOutbox(outbox);
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

    /**
     * Get the delta_cursor from sync state.
     * @returns {string|null}
     */
    function getCursor() {
        const state = loadSyncState();
        return state.delta_cursor || null;
    }

    /**
     * Store the delta_cursor in sync state.
     * @param {string|null} cursor
     */
    function setCursor(cursor) {
        const state = loadSyncState();
        state.delta_cursor = cursor;
        saveSyncState(state);
    }

    /**
     * Get the device_id from sync state.
     * @returns {string|null}
     */
    function getDeviceId() {
        const state = loadSyncState();
        return state.device_id || null;
    }

    /**
     * Store the device_id in sync state.
     * @param {string} deviceId
     */
    function setDeviceId(deviceId) {
        const state = loadSyncState();
        state.device_id = deviceId;
        saveSyncState(state);
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
        // Exposed for testing
        _loadOutbox: loadOutbox,
        _saveOutbox: saveOutbox,
        _mergeOperations: mergeOperations
    };
})();

if (typeof window !== 'undefined') {
    window._SyncOutbox = _SyncOutbox;
}
