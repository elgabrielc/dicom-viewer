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
        firstSeen: '2026-04-08T12:00:00.000Z',
        lastSeen: '2026-04-09T08:30:00.000Z',
        sessions: 3,
        studiesImported: 2,
        ...overrides
    };
}

// In-memory D1 double. Stores one row per install_id and enforces the
// "only upsert when incoming.revision > stored.revision" guard.
function createDb(initialInstalls = []) {
    const installs = new Map(
        initialInstalls.map((row) => [row.install_id, { ...row }])
    );

    return {
        installs,
        prepare(query) {
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
                    const [installId, revision, statsJson, firstSeen, lastSeen, version] =
                        this.args;
                    const existing = installs.get(installId);
                    if (!existing) {
                        installs.set(installId, {
                            install_id: installId,
                            revision,
                            stats_json: statsJson,
                            first_seen: firstSeen,
                            last_seen: lastSeen,
                            version,
                            updated_at: new Date().toISOString()
                        });
                        return { success: true };
                    }
                    // Stale-write guard mirrors the WHERE clause in production.
                    if (revision > existing.revision) {
                        existing.revision = revision;
                        existing.stats_json = statsJson;
                        existing.last_seen = lastSeen;
                        existing.version = version;
                        existing.updated_at = new Date().toISOString();
                        // first_seen intentionally not updated.
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

test('validateStatsPayload: accepts a well-formed payload', () => {
    const result = validateStatsPayload(validPayload());
    assert.equal(result.ok, true);
    assert.equal(result.payload.installationId, VALID_INSTALL_ID);
    assert.equal(result.payload.sessions, 3);
    // Field order should be normalized.
    assert.deepEqual(Object.keys(result.payload), [
        'version',
        'revision',
        'installationId',
        'firstSeen',
        'lastSeen',
        'sessions',
        'studiesImported'
    ]);
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

test('validateStatsPayload: rejects invalid timestamps', () => {
    const badDates = ['', null, undefined, 'not-a-date', 123456];
    for (const bad of badDates) {
        const result = validateStatsPayload(validPayload({ firstSeen: bad }));
        assert.equal(result.ok, false, `firstSeen=${bad} should fail`);
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
    assert.equal(row.first_seen, '2026-04-08T12:00:00.000Z');
});

test('upsertInstall: higher revision overwrites stored row', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload({ revision: 1, sessions: 3 }));
    await upsertInstall(
        db,
        validPayload({
            revision: 5,
            sessions: 10,
            lastSeen: '2026-04-10T00:00:00.000Z'
        })
    );
    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(row.revision, 5);
    assert.equal(row.last_seen, '2026-04-10T00:00:00.000Z');
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

test('upsertInstall: first_seen is preserved on upsert', async () => {
    const db = createDb();
    await upsertInstall(db, validPayload({ revision: 1, firstSeen: '2026-01-01T00:00:00.000Z' }));
    await upsertInstall(db, validPayload({ revision: 2, firstSeen: '2099-12-31T23:59:59.000Z' }));
    const row = db.installs.get(VALID_INSTALL_ID);
    assert.equal(row.first_seen, '2026-01-01T00:00:00.000Z');
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

test('handleStats: no Origin header is allowed (Tauri desktop case)', async () => {
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
