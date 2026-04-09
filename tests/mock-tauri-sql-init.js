// Copyright (c) 2026 Divergent Health Technologies
//
// Mock Tauri SQL plugin for Playwright desktop tests.
// Simulates plugin:sql commands using localStorage-backed in-memory tables.
// Schema mirrors desktop/src-tauri/migrations/ (001 through 007).
(() => {
    if (typeof window === 'undefined') return;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeQuery(query) {
        return String(query || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function createEmptyDbState() {
        return {
            study_notes: [],
            series_notes: [],
            comments: [],
            reports: [],
            app_config: [],
            desktop_scan_cache: [],
            sync_outbox: [],
            sync_state: [],
            import_jobs: [],
            // ADR 008: Local-first instrumentation. Singleton row (id = 1).
            // Desktop tests that do not exercise instrumentation still need
            // this table present so the module's ensureDesktopTable() call
            // does not error out on load.
            instrumentation: [],
            meta: {
                lastCommentId: 0,
                lastOutboxId: 0,
                loadCalls: 0,
            },
        };
    }

    function createStorageKey(db) {
        return `mock-tauri-sql:${db}`;
    }

    function loadState(db, options) {
        const storageKey = createStorageKey(db);
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            return hydrateState(safeParse(raw, createEmptyDbState()));
        }
        const initial = options?.initialState?.[db];
        const state = hydrateState(initial ? clone(initial) : createEmptyDbState());
        persistState(db, state);
        return state;
    }

    function hydrateState(state) {
        const normalized = state && typeof state === 'object' ? state : createEmptyDbState();
        if (!Array.isArray(normalized.study_notes)) normalized.study_notes = [];
        if (!Array.isArray(normalized.series_notes)) normalized.series_notes = [];
        if (!Array.isArray(normalized.comments)) normalized.comments = [];
        if (!Array.isArray(normalized.reports)) normalized.reports = [];
        if (!Array.isArray(normalized.app_config)) normalized.app_config = [];
        if (!Array.isArray(normalized.desktop_scan_cache)) normalized.desktop_scan_cache = [];
        if (!Array.isArray(normalized.sync_outbox)) normalized.sync_outbox = [];
        if (!Array.isArray(normalized.sync_state)) normalized.sync_state = [];
        if (!Array.isArray(normalized.import_jobs)) normalized.import_jobs = [];
        if (!Array.isArray(normalized.instrumentation)) normalized.instrumentation = [];
        if (!normalized.meta || typeof normalized.meta !== 'object') {
            normalized.meta = { lastCommentId: 0, lastOutboxId: 0, loadCalls: 0 };
        }
        if (!Number.isFinite(Number(normalized.meta.lastCommentId))) {
            normalized.meta.lastCommentId = 0;
        }
        if (!Number.isFinite(Number(normalized.meta.lastOutboxId))) {
            normalized.meta.lastOutboxId = 0;
        }
        if (!Number.isFinite(Number(normalized.meta.loadCalls))) {
            normalized.meta.loadCalls = 0;
        }
        return normalized;
    }

    function persistState(db, state) {
        localStorage.setItem(createStorageKey(db), JSON.stringify(state));
    }

    function safeParse(raw, fallback) {
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    function sortByAddedAtThenId(items) {
        return items.slice().sort((a, b) => {
            return (a.added_at || 0) - (b.added_at || 0) || String(a.id || '').localeCompare(String(b.id || ''));
        });
    }

    function sortComments(items) {
        return items.slice().sort((a, b) => {
            return (a.time || 0) - (b.time || 0) || (a.id || 0) - (b.id || 0);
        });
    }

    function makeConnection(db, options) {
        return {
            async execute(query, values = []) {
                const normalized = normalizeQuery(query);
                const state = loadState(db, options);

                if (
                    normalized === 'begin' ||
                    normalized === 'commit' ||
                    normalized === 'rollback' ||
                    normalized.startsWith('create table') ||
                    normalized.startsWith('create unique index') ||
                    normalized.startsWith('create index') ||
                    normalized.startsWith('alter table')
                ) {
                    return { rowsAffected: 0, lastInsertId: null };
                }

                // -- study_notes --

                if (normalized.startsWith('insert into study_notes')) {
                    const [studyUid, description, updatedAt] = values;
                    const existing = state.study_notes.find((row) => row.study_uid === studyUid);
                    if (existing) {
                        if (normalized.includes('do update')) {
                            existing.description = description;
                            existing.updated_at = updatedAt;
                            persistState(db, state);
                            return { rowsAffected: 1, lastInsertId: null };
                        }
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    state.study_notes.push({
                        study_uid: studyUid,
                        description,
                        updated_at: updatedAt,
                        deleted_at: null,
                        device_id: null,
                        sync_version: 0,
                    });
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from study_notes')) {
                    const [studyUid] = values;
                    const before = state.study_notes.length;
                    state.study_notes = state.study_notes.filter((row) => row.study_uid !== studyUid);
                    persistState(db, state);
                    return { rowsAffected: before - state.study_notes.length, lastInsertId: null };
                }

                // -- series_notes --

                if (normalized.startsWith('insert into series_notes')) {
                    const [studyUid, seriesUid, description, updatedAt] = values;
                    const existing = state.series_notes.find(
                        (row) => row.study_uid === studyUid && row.series_uid === seriesUid,
                    );
                    if (existing) {
                        if (normalized.includes('do update')) {
                            existing.description = description;
                            existing.updated_at = updatedAt;
                            persistState(db, state);
                            return { rowsAffected: 1, lastInsertId: null };
                        }
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    state.series_notes.push({
                        study_uid: studyUid,
                        series_uid: seriesUid,
                        description,
                        updated_at: updatedAt,
                    });
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from series_notes')) {
                    const [studyUid, seriesUid] = values;
                    const before = state.series_notes.length;
                    state.series_notes = state.series_notes.filter(
                        (row) => !(row.study_uid === studyUid && row.series_uid === seriesUid),
                    );
                    persistState(db, state);
                    return { rowsAffected: before - state.series_notes.length, lastInsertId: null };
                }

                // -- comments --

                if (
                    normalized.startsWith('insert into comments') ||
                    normalized.startsWith('insert or ignore into comments')
                ) {
                    const [studyUid, seriesUid, text, time] = values;
                    const existing = state.comments.find(
                        (row) =>
                            row.study_uid === studyUid &&
                            row.series_uid === seriesUid &&
                            row.text === text &&
                            row.time === time,
                    );
                    if (existing) {
                        return { rowsAffected: 0, lastInsertId: existing.id };
                    }
                    state.meta.lastCommentId += 1;
                    const id = state.meta.lastCommentId;
                    state.comments.push({
                        id,
                        study_uid: studyUid,
                        series_uid: seriesUid,
                        text,
                        time,
                        record_uuid: null,
                        created_at: time,
                        updated_at: time,
                        deleted_at: null,
                        device_id: null,
                        sync_version: 0,
                    });
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: id };
                }

                if (normalized.startsWith('update comments set')) {
                    const [text, time, id, studyUid] = values;
                    const existing = state.comments.find((row) => row.id === Number(id) && row.study_uid === studyUid);
                    if (!existing) {
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    existing.text = text;
                    existing.time = time;
                    existing.updated_at = time;
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from comments')) {
                    const [id, studyUid] = values;
                    const before = state.comments.length;
                    state.comments = state.comments.filter(
                        (row) => !(row.id === Number(id) && row.study_uid === studyUid),
                    );
                    persistState(db, state);
                    return { rowsAffected: before - state.comments.length, lastInsertId: null };
                }

                // -- reports --

                if (
                    normalized.startsWith('insert into reports') ||
                    normalized.startsWith('insert or replace into reports')
                ) {
                    const [id, studyUid, name, type, size, filePath, addedAt, updatedAt] = values;
                    const existing = state.reports.find((row) => String(row.id) === String(id));
                    if (existing) {
                        existing.study_uid = studyUid;
                        existing.name = name;
                        existing.type = type;
                        existing.size = size;
                        existing.file_path = filePath;
                        existing.added_at = addedAt;
                        existing.updated_at = updatedAt;
                    } else {
                        state.reports.push({
                            id: String(id),
                            study_uid: studyUid,
                            name,
                            type,
                            size,
                            file_path: filePath,
                            added_at: addedAt,
                            updated_at: updatedAt,
                            content_hash: null,
                            deleted_at: null,
                            device_id: null,
                            sync_version: 0,
                        });
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from reports')) {
                    const [id, studyUid] = values;
                    const before = state.reports.length;
                    state.reports = state.reports.filter(
                        (row) => !(String(row.id) === String(id) && row.study_uid === studyUid),
                    );
                    persistState(db, state);
                    return { rowsAffected: before - state.reports.length, lastInsertId: null };
                }

                // -- app_config --

                if (normalized.startsWith('insert into app_config')) {
                    const [key, value, updatedAt] = values;
                    const existing = state.app_config.find((row) => row.key === key);
                    if (existing) {
                        existing.value = value;
                        existing.updated_at = updatedAt;
                    } else {
                        state.app_config.push({ key, value, updated_at: updatedAt });
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                // -- desktop_scan_cache --

                if (normalized.startsWith('insert into desktop_scan_cache')) {
                    const stride = 8;
                    for (let index = 0; index < values.length; index += stride) {
                        const [path, rootPath, size, modifiedMs, scannerVersion, renderable, metaJson, updatedAt] =
                            values.slice(index, index + stride);
                        const existing = state.desktop_scan_cache.find((row) => row.path === path);
                        if (existing) {
                            existing.root_path = rootPath;
                            existing.size = size;
                            existing.modified_ms = modifiedMs;
                            existing.scanner_version = scannerVersion;
                            existing.renderable = renderable;
                            existing.meta_json = metaJson;
                            existing.updated_at = updatedAt;
                        } else {
                            state.desktop_scan_cache.push({
                                path,
                                root_path: rootPath,
                                size,
                                modified_ms: modifiedMs,
                                scanner_version: scannerVersion,
                                renderable,
                                meta_json: metaJson,
                                updated_at: updatedAt,
                            });
                        }
                    }
                    persistState(db, state);
                    return { rowsAffected: values.length / stride, lastInsertId: null };
                }

                // -- sync_outbox --

                if (normalized.startsWith('insert into sync_outbox')) {
                    const [operationUuid, tableName, recordKey, operation, baseSyncVersion, createdAt] = values;
                    state.meta.lastOutboxId += 1;
                    const id = state.meta.lastOutboxId;
                    state.sync_outbox.push({
                        id,
                        operation_uuid: operationUuid,
                        table_name: tableName,
                        record_key: recordKey,
                        operation,
                        base_sync_version: baseSyncVersion,
                        created_at: createdAt,
                        synced_at: null,
                        attempts: 0,
                        last_error: null,
                    });
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: id };
                }

                if (normalized.startsWith('update sync_outbox')) {
                    const lookupValue = values[values.length - 1];
                    const existing = normalized.includes('where operation_uuid = ?')
                        ? state.sync_outbox.find((row) => row.operation_uuid === lookupValue)
                        : state.sync_outbox.find((row) => row.id === Number(lookupValue));
                    if (!existing) {
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    if (values.length >= 3) {
                        existing.attempts = values[0];
                        existing.last_error = values[1];
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from sync_outbox')) {
                    const before = state.sync_outbox.length;
                    if (values.length > 0) {
                        const [lookupValue] = values;
                        state.sync_outbox = normalized.includes('where operation_uuid = ?')
                            ? state.sync_outbox.filter((row) => row.operation_uuid !== lookupValue)
                            : state.sync_outbox.filter((row) => row.id !== Number(lookupValue));
                    }
                    persistState(db, state);
                    return { rowsAffected: before - state.sync_outbox.length, lastInsertId: null };
                }

                // -- sync_state --

                if (
                    normalized.startsWith('insert into sync_state') ||
                    normalized.startsWith('insert or ignore into sync_state') ||
                    normalized.startsWith('insert or replace into sync_state')
                ) {
                    const [key, value, updatedAt] = values;
                    const existing = state.sync_state.find((row) => row.key === key);
                    if (existing) {
                        if (!normalized.includes('or ignore')) {
                            existing.value = value;
                            existing.updated_at = updatedAt;
                        }
                    } else {
                        state.sync_state.push({ key, value, updated_at: updatedAt });
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('update sync_state')) {
                    const key = values[values.length - 1];
                    const existing = state.sync_state.find((row) => row.key === key);
                    if (!existing) {
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    if (values.length >= 3) {
                        existing.value = values[0];
                        existing.updated_at = values[1];
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                // -- import_jobs --

                if (normalized.startsWith('insert into import_jobs')) {
                    const [id, sourcePath, startedAt, completedAt, importedCount, skippedCount, errorCount, status] =
                        values;
                    const existing = state.import_jobs.find((row) => row.id === id);
                    if (existing) {
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    state.import_jobs.push({
                        id,
                        source_path: sourcePath,
                        started_at: startedAt,
                        completed_at: completedAt ?? null,
                        imported_count: importedCount ?? 0,
                        skipped_count: skippedCount ?? 0,
                        error_count: errorCount ?? 0,
                        status: status || 'running',
                    });
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('update import_jobs set')) {
                    const id = values[values.length - 1];
                    const existing = state.import_jobs.find((row) => row.id === id);
                    if (!existing) {
                        return { rowsAffected: 0, lastInsertId: null };
                    }
                    // Parse dynamic SET clauses from the normalized query.
                    // The production code builds "col = ?" pairs; extract column
                    // names between "set" and "where" then apply positional values.
                    const setMatch = normalized.match(/set\s+(.+?)\s+where/);
                    if (setMatch) {
                        const pairs = setMatch[1].split(',').map((s) => s.trim());
                        for (let i = 0; i < pairs.length; i++) {
                            const colName = pairs[i].replace(/\s*=\s*\?/, '').trim();
                            existing[colName] = values[i];
                        }
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                // -- instrumentation (ADR 008) --
                //
                // Singleton row keyed on id = 1. Supports the upsert pattern
                // used by docs/js/instrumentation.js saveToDesktopSql().

                if (normalized.startsWith('insert into instrumentation')) {
                    const [
                        version,
                        revision,
                        installationId,
                        firstSeen,
                        lastSeen,
                        sessions,
                        studiesImported,
                        shareEnabled,
                    ] = values;
                    const existing = state.instrumentation.find((row) => row.id === 1);
                    if (existing) {
                        existing.version = version;
                        existing.revision = revision;
                        existing.installation_id = installationId;
                        existing.first_seen = firstSeen;
                        existing.last_seen = lastSeen;
                        existing.sessions = sessions;
                        existing.studies_imported = studiesImported;
                        existing.share_enabled = shareEnabled;
                    } else {
                        state.instrumentation.push({
                            id: 1,
                            version,
                            revision,
                            installation_id: installationId,
                            first_seen: firstSeen,
                            last_seen: lastSeen,
                            sessions,
                            studies_imported: studiesImported,
                            share_enabled: shareEnabled,
                        });
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                throw new Error(`Unhandled mock SQL execute: ${query}`);
            },

            async select(query, values = []) {
                const normalized = normalizeQuery(query);
                const state = loadState(db, options);

                if (normalized.startsWith('select value from app_config where key = ?')) {
                    const [key] = values;
                    const row = state.app_config.find((entry) => entry.key === key);
                    return row ? [{ value: row.value }] : [];
                }

                if (normalized.startsWith('select study_uid, description from study_notes where study_uid in')) {
                    const studyUids = new Set(values);
                    return state.study_notes
                        .filter((row) => studyUids.has(row.study_uid))
                        .map((row) => ({ study_uid: row.study_uid, description: row.description }));
                }

                if (
                    normalized.startsWith('select study_uid, description from study_notes where study_uid = ? limit 1')
                ) {
                    const [studyUid] = values;
                    const row = state.study_notes.find((entry) => entry.study_uid === studyUid);
                    return row ? [{ study_uid: row.study_uid, description: row.description }] : [];
                }

                if (
                    normalized.startsWith(
                        'select study_uid, series_uid, description from series_notes where study_uid in',
                    )
                ) {
                    const studyUids = new Set(values);
                    return state.series_notes
                        .filter((row) => studyUids.has(row.study_uid))
                        .map((row) => ({
                            study_uid: row.study_uid,
                            series_uid: row.series_uid,
                            description: row.description,
                        }));
                }

                if (
                    normalized.startsWith(
                        'select id, study_uid, series_uid, text, time from comments where study_uid in',
                    )
                ) {
                    const studyUids = new Set(values);
                    return sortComments(state.comments.filter((row) => studyUids.has(row.study_uid))).map((row) => ({
                        id: row.id,
                        study_uid: row.study_uid,
                        series_uid: row.series_uid,
                        text: row.text,
                        time: row.time,
                    }));
                }

                if (
                    normalized.startsWith(
                        'select id, record_uuid, study_uid, series_uid, text, time, created_at, updated_at, deleted_at from comments where study_uid in',
                    )
                ) {
                    const studyUids = new Set(values);
                    return sortComments(state.comments.filter((row) => studyUids.has(row.study_uid))).map((row) => ({
                        id: row.id,
                        record_uuid: row.record_uuid,
                        study_uid: row.study_uid,
                        series_uid: row.series_uid,
                        text: row.text,
                        time: row.time,
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                        deleted_at: row.deleted_at,
                    }));
                }

                if (
                    normalized.startsWith(
                        'select record_uuid, study_uid, series_uid, text, time, created_at, updated_at, deleted_at from comments where record_uuid = ? limit 1',
                    )
                ) {
                    const [recordUuid] = values;
                    const row = state.comments.find((entry) => entry.record_uuid === recordUuid);
                    return row
                        ? [
                              {
                                  record_uuid: row.record_uuid,
                                  study_uid: row.study_uid,
                                  series_uid: row.series_uid,
                                  text: row.text,
                                  time: row.time,
                                  created_at: row.created_at,
                                  updated_at: row.updated_at,
                                  deleted_at: row.deleted_at,
                              },
                          ]
                        : [];
                }

                if (
                    normalized.startsWith(
                        'select id, study_uid, name, type, size, added_at, updated_at, file_path from reports where study_uid in',
                    )
                ) {
                    const studyUids = new Set(values);
                    return sortByAddedAtThenId(
                        state.reports.filter(
                            (row) =>
                                studyUids.has(row.study_uid) && row.file_path !== null && row.file_path !== undefined,
                        ),
                    ).map((row) => ({
                        id: row.id,
                        study_uid: row.study_uid,
                        name: row.name,
                        type: row.type,
                        size: row.size,
                        added_at: row.added_at,
                        updated_at: row.updated_at,
                        file_path: row.file_path,
                    }));
                }

                if (
                    normalized.startsWith(
                        'select id, study_uid, name, type, size, content_hash, added_at, updated_at, deleted_at, file_path from reports where study_uid in',
                    )
                ) {
                    const studyUids = new Set(values);
                    return sortByAddedAtThenId(
                        state.reports.filter(
                            (row) =>
                                studyUids.has(row.study_uid) && row.file_path !== null && row.file_path !== undefined,
                        ),
                    ).map((row) => ({
                        id: row.id,
                        study_uid: row.study_uid,
                        name: row.name,
                        type: row.type,
                        size: row.size,
                        content_hash: row.content_hash || null,
                        added_at: row.added_at,
                        updated_at: row.updated_at,
                        deleted_at: row.deleted_at || null,
                        file_path: row.file_path,
                    }));
                }

                if (
                    normalized.startsWith(
                        'select id, study_uid, name, type, size, content_hash, added_at, updated_at, deleted_at from reports where id = ? limit 1',
                    )
                ) {
                    const [id] = values;
                    const row = state.reports.find((entry) => String(entry.id) === String(id));
                    return row
                        ? [
                              {
                                  id: row.id,
                                  study_uid: row.study_uid,
                                  name: row.name,
                                  type: row.type,
                                  size: row.size,
                                  content_hash: row.content_hash || null,
                                  added_at: row.added_at,
                                  updated_at: row.updated_at,
                                  deleted_at: row.deleted_at || null,
                              },
                          ]
                        : [];
                }

                if (normalized.startsWith('select file_path, added_at from reports where id = ? limit 1')) {
                    const [id] = values;
                    const row = state.reports.find((entry) => String(entry.id) === String(id));
                    return row ? [{ file_path: row.file_path, added_at: row.added_at }] : [];
                }

                if (normalized.startsWith('select file_path from reports where id = ? and study_uid = ? limit 1')) {
                    const [id, studyUid] = values;
                    const row = state.reports.find(
                        (entry) => String(entry.id) === String(id) && entry.study_uid === studyUid,
                    );
                    return row ? [{ file_path: row.file_path }] : [];
                }

                if (
                    normalized.startsWith(
                        'select path, size, modified_ms, renderable, meta_json from desktop_scan_cache where root_path in',
                    )
                ) {
                    const scannerVersion = Number(values[values.length - 1]);
                    const roots = new Set(values.slice(0, -1));
                    return state.desktop_scan_cache
                        .filter((row) => roots.has(row.root_path) && Number(row.scanner_version) === scannerVersion)
                        .map((row) => ({
                            path: row.path,
                            size: row.size,
                            modified_ms: row.modified_ms,
                            renderable: row.renderable,
                            meta_json: row.meta_json,
                        }));
                }

                // -- sync_outbox selects --

                if (
                    normalized.startsWith('select') &&
                    normalized.includes('sync_outbox') &&
                    normalized.includes('synced_at is null')
                ) {
                    return state.sync_outbox.filter((row) => row.synced_at === null).map((row) => clone(row));
                }

                if (normalized.startsWith('select') && normalized.includes('sync_outbox')) {
                    return state.sync_outbox.map((row) => clone(row));
                }

                // -- sync_state selects --

                if (
                    normalized.startsWith('select') &&
                    normalized.includes('sync_state') &&
                    normalized.includes('where key = ?')
                ) {
                    const [key] = values;
                    const row = state.sync_state.find((entry) => entry.key === key);
                    return row ? [clone(row)] : [];
                }

                if (normalized.startsWith('select') && normalized.includes('sync_state')) {
                    return state.sync_state.map((row) => clone(row));
                }

                // -- import_jobs selects --

                if (normalized.startsWith('select') && normalized.includes('from import_jobs')) {
                    const rows = state.import_jobs.slice();
                    // Support ORDER BY started_at DESC (the production query pattern)
                    if (normalized.includes('order by started_at desc')) {
                        rows.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
                    }
                    // Support LIMIT clause
                    const limitMatch = normalized.match(/limit\s+\?/);
                    const limitValue = limitMatch ? Number(values[values.length - 1]) : rows.length;
                    return rows.slice(0, limitValue).map((row) => clone(row));
                }

                // -- instrumentation selects (ADR 008) --

                if (normalized.startsWith('select') && normalized.includes('from instrumentation')) {
                    const rows = state.instrumentation
                        .filter((row) => row.id === 1)
                        .slice(0, 1)
                        .map((row) => clone(row));
                    return rows;
                }

                throw new Error(`Unhandled mock SQL select: ${query}`);
            },

            async close() {
                return true;
            },
        };
    }

    async function applyMigrationBatch(db, batch, options = {}) {
        const connection = makeConnection(db, options);

        for (const row of batch?.studyNotes || []) {
            await connection.execute(
                `INSERT INTO study_notes (study_uid, description, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(study_uid) DO NOTHING`,
                [row.studyUid, row.description, row.updatedAt],
            );
        }

        for (const row of batch?.seriesNotes || []) {
            await connection.execute(
                `INSERT INTO series_notes (study_uid, series_uid, description, updated_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(study_uid, series_uid) DO NOTHING`,
                [row.studyUid, row.seriesUid, row.description, row.updatedAt],
            );
        }

        for (const row of batch?.comments || []) {
            await connection.execute(
                'INSERT OR IGNORE INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)',
                [row.studyUid, row.seriesUid, row.text, row.time],
            );
        }

        for (const row of batch?.reports || []) {
            await connection.execute(
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
                [row.id, row.studyUid, row.name, row.type, row.size, row.filePath, row.addedAt, row.updatedAt],
            );
        }

        for (const row of batch?.appConfig || []) {
            await connection.execute(
                `INSERT INTO app_config (key, value, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET
                     value = excluded.value,
                     updated_at = excluded.updated_at`,
                [row.key, row.value, row.updatedAt],
            );
        }

        return true;
    }

    window.__createMockTauriSql = function createMockTauriSql(options = {}) {
        return {
            async load(db) {
                const loadKey = `mock-tauri-sql-load-calls:${db}`;
                const previousCalls = Number(localStorage.getItem(loadKey) || '0');
                localStorage.setItem(loadKey, String(previousCalls + 1));
                if (options.sqlLoadError) {
                    throw new Error(options.sqlLoadError);
                }
                const state = loadState(db, options);
                state.meta.loadCalls += 1;
                persistState(db, state);
                return makeConnection(db, options);
            },
        };
    };

    window.__applyMockDesktopMigration = async function applyMockDesktopMigration(db, batch, options = {}) {
        loadState(db, options);
        return await applyMigrationBatch(db, batch, options);
    };

    window.__handleMockTauriSqlCommand = async function handleMockTauriSqlCommand(cmd, args, options = {}) {
        const sql = window.__createMockTauriSql(options);
        switch (cmd) {
            case 'plugin:sql|load':
                await sql.load(args.db);
                return args.db;
            case 'plugin:sql|select': {
                const connection = await sql.load(args.db);
                return await connection.select(args.query, args.values || []);
            }
            case 'plugin:sql|execute': {
                const connection = await sql.load(args.db);
                const result = await connection.execute(args.query, args.values || []);
                return [result.rowsAffected || 0, result.lastInsertId ?? null];
            }
            case 'plugin:sql|close':
                return true;
            default:
                throw new Error(`Unhandled mock SQL command: ${cmd}`);
        }
    };
})();
