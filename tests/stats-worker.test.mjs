import test from 'node:test';
import assert from 'node:assert/strict';

import {
    STATS_PATH,
    handleStats,
    parseAllowedOrigins,
    upsertInstall,
    validateStatsPayload
} from '../workers/stats/src/index.mjs';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

const VALID_INSTALL_ID = 'a1b2c3d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

function validPayload(overrides = {}) {
    return {
        version: 1,
        revision: 1,
        installationId: VALID_INSTALL_ID,
        sessions: 3,
        studiesImported: 2,
        ...overrides
    };
}

// In-memory D1 double. Stores one row per install_id and enforces the
// "only upsert when incoming.revision > stored.revision" guard.
function createDb(initialInstalls = [], options = {}) {
    const installs = new Map(
        initialInstalls.map((row) => [row.install_id, { ...row }])
    );
    const preparedQueries = [];
    const now = () => new Date().toISOString();

    return {
        installs,
        preparedQueries,
        prepare(query) {
            preparedQueries.push(query);
            return {
                args: [],
                bind(...args) {
                    this.args = args;
                    return this;
                },
                async run() {
                    if (!query.startsWith('INSERT INTO installs')) {
                        throw new Error(`Unhandled run() query: ${query}`);
                    }
                    if (
                        options.requireSeenColumns &&
                        query.includes('INSERT INTO installs (install_id, revision, stats_json, version)')
                    ) {
                        throw new Error('NOT NULL constraint failed: installs.first_seen');
                    }
                    const [installId, revision, statsJson, version] = this.args;
                    const fallbackSeenColumns = query.includes('first_seen, last_seen');
                    const existing = installs.get(installId);
                    if (!existing) {
                        installs.set(installId, {
                            install_id: installId,
                            revision,
                            stats_json: statsJson,
                            ...(fallbackSeenColumns
                                ? {
                                      first_seen: now(),
                                      last_seen: now()
                                  }
                                : {}),
                            version,
                            created_at: now(),
                            updated_at: now()
                        });
                        return { success: true };
                    }
                    // Stale-write guard mirrors the WHERE clause in production.
                    if (revision > existing.revision) {
                        existing.revision = revision;
                        existing.stats_json = statsJson;
                        if (fallbackSeenColumns) {
                            existing.last_seen = now();
                        }
                        existing.version = version;
                        existing.updated_at = now();
                    }
                    return { success: true };
                }
            };
        }
    };
}

function createRequest(body, { method = 'POST', origin = null, path = STATS_PATH } = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (origin) headers.set('Origin', origin);
    const init = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'OPTIONS') {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return new Request(`https://api.myradone.com${path}`, init);
}

function createEnv({ db = createDb(), allowedOrigins = 'https://myradone.com' } = {}) {
    return {
        DB: db,
        ALLOWED_ORIGINS: allowedOrigins,
        STATS_RATE_LIMIT: null // rate limiting disabled in tests
    };
}

// -----------------------------------------------------------------------
// validateStatsPayload
// -----------------------------------------------------------------------

test('validateStatsPayload: accepts a well-formed payload without timestamps', () => {
    const result = validateStatsPayload(validPayload());
    assert.equal(result.ok, true);
    assert.equal(result.payload.installationId, VALID_INSTALL_ID);
    assert.equal(result.payload.sessions, 3);
    // Field order should be normalized.
    assert.deepEqual(Object.keys(result.payload), [
        'version',
        'revision',
        'installationId',
        'sessions',
        'studiesImported'
    ]);
});

test('validateStatsPayload: accepts and strips legacy timestamps', () => {
    const result = validateStatsPayload(
        validPayload({
            firstSeen: '2026-04-08T12:00:00.000Z',
            lastSeen: '2026-04-09T08:30:00.000Z'
        })
    );
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.payload), [
        'version',
        'revision',
        'installationId',
        'sessions',
        'studiesImported'
    ]);
    assert.equal('firstSeen' in result.payload, false);
    assert.equal('lastSeen' in result.payload, false);
});

test('validateStatsPayload: rejects non-objects', () => {
    for (const value of [null, undefined, 'string', 42, [], true]) {
        const result = validateStatsPayload(value);
        assert.equal(result.ok, false, `should reject ${JSON.stringify(value)}`);
    }
});

test('validateStatsPayload: rejects unknown fields', () => {
    const result = validateStatsPayload(validPayload({ shareEnabled: true }));
    assert.equal(result.ok, false);
    assert.equal(result.field, 'shareEnabled');
});

test('validateStatsPayload: rejects wrong schema version', () => {
    const result = validateStatsPayload(validPayload({ version: 2 }));
    assert.equal(result.ok, false);
    assert.equal(result.field, 'version');
});

test('validateStatsPayload: rejects non-UUID-v4 installationId', () => {
    const cases = [
        'not-a-uuid',
        '',
        'A1B2C3D4-5E6F-4A8B-9C0D-1E2F3A4B5C6D', // uppercase rejected
        'a1b2c3d4-5e6f-1a8b-9c0d-1e2f3a4b5c6d', // version 1, not 4
        'a1b2c3d4-5e6f-4a8b-7c0d-1e2f3a4b5c6d'  // variant 7, not 8-b
    ];
    for (const id of cases) {
        const result = validateStatsPayload(validPayload({ installationId: id }));
        assert.equal(result.ok, false, `should reject ${id}`);
        assert.equal(result.field, 'installationId');
    }
});

test('validateStatsPayload: rejects non-integer or negative counters', () => {
    const badValues = [-1, 1.5, '3', null, undefined, NaN];
    for (const bad of badValues) {
        for (const field of ['revision', 'sessions', 'studiesImported']) {
            const result = validateStatsPayload(validPayload({ [field]: bad }));
            assert.equal(result.ok, false, `${field}=${bad} should fail`);
            assert.equal(result.field, field);
        }
    }
});

test('validateStatsPayload: rejects invalid timestamps when present', () => {
    const badDates = ['', null, undefined, 'not-a-date', 123456];
    for (const bad of badDates) {
        const result = validateStatsPayload(validPayload({ firstSeen: bad }));
        assert.equal(result.ok, false, `firstSeen=${bad} should fail`);
        assert.equal(result.field, 'firstSeen');

        const lastSeenResult = validateStatsPayload(validPayload({ lastSeen: bad }));
        assert.equal(lastSeenResult.ok, false, `lastSeen=${bad} should fail`);
        assert.equal(lastSeenResult.field, 'lastSeen');
    }
});

// -----------------------------------------------------------------------
// parseAllowedOrigins
// -----------------------------------------------------------------------

test('parseAllowedOrigins: splits and trims comma-separated origins', () => {
    const set = parseAllowedOrigins(' https://a.com , https://b.com,https://c.com ');
    assert.equal(set.has('https://a.com'), true);
    assert.equal(set.has('https://b.com'), true);
    assert.equal(set.has('https://c.com'), true);
    assert.equal(set.size, 3);
});

test('parseAllowedOrigins: empty input falls back to defaults', () => {
    const set = parseAllowedOrigins('');
    assert.ok(set.size > 0, 'expected default origins');
});

// -----------------------------------------------------------------------
// upsertInstall
// -----------------------------------------------------------------------

test('upsertInstall: inserts a new row on first write', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload({ revision: 1 }));
    assert.equal(db.installs.size, 1);
    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(row.revision, 1);
    assert.equal(row.version, 1);
    assert.equal('first_seen' in row, false);
    assert.equal('last_seen' in row, false);
});

test('upsertInstall: higher revision overwrites stored row', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload({ revision: 1, sessions: 3 }));
    await upsertInstall(
        db,
        validPayload({
            revision: 5,
            sessions: 10
        })
    );
    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(row.revision, 5);
    const stored = JSON.parse(row.stats_json);
    assert.equal(stored.sessions, 10);
});

test('upsertInstall: stale revision is silently ignored', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload({ revision: 5, sessions: 10 }));
    await upsertInstall(db, validPayload({ revision: 3, sessions: 1 }));
    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(row.revision, 5);
    const stored = JSON.parse(row.stats_json);
    assert.equal(stored.sessions, 10, 'stale write should not overwrite');
});

test('upsertInstall: created_at is preserved on upsert', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload({ revision: 1, sessions: 1 }));
    const insertedCreatedAt = db.installs.get(VALID_INSTALL_ID).created_at;
    await upsertInstall(db, validPayload({ revision: 2, sessions: 2 }));
    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(row.created_at, insertedCreatedAt);
});

test('upsertInstall: stores exact normalized JSON keys', async () => {
    const legacyPayload = validPayload({
        firstSeen: '2026-04-08T12:00:00.000Z',
        lastSeen: '2026-04-09T08:30:00.000Z'
    });
    const validation = validateStatsPayload(legacyPayload);
    assert.equal(validation.ok, true);

    const db = createDb();
    await upsertInstall(db, legacyPayload);
    const row = db.installs.get(VALID_INSTALL_ID);
    const stored = JSON.parse(row.stats_json);
    assert.deepEqual(Object.keys(stored), [
        'version',
        'revision',
        'installationId',
        'sessions',
        'studiesImported'
    ]);
    assert.deepEqual(stored, validation.payload);
});

test('upsertInstall: retries old NOT NULL seen-column schema without storing timestamps in stats_json', async () => {
    const db = createDb([], { requireSeenColumns: true });
    await upsertInstall(
        db,
        validPayload({
            firstSeen: '2026-04-08T12:00:00.000Z',
            lastSeen: '2026-04-09T08:30:00.000Z'
        })
    );

    assert.equal(db.preparedQueries.length, 2);
    assert.match(db.preparedQueries[0], /INSERT INTO installs \(install_id, revision, stats_json, version\)/);
    assert.match(db.preparedQueries[1], /INSERT INTO installs \(install_id, revision, stats_json, first_seen, last_seen, version\)/);

    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(typeof row.first_seen, 'string');
    assert.equal(typeof row.last_seen, 'string');
    const stored = JSON.parse(row.stats_json);
    assert.deepEqual(Object.keys(stored), [
        'version',
        'revision',
        'installationId',
        'sessions',
        'studiesImported'
    ]);
    assert.equal('firstSeen' in stored, false);
    assert.equal('lastSeen' in stored, false);
});

test('upsertInstall: INSERT column shape does not reference seen columns', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload());
    const query = db.preparedQueries[0];
    assert.match(query, /INSERT INTO installs \(install_id, revision, stats_json, version\)/);
    assert.match(query, /VALUES \(\?, \?, \?, \?\)/);
    assert.doesNotMatch(query, /\bfirst_seen\b/);
    assert.doesNotMatch(query, /\blast_seen\b/);
});

// -----------------------------------------------------------------------
// handleStats (end-to-end through the fetch handler)
// -----------------------------------------------------------------------

test('handleStats: POST with valid payload returns 200 and writes the row', async () => {
    const env = createEnv();
    const response = await handleStats(createRequest(validPayload()), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true });
    assert.equal(env.DB.installs.size, 1);
});

test('handleStats: OPTIONS returns 204 for CORS preflight', async () => {
    const env = createEnv();
    const request = createRequest(undefined, {
        method: 'OPTIONS',
        origin: 'https://myradone.com'
    });
    const response = await handleStats(request, env);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://myradone.com');
});

test('handleStats: Tauri desktop origins are allowed for CORS preflight', async () => {
    const env = createEnv();
    for (const origin of [
        'tauri://localhost',
        'tauri://localhost:1430',
        'http://tauri.localhost',
        'https://tauri.localhost'
    ]) {
        const request = createRequest(undefined, { method: 'OPTIONS', origin });
        const response = await handleStats(request, env);
        assert.equal(response.status, 204, `${origin} preflight should be allowed`);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    }
});

test('handleStats: unknown path returns 404', async () => {
    const env = createEnv();
    const response = await handleStats(createRequest(validPayload(), { path: '/api/other' }), env);
    assert.equal(response.status, 404);
});

test('handleStats: GET returns 405', async () => {
    const env = createEnv();
    const response = await handleStats(createRequest(undefined, { method: 'GET' }), env);
    assert.equal(response.status, 405);
});

test('handleStats: invalid JSON returns 400', async () => {
    const env = createEnv();
    const response = await handleStats(createRequest('{not json'), env);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid JSON');
});

test('handleStats: unknown payload field returns 400 with field name', async () => {
    const env = createEnv();
    const response = await handleStats(
        createRequest(validPayload({ shareEnabled: true })),
        env
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.field, 'shareEnabled');
});

test('handleStats: disallowed origin returns 403', async () => {
    const env = createEnv();
    const request = createRequest(validPayload(), { origin: 'https://attacker.example' });
    const response = await handleStats(request, env);
    assert.equal(response.status, 403);
});

test('handleStats: localhost origins are allowed', async () => {
    const env = createEnv();
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:8080', 'https://localhost']) {
        const response = await handleStats(createRequest(validPayload(), { origin }), env);
        assert.equal(response.status, 200, `${origin} should be allowed`);
    }
});

test('handleStats: Tauri desktop origins are allowed for POST', async () => {
    const env = createEnv();
    for (const origin of [
        'tauri://localhost',
        'tauri://localhost:1430',
        'http://tauri.localhost',
        'https://tauri.localhost'
    ]) {
        const response = await handleStats(createRequest(validPayload(), { origin }), env);
        assert.equal(response.status, 200, `${origin} should be allowed`);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    }
});

test('handleStats: no Origin header is allowed', async () => {
    const env = createEnv();
    const response = await handleStats(createRequest(validPayload()), env);
    assert.equal(response.status, 200);
});

test('handleStats: D1 errors return generic 500 without leaking details', async () => {
    const failingDb = {
        prepare() {
            return {
                bind: () => ({
                    run: () => {
                        throw new Error('secret internal detail: table xyz does not exist');
                    }
                })
            };
        }
    };
    const env = createEnv({ db: failingDb });
    const response = await handleStats(createRequest(validPayload()), env);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, 'Server error');
    assert.equal(body.field, undefined);
    // The error message must not leak the internal detail.
    assert.equal(JSON.stringify(body).includes('secret internal detail'), false);
    assert.equal(JSON.stringify(body).includes('xyz'), false);
});
