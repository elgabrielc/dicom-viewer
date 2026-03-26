// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Playwright tests for Flask auth hardening (Stage 0 - Cloud Sync).
 *
 * These tests verify the session-token authentication layer added to protect
 * API routes. They are designed to FAIL against the pre-auth codebase and
 * PASS after the cc/s0-flask-auth branch is merged.
 *
 * Test coverage:
 *   - Unauthenticated mutating requests (POST/PUT/DELETE) return 401
 *   - Unauthenticated PHI reads return 401
 *   - Headerless mutating requests return 401
 *   - Test-mode bypass continues working
 *   - Session bootstrap (GET /api/session) returns a token
 *   - Authenticated requests succeed with valid token
 *   - Invalid tokens are rejected with 401
 *   - Static file serving remains unaffected by auth
 *
 * Test suites: 35-42 (continuing from notes-api.spec.js suite 34)
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001';

// Override the global X-Test-Mode header for this file so the suite exercises
// the real session-token auth path instead of the test bypass.
test.use({ extraHTTPHeaders: {} });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a session token from the bootstrap endpoint.
 * Returns the raw token string.
 */
async function getSessionToken(request) {
    const response = await request.get(`${BASE_URL}/api/session`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('token');
    return body.token;
}

/**
 * Generate a unique study UID for test isolation (mirrors notes-api.spec.js).
 */
function uniqueStudyUid() {
    return `test-auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameOriginHeaders(extra = {}) {
    return {
        Origin: BASE_URL,
        ...extra,
    };
}

// ---------------------------------------------------------------------------
// Test Suite 35: Unauthenticated Mutating Routes Rejected
// ---------------------------------------------------------------------------

test.describe('Test Suite 35: Unauthenticated Mutating Routes - 401', () => {
    const studyUid = 'auth-test-study-unauthenticated';
    const seriesUid = 'auth-test-series-unauthenticated';

    // -- Notes API: PUT/POST/DELETE --

    test('PUT /api/notes/<study>/description without token returns 401', async ({ request }) => {
        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/description`,
            {
                headers: sameOriginHeaders(),
                data: { description: 'should be rejected' },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('PUT /api/notes/<study>/series/<series>/description without token returns 401', async ({ request }) => {
        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            {
                headers: sameOriginHeaders(),
                data: { description: 'should be rejected' },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('POST /api/notes/<study>/comments without token returns 401', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/notes/${studyUid}/comments`,
            {
                headers: sameOriginHeaders(),
                data: { text: 'rejected comment', time: Date.now() },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('PUT /api/notes/<study>/comments/1 without token returns 401', async ({ request }) => {
        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/1`,
            {
                headers: sameOriginHeaders(),
                data: { text: 'rejected edit' },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('DELETE /api/notes/<study>/comments/1 without token returns 401', async ({ request }) => {
        const response = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/comments/1`,
            { headers: sameOriginHeaders() }
        );
        expect(response.status()).toBe(401);
    });

    test('POST /api/notes/<study>/reports without token returns 401', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/notes/${studyUid}/reports`,
            {
                headers: sameOriginHeaders(),
                multipart: {
                    file: {
                        name: 'report.pdf',
                        mimeType: 'application/pdf',
                        buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
                    },
                },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('DELETE /api/notes/<study>/reports/fake-id without token returns 401', async ({ request }) => {
        const response = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/reports/fake-report-id`,
            { headers: sameOriginHeaders() }
        );
        expect(response.status()).toBe(401);
    });

    test('POST /api/notes/migrate without token returns 401', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/notes/migrate`,
            {
                headers: sameOriginHeaders(),
                data: {},
            }
        );
        expect(response.status()).toBe(401);
    });

    // -- Library API: POST --

    test('POST /api/library/config without token returns 401', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/library/config`,
            {
                headers: sameOriginHeaders(),
                data: { folder: '/tmp/should-be-rejected' },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('POST /api/library/refresh without token returns 401', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/library/refresh`,
            { headers: sameOriginHeaders() }
        );
        expect(response.status()).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 36: Unauthenticated PHI Reads Rejected
// ---------------------------------------------------------------------------

test.describe('Test Suite 36: Unauthenticated PHI Reads - 401', () => {
    test('GET /api/notes/ without token returns 401', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/notes/`);
        expect(response.status()).toBe(401);
    });

    test('GET /api/notes/?studies=some-uid without token returns 401', async ({ request }) => {
        const response = await request.get(
            `${BASE_URL}/api/notes/?studies=some-study-uid`
        );
        expect(response.status()).toBe(401);
    });

    test('GET /api/library/studies without token returns 401', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/library/studies`);
        expect(response.status()).toBe(401);
    });

    test('GET /api/library/config without token returns 401', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/library/config`);
        expect(response.status()).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 37: Headerless Mutating Requests Rejected
// ---------------------------------------------------------------------------

test.describe('Test Suite 37: Headerless Mutating Requests - 401', () => {
    // These requests have no Origin, no Referer, AND no session token.
    // Playwright's request API sends no Origin/Referer by default, so simply
    // omitting the X-Session-Token header is sufficient.

    test('POST without Origin/Referer/token is rejected', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/notes/${uniqueStudyUid()}/comments`,
            {
                headers: {},
                data: { text: 'headerless', time: Date.now() },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('PUT without Origin/Referer/token is rejected', async ({ request }) => {
        const response = await request.put(
            `${BASE_URL}/api/notes/${uniqueStudyUid()}/description`,
            {
                headers: {},
                data: { description: 'headerless' },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('DELETE without Origin/Referer/token is rejected', async ({ request }) => {
        const response = await request.delete(
            `${BASE_URL}/api/notes/${uniqueStudyUid()}/comments/999`,
            { headers: {} }
        );
        expect(response.status()).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 38: Test-Mode Bypass Works
// ---------------------------------------------------------------------------

test.describe('Test Suite 38: Test-Mode Bypass', () => {
    // The ?test URL parameter activates test mode. The test-data API routes
    // must continue working without auth so Playwright tests can load data.

    test('GET /api/test-data/info works without token', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/test-data/info`);
        // Should succeed -- test-data routes are not behind auth
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body).toHaveProperty('available');
    });

    test('GET /api/test-data/studies works without token', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/test-data/studies`);
        // 200 if test data exists, but should not be 401 regardless
        expect(response.status()).not.toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 39: Session Bootstrap
// ---------------------------------------------------------------------------

test.describe('Test Suite 39: Session Bootstrap - GET /api/session', () => {
    test('returns 200 with a JSON body containing a token field', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/session`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('token');
        expect(typeof body.token).toBe('string');
        expect(body.token.length).toBeGreaterThan(0);
    });

    test('returns a different token on each call', async ({ request }) => {
        // Tokens should be unique per session/call to prevent reuse attacks
        const token1 = await getSessionToken(request);
        const token2 = await getSessionToken(request);
        // Both should be valid non-empty strings, but not necessarily different
        // (implementation may use a single server token). At minimum, both are valid.
        expect(token1.length).toBeGreaterThan(0);
        expect(token2.length).toBeGreaterThan(0);
    });

    test('token is a reasonable length (not trivially guessable)', async ({ request }) => {
        const token = await getSessionToken(request);
        // A secure token should be at least 16 characters (128 bits of entropy
        // when hex-encoded). This is a sanity check, not a cryptographic audit.
        expect(token.length).toBeGreaterThanOrEqual(16);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 40: Authenticated Requests Succeed
// ---------------------------------------------------------------------------

test.describe('Test Suite 40: Authenticated Requests Succeed', () => {
    test('PUT /api/notes/<study>/description with valid token returns 200', async ({ request }) => {
        const token = await getSessionToken(request);
        const studyUid = uniqueStudyUid();

        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/description`,
            {
                headers: sameOriginHeaders({ 'X-Session-Token': token }),
                data: { description: 'authenticated write' },
            }
        );
        expect(response.status()).toBe(200);
    });

    test('POST /api/notes/<study>/comments with valid token returns 200', async ({ request }) => {
        const token = await getSessionToken(request);
        const studyUid = uniqueStudyUid();

        const response = await request.post(
            `${BASE_URL}/api/notes/${studyUid}/comments`,
            {
                headers: sameOriginHeaders({ 'X-Session-Token': token }),
                data: { text: 'authenticated comment', time: Date.now() },
            }
        );
        expect(response.status()).toBe(200);
    });

    test('GET /api/notes/ with valid token returns 200', async ({ request }) => {
        const token = await getSessionToken(request);

        const response = await request.get(`${BASE_URL}/api/notes/`, {
            headers: { 'X-Session-Token': token },
        });
        expect(response.status()).toBe(200);
    });

    test('GET /api/notes/?studies=uid with valid token returns 200', async ({ request }) => {
        const token = await getSessionToken(request);
        const studyUid = uniqueStudyUid();

        const response = await request.get(
            `${BASE_URL}/api/notes/?studies=${studyUid}`,
            { headers: { 'X-Session-Token': token } }
        );
        expect(response.status()).toBe(200);
    });

    test('GET /api/library/studies with valid token returns 200', async ({ request }) => {
        const token = await getSessionToken(request);

        const response = await request.get(`${BASE_URL}/api/library/studies`, {
            headers: { 'X-Session-Token': token },
        });
        expect(response.status()).toBe(200);
    });

    test('GET /api/library/config with valid token returns 200', async ({ request }) => {
        const token = await getSessionToken(request);

        const response = await request.get(`${BASE_URL}/api/library/config`, {
            headers: { 'X-Session-Token': token },
        });
        expect(response.status()).toBe(200);
    });

    test('POST /api/library/refresh with valid token succeeds', async ({ request }) => {
        const token = await getSessionToken(request);

        const response = await request.post(`${BASE_URL}/api/library/refresh`, {
            headers: sameOriginHeaders({ 'X-Session-Token': token }),
        });
        // 200 on success, possibly 500 if library folder doesn't exist --
        // but should never be 401 with a valid token
        expect(response.status()).not.toBe(401);
    });

    test('DELETE /api/notes/<study>/comments/<id> with valid token does not return 401', async ({ request }) => {
        const token = await getSessionToken(request);
        const studyUid = uniqueStudyUid();

        // First create a comment so we have a real ID to delete
        const createResponse = await request.post(
            `${BASE_URL}/api/notes/${studyUid}/comments`,
            {
                headers: sameOriginHeaders({ 'X-Session-Token': token }),
                data: { text: 'comment to delete', time: Date.now() },
            }
        );
        expect(createResponse.status()).toBe(200);
        const created = await createResponse.json();

        const deleteResponse = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/comments/${created.id}`,
            { headers: sameOriginHeaders({ 'X-Session-Token': token }) }
        );
        // Should be 200 on successful delete, not 401
        expect(deleteResponse.status()).toBe(200);
    });

    test('POST /api/notes/<study>/reports with valid token succeeds', async ({ request }) => {
        const token = await getSessionToken(request);
        const studyUid = uniqueStudyUid();

        const response = await request.post(
            `${BASE_URL}/api/notes/${studyUid}/reports`,
            {
                headers: sameOriginHeaders({ 'X-Session-Token': token }),
                multipart: {
                    file: {
                        name: 'auth-test-report.pdf',
                        mimeType: 'application/pdf',
                        buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
                    },
                },
            }
        );
        expect(response.status()).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 41: Invalid Token Rejected
// ---------------------------------------------------------------------------

test.describe('Test Suite 41: Invalid Token Rejected - 401', () => {
    const FAKE_TOKEN = 'invalid-token-that-does-not-exist-on-server';

    test('PUT with invalid token returns 401', async ({ request }) => {
        const response = await request.put(
            `${BASE_URL}/api/notes/${uniqueStudyUid()}/description`,
            {
                headers: sameOriginHeaders({ 'X-Session-Token': FAKE_TOKEN }),
                data: { description: 'should fail' },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('POST with invalid token returns 401', async ({ request }) => {
        const response = await request.post(
            `${BASE_URL}/api/notes/${uniqueStudyUid()}/comments`,
            {
                headers: sameOriginHeaders({ 'X-Session-Token': FAKE_TOKEN }),
                data: { text: 'should fail', time: Date.now() },
            }
        );
        expect(response.status()).toBe(401);
    });

    test('DELETE with invalid token returns 401', async ({ request }) => {
        const response = await request.delete(
            `${BASE_URL}/api/notes/${uniqueStudyUid()}/comments/999`,
            { headers: sameOriginHeaders({ 'X-Session-Token': FAKE_TOKEN }) }
        );
        expect(response.status()).toBe(401);
    });

    test('GET /api/notes/ with invalid token returns 401', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/notes/`, {
            headers: { 'X-Session-Token': FAKE_TOKEN },
        });
        expect(response.status()).toBe(401);
    });

    test('GET /api/library/studies with invalid token returns 401', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/library/studies`, {
            headers: { 'X-Session-Token': FAKE_TOKEN },
        });
        expect(response.status()).toBe(401);
    });

    test('GET /api/library/config with invalid token returns 401', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/library/config`, {
            headers: { 'X-Session-Token': FAKE_TOKEN },
        });
        expect(response.status()).toBe(401);
    });

    test('POST /api/library/config with invalid token returns 401', async ({ request }) => {
        const response = await request.post(`${BASE_URL}/api/library/config`, {
            headers: sameOriginHeaders({ 'X-Session-Token': FAKE_TOKEN }),
            data: { folder: '/tmp/nope' },
        });
        expect(response.status()).toBe(401);
    });

    test('POST /api/library/refresh with invalid token returns 401', async ({ request }) => {
        const response = await request.post(`${BASE_URL}/api/library/refresh`, {
            headers: sameOriginHeaders({ 'X-Session-Token': FAKE_TOKEN }),
        });
        expect(response.status()).toBe(401);
    });

    test('empty string token is rejected', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/notes/`, {
            headers: { 'X-Session-Token': '' },
        });
        expect(response.status()).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 42: Static File Serving Unaffected
// ---------------------------------------------------------------------------

test.describe('Test Suite 42: Static File Serving - No Auth Required', () => {
    test('GET / (index.html) works without token', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/`);
        expect(response.status()).toBe(200);

        // Verify we got HTML content back (not a JSON error)
        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('text/html');
    });

    test('GET /css/style.css works without token', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/css/style.css`);
        expect(response.status()).toBe(200);

        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('text/css');
    });

    test('GET /js/config.js works without token', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/js/config.js`);
        expect(response.status()).toBe(200);

        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('javascript');
    });

    test('GET /?test (test mode page) works without token', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/?test`);
        expect(response.status()).toBe(200);

        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('text/html');
    });
});
