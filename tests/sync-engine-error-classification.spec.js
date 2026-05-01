// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Tests for SyncEngine error classification and backoff behaviour.
 *
 * The sync engine classifies fetch errors as either transient or permanent.
 * Transient errors skip markFailed() on outbox entries so they get retried by
 * the backoff loop. Permanent errors mark entries failed so the outbox can
 * track retry counts and surface errors to the user.
 *
 * Key implementation detail under test (sync-engine.js ~line 250):
 *   const isTransient = /network error|rate limited \(429\)/i.test(fetchError.message);
 *
 * Known issue tracked as fixme test (c) below: a 410 Cursor-Expired response
 * throws "Cursor expired (410), reset for full resync" which does NOT match
 * the transient regex, so the engine increments _consecutiveErrors and calls
 * markFailed() on outbox entries, even though the cursor reset is a normal
 * protocol operation rather than a failure.
 *
 * Suite: Sync Engine Error Classification (no suite number — internal JS unit tests)
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001/?nolib';

// ---------------------------------------------------------------------------
// Page setup helper
// ---------------------------------------------------------------------------

/**
 * Navigate to the app and install a minimal mock of _SyncOutbox and
 * _NotesInternals so we can drive SyncEngine in isolation.
 *
 * @param {import('@playwright/test').Page} page
 */
async function setupPage(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(
        () => typeof window._SyncEngine?.SyncEngine === 'function' && !!window._SyncOutbox,
        null,
        { timeout: 10000 },
    );

    await page.evaluate(() => {
        // Minimal _NotesInternals stub so _applyRemoteData / _updateLocalSyncVersion do not crash.
        window.__SYNC_TEST_STORE = { studies: {} };
        window._NotesInternals = {
            loadStore() {
                return structuredClone(window.__SYNC_TEST_STORE);
            },
            saveStore(store) {
                window.__SYNC_TEST_STORE = structuredClone(store);
            },
            ensureStudy(store, uid) {
                if (!store.studies[uid]) {
                    store.studies[uid] = { description: '', comments: [], reports: [], series: {} };
                }
                return store.studies[uid];
            },
        };
    });
}

/**
 * Enqueue one change and return the resulting outbox entry.
 */
async function enqueueOneChange(page, recordKey = `rec-${Date.now()}`) {
    return page.evaluate((key) => {
        window._SyncOutbox._saveOutbox([]);
        window._SyncOutbox._saveSyncState({});
        return window._SyncOutbox.enqueueChange('comments', key, 'update', 0);
    }, recordKey);
}

/**
 * Build a SyncEngine with a stub getAccessToken and the provided Response factory,
 * run syncNow(), and return observable side-effects.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} statusCode   HTTP status to simulate
 * @param {object} [headers={}] Response headers
 * @param {boolean} [throwNetwork=false] Simulate a network failure instead
 */
async function runSyncWithFetchMock(page, statusCode, headers = {}, throwNetwork = false) {
    return page.evaluate(
        async ({ statusCode: status, headers: hdrs, throwNetwork: doThrow }) => {
            const originalFetch = window.fetch;
            window.fetch = async () => {
                if (doThrow) {
                    throw new TypeError('Failed to fetch');
                }
                return new Response('{}', { status, headers: { 'Content-Type': 'application/json', ...hdrs } });
            };

            try {
                const engine = new window._SyncEngine.SyncEngine({
                    getAccessToken: async () => 'test-access-token',
                    onAuthRequired: () => {},
                });

                let summaryResult;
                try {
                    summaryResult = await engine.syncNow();
                } catch {
                    summaryResult = null;
                }

                const allEntries = window._SyncOutbox._loadOutbox();

                return {
                    summary: summaryResult,
                    consecutiveErrors: engine._consecutiveErrors,
                    retryAfterMs: engine._retryAfterMs,
                    allEntries,
                };
            } finally {
                window.fetch = originalFetch;
            }
        },
        { statusCode, headers, throwNetwork },
    );
}

// ---------------------------------------------------------------------------
// Test Suite: Error Classification
// ---------------------------------------------------------------------------

test.describe('Sync Engine: Error Classification', () => {
    test.beforeEach(async ({ page }) => {
        await setupPage(page);
    });

    // (a) Network errors are transient: entries must NOT be marked failed
    test('network error is classified as transient and does not mark entries failed', async ({ page }) => {
        const entry = await enqueueOneChange(page, `rec-network-${Date.now()}`);

        // Simulate a real network failure (fetch itself rejects with TypeError)
        const result = await runSyncWithFetchMock(page, 0, {}, true);

        // syncNow catches the throw and returns {error: true}
        expect(result.summary).toMatchObject({ error: true });
        // Error counter is incremented by syncNow's catch block
        expect(result.consecutiveErrors).toBe(1);

        // The key assertion: last_error must NOT be set.
        // Transient errors skip markFailed(), so the entry stays pending (attempts=0).
        const matchingEntry = result.allEntries.find((e) => e.operation_uuid === entry.operation_uuid);
        expect(matchingEntry).toBeDefined();
        expect(matchingEntry.last_error).toBeFalsy();
        expect(matchingEntry.attempts).toBe(0);
    });

    // (b) 429 Rate-Limited errors are transient: entries must NOT be marked failed
    test('429 rate-limited response is classified as transient and does not mark entries failed', async ({ page }) => {
        const entry = await enqueueOneChange(page, `rec-429-${Date.now()}`);

        const result = await runSyncWithFetchMock(page, 429, { 'Retry-After': '60' });

        expect(result.summary).toMatchObject({ error: true });
        expect(result.consecutiveErrors).toBe(1);

        // 429 must not mark entries failed
        const matchingEntry = result.allEntries.find((e) => e.operation_uuid === entry.operation_uuid);
        expect(matchingEntry).toBeDefined();
        expect(matchingEntry.last_error).toBeFalsy();
        expect(matchingEntry.attempts).toBe(0);
    });

    // (b2) 429 sets _retryAfterMs from the Retry-After header
    test('429 response stores Retry-After delay for next schedule', async ({ page }) => {
        await enqueueOneChange(page, `rec-retry-after-${Date.now()}`);

        const result = await runSyncWithFetchMock(page, 429, { 'Retry-After': '120' });

        // The engine should have stored 120 * 1000 = 120000 ms
        expect(result.retryAfterMs).toBe(120000);
    });

    // (c) 410 Cursor-Expired: this is a PROTOCOL RESET, not a failure.
    //
    // KNOWN BUG: The current implementation throws "Cursor expired (410), reset for
    // full resync" from _fetchSync(), which does NOT match the transient regex
    //   /network error|rate limited \(429\)/i
    // so _doSync() calls outbox.markFailed() and syncNow() increments
    // _consecutiveErrors.  This means a routine cursor expiry causes backoff
    // and marks outbox entries as permanently failed — both are wrong.
    //
    // This test encodes the desired behaviour, but is marked fixme until the
    // sync engine handles cursor expiry as a protocol reset instead of a failure.
    test('410 cursor-expired resets without marking outbox entries failed', async ({ page }) => {
        test.fixme(true, 'Cursor expiry should reset sync state without backoff or outbox failure.');

        const entry = await enqueueOneChange(page, `rec-410-${Date.now()}`);

        // Pre-set a cursor so we can verify it gets cleared
        await page.evaluate(() => {
            window._SyncOutbox.setCursor('cursor-before-410');
        });

        const result = await runSyncWithFetchMock(page, 410);

        // Cursor MUST be reset to null after a 410 -- this is always correct
        const cursor = await page.evaluate(() => window._SyncOutbox.getCursor());
        expect(cursor).toBeNull();

        // A cursor reset is not a sync failure.
        expect(result.summary).not.toMatchObject({ error: true });
        expect(result.consecutiveErrors).toBe(0);

        const matchingEntry = result.allEntries.find((e) => e.operation_uuid === entry.operation_uuid);
        expect(matchingEntry).toBeDefined();
        expect(matchingEntry.last_error).toBeFalsy();
    });

    // (d) Unknown/unexpected errors ARE permanent: entries must be marked failed
    test('unknown server error (500) is classified as permanent and marks entries failed', async ({ page }) => {
        const entry = await enqueueOneChange(page, `rec-500-${Date.now()}`);

        const result = await runSyncWithFetchMock(page, 500);

        expect(result.summary).toMatchObject({ error: true });
        expect(result.consecutiveErrors).toBe(1);

        // 500 is a permanent error -- entries must have last_error set and attempts incremented
        const matchingEntry = result.allEntries.find((e) => e.operation_uuid === entry.operation_uuid);
        expect(matchingEntry).toBeDefined();
        expect(matchingEntry.last_error).toBeTruthy();
        expect(matchingEntry.attempts).toBeGreaterThan(0);
    });

    // (d2) 403 Device-Not-Registered is also permanent
    test('403 device-not-registered is classified as permanent and marks entries failed', async ({ page }) => {
        const entry = await enqueueOneChange(page, `rec-403-${Date.now()}`);

        const result = await runSyncWithFetchMock(page, 403);

        expect(result.summary).toMatchObject({ error: true });

        const matchingEntry = result.allEntries.find((e) => e.operation_uuid === entry.operation_uuid);
        expect(matchingEntry).toBeDefined();
        expect(matchingEntry.last_error).toBeTruthy();
        expect(matchingEntry.attempts).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Test Suite: Backoff Schedule
// ---------------------------------------------------------------------------

test.describe('Sync Engine: Backoff Schedule', () => {
    test.beforeEach(async ({ page }) => {
        await setupPage(page);
    });

    test('_calculateNextDelay returns default interval when no errors', async ({ page }) => {
        const delay = await page.evaluate(() => {
            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'token',
                onAuthRequired: () => {},
                intervalMs: 30000,
            });
            return engine._calculateNextDelay();
        });
        expect(delay).toBe(30000);
    });

    test('_calculateNextDelay returns first backoff step after 1 consecutive error', async ({ page }) => {
        const delay = await page.evaluate(() => {
            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'token',
                onAuthRequired: () => {},
            });
            engine._consecutiveErrors = 1;
            return engine._calculateNextDelay();
        });
        // BACKOFF_SCHEDULE_MS[0] = 30000
        expect(delay).toBe(30000);
    });

    test('_calculateNextDelay returns second backoff step after 2 consecutive errors', async ({ page }) => {
        const delay = await page.evaluate(() => {
            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'token',
                onAuthRequired: () => {},
            });
            engine._consecutiveErrors = 2;
            return engine._calculateNextDelay();
        });
        // BACKOFF_SCHEDULE_MS[1] = 60000
        expect(delay).toBe(60000);
    });

    test('_calculateNextDelay caps at maximum backoff after many errors', async ({ page }) => {
        const delay = await page.evaluate(() => {
            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'token',
                onAuthRequired: () => {},
            });
            engine._consecutiveErrors = 999;
            return engine._calculateNextDelay();
        });
        // BACKOFF_SCHEDULE_MS[3] = 300000 (5 min cap)
        expect(delay).toBe(300000);
    });

    test('_calculateNextDelay returns Retry-After delay and clears it', async ({ page }) => {
        const result = await page.evaluate(() => {
            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'token',
                onAuthRequired: () => {},
            });
            engine._retryAfterMs = 90000;
            const first = engine._calculateNextDelay();
            // After consuming it, should reset to 0
            const second = engine._calculateNextDelay();
            return { first, secondRetryAfterMs: engine._retryAfterMs, second };
        });

        expect(result.first).toBe(90000);
        expect(result.secondRetryAfterMs).toBe(0);
        // Second call with no errors and no retryAfter uses default interval
        expect(result.second).toBe(30000);
    });

    test('successful sync resets consecutive error counter to zero', async ({ page }) => {
        await page.evaluate(() => {
            window._SyncOutbox._saveOutbox([]);
            window._SyncOutbox._saveSyncState({});
        });

        const consecutiveErrors = await page.evaluate(async () => {
            const originalFetch = window.fetch;
            window.fetch = async () =>
                new Response(
                    JSON.stringify({
                        accepted: [],
                        rejected: [],
                        remote_changes: [],
                        delta_cursor: 'cursor-ok',
                        server_time: Date.now(),
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );

            try {
                const engine = new window._SyncEngine.SyncEngine({
                    getAccessToken: async () => 'token',
                    onAuthRequired: () => {},
                });
                // Simulate prior failures
                engine._consecutiveErrors = 3;
                await engine.syncNow();
                return engine._consecutiveErrors;
            } finally {
                window.fetch = originalFetch;
            }
        });

        expect(consecutiveErrors).toBe(0);
    });
});
