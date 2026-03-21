(function () {
    if (typeof window === 'undefined') return;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeQuery(query) {
        return String(query || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function createEmptyDbState() {
        return {
            study_notes: [],
            series_notes: [],
            comments: [],
            reports: [],
            app_config: [],
            meta: {
                lastCommentId: 0
            }
        };
    }

    function createStorageKey(db) {
        return `mock-tauri-sql:${db}`;
    }

    function loadState(db, options) {
        const storageKey = createStorageKey(db);
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            return safeParse(raw, createEmptyDbState());
        }
        const initial = options?.initialState?.[db];
        const state = initial ? clone(initial) : createEmptyDbState();
        persistState(db, state);
        return state;
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
            return (a.added_at || 0) - (b.added_at || 0)
                || String(a.id || '').localeCompare(String(b.id || ''));
        });
    }

    function sortComments(items) {
        return items.slice().sort((a, b) => {
            return (a.time || 0) - (b.time || 0)
                || (a.id || 0) - (b.id || 0);
        });
    }

    function makeConnection(db, options) {
        return {
            async execute(query, values = []) {
                const normalized = normalizeQuery(query);
                const state = loadState(db, options);

                if (
                    normalized === 'begin'
                    || normalized === 'commit'
                    || normalized === 'rollback'
                    || normalized.startsWith('create table')
                    || normalized.startsWith('create unique index')
                ) {
                    return { rowsAffected: 0, lastInsertId: null };
                }

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
                        updated_at: updatedAt
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

                if (normalized.startsWith('insert into series_notes')) {
                    const [studyUid, seriesUid, description, updatedAt] = values;
                    const existing = state.series_notes.find((row) => row.study_uid === studyUid && row.series_uid === seriesUid);
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
                        updated_at: updatedAt
                    });
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from series_notes')) {
                    const [studyUid, seriesUid] = values;
                    const before = state.series_notes.length;
                    state.series_notes = state.series_notes.filter(
                        (row) => !(row.study_uid === studyUid && row.series_uid === seriesUid)
                    );
                    persistState(db, state);
                    return { rowsAffected: before - state.series_notes.length, lastInsertId: null };
                }

                if (normalized.startsWith('insert into comments') || normalized.startsWith('insert or ignore into comments')) {
                    const [studyUid, seriesUid, text, time] = values;
                    const existing = state.comments.find(
                        (row) => row.study_uid === studyUid
                            && row.series_uid === seriesUid
                            && row.text === text
                            && row.time === time
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
                        time
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
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from comments')) {
                    const [id, studyUid] = values;
                    const before = state.comments.length;
                    state.comments = state.comments.filter(
                        (row) => !(row.id === Number(id) && row.study_uid === studyUid)
                    );
                    persistState(db, state);
                    return { rowsAffected: before - state.comments.length, lastInsertId: null };
                }

                if (normalized.startsWith('insert into reports') || normalized.startsWith('insert or replace into reports')) {
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
                            updated_at: updatedAt
                        });
                    }
                    persistState(db, state);
                    return { rowsAffected: 1, lastInsertId: null };
                }

                if (normalized.startsWith('delete from reports')) {
                    const [id, studyUid] = values;
                    const before = state.reports.length;
                    state.reports = state.reports.filter(
                        (row) => !(String(row.id) === String(id) && row.study_uid === studyUid)
                    );
                    persistState(db, state);
                    return { rowsAffected: before - state.reports.length, lastInsertId: null };
                }

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

                if (normalized.startsWith('select study_uid, series_uid, description from series_notes where study_uid in')) {
                    const studyUids = new Set(values);
                    return state.series_notes
                        .filter((row) => studyUids.has(row.study_uid))
                        .map((row) => ({
                            study_uid: row.study_uid,
                            series_uid: row.series_uid,
                            description: row.description
                        }));
                }

                if (normalized.startsWith('select id, study_uid, series_uid, text, time from comments where study_uid in')) {
                    const studyUids = new Set(values);
                    return sortComments(
                        state.comments.filter((row) => studyUids.has(row.study_uid))
                    ).map((row) => ({
                        id: row.id,
                        study_uid: row.study_uid,
                        series_uid: row.series_uid,
                        text: row.text,
                        time: row.time
                    }));
                }

                if (normalized.startsWith('select id, study_uid, name, type, size, added_at, updated_at, file_path from reports where study_uid in')) {
                    const studyUids = new Set(values);
                    return sortByAddedAtThenId(
                        state.reports.filter((row) => studyUids.has(row.study_uid) && row.file_path !== null && row.file_path !== undefined)
                    ).map((row) => ({
                        id: row.id,
                        study_uid: row.study_uid,
                        name: row.name,
                        type: row.type,
                        size: row.size,
                        added_at: row.added_at,
                        updated_at: row.updated_at,
                        file_path: row.file_path
                    }));
                }

                if (normalized.startsWith('select file_path, added_at from reports where id = ? limit 1')) {
                    const [id] = values;
                    const row = state.reports.find((entry) => String(entry.id) === String(id));
                    return row ? [{ file_path: row.file_path, added_at: row.added_at }] : [];
                }

                if (normalized.startsWith('select file_path from reports where id = ? and study_uid = ? limit 1')) {
                    const [id, studyUid] = values;
                    const row = state.reports.find(
                        (entry) => String(entry.id) === String(id) && entry.study_uid === studyUid
                    );
                    return row ? [{ file_path: row.file_path }] : [];
                }

                throw new Error(`Unhandled mock SQL select: ${query}`);
            },

            async close() {
                return true;
            }
        };
    }

    async function applyMigrationBatch(db, batch, options = {}) {
        const connection = makeConnection(db, options);

        for (const row of batch?.studyNotes || []) {
            await connection.execute(
                `INSERT INTO study_notes (study_uid, description, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(study_uid) DO NOTHING`,
                [row.studyUid, row.description, row.updatedAt]
            );
        }

        for (const row of batch?.seriesNotes || []) {
            await connection.execute(
                `INSERT INTO series_notes (study_uid, series_uid, description, updated_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(study_uid, series_uid) DO NOTHING`,
                [row.studyUid, row.seriesUid, row.description, row.updatedAt]
            );
        }

        for (const row of batch?.comments || []) {
            await connection.execute(
                'INSERT OR IGNORE INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)',
                [row.studyUid, row.seriesUid, row.text, row.time]
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
                [row.id, row.studyUid, row.name, row.type, row.size, row.filePath, row.addedAt, row.updatedAt]
            );
        }

        for (const row of batch?.appConfig || []) {
            await connection.execute(
                `INSERT INTO app_config (key, value, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET
                     value = excluded.value,
                     updated_at = excluded.updated_at`,
                [row.key, row.value, row.updatedAt]
            );
        }

        return true;
    }

    window.__createMockTauriSql = function createMockTauriSql(options = {}) {
        return {
            async load(db) {
                loadState(db, options);
                return makeConnection(db, options);
            }
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
