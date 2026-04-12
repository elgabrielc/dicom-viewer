import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
    DASHBOARD_PATH,
    SESSION_PATH,
    SUMMARY_PATH,
    SUBSCRIBERS_PATH,
    authenticate,
    createSignedSessionValue,
    createErrorResponse,
    dispatchRequest,
    handleDashboard,
    handleSubscribers,
    handleSummary,
    verifySignedSessionValue
} from '../workers/dashboard/src/lib.mjs';

const DASHBOARD_HTML = '<!doctype html><html><body data-dashboard-shell="true">dashboard</body></html>';
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

function createEnv({ subscribers = [], token = 'secret-token', rateLimitSuccess = true } = {}) {
    return {
        DASHBOARD_TOKEN: token,
        DASHBOARD_RATE_LIMIT: {
            async limit() {
                return { success: rateLimitSuccess };
            }
        },
        SUBSCRIBERS_DB: createDb(subscribers)
    };
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

    return {
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
    assert.equal(await authenticate(createRequest(DASHBOARD_PATH, { token: 'secret-token' }), env), true);

    const sessionLogin = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: 'secret-token' }),
        env,
        DASHBOARD_HTML
    );
    const cookieValue = extractCookieValue(sessionLogin.headers.get('Set-Cookie'));
    assert.match(cookieValue, /^v1\.\d+\.[0-9a-f]{64}$/);
    assert.equal(await verifySignedSessionValue(cookieValue, 'secret-token'), true);
    assert.equal(await authenticate(createRequest(DASHBOARD_PATH, { cookieToken: cookieValue }), env), true);
});

test('signed session values expire server-side', async () => {
    const nowMs = Date.UTC(2026, 3, 12, 12, 0, 0);
    const value = await createSignedSessionValue('secret-token', nowMs);

    assert.equal(await verifySignedSessionValue(value, 'secret-token', nowMs + 1_000), true);
    assert.equal(
        await verifySignedSessionValue(value, 'secret-token', nowMs + 12 * 60 * 60 * 1000 + 1),
        false
    );
});

test('tampered session values are rejected', async () => {
    const value = await createSignedSessionValue('secret-token', Date.UTC(2026, 3, 12, 12, 0, 0));
    const tampered = value.replace(/\.[0-9a-f]{64}$/, '.'.concat('0'.repeat(64)));

    assert.equal(await verifySignedSessionValue(tampered, 'secret-token'), false);
});

test('malformed session values are rejected', async () => {
    assert.equal(await verifySignedSessionValue('v1.123abc.'.concat('0'.repeat(64)), 'secret-token'), false);
    assert.equal(await verifySignedSessionValue('v1.123456.short', 'secret-token'), false);
});

test('handleDashboard returns login page without auth and shell with auth', async () => {
    const env = createEnv();

    const loginResponse = await handleDashboard(createRequest(DASHBOARD_PATH), env, DASHBOARD_HTML);
    assert.equal(loginResponse.status, 200);
    const loginHtml = await loginResponse.text();
    assert.match(loginHtml, /Open dashboard/);
    assert.match(loginResponse.headers.get('Set-Cookie'), /Max-Age=0/);

    const sessionLogin = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: 'secret-token' }),
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
        cookieToken: 'secret-token'
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

test('dispatchRequest creates and clears dashboard sessions', async () => {
    const env = createEnv();

    const loginResponse = await dispatchRequest(
        createRequest(SESSION_PATH, { method: 'POST', token: 'secret-token' }),
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

test('logout is not blocked by the dashboard rate limiter', async () => {
    const env = createEnv({ rateLimitSuccess: false });
    const response = await dispatchRequest(createRequest(SESSION_PATH, { method: 'DELETE' }), env, DASHBOARD_HTML);

    assert.equal(response.status, 204);
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
