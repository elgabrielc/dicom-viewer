// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Auth rate-limiting edge cases for POST /api/auth/login and POST /api/auth/signup.
 *
 * The basic rate-limiting behaviour (5 failures → 429) is already covered in
 * tests/auth-security.spec.js (Suite 43).  This file covers the edge cases:
 *
 *   (a) Retry-After value is a positive integer (not zero or negative)
 *   (b) A successful login clears the failure counter so the window resets
 *   (c) Rate-limit key is case-insensitive: USER@EXAMPLE.COM and user@example.com
 *       share the same sliding window
 *   (d) Signup rate-limit mirrors login: 5 duplicate-email attempts → 429
 *
 * Servers-side rate-limiting is stateful (in-process Python dict keyed by
 * action:ip:email).  Tests use unique emails so windows don't bleed between
 * runs and so that concurrent test runs on the same machine do not interfere.
 *
 * These tests require the Flask server to be running (npm run server or
 * python app.py).  They exercise the real auth.py code.
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001';

// Override global X-Test-Mode header -- these tests exercise real auth paths
test.use({ extraHTTPHeaders: {} });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(prefix = 'rl') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function sameOriginHeaders(extra = {}) {
    return { Origin: BASE_URL, ...extra };
}

/**
 * Trigger exactly `count` login failures for the given email.
 * Uses the wrong password so we get deliberate 401s from the server.
 */
async function triggerLoginFailures(request, email, count) {
    for (let i = 0; i < count; i += 1) {
        await request.post(`${BASE_URL}/api/auth/login`, {
            headers: sameOriginHeaders(),
            data: { email, password: 'definitely-wrong-password' },
        });
    }
}

/**
 * Create a real user account with a given password (default 'ValidPass1!').
 * Returns the email used.
 */
async function createAccount(request, email = uniqueEmail('acct'), password = 'ValidPass1!') {
    const response = await request.post(`${BASE_URL}/api/auth/signup`, {
        headers: sameOriginHeaders(),
        data: { email, password, name: 'Rate Limit Test' },
    });
    expect(response.status()).toBe(202);
    return email;
}

// ---------------------------------------------------------------------------
// Suite: Retry-After Header Value
// ---------------------------------------------------------------------------

test.describe('Auth Rate Limit: Retry-After header value', () => {
    test('Retry-After on login 429 is a positive integer in seconds', async ({ request }) => {
        // Use a dedicated email to guarantee a fresh window
        const email = uniqueEmail('retryafter');

        // Exhaust the 5-attempt window with wrong passwords
        await triggerLoginFailures(request, email, 5);

        const limitedResponse = await request.post(`${BASE_URL}/api/auth/login`, {
            headers: sameOriginHeaders(),
            data: { email, password: 'wrong' },
        });

        expect(limitedResponse.status()).toBe(429);

        const retryAfterHeader = limitedResponse.headers()['retry-after'];
        expect(retryAfterHeader).toBeDefined();

        const retryAfterSeconds = parseInt(retryAfterHeader, 10);
        expect(Number.isNaN(retryAfterSeconds)).toBe(false);
        // The window is 15 minutes = 900 seconds; retry-after must be at least 1
        expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
        // And no more than the full window (900s)
        expect(retryAfterSeconds).toBeLessThanOrEqual(900);
    });

    test('Retry-After on signup 429 is a positive integer in seconds', async ({ request }) => {
        const email = uniqueEmail('signuprl');

        // The signup rate-limiter fires on duplicate-email attempts.
        // First call creates the account; subsequent calls record failures.
        await request.post(`${BASE_URL}/api/auth/signup`, {
            headers: sameOriginHeaders(),
            data: { email, password: 'ValidPass1!', name: 'First' },
        });

        // Trigger 5 duplicate-email failures to hit the limit
        for (let i = 0; i < 5; i += 1) {
            await request.post(`${BASE_URL}/api/auth/signup`, {
                headers: sameOriginHeaders(),
                data: { email, password: 'ValidPass1!', name: 'Duplicate' },
            });
        }

        const limitedResponse = await request.post(`${BASE_URL}/api/auth/signup`, {
            headers: sameOriginHeaders(),
            data: { email, password: 'ValidPass1!', name: 'Duplicate' },
        });

        expect(limitedResponse.status()).toBe(429);

        const retryAfter = parseInt(limitedResponse.headers()['retry-after'] || '0', 10);
        expect(retryAfter).toBeGreaterThanOrEqual(1);
        expect(retryAfter).toBeLessThanOrEqual(900);
    });
});

// ---------------------------------------------------------------------------
// Suite: Rate Limit Clears on Success
// ---------------------------------------------------------------------------

test.describe('Auth Rate Limit: clears on successful login', () => {
    test('successful login resets failure counter and returns tokens', async ({ request }) => {
        const email = uniqueEmail('cleartest');
        const password = 'ValidPass1!';

        // Create a real account
        await createAccount(request, email, password);

        // Record 4 failures -- one below the threshold of 5
        await triggerLoginFailures(request, email, 4);

        // A single successful login should clear the failure counter
        const successResponse = await request.post(`${BASE_URL}/api/auth/login`, {
            headers: sameOriginHeaders(),
            data: { email, password },
        });
        expect(successResponse.status()).toBe(200);
        const body = await successResponse.json();
        expect(body).toHaveProperty('access_token');
        expect(body).toHaveProperty('refresh_token');

        // After clearing, 4 more failures should all return 401 (not 429)
        // because the window started fresh.
        for (let i = 0; i < 4; i += 1) {
            const res = await request.post(`${BASE_URL}/api/auth/login`, {
                headers: sameOriginHeaders(),
                data: { email, password: 'wrong-again' },
            });
            expect(res.status()).toBe(401);
        }
    });
});

// ---------------------------------------------------------------------------
// Suite: Case-Insensitive Email Normalization
// ---------------------------------------------------------------------------

test.describe('Auth Rate Limit: case-insensitive email key', () => {
    test('mixed-case and lowercase versions of the same email share the rate-limit window', async ({ request }) => {
        // Generate a base email with mixed case to verify normalization
        const baseEmail = uniqueEmail('casetest');
        // Create a mixed-case variant (uppercase local part)
        const upperEmail = baseEmail.toUpperCase();
        const lowerEmail = baseEmail.toLowerCase();

        // Trigger failures using the uppercase variant
        await triggerLoginFailures(request, upperEmail, 5);

        // Attempting login with the lowercase variant should now be rate-limited,
        // because the server normalises both to the same key.
        const limitedResponse = await request.post(`${BASE_URL}/api/auth/login`, {
            headers: sameOriginHeaders(),
            data: { email: lowerEmail, password: 'wrong' },
        });

        expect(limitedResponse.status()).toBe(429);
    });

    test('Title-case email variant is treated the same as lowercase', async ({ request }) => {
        const base = uniqueEmail('titlecase');
        // Construct a title-cased version (first char upper, rest lower)
        const titleEmail = base.charAt(0).toUpperCase() + base.slice(1);
        const lowerEmail = base.toLowerCase();

        // Exhaust window under titlecase
        await triggerLoginFailures(request, titleEmail, 5);

        // Lower-case variant should also be blocked
        const res = await request.post(`${BASE_URL}/api/auth/login`, {
            headers: sameOriginHeaders(),
            data: { email: lowerEmail, password: 'wrong' },
        });
        expect(res.status()).toBe(429);
    });
});

// ---------------------------------------------------------------------------
// Suite: Signup-Specific Rate Limiting
// ---------------------------------------------------------------------------

test.describe('Auth Rate Limit: signup duplicate-email throttling', () => {
    test('signup rate limit does not fire for valid new accounts', async ({ request }) => {
        // Each of these is a new unique email -- none should trigger rate limiting
        for (let i = 0; i < 6; i += 1) {
            const email = uniqueEmail(`newacct${i}`);
            const res = await request.post(`${BASE_URL}/api/auth/signup`, {
                headers: sameOriginHeaders(),
                data: { email, password: 'ValidPass1!', name: `User ${i}` },
            });
            // 202 for new accounts
            expect(res.status()).toBe(202);
        }
    });

    test('signup with invalid email format returns 400 not 429', async ({ request }) => {
        // Invalid email format should be caught by validation before rate-limiting,
        // so it should never return 429 regardless of how many times it is sent.
        for (let i = 0; i < 6; i += 1) {
            const res = await request.post(`${BASE_URL}/api/auth/signup`, {
                headers: sameOriginHeaders(),
                data: { email: 'not-an-email', password: 'ValidPass1!', name: 'Test' },
            });
            expect(res.status()).toBe(400);
        }
    });
});
