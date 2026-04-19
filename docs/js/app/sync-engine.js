/**
 * SyncEngine - Background sync loop that drains the outbox to the server
 *
 * Periodically reads pending changes from the sync outbox, collapses them,
 * builds request payloads per the frozen sync contract (SYNC-CONTRACT-V1.md),
 * and POSTs to /api/sync. Handles accepted, rejected, and remote_changes
 * in the response.
 *
 * This module exports the SyncEngine class but does NOT auto-start it.
 * Stage 4 (dispatcher integration) wires it up and calls start().
 *
 * Depends on:
 *   window._SyncOutbox (sync.js)
 *   window._NotesInternals (local.js)
 *   window.CONFIG (config.js)
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _SyncEngine = (() => {
    // Default sync interval per contract: 30 seconds
    const DEFAULT_INTERVAL_MS = 30000;

    // Backoff schedule: 30s, 60s, 120s, 300s (max 5 min)
    const BACKOFF_SCHEDULE_MS = [30000, 60000, 120000, 300000];

    function parseSeriesRecordKey(recordKey) {
        try {
            const [studyUid, seriesUid] = JSON.parse(String(recordKey || ''));
            if (!studyUid || !seriesUid) return null;
            return {
                studyUid: String(studyUid),
                seriesUid: String(seriesUid),
            };
        } catch {
            return null;
        }
    }

    /**
     * SyncEngine manages the periodic sync loop.
     *
     * @param {Object} options
     * @param {string} options.syncUrl - Full URL for POST /api/sync (default: '/api/sync')
     * @param {Function} options.getAccessToken - Async function returning current JWT access token
     * @param {Function} options.onAuthRequired - Called when 401 received (need re-auth)
     * @param {number} options.intervalMs - Polling interval in ms (default: 30000)
     */
    class SyncEngine {
        constructor(options = {}) {
            this.syncUrl = options.syncUrl || '/api/sync';
            this.getAccessToken = options.getAccessToken || (() => Promise.resolve(null));
            this.onAuthRequired = options.onAuthRequired || (() => {});
            this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;

            this._timerId = null;
            this._running = false;
            this._syncing = false; // guard against overlapping sync calls
            this._consecutiveErrors = 0;
            this._retryAfterMs = 0; // from 429 Retry-After header
        }

        /**
         * Start the periodic sync loop.
         * No-op if already running.
         */
        start() {
            if (this._running) return;
            this._running = true;
            this._consecutiveErrors = 0;
            this._scheduleNext(this.intervalMs);
        }

        /**
         * Stop the periodic sync loop.
         */
        stop() {
            this._running = false;
            if (this._timerId !== null) {
                clearTimeout(this._timerId);
                this._timerId = null;
            }
        }

        /**
         * Check whether the engine is currently running.
         * @returns {boolean}
         */
        get isRunning() {
            return this._running;
        }

        /**
         * Trigger a sync immediately. Safe to call while the periodic loop
         * is running -- if a sync is already in progress, this returns the
         * existing promise.
         *
         * @returns {Promise<Object>} Sync result summary
         */
        async syncNow() {
            if (this._syncing) {
                return { skipped: true, reason: 'sync_in_progress' };
            }

            this._syncing = true;
            try {
                const result = await this._doSync();
                this._consecutiveErrors = 0;
                this._retryAfterMs = 0;
                if (!result?.skipped) {
                    this._dispatchSyncEvent('sync:completed', result);
                }
                return result;
            } catch (err) {
                this._consecutiveErrors++;
                console.warn('SyncEngine: sync failed:', err.message || err);
                this._dispatchSyncEvent('sync:error', {
                    message: err.message || String(err),
                    consecutiveErrors: this._consecutiveErrors,
                });
                return { error: true, message: err.message || String(err) };
            } finally {
                this._syncing = false;
            }
        }

        // ---- Internal ----

        /**
         * Dispatch a sync lifecycle event. Delegates to the canonical
         * implementation on _SyncOutbox when available; falls back to
         * a direct CustomEvent dispatch otherwise.
         *
         * Resolved at call time (not module load) so it works regardless
         * of script load order.
         *
         * @param {string} type - Event type (e.g. 'sync:started')
         * @param {*} [detail] - Optional event detail payload
         */
        _dispatchSyncEvent(type, detail) {
            if (typeof window === 'undefined') return;
            window.dispatchEvent(new CustomEvent(type, detail === undefined ? undefined : { detail }));
        }

        /**
         * Schedule the next sync tick.
         * @param {number} delayMs
         */
        _scheduleNext(delayMs) {
            if (!this._running) return;
            this._timerId = setTimeout(async () => {
                await this.syncNow();
                if (this._running) {
                    const nextDelay = this._calculateNextDelay();
                    this._scheduleNext(nextDelay);
                }
            }, delayMs);
        }

        /**
         * Calculate the delay for the next sync tick, accounting for
         * backoff on consecutive errors and 429 Retry-After.
         * @returns {number} Delay in milliseconds
         */
        _calculateNextDelay() {
            // Respect 429 Retry-After if set
            if (this._retryAfterMs > 0) {
                const retryDelay = this._retryAfterMs;
                this._retryAfterMs = 0;
                return retryDelay;
            }

            // Exponential backoff on consecutive errors
            if (this._consecutiveErrors > 0) {
                const idx = Math.min(this._consecutiveErrors - 1, BACKOFF_SCHEDULE_MS.length - 1);
                return BACKOFF_SCHEDULE_MS[idx];
            }

            return this.intervalMs;
        }

        /**
         * Perform a single sync cycle: push local changes, pull remote changes.
         * @returns {Promise<Object>} Summary of what happened
         */
        async _doSync() {
            const outbox = window._SyncOutbox;
            if (!outbox) {
                throw new Error('SyncOutbox not available');
            }

            // 1. Check access token before reading the outbox, so we don't
            //    mark no-ops as synced or build payloads when auth is missing.
            const accessToken = await this.getAccessToken();
            if (!accessToken) {
                // No token available -- stop the engine and signal auth required
                // so it doesn't spin at full rate while logged out
                this.stop();
                this._dispatchSyncEvent('sync:auth-required');
                this.onAuthRequired();
                return { skipped: true, reason: 'no_access_token' };
            }

            this._dispatchSyncEvent('sync:started');

            // 2. Read and collapse pending outbox entries.
            // Prefer the async path (reads SQLite on desktop) over the
            // synchronous localStorage-only fallback.
            const pending =
                typeof outbox.readPendingChangesAsync === 'function'
                    ? await outbox.readPendingChangesAsync()
                    : outbox.readPendingChanges();
            const collapsed = outbox.collapseChanges(pending);

            // Separate no-ops (insert+delete pairs) from real changes
            const noops = collapsed.filter((entry) => entry._noop);
            const changes = collapsed.filter((entry) => !entry._noop);

            // Mark no-ops as synced immediately (they never need to reach the server)
            for (const noop of noops) {
                if (noop._entry_ids) {
                    outbox.markSynced(noop._entry_ids, Date.now());
                }
            }

            // 3. Build request payload per contract
            const requestChanges = [];
            for (const entry of changes) {
                const recordState =
                    typeof outbox.readRecordStateAsync === 'function'
                        ? await outbox.readRecordStateAsync(entry.table_name, entry.record_key)
                        : outbox.readRecordState(entry.table_name, entry.record_key);
                const data = recordState || {};

                requestChanges.push({
                    operation_uuid: entry.operation_uuid,
                    table: entry.table_name,
                    key: entry.record_key,
                    operation: entry.operation,
                    base_sync_version: entry.base_sync_version,
                    data: entry.operation === 'delete' ? {} : data,
                });
            }

            // Build the full request body
            const deviceId = outbox.getDeviceId();
            const deltaCursor = outbox.getCursor();

            const requestBody = {
                device_id: deviceId,
                delta_cursor: deltaCursor,
                changes: requestChanges,
            };

            let response;
            try {
                response = await this._fetchSync(requestBody, accessToken);
            } catch (fetchError) {
                // Mark outbox entries as failed for non-transient errors so the
                // outbox tracks retry attempts and error context.  Transient
                // errors (network offline, 429 rate-limit) will be retried by
                // the backoff loop without penalising entries.
                const isTransient = /network error|rate limited \(429\)/i.test(fetchError.message);
                if (!isTransient && changes.length > 0) {
                    const failedIds = changes.flatMap((e) => e._entry_ids || [e.id]);
                    outbox.markFailed(failedIds, fetchError.message || String(fetchError));
                }
                throw fetchError;
            }

            // 4. Process the response
            return await this._processResponse(response, changes, noops.length);
        }

        /**
         * Send the sync request to the server.
         *
         * @param {Object} body - Request body
         * @param {string} accessToken - JWT access token
         * @returns {Promise<Object>} Parsed response with status info
         */
        async _fetchSync(body, accessToken) {
            let res;
            try {
                res = await fetch(this.syncUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });
            } catch (networkError) {
                // Network failure (offline, DNS, etc.)
                throw new Error(`Network error: ${networkError.message || 'fetch failed'}`);
            }

            // Handle error status codes per contract
            if (res.status === 401) {
                this.stop();
                this.onAuthRequired();
                throw new Error('Authentication required (401)');
            }

            if (res.status === 403) {
                throw new Error('Device not registered (403)');
            }

            if (res.status === 410) {
                // Cursor expired -- reset and signal full resync needed
                const outbox = window._SyncOutbox;
                outbox.setCursor(null);
                throw new Error('Cursor expired (410), reset for full resync');
            }

            if (res.status === 429) {
                // Rate limited -- respect Retry-After header
                const retryAfter = res.headers.get('Retry-After');
                if (retryAfter) {
                    const seconds = parseInt(retryAfter, 10);
                    if (!Number.isNaN(seconds)) {
                        this._retryAfterMs = seconds * 1000;
                    }
                }
                throw new Error('Rate limited (429)');
            }

            if (!res.ok) {
                throw new Error(`Sync request failed: ${res.status}`);
            }

            return await res.json();
        }

        /**
         * Process the server response: handle accepted, rejected, and remote changes.
         *
         * @param {Object} response - Parsed JSON response
         * @param {Array} changes - The collapsed outbox entries we sent
         * @param {number} noopCount - Number of collapsed no-op groups cleaned locally
         * @returns {Object} Summary of what was processed
         */
        async _processResponse(response, changes, noopCount = 0) {
            const outbox = window._SyncOutbox;
            const accepted = response.accepted || [];
            const rejected = response.rejected || [];
            const remoteChanges = response.remote_changes || [];
            const newCursor = response.delta_cursor;
            const syncedAt = response.server_time || Date.now();

            // Map operation_uuid -> collapsed entry for quick lookup
            const entryByOpUuid = new Map();
            for (const entry of changes) {
                entryByOpUuid.set(entry.operation_uuid, entry);
            }

            // Build a study_uid -> study object lookup map once, so that
            // _updateLocalSyncVersion and _applyRemoteData can do O(1)
            // lookups instead of scanning all studies for comment changes.
            const { loadStore } = window._NotesInternals;
            const studyLookup = this._buildStudyLookup(loadStore());

            // 5a. Process accepted changes
            const acceptedIds = [];
            for (const acc of accepted) {
                const entry = entryByOpUuid.get(acc.operation_uuid);
                if (entry) {
                    // Update local sync_version for this record
                    this._updateLocalSyncVersion(entry.table_name, entry.record_key, acc.sync_version, studyLookup);
                    // Collect all original entry IDs for this collapsed entry
                    const ids = entry._entry_ids || [entry.id];
                    acceptedIds.push(...ids);
                }
            }
            if (acceptedIds.length > 0) {
                outbox.markSynced(acceptedIds, syncedAt);
            }

            // 5b. Process rejected changes (stale version -- server wins)
            const rejectedIds = [];
            for (const rej of rejected) {
                const entry = entryByOpUuid.get(rej.operation_uuid);
                if (entry) {
                    // Apply server's current data to local DB
                    this._applyRemoteData(
                        entry.table_name,
                        entry.record_key,
                        rej.current_data,
                        rej.current_sync_version,
                    );
                    const ids = entry._entry_ids || [entry.id];
                    rejectedIds.push(...ids);
                }
            }
            if (rejectedIds.length > 0) {
                // Remove rejected entries from outbox (server version applied)
                outbox.markSynced(rejectedIds, syncedAt);
            }

            // 5c. Process remote changes (from other devices)
            for (const remote of remoteChanges) {
                this._applyRemoteData(remote.table, remote.key, remote.data, remote.sync_version);
            }

            // 6. Store new delta_cursor
            if (newCursor !== undefined) {
                outbox.setCursor(newCursor);
            }

            return {
                accepted,
                acceptedCount: accepted.length,
                rejected,
                rejectedCount: rejected.length,
                remoteChanges,
                remoteChangeCount: remoteChanges.length,
                noopsCleaned: noopCount,
            };
        }

        /**
         * Build a lookup map from comment record_uuid/id to {studyUid, comment}
         * for O(1) lookups when updating sync_version on comments.
         *
         * @param {Object} store - The notes store from _NotesInternals
         * @returns {Map<string, {studyUid: string}>}
         */
        _buildStudyLookup(store) {
            const map = new Map();
            for (const studyUid of Object.keys(store.studies || {})) {
                const studyEntry = store.studies[studyUid];
                if (Array.isArray(studyEntry.comments)) {
                    for (const comment of studyEntry.comments) {
                        if (comment.record_uuid) map.set(comment.record_uuid, { studyUid });
                        if (comment.id) map.set(String(comment.id), { studyUid });
                    }
                }
                if (studyEntry.series && typeof studyEntry.series === 'object') {
                    for (const seriesEntry of Object.values(studyEntry.series)) {
                        if (Array.isArray(seriesEntry.comments)) {
                            for (const comment of seriesEntry.comments) {
                                if (comment.record_uuid) map.set(comment.record_uuid, { studyUid });
                                if (comment.id) map.set(String(comment.id), { studyUid });
                            }
                        }
                    }
                }
            }
            return map;
        }

        /**
         * Update the sync_version on a local record after the server accepts it.
         *
         * @param {string} tableName
         * @param {string} recordKey
         * @param {number} syncVersion
         * @param {Map} [studyLookup] - Optional pre-built comment lookup map for O(1) access
         */
        _updateLocalSyncVersion(tableName, recordKey, syncVersion, studyLookup) {
            const { loadStore, saveStore, ensureStudy, ensureSeries } = window._NotesInternals;
            const store = loadStore();

            if (tableName === 'study_notes') {
                const studyEntry = store.studies[recordKey];
                if (studyEntry) {
                    studyEntry.sync_version = syncVersion;
                    saveStore(store);
                }
                return;
            }

            if (tableName === 'comments') {
                // Use the pre-built lookup map for O(1) access if available
                if (studyLookup) {
                    const hit = studyLookup.get(recordKey);
                    if (hit) {
                        const studyEntry = ensureStudy(store, hit.studyUid);
                        const comment = this._findCommentByKey(studyEntry, recordKey);
                        if (comment) {
                            comment.sync_version = syncVersion;
                            saveStore(store);
                            return;
                        }
                    }
                }
                // Fallback: linear scan (only reached if lookup was not provided
                // or the comment was added after the map was built)
                for (const studyUid of Object.keys(store.studies)) {
                    const studyEntry = ensureStudy(store, studyUid);
                    const comment = this._findCommentByKey(studyEntry, recordKey);
                    if (comment) {
                        comment.sync_version = syncVersion;
                        saveStore(store);
                        return;
                    }
                }
                return;
            }

            if (tableName === 'series_notes') {
                const parsed = parseSeriesRecordKey(recordKey);
                if (!parsed) return;
                const studyEntry = store.studies[parsed.studyUid];
                if (!studyEntry) return;
                const seriesEntry = ensureSeries(studyEntry, parsed.seriesUid);
                seriesEntry.sync_version = syncVersion;
                saveStore(store);
                return;
            }

            if (tableName === 'reports') {
                const { findReportMetadata } = window._NotesInternals;
                const match = findReportMetadata(store, recordKey);
                if (match) {
                    match.report.sync_version = syncVersion;
                    saveStore(store);
                }
            }
        }

        /**
         * Apply remote data to a local record (from rejected or remote_changes).
         * Server-last-write-wins for rejected entries; new data for remote changes.
         *
         * @param {string} tableName
         * @param {string} recordKey
         * @param {Object} data - Server's current data for this record
         * @param {number} syncVersion - Server's current sync_version
         */
        _applyRemoteData(tableName, recordKey, data, syncVersion) {
            if (!data) return;

            const { loadStore, saveStore, ensureStudy, ensureSeries } = window._NotesInternals;
            const store = loadStore();

            if (tableName === 'study_notes') {
                const studyEntry = ensureStudy(store, recordKey);
                if (data.description !== undefined) {
                    studyEntry.description = data.description;
                }
                studyEntry.sync_version = syncVersion;
                saveStore(store);
                return;
            }

            if (tableName === 'series_notes') {
                const parsed = parseSeriesRecordKey(recordKey);
                if (!parsed) return;
                const deletedAt = data.deletedAt || data.deleted_at || null;
                const existingStudy = store.studies[parsed.studyUid];

                if (deletedAt) {
                    if (!existingStudy) return;
                    const existingSeries = existingStudy.series?.[parsed.seriesUid];
                    if (!existingSeries) return;
                    existingSeries.description = '';
                    existingSeries.deletedAt = deletedAt;
                    existingSeries.sync_version = syncVersion;
                    saveStore(store);
                    return;
                }

                const studyEntry = ensureStudy(store, parsed.studyUid);
                const seriesEntry = ensureSeries(studyEntry, parsed.seriesUid);
                if (data.description !== undefined) {
                    seriesEntry.description = data.description;
                }
                if (data.updated_at !== undefined) {
                    seriesEntry.updated_at = data.updated_at;
                }
                seriesEntry.sync_version = syncVersion;
                delete seriesEntry.deletedAt;
                delete seriesEntry.deleted_at;
                saveStore(store);
                return;
            }

            if (tableName === 'comments') {
                const studyUid = data.study_uid;
                if (!studyUid) return;
                const seriesUid = data.series_uid || null;
                const deletedAt = data.deletedAt || data.deleted_at || null;

                if (deletedAt) {
                    // Remote tombstone -- only act if the study and comment
                    // already exist locally.  Calling ensureStudy here would
                    // create a phantom empty study entry for a record we
                    // never had.
                    const existingStudy = store.studies[studyUid];
                    if (!existingStudy) return;
                    const existing = this._findCommentByKey(existingStudy, recordKey);
                    if (!existing) return;
                    this._removeCommentFromStudy(existingStudy, recordKey);
                    saveStore(store);
                    return;
                }

                const studyEntry = ensureStudy(store, studyUid);
                const existing = this._findCommentByKey(studyEntry, recordKey);

                if (existing) {
                    this._removeCommentFromStudy(studyEntry, recordKey);
                    const targetComments = seriesUid
                        ? ensureSeries(studyEntry, seriesUid).comments
                        : studyEntry.comments;
                    targetComments.push(existing);
                    // Update existing comment
                    existing.id = recordKey;
                    existing.record_uuid = recordKey;
                    existing.text = data.text || '';
                    existing.created_at = data.created_at || existing.created_at || existing.time || Date.now();
                    existing.updated_at = data.updated_at || Date.now();
                    existing.time = existing.created_at || existing.time || Date.now();
                    existing.sync_version = syncVersion;
                    delete existing.deletedAt;
                    delete existing.deleted_at;
                } else {
                    // Insert new comment from remote
                    const createdAt = data.created_at || Date.now();
                    const targetComments = seriesUid
                        ? ensureSeries(studyEntry, seriesUid).comments
                        : studyEntry.comments;
                    targetComments.push({
                        id: recordKey,
                        record_uuid: recordKey,
                        text: data.text || '',
                        time: createdAt,
                        created_at: createdAt,
                        updated_at: data.updated_at || createdAt,
                        sync_version: syncVersion,
                    });
                }
                saveStore(store);
                return;
            }

            if (tableName === 'reports') {
                const studyUid = data.study_uid;
                if (!studyUid) return;
                if (!store.studies[studyUid]) return;
                const deletedAt = data.deletedAt || data.deleted_at || null;
                const { normalizeReportId } = window._NotesInternals;
                const targetId = normalizeReportId(recordKey);

                if (deletedAt) {
                    // Remote tombstone -- only act if study and report exist locally
                    const existingStudy = store.studies[studyUid];
                    if (!existingStudy) return;
                    const idx = existingStudy.reports.findIndex((r) => normalizeReportId(r?.id) === targetId);
                    if (idx !== -1) {
                        existingStudy.reports[idx].deletedAt = deletedAt;
                        existingStudy.reports[idx].sync_version = syncVersion;
                        saveStore(store);
                    }
                    return;
                }

                const studyEntry = ensureStudy(store, studyUid);
                const existingIdx = studyEntry.reports.findIndex((r) => normalizeReportId(r?.id) === targetId);

                if (existingIdx !== -1) {
                    // Update existing report metadata
                    const report = studyEntry.reports[existingIdx];
                    if (data.name !== undefined) report.name = data.name;
                    if (data.type !== undefined) report.type = data.type;
                    if (data.size !== undefined) report.size = data.size;
                    if (data.added_at !== undefined) report.addedAt = new Date(data.added_at).toISOString();
                    if (data.updated_at !== undefined) report.updatedAt = new Date(data.updated_at).toISOString();
                    report.sync_version = syncVersion;
                    delete report.deletedAt;
                    delete report.deleted_at;
                } else {
                    // Insert new report from remote (metadata only; file download separate)
                    studyEntry.reports.push({
                        id: recordKey,
                        name: data.name || '',
                        type: data.type || '',
                        size: data.size || 0,
                        addedAt: data.added_at ? new Date(data.added_at).toISOString() : new Date().toISOString(),
                        updatedAt: data.updated_at ? new Date(data.updated_at).toISOString() : new Date().toISOString(),
                        sync_version: syncVersion,
                    });
                }
                saveStore(store);
            }
        }

        /**
         * Find a comment by record_uuid or id within a study entry.
         * Searches study-level and series-level comments.
         *
         * @param {Object} studyEntry
         * @param {string} recordKey
         * @returns {Object|null}
         */
        _findCommentByKey(studyEntry, recordKey) {
            if (Array.isArray(studyEntry.comments)) {
                const found = studyEntry.comments.find((c) => c.record_uuid === recordKey || c.id === recordKey);
                if (found) return found;
            }
            if (studyEntry.series && typeof studyEntry.series === 'object') {
                for (const seriesEntry of Object.values(studyEntry.series)) {
                    if (Array.isArray(seriesEntry.comments)) {
                        const found = seriesEntry.comments.find(
                            (c) => c.record_uuid === recordKey || c.id === recordKey,
                        );
                        if (found) return found;
                    }
                }
            }
            return null;
        }

        /**
         * Remove a comment from all arrays in a study entry (by record_uuid or id).
         *
         * @param {Object} studyEntry
         * @param {string} recordKey
         */
        _removeCommentFromStudy(studyEntry, recordKey) {
            if (Array.isArray(studyEntry.comments)) {
                studyEntry.comments = studyEntry.comments.filter(
                    (c) => c.record_uuid !== recordKey && c.id !== recordKey,
                );
            }
            if (studyEntry.series && typeof studyEntry.series === 'object') {
                for (const seriesEntry of Object.values(studyEntry.series)) {
                    if (Array.isArray(seriesEntry.comments)) {
                        seriesEntry.comments = seriesEntry.comments.filter(
                            (c) => c.record_uuid !== recordKey && c.id !== recordKey,
                        );
                    }
                }
            }
        }
    }

    return { SyncEngine };
})();

if (typeof window !== 'undefined') {
    window._SyncEngine = _SyncEngine;
}
