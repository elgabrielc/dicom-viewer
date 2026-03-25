// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Integration tests for the client-side sync outbox logic.
 *
 * These tests run in a browser context to exercise the JavaScript outbox module
 * that queues local changes for eventual sync to the server. They verify that
 * the outbox correctly collapses operations and respects feature flags.
 *
 * The outbox module lives in the frontend JavaScript and is responsible for:
 * - Queuing insert/update/delete operations when the user makes local changes
 * - Collapsing redundant operations (e.g., insert+update -> insert, insert+delete -> no-op)
 * - Gating on the cloudSync feature flag
 *
 * These tests will initially FAIL because the outbox module does not exist yet.
 * They will pass after the client-outbox lane is merged.
 *
 * Contract: docs/planning/SYNC-CONTRACT-V1.md (frozen 2026-03-25)
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001';

// ---------------------------------------------------------------------------
// Browser setup helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the app and inject the outbox module into the page context.
 * We set the deployment mode to 'cloud' so cloudSync feature flag is enabled.
 *
 * @param {import('@playwright/test').Page} page
 */
async function setupOutboxPage(page) {
    await page.goto(`${BASE_URL}/`);

    // Wait for CONFIG to be available
    await page.waitForFunction(() => typeof window.CONFIG !== 'undefined', null, {
        timeout: 10000,
    });

    // Override deployment mode to 'cloud' so cloudSync is enabled.
    // CONFIG is frozen, so we inject a patched version for testing.
    await page.evaluate(() => {
        window.__TEST_DEPLOYMENT_MODE = 'cloud';
        // Patch CONFIG.detectDeploymentMode to return 'cloud' for tests
        Object.defineProperty(window, 'CONFIG', {
            value: new Proxy(window.CONFIG, {
                get(target, prop) {
                    if (prop === 'deploymentMode') return 'cloud';
                    if (prop === 'features') {
                        return new Proxy(target.features, {
                            get(fTarget, fProp) {
                                if (fProp === 'cloudSync') return true;
                                // Access from original features via the target's getter
                                return fTarget[fProp];
                            }
                        });
                    }
                    if (prop === 'isCloudPlatform') return () => true;
                    if (typeof target[prop] === 'function') return target[prop].bind(target);
                    return target[prop];
                }
            }),
            configurable: true,
        });
    });
}

/**
 * Navigate to the app WITHOUT cloud sync enabled (personal mode).
 *
 * @param {import('@playwright/test').Page} page
 */
async function setupPersonalModePage(page) {
    await page.goto(`${BASE_URL}/`);

    // Wait for CONFIG to be available
    await page.waitForFunction(() => typeof window.CONFIG !== 'undefined', null, {
        timeout: 10000,
    });

    // Personal mode is the default for localhost, so no override needed.
    // Verify the feature flag is off.
    const cloudSyncEnabled = await page.evaluate(() => {
        return window.CONFIG.features.cloudSync;
    });
    expect(cloudSyncEnabled).toBe(false);
}

/**
 * Read the current outbox contents from the page.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array>}
 */
async function getOutboxEntries(page) {
    return await page.evaluate(() => {
        // The outbox module should expose its queue via a global or module accessor
        if (typeof window.SyncOutbox !== 'undefined') {
            return window.SyncOutbox.getQueue();
        }
        // Fallback: check if outbox is stored in localStorage
        const raw = localStorage.getItem('sync_outbox');
        return raw ? JSON.parse(raw) : [];
    });
}

/**
 * Clear the outbox in the page context.
 *
 * @param {import('@playwright/test').Page} page
 */
async function clearOutbox(page) {
    await page.evaluate(() => {
        if (typeof window.SyncOutbox !== 'undefined') {
            window.SyncOutbox.clear();
        }
        localStorage.removeItem('sync_outbox');
    });
}

/**
 * Enqueue a change into the outbox via the page's outbox module.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} table
 * @param {string} key
 * @param {string} operation - 'insert', 'update', or 'delete'
 * @param {Object} [data]
 * @returns {Promise<void>}
 */
async function enqueueChange(page, table, key, operation, data = {}) {
    await page.evaluate(({ table, key, operation, data }) => {
        if (typeof window.SyncOutbox !== 'undefined') {
            window.SyncOutbox.enqueue(table, key, operation, data);
        }
    }, { table, key, operation, data });
}

// ---------------------------------------------------------------------------
// Suite: Outbox collapsing
// ---------------------------------------------------------------------------

test.describe('Outbox Collapsing', () => {
    test('multiple updates on same record collapse to one', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'study-note-collapse-test';

        // Enqueue three updates on the same record
        await enqueueChange(page, 'study_notes', key, 'update', { description: 'First' });
        await enqueueChange(page, 'study_notes', key, 'update', { description: 'Second' });
        await enqueueChange(page, 'study_notes', key, 'update', { description: 'Third' });

        const entries = await getOutboxEntries(page);

        // Should collapse to a single update with the latest data
        const matchingEntries = entries.filter(
            e => e.table === 'study_notes' && e.key === key
        );
        expect(matchingEntries.length).toBe(1);
        expect(matchingEntries[0].operation).toBe('update');
        expect(matchingEntries[0].data.description).toBe('Third');
    });

    test('insert then updates collapse to one insert', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'comment-insert-update-test';

        // Insert followed by updates
        await enqueueChange(page, 'comments', key, 'insert', {
            study_uid: 'test-study',
            text: 'Original',
            created_at: Date.now(),
            updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', key, 'update', {
            text: 'Edited once',
            updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', key, 'update', {
            text: 'Edited twice',
            updated_at: Date.now(),
        });

        const entries = await getOutboxEntries(page);

        // Should collapse to a single insert with the latest data merged
        const matchingEntries = entries.filter(
            e => e.table === 'comments' && e.key === key
        );
        expect(matchingEntries.length).toBe(1);
        expect(matchingEntries[0].operation).toBe('insert');
        // The data should reflect the final state
        expect(matchingEntries[0].data.text).toBe('Edited twice');
    });

    test('insert then delete cancels out (no-op)', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'comment-insert-delete-noop';

        // Insert then immediately delete -- net effect is nothing
        await enqueueChange(page, 'comments', key, 'insert', {
            study_uid: 'test-study',
            text: 'Ephemeral comment',
            created_at: Date.now(),
            updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', key, 'delete', {});

        const entries = await getOutboxEntries(page);

        // Should cancel out -- no entry for this key
        const matchingEntries = entries.filter(
            e => e.table === 'comments' && e.key === key
        );
        expect(matchingEntries.length).toBe(0);
    });

    test('update then delete collapses to one delete', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'comment-update-delete-test';

        // Update then delete -- only the delete matters
        await enqueueChange(page, 'comments', key, 'update', {
            text: 'Updated text',
            updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', key, 'delete', {});

        const entries = await getOutboxEntries(page);

        const matchingEntries = entries.filter(
            e => e.table === 'comments' && e.key === key
        );
        expect(matchingEntries.length).toBe(1);
        expect(matchingEntries[0].operation).toBe('delete');
    });
});

// ---------------------------------------------------------------------------
// Suite: Outbox enqueue
// ---------------------------------------------------------------------------

test.describe('Outbox Enqueue', () => {
    test('comment insert creates outbox entry with correct table/key/operation', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'comment-enqueue-test';
        const studyUid = 'test-study-enqueue';
        const now = Date.now();

        await enqueueChange(page, 'comments', key, 'insert', {
            study_uid: studyUid,
            text: 'Test comment',
            created_at: now,
            updated_at: now,
        });

        const entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeDefined();
        expect(entry.table).toBe('comments');
        expect(entry.key).toBe(key);
        expect(entry.operation).toBe('insert');
        expect(entry.data.study_uid).toBe(studyUid);
        expect(entry.data.text).toBe('Test comment');
    });

    test('study note update creates outbox entry', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'study-uid-enqueue-test';

        await enqueueChange(page, 'study_notes', key, 'update', {
            description: 'New description',
        });

        const entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeDefined();
        expect(entry.table).toBe('study_notes');
        expect(entry.operation).toBe('update');
        expect(entry.data.description).toBe('New description');
    });

    test('report soft delete creates outbox entry', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'report-delete-enqueue-test';

        await enqueueChange(page, 'reports', key, 'delete', {});

        const entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeDefined();
        expect(entry.table).toBe('reports');
        expect(entry.operation).toBe('delete');
    });

    test('outbox entries not created when cloudSync feature flag is off', async ({ page }) => {
        // Use personal mode where cloudSync is disabled
        await setupPersonalModePage(page);
        await clearOutbox(page);

        const key = 'should-not-enqueue';

        // Attempt to enqueue -- should be a no-op since cloudSync is off
        await page.evaluate(({ key }) => {
            if (typeof window.SyncOutbox !== 'undefined') {
                window.SyncOutbox.enqueue('comments', key, 'insert', {
                    study_uid: 'test',
                    text: 'Should not be queued',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                });
            }
        }, { key });

        const entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Suite: Outbox entry fields
// ---------------------------------------------------------------------------

test.describe('Outbox Entry Fields', () => {
    test('each outbox entry has an operation_uuid for idempotency', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'uuid-field-test';
        await enqueueChange(page, 'comments', key, 'insert', {
            study_uid: 'test-study',
            text: 'UUID test',
            created_at: Date.now(),
            updated_at: Date.now(),
        });

        const entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeDefined();
        expect(typeof entry.operation_uuid).toBe('string');
        expect(entry.operation_uuid.length).toBeGreaterThan(0);
    });

    test('each outbox entry has a base_sync_version field', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'version-field-test';
        await enqueueChange(page, 'study_notes', key, 'update', {
            description: 'Version test',
        });

        const entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeDefined();
        expect(typeof entry.base_sync_version).toBe('number');
    });

    test('operation_uuid is unique across entries', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        // Enqueue entries for different records
        await enqueueChange(page, 'comments', 'key-a', 'insert', {
            study_uid: 'test', text: 'A', created_at: Date.now(), updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', 'key-b', 'insert', {
            study_uid: 'test', text: 'B', created_at: Date.now(), updated_at: Date.now(),
        });

        const entries = await getOutboxEntries(page);
        const uuids = entries.map(e => e.operation_uuid);
        const uniqueUuids = new Set(uuids);
        expect(uniqueUuids.size).toBe(uuids.length);
    });
});

// ---------------------------------------------------------------------------
// Suite: Outbox persistence
// ---------------------------------------------------------------------------

test.describe('Outbox Persistence', () => {
    test('outbox entries survive page reload', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'persistence-test';
        await enqueueChange(page, 'comments', key, 'insert', {
            study_uid: 'test-study',
            text: 'Should survive reload',
            created_at: Date.now(),
            updated_at: Date.now(),
        });

        // Verify entry exists before reload
        let entries = await getOutboxEntries(page);
        expect(entries.find(e => e.key === key)).toBeDefined();

        // Reload the page and re-setup
        await setupOutboxPage(page);

        // Entry should still be there
        entries = await getOutboxEntries(page);
        const entry = entries.find(e => e.key === key);
        expect(entry).toBeDefined();
        expect(entry.data.text).toBe('Should survive reload');
    });

    test('clear removes all outbox entries', async ({ page }) => {
        await setupOutboxPage(page);

        // Enqueue something
        await enqueueChange(page, 'comments', 'clear-test', 'insert', {
            study_uid: 'test', text: 'will be cleared', created_at: Date.now(), updated_at: Date.now(),
        });

        // Verify it exists
        let entries = await getOutboxEntries(page);
        expect(entries.length).toBeGreaterThan(0);

        // Clear
        await clearOutbox(page);

        // Verify empty
        entries = await getOutboxEntries(page);
        expect(entries.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Suite: Outbox collapsing edge cases
// ---------------------------------------------------------------------------

test.describe('Outbox Collapsing Edge Cases', () => {
    test('operations on different records are not collapsed', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        await enqueueChange(page, 'comments', 'key-x', 'update', { text: 'X' });
        await enqueueChange(page, 'comments', 'key-y', 'update', { text: 'Y' });

        const entries = await getOutboxEntries(page);
        const xEntries = entries.filter(e => e.key === 'key-x');
        const yEntries = entries.filter(e => e.key === 'key-y');
        expect(xEntries.length).toBe(1);
        expect(yEntries.length).toBe(1);
    });

    test('operations on different tables with same key are not collapsed', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const sharedKey = 'shared-key-test';
        await enqueueChange(page, 'comments', sharedKey, 'update', { text: 'comment update' });
        await enqueueChange(page, 'study_notes', sharedKey, 'update', { description: 'note update' });

        const entries = await getOutboxEntries(page);
        const commentEntries = entries.filter(e => e.table === 'comments' && e.key === sharedKey);
        const noteEntries = entries.filter(e => e.table === 'study_notes' && e.key === sharedKey);
        expect(commentEntries.length).toBe(1);
        expect(noteEntries.length).toBe(1);
    });

    test('insert + update + delete on same record cancels to no-op', async ({ page }) => {
        await setupOutboxPage(page);
        await clearOutbox(page);

        const key = 'full-lifecycle-noop';
        await enqueueChange(page, 'comments', key, 'insert', {
            study_uid: 'test', text: 'Created', created_at: Date.now(), updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', key, 'update', {
            text: 'Edited', updated_at: Date.now(),
        });
        await enqueueChange(page, 'comments', key, 'delete', {});

        const entries = await getOutboxEntries(page);
        const matchingEntries = entries.filter(
            e => e.table === 'comments' && e.key === key
        );
        // insert + any number of updates + delete should cancel out completely
        expect(matchingEntries.length).toBe(0);
    });
});
