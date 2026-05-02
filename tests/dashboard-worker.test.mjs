import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
    DASHBOARD_PATH,
    CONFIG_PATH,
    SESSION_PATH,
    SUMMARY_PATH,
    SUBSCRIBERS_PATH,
    STATS_INSTALLS_PATH,
    STATS_SUMMARY_PATH,
    authenticate,
    createSignedSessionValue,
    createErrorResponse,
    dispatchRequest,
    handleDashboard,
    handleStatsInstalls,
    handleStatsSummary,
    handleSubscribers,
    handleSummary,
    readonlySelect,
    verifySignedSessionValue
} from '../workers/dashboard/src/lib.mjs';

const DASHBOARD_HTML = '<!doctype html><html><body data-dashboard-shell="true">dashboard</body></html>';
const VALID_TEST_TOKEN = 'valid-dashboard-token-0123456789abcdef';
const REAL_DASHBOARD_HTML = fs.readFileSync(
    new URL('../workers/dashboard/src/dashboard.html', import.meta.url),
    'utf8'
);

function extractInlineScript(html) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match, 'expected inline script');
    return match[1];
}

function sha256Base64(value) {
    return crypto.createHash('sha256').update(value).digest('base64');
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function createEnv(options = {}) {
    const { subscribers = [], installs = [], rateLimitSuccess = true } = options;
    const token = Object.prototype.hasOwnProperty.call(options, 'token') ? options.token : VALID_TEST_TOKEN;

    return {
        DASHBOARD_TOKEN: token,
        NOW: options.now,
        DASHBOARD_RATE_LIMIT: {
            async limit() {
                return { success: rateLimitSuccess };
            }
        },
        SUBSCRIBERS_DB: createDb(subscribers),
        STATS_DB: createStatsDb(installs)
    };
}

function createStatsDb(initialInstalls) {
    const installs = initialInstalls.map((install, index) => {
        const statsJson = Object.prototype.hasOwnProperty.call(install, 'statsJson')
            ? install.statsJson
            : JSON.stringify({
                sessions: install.sessions ?? 0,
                studiesImported: install.studiesImported ?? 0
            });

        return {
            install_id: install.installationId,
            revision: install.revision ?? index,
            first_seen: install.firstSeen ?? '2026-04-12T00:00:00.000Z',
            last_seen: install.lastSeen ?? '2026-04-12T00:00:00.000Z',
            created_at: install.createdAt ?? '2026-04-12T00:00:00.000Z',
            stats_json: statsJson,
            version: install.version ?? 1
        };
    });

    const db = {
        recordedQueries: [],
        prepare(query) {
            this.recordedQueries.push(query);
            return {
                args: [],
                bind(...args) {
                    this.args = args;
                    return this;
                },
                async first() {
                    if (query.includes('COUNT(*) AS installs_total')) {
                        return buildStatsTotals(installs, this.args);
                    }

                    if (query.startsWith('SELECT COUNT(*) AS total FROM installs')) {
                        return { total: installs.length };
                    }

                    throw new Error(`Unhandled stats first() query: ${query}`);
                },
                async all() {
                    if (query.startsWith('WITH RECURSIVE days(day) AS')) {
                        return { results: buildInstallDailyRows(installs, this.args) };
                    }

                    if (query.includes('SELECT') && query.includes('install_id') && query.includes('FROM installs')) {
                        const [limit, offset] = this.args;
                        const { column, direction } = extractInstallSort(query);
                        const rows = installs.map(normalizeStatsRecord);
                        rows.sort((left, right) => compareInstallRows(left, right, column, direction));
                        return { results: rows.slice(offset, offset + limit) };
                    }

                    throw new Error(`Unhandled stats all() query: ${query}`);
                }
            };
        }
    };

    return db;
}

function createDb(initialSubscribers) {
    const subscribers = initialSubscribers.map((subscriber, index) => ({
        id: index + 1,
        email: subscriber.email,
        status: subscriber.status ?? 'active',
        subscribed_at: subscriber.subscribed_at ?? '2026-04-12 12:00:00',
        source: subscriber.source ?? 'landing',
        consent_version: subscriber.consent_version ?? 'v1'
    }));

    const db = {
        prepare(query) {
            return {
                args: [],
                bind(...args) {
                    this.args = args;
                    return this;
                },
                async first() {
                    if (query.includes('COUNT(*) AS total') && query.includes("status = 'active'")) {
                        const total = subscribers.length;
                        const active = subscribers.filter((row) => row.status === 'active').length;
                        const unsubscribed = subscribers.filter((row) => row.status === 'unsubscribed').length;
                        return { total, active, unsubscribed };
                    }

                    if (query.startsWith('SELECT COUNT(*) AS total FROM subscribers')) {
                        return { total: filterSubscribers(query, this.args, subscribers).length };
                    }

                    throw new Error(`Unhandled first() query: ${query}`);
                },
                async all() {
                    if (query.startsWith('SELECT source, status, COUNT(*) AS count')) {
                        const grouped = new Map();
                        for (const subscriber of subscribers) {
                            const key = `${subscriber.source}:${subscriber.status}`;
                            grouped.set(key, (grouped.get(key) || 0) + 1);
                        }

                        return {
                            results: [...grouped.entries()]
                                .map(([key, count]) => {
                                    const [source, status] = key.split(':');
                                    return { source, status, count };
                                })
                                .sort((left, right) => left.source.localeCompare(right.source) || left.status.localeCompare(right.status))
                        };
                    }

                    if (query.startsWith('WITH RECURSIVE days(day) AS')) {
                        return {
                            results: buildDailyRows(subscribers)
                        };
                    }

                    if (query.includes('SELECT id, email, status, subscribed_at, source, consent_version')) {
                        const filtered = filterSubscribers(query, this.args, subscribers);
                        const [limit, offset] = extractPagination(query, this.args);
                        const { column, direction } = extractSort(query);
                        const sorted = [...filtered].sort((left, right) => compareRows(left, right, column, direction));
                        return {
                            results: sorted.slice(offset, offset + limit)
                        };
                    }

                    throw new Error(`Unhandled all() query: ${query}`);
                }
            };
        }
    };

    return db;
}

function filterSubscribers(query, args, subscribers) {
    let bindIndex = 0;
    let rows = [...subscribers];

    if (query.includes('status = ?')) {
        const status = args[bindIndex];
        bindIndex += 1;
        rows = rows.filter((row) => row.status === status);
    }

    if (query.includes('source = ?')) {
        const source = args[bindIndex];
        rows = rows.filter((row) => row.source === source);
    }

    return rows;
}

function extractPagination(query, args) {
    const needsStatus = query.includes('status = ?');
    const needsSource = query.includes('source = ?');
    const offsetIndex = (needsStatus ? 1 : 0) + (needsSource ? 1 : 0);
    return [args[offsetIndex], args[offsetIndex + 1]];
}

function extractSort(query) {
    const match = query.match(/ORDER BY ([a-z_]+) (ASC|DESC), id (ASC|DESC)/i);
    return {
        column: match ? match[1] : 'subscribed_at',
        direction: match ? match[2].toLowerCase() : 'desc'
    };
}

function compareRows(left, right, column, direction) {
    const factor = direction === 'asc' ? 1 : -1;
    const leftValue = left[column];
    const rightValue = right[column];

    if (leftValue < rightValue) return -1 * factor;
    if (leftValue > rightValue) return 1 * factor;

    return (left.id - right.id) * factor;
}

function parseStatsJson(statsJson) {
    try {
        const parsed = JSON.parse(statsJson);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function nonNegativeInteger(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeStatsRecord(row) {
    const stats = parseStatsJson(row.stats_json);
    return {
        install_id: row.install_id,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        revision: row.revision,
        sessions: nonNegativeInteger(stats.sessions),
        studies_imported: nonNegativeInteger(stats.studiesImported)
    };
}

function buildStatsTotals(installs, args) {
    const [active24hSince, active7dSince, active30dSince] = args;
    return installs.reduce(
        (totals, row) => {
            const stats = parseStatsJson(row.stats_json);
            totals.installs_total += 1;
            totals.active_24h += Date.parse(row.last_seen) >= Date.parse(active24hSince) ? 1 : 0;
            totals.active_7d += Date.parse(row.last_seen) >= Date.parse(active7dSince) ? 1 : 0;
            totals.active_30d += Date.parse(row.last_seen) >= Date.parse(active30dSince) ? 1 : 0;
            totals.sessions_total += nonNegativeInteger(stats.sessions);
            totals.studies_total += nonNegativeInteger(stats.studiesImported);
            return totals;
        },
        {
            installs_total: 0,
            active_24h: 0,
            active_7d: 0,
            active_30d: 0,
            sessions_total: 0,
            studies_total: 0
        }
    );
}

function buildInstallDailyRows(installs, args) {
    const [startDay, todayDay] = args;
    const counts = new Map();
    for (const install of installs) {
        const day = new Date(install.created_at).toISOString().slice(0, 10);
        counts.set(day, (counts.get(day) || 0) + 1);
    }

    const today = new Date(`${todayDay}T00:00:00.000Z`);
    const start = new Date(`${startDay}T00:00:00.000Z`);
    const rows = [];
    for (const date = new Date(start); date <= today; date.setUTCDate(date.getUTCDate() + 1)) {
        const day = date.toISOString().slice(0, 10);
        rows.push({ day, count: counts.get(day) || 0 });
    }
    return rows;
}

function extractInstallSort(query) {
    const match = query.match(/ORDER BY ([a-z_]+) (ASC|DESC), install_id (ASC|DESC)/i);
    return {
        column: match ? match[1] : 'last_seen',
        direction: match ? match[2].toLowerCase() : 'desc'
    };
}

function compareInstallRows(left, right, column, direction) {
    const factor = direction === 'asc' ? 1 : -1;
    const leftValue = left[column];
    const rightValue = right[column];

    if (leftValue < rightValue) return -1 * factor;
    if (leftValue > rightValue) return 1 * factor;
    return left.install_id.localeCompare(right.install_id) * factor;
}

function buildDailyRows(subscribers) {
    const counts = new Map();
    for (const subscriber of subscribers) {
        const day = subscriber.subscribed_at.slice(0, 10);
        counts.set(day, (counts.get(day) || 0) + 1);
    }

    const today = new Date('2026-04-12T00:00:00Z');
    const rows = [];
    for (let index = 29; index >= 0; index -= 1) {
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() - index);
        const day = date.toISOString().slice(0, 10);
        rows.push({
            day,
            count: counts.get(day) || 0
        });
    }

    return rows;
}

function createRequest(path, { token = null, cookieToken = null, method = 'GET' } = {}) {
    const headers = new Headers();
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (cookieToken) {
        headers.set('Cookie', `myradone_dashboard_token=${encodeURIComponent(cookieToken)}`);
    }
    return new Request(`https://dashboard.myradone.com${path}`, {
        method,
        headers
    });
}

function extractCookieValue(setCookieHeader) {
    return decodeURIComponent(setCookieHeader.match(/myradone_dashboard_token=([^;]+)/)[1]);
}

test('authenticate rejects missing and wrong tokens, accepts matching token', async () => {
    const env = createEnv();

    assert.equal(await authenticate(createRequest(DASHBOARD_PATH), env), false);
    assert.equal(await authenticate(createRequest(DASHBOARD_PATH, { token: 'wrong' }), env), false);
    assert.equal(await authenticate(createRequest(DASHBOARD_PATH, { token: VALID_TEST_TOKEN }), env), true);

    const sessionLogin = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: VALID_TEST_TOKEN }),
        env,
        DASHBOARD_HTML
    );
    const cookieValue = extractCookieValue(sessionLogin.headers.get('Set-Cookie'));
    assert.match(cookieValue, /^v1\.\d+\.[0-9a-f]{64}$/);
    assert.equal(await verifySignedSessionValue(cookieValue, VALID_TEST_TOKEN), true);
    assert.equal(await authenticate(createRequest(DASHBOARD_PATH, { cookieToken: cookieValue }), env), true);
});

test('signed session values expire server-side', async () => {
    const nowMs = Date.UTC(2026, 3, 12, 12, 0, 0);
    const value = await createSignedSessionValue(VALID_TEST_TOKEN, nowMs);

    assert.equal(await verifySignedSessionValue(value, VALID_TEST_TOKEN, nowMs + 1_000), true);
    assert.equal(
        await verifySignedSessionValue(value, VALID_TEST_TOKEN, nowMs + 12 * 60 * 60 * 1000 + 1),
        false
    );
});

test('tampered session values are rejected', async () => {
    const value = await createSignedSessionValue(VALID_TEST_TOKEN, Date.UTC(2026, 3, 12, 12, 0, 0));
    const tampered = value.replace(/\.[0-9a-f]{64}$/, '.'.concat('0'.repeat(64)));

    assert.equal(await verifySignedSessionValue(tampered, VALID_TEST_TOKEN), false);
});

test('malformed session values are rejected', async () => {
    assert.equal(await verifySignedSessionValue('v1.123abc.'.concat('0'.repeat(64)), VALID_TEST_TOKEN), false);
    assert.equal(await verifySignedSessionValue('v1.123456.short', VALID_TEST_TOKEN), false);
});

test('handleDashboard returns login page without auth and shell with auth', async () => {
    const env = createEnv();

    const loginResponse = await handleDashboard(createRequest(DASHBOARD_PATH), env, DASHBOARD_HTML);
    assert.equal(loginResponse.status, 200);
    const loginHtml = await loginResponse.text();
    assert.match(loginHtml, /Open dashboard/);
    assert.match(loginResponse.headers.get('Set-Cookie'), /Max-Age=0/);

    const sessionLogin = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: VALID_TEST_TOKEN }),
        env,
        REAL_DASHBOARD_HTML
    );
    const cookieValue = extractCookieValue(sessionLogin.headers.get('Set-Cookie'));
    const shellResponse = await handleDashboard(createRequest(DASHBOARD_PATH, { cookieToken: cookieValue }), env, REAL_DASHBOARD_HTML);
    assert.equal(shellResponse.status, 200);
    const shellHtml = await shellResponse.text();
    assert.match(shellHtml, /data-dashboard-shell="true"/);
    assert.match(shellResponse.headers.get('Content-Security-Policy'), /script-src 'sha256-/);
    assert.doesNotMatch(shellResponse.headers.get('Content-Security-Policy'), /script-src 'unsafe-inline'/);

    const loginScriptHash = sha256Base64(extractInlineScript(loginHtml));
    assert.match(loginResponse.headers.get('Content-Security-Policy'), new RegExp(loginScriptHash.replaceAll('+', '\\+').replaceAll('/', '\\/')));

    const dashboardScriptHash = sha256Base64(extractInlineScript(shellHtml));
    assert.match(shellResponse.headers.get('Content-Security-Policy'), new RegExp(dashboardScriptHash.replaceAll('+', '\\+').replaceAll('/', '\\/')));
});

test('handleSummary returns empty shapes on an empty database', async () => {
    const env = createEnv({ subscribers: [] });
    const payload = await handleSummary(env);

    assert.deepEqual(payload.counts, {
        total: 0,
        active: 0,
        unsubscribed: 0
    });
    assert.equal(payload.sources.length, 3);
    assert.equal(payload.daily.length, 30);
});

test('handleStatsSummary returns zero shape and 30 UTC days on an empty database', async () => {
    const env = createEnv({ installs: [] });
    const payload = await handleStatsSummary(env, { now: '2026-05-02T15:45:00.000Z' });

    assert.deepEqual(payload.installs, {
        total: 0,
        active_24h: 0,
        active_7d: 0,
        active_30d: 0
    });
    assert.deepEqual(payload.sessions, { total: 0 });
    assert.deepEqual(payload.studies, { total: 0 });
    assert.equal(payload.new_installs_daily.length, 30);
    assert.equal(payload.new_installs_daily.at(0).day, '2026-04-03');
    assert.equal(payload.new_installs_daily.at(-1).day, '2026-05-02');
    assert.deepEqual(payload.new_installs_daily.map((row) => row.count), Array(30).fill(0));
    assert.deepEqual(
        [...payload.new_installs_daily].sort((left, right) => left.day.localeCompare(right.day)),
        payload.new_installs_daily
    );
});

test('handleStatsSummary aggregates seeded installs defensively', async () => {
    const env = createEnv({
        installs: [
            {
                installationId: '11111111-1111-4111-8111-111111111111',
                revision: 3,
                firstSeen: '2026-04-01T00:00:00.000Z',
                lastSeen: '2026-05-02T10:00:00.000Z',
                createdAt: '2026-04-01T00:00:00.000Z',
                sessions: 4,
                studiesImported: 10
            },
            {
                installationId: '22222222-2222-4222-8222-222222222222',
                revision: 5,
                firstSeen: '2026-03-01T00:00:00.000Z',
                lastSeen: '2026-04-29T10:00:00.000Z',
                createdAt: '2026-05-01T04:00:00.000Z',
                sessions: 7,
                studiesImported: 2
            },
            {
                installationId: '33333333-3333-4333-8333-333333333333',
                revision: 9,
                firstSeen: '2026-05-02T00:00:00.000Z',
                lastSeen: '2026-03-01T00:00:00.000Z',
                createdAt: '2026-05-02T03:00:00.000Z',
                statsJson: '{malformed-json'
            }
        ]
    });

    const payload = await handleStatsSummary(env, { now: '2026-05-02T12:00:00.000Z' });

    assert.deepEqual(payload.installs, {
        total: 3,
        active_24h: 1,
        active_7d: 2,
        active_30d: 2
    });
    assert.deepEqual(payload.sessions, { total: 11 });
    assert.deepEqual(payload.studies, { total: 12 });
    assert.equal(payload.new_installs_daily.find((row) => row.day === '2026-05-01').count, 1);
    assert.equal(payload.new_installs_daily.find((row) => row.day === '2026-05-02').count, 1);
});

test('new installs daily uses created_at rather than first_seen', async () => {
    const env = createEnv({
        installs: [
            {
                installationId: '44444444-4444-4444-8444-444444444444',
                firstSeen: '2026-05-02T11:00:00.000Z',
                lastSeen: '2026-05-02T11:00:00.000Z',
                createdAt: '2026-04-20T03:00:00.000Z',
                sessions: 1,
                studiesImported: 1
            }
        ]
    });

    const payload = await handleStatsSummary(env, { now: '2026-05-02T12:00:00.000Z' });

    assert.equal(payload.new_installs_daily.find((row) => row.day === '2026-04-20').count, 1);
    assert.equal(payload.new_installs_daily.find((row) => row.day === '2026-05-02').count, 0);
});

test('handleSubscribers rejects invalid filters and sort params', async () => {
    const env = createEnv();

    await assert.rejects(
        () => handleSubscribers(createRequest(`${SUBSCRIBERS_PATH}?status=bad`), env),
        /Invalid status filter/
    );
    await assert.rejects(
        () => handleSubscribers(createRequest(`${SUBSCRIBERS_PATH}?source=other`), env),
        /Invalid source filter/
    );
    await assert.rejects(
        () => handleSubscribers(createRequest(`${SUBSCRIBERS_PATH}?sort=created_at`), env),
        /Invalid sort column/
    );
    await assert.rejects(
        () => handleSubscribers(createRequest(`${SUBSCRIBERS_PATH}?order=sideways`), env),
        /Invalid sort order/
    );
});

test('handleSubscribers enforces per_page <= 100', async () => {
    const env = createEnv();

    await assert.rejects(
        () => handleSubscribers(createRequest(`${SUBSCRIBERS_PATH}?per_page=101`), env),
        /Integer parameter out of range/
    );
});

test('handleSubscribers invalid integer errors do not reflect raw input', async () => {
    const env = createEnv();
    const request = createRequest(`${SUBSCRIBERS_PATH}?page=%3Cscript%3Ealert(1)%3C/script%3E`, {
        cookieToken: VALID_TEST_TOKEN
    });

    let response = null;
    try {
        await handleSubscribers(request, env);
    } catch (error) {
        response = await createErrorResponse(request, error);
    }

    assert.ok(response);
    assert.deepEqual(await response.json(), { error: 'Invalid integer parameter' });
});

test('handleSubscribers paginates and sorts seeded subscribers', async () => {
    const env = createEnv({
        subscribers: [
            { email: 'zeta@example.com', source: 'demo', subscribed_at: '2026-04-10 08:00:00' },
            { email: 'alpha@example.com', source: 'landing', subscribed_at: '2026-04-12 09:00:00' },
            { email: 'beta@example.com', source: 'app', status: 'unsubscribed', subscribed_at: '2026-04-11 07:00:00' }
        ]
    });

    const payload = await handleSubscribers(
        createRequest(`${SUBSCRIBERS_PATH}?sort=email&order=asc&per_page=2&page=1`),
        env
    );

    assert.equal(payload.subscribers.length, 2);
    assert.equal(payload.subscribers[0].email, 'alpha@example.com');
    assert.equal(payload.pagination.total, 3);
    assert.equal(payload.pagination.total_pages, 2);
});

test('handleStatsInstalls paginates, sorts, and redacts install identifiers', async () => {
    const fullId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const env = createEnv({
        installs: [
            {
                installationId: fullId,
                revision: 1,
                firstSeen: '2026-04-01T01:00:00.000Z',
                lastSeen: '2026-05-01T01:00:00.000Z',
                sessions: 9,
                studiesImported: 3
            },
            {
                installationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                revision: 2,
                firstSeen: '2026-04-02T01:00:00.000Z',
                lastSeen: '2026-05-02T01:00:00.000Z',
                sessions: 2,
                studiesImported: 4
            },
            {
                installationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                revision: 3,
                firstSeen: '2026-04-03T01:00:00.000Z',
                lastSeen: '2026-04-30T01:00:00.000Z',
                sessions: 5,
                studiesImported: 6
            }
        ]
    });

    const payload = await handleStatsInstalls(
        createRequest(`${STATS_INSTALLS_PATH}?sort=sessions&order=desc&per_page=2&page=1`),
        env
    );
    const serialized = JSON.stringify(payload);

    assert.equal(payload.installs.length, 2);
    assert.equal(payload.installs[0].install_id_prefix, 'aaaaaaaa');
    assert.equal(payload.installs[0].install_id_prefix.length, 8);
    assert.equal(payload.installs[0].sessions, 9);
    assert.equal(Object.hasOwn(payload.installs[0], 'version'), false);
    assert.deepEqual(payload.pagination, {
        page: 1,
        per_page: 2,
        total: 3,
        total_pages: 2
    });
    assert.doesNotMatch(serialized, new RegExp(fullId));
    assert.doesNotMatch(serialized, /installationId/);
    assert.doesNotMatch(serialized, /install_id"/);
    assert.doesNotMatch(serialized, /"version"/);
});

test('handleStatsInstalls returns field-specific 400 payloads for invalid params', async () => {
    const env = createEnv();
    const cases = [
        [`${STATS_INSTALLS_PATH}?page=0`, 'page'],
        [`${STATS_INSTALLS_PATH}?per_page=200`, 'per_page'],
        [`${STATS_INSTALLS_PATH}?sort=unknown`, 'sort'],
        [`${STATS_INSTALLS_PATH}?order=sideways`, 'order']
    ];

    for (const [path, field] of cases) {
        let response = null;
        const request = createRequest(path, { token: VALID_TEST_TOKEN });
        try {
            await handleStatsInstalls(request, env);
        } catch (error) {
            response = await createErrorResponse(request, error);
        }

        assert.ok(response);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).field, field);
    }
});

test('dispatchRequest returns 401 for unauthenticated API requests and 429 when rate-limited', async () => {
    const env = createEnv();

    const unauthorized = await dispatchRequest(createRequest(SUMMARY_PATH), env, DASHBOARD_HTML);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: 'Unauthorized' });
    assert.match(unauthorized.headers.get('Set-Cookie'), /Max-Age=0/);

    const rateLimitedEnv = createEnv({ rateLimitSuccess: false });
    const rateLimited = await dispatchRequest(createRequest(SUMMARY_PATH), rateLimitedEnv, DASHBOARD_HTML);
    assert.equal(rateLimited.status, 429);
});

test('dispatchRequest returns 401 for unauthenticated stats endpoints', async () => {
    const env = createEnv();

    for (const path of [STATS_SUMMARY_PATH, STATS_INSTALLS_PATH]) {
        const response = await dispatchRequest(createRequest(path), env, DASHBOARD_HTML);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
});

test('dispatchRequest creates and clears dashboard sessions', async () => {
    const env = createEnv();

    const loginResponse = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: VALID_TEST_TOKEN }),
        env,
        DASHBOARD_HTML
    );
    assert.equal(loginResponse.status, 204);
    assert.match(loginResponse.headers.get('Set-Cookie'), /HttpOnly/);
    assert.match(loginResponse.headers.get('Set-Cookie'), /Expires=/);
    assert.match(loginResponse.headers.get('Set-Cookie'), /myradone_dashboard_token=/);

    const rejectedLogin = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: 'wrong' }),
        env,
        DASHBOARD_HTML
    );
    assert.equal(rejectedLogin.status, 401);
    assert.equal(rejectedLogin.headers.get('WWW-Authenticate'), 'Bearer realm="myradone-dashboard"');

    const logoutResponse = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'DELETE' }),
        env,
        DASHBOARD_HTML
    );
    assert.equal(logoutResponse.status, 204);
    assert.match(logoutResponse.headers.get('Set-Cookie'), /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(logoutResponse.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('POST /api/session returns 503, not 401, when DASHBOARD_TOKEN is empty', async () => {
    const response = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: VALID_TEST_TOKEN }),
        createEnv({ token: '' }),
        DASHBOARD_HTML
    );

    assert.equal(response.status, 503);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.deepEqual(await response.json(), {
        error: 'Dashboard misconfigured',
        reason: 'DASHBOARD_TOKEN is empty'
    });
});

test('POST /api/session returns 503 when DASHBOARD_TOKEN is unset', async () => {
    const response = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: VALID_TEST_TOKEN }),
        createEnv({ token: undefined }),
        DASHBOARD_HTML
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
        error: 'Dashboard misconfigured',
        reason: 'DASHBOARD_TOKEN is unset'
    });
});

test('POST /api/session returns 503 when DASHBOARD_TOKEN is too short', async () => {
    const response = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: VALID_TEST_TOKEN }),
        createEnv({ token: 'too-short-dashboard' }),
        DASHBOARD_HTML
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
        error: 'Dashboard misconfigured',
        reason: 'DASHBOARD_TOKEN is too short (length < 32)'
    });
});

test('logout is not blocked by the dashboard rate limiter', async () => {
    const env = createEnv({ rateLimitSuccess: false });
    const response = await dispatchRequest(createRequest(SESSION_PATH, { method: 'DELETE' }), env, DASHBOARD_HTML);

    assert.equal(response.status, 204);
});

test('logout still clears cookies while the dashboard is misconfigured', async () => {
    const response = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'DELETE' }),
        createEnv({ token: '' }),
        DASHBOARD_HTML
    );

    assert.equal(response.status, 204);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('dispatchRequest returns a dedicated misconfig page for GET /', async () => {
    const response = await dispatchRequest(createRequest(DASHBOARD_PATH), createEnv({ token: '' }), DASHBOARD_HTML);
    const html = await response.text();

    assert.equal(response.status, 503);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.match(html, /Dashboard unavailable/);
    assert.match(html, /DASHBOARD_TOKEN is empty/);
    assert.doesNotMatch(html, /id="tokenInput"/);
});

test('GET /api/config returns trimmed token metadata with a SHA-256 fingerprint prefix', async () => {
    const tokenWithWhitespace = `  ${VALID_TEST_TOKEN}  `;
    const response = await dispatchRequest(createRequest(CONFIG_PATH), createEnv({ token: tokenWithWhitespace }), DASHBOARD_HTML);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
        status: 'ok',
        token_configured: true,
        token_length: VALID_TEST_TOKEN.length,
        token_fingerprint_sha256_prefix: sha256Hex(VALID_TEST_TOKEN).slice(0, 12)
    });
    assert.match(payload.token_fingerprint_sha256_prefix, /^[0-9a-f]{12}$/);
});

test('GET /api/config returns the standard 503 misconfig payload without clearing cookies', async () => {
    const response = await dispatchRequest(createRequest(CONFIG_PATH), createEnv({ token: '' }), DASHBOARD_HTML);

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.deepEqual(await response.json(), {
        error: 'Dashboard misconfigured',
        reason: 'DASHBOARD_TOKEN is empty'
    });
});

test('GET /api/config bypasses the dashboard rate limiter', async () => {
    const response = await dispatchRequest(
        createRequest(CONFIG_PATH),
        createEnv({ rateLimitSuccess: false }),
        DASHBOARD_HTML
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
});

test('readonlySelect accepts read-only SELECT and WITH forms', async () => {
    const db = createStatsDb([]);
    const accepted = [
        'SELECT 1',
        'select 1',
        'SeLeCt 1',
        'WITH rows AS (SELECT 1) SELECT * FROM rows',
        '   SELECT 1',
        '-- leading comment\nSELECT 1',
        '/* leading block */ SELECT 1'
    ];

    for (const sql of accepted) {
        assert.doesNotThrow(() => readonlySelect(db, sql));
    }
});

test('readonlySelect rejects mutation keywords, semicolons, and comment-cloaked attacks', async () => {
    const db = createStatsDb([]);
    const rejected = [
        'INSERT INTO installs DEFAULT VALUES',
        'UPDATE installs SET revision = 1',
        'DELETE FROM installs',
        'DROP TABLE installs',
        'ALTER TABLE installs ADD COLUMN x TEXT',
        'CREATE TABLE x (id INTEGER)',
        'TRUNCATE TABLE installs',
        'REPLACE INTO installs DEFAULT VALUES',
        'ATTACH DATABASE "x" AS x',
        'DETACH DATABASE x',
        'PRAGMA table_info(installs)',
        'VACUUM',
        'REINDEX',
        'SELECT 1; SELECT 2',
        '/* comment */ UPDATE installs SET revision = 1',
        'SEL/*comment*/ECT 1',
        'ＵＰＤＡＴＥ installs SET revision = 1',
        'WITH rows AS (SELECT 1) DELETE FROM installs'
    ];

    for (const sql of rejected) {
        assert.throws(() => readonlySelect(db, sql), /readonlySelect/);
    }
});

test('dashboard worker routes D1 prepare calls through readonlySelect', () => {
    const source = fs.readFileSync(new URL('../workers/dashboard/src/lib.mjs', import.meta.url), 'utf8');
    const prepareMatches = [...source.matchAll(/\.prepare\(/g)];

    assert.equal(prepareMatches.length, 1);
    assert.match(
        source.slice(Math.max(0, prepareMatches[0].index - 300), prepareMatches[0].index + 300),
        /function readonlySelect/
    );
});

test('stats aggregate queries are independently read-only valid', async () => {
    const env = createEnv({
        installs: [
            {
                installationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                lastSeen: '2026-05-02T10:00:00.000Z',
                createdAt: '2026-05-02T10:00:00.000Z',
                sessions: 1,
                studiesImported: 1
            }
        ]
    });

    await handleStatsSummary(env, { now: '2026-05-02T12:00:00.000Z' });

    for (const sql of env.STATS_DB.recordedQueries) {
        const validationDb = {
            prepare() {
                return {
                    bind() {
                        return this;
                    },
                    first() {},
                    all() {}
                };
            }
        };
        assert.doesNotThrow(() => readonlySelect(validationDb, sql));
    }
});

test('tampered dashboard cookies fall back to login and get cleared', async () => {
    const env = createEnv();
    const response = await handleDashboard(
        createRequest(DASHBOARD_PATH, { cookieToken: 'v1.9999999999999.'.concat('0'.repeat(64)) }),
        env,
        REAL_DASHBOARD_HTML
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.match(await response.text(), /Open dashboard/);
});

test('createErrorResponse turns unexpected failures into JSON 500 payloads', async () => {
    const request = createRequest(SUBSCRIBERS_PATH);
    const originalConsoleError = console.error;
    console.error = () => {};

    const response = await createErrorResponse(request, new Error('boom'));

    console.error = originalConsoleError;

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Server error' });
});
