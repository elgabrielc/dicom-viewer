// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Regression coverage for concurrent sync version allocation.
 *
 * The server cursor protocol relies on sync_version being unique and monotonic
 * for each user. Concurrent pushes used to race when allocating
 * MAX(sync_version) + 1, which could make later cursor pulls miss changes.
 */

const { test, expect } = require('@playwright/test');
const {
    BASE_URL,
    registerDevice,
    syncAndExpectOk,
    syncRequest,
    commentInsertChange,
    setupSyncUser,
} = require('./sync-helpers');

test.describe('Sync Version Allocation Race', () => {
    test('concurrent pushes allocate distinct versions and cursor pulls do not miss changes', async ({ request }) => {
        const { access_token, device_id: deviceA } = await setupSyncUser(request);
        const { device_id: deviceB } = await registerDevice(request, BASE_URL, access_token);
        const { device_id: deviceC } = await registerDevice(request, BASE_URL, access_token);

        const changeCount = 12;
        const changes = Array.from({ length: changeCount }, (_, index) =>
            commentInsertChange({ text: `Concurrent sync comment ${index}` }),
        );

        const pushedTextsByKey = Object.fromEntries(changes.map((change) => [change.key, change.data.text]));
        expect(new Set(Object.keys(pushedTextsByKey)).size).toBe(changeCount);

        // `flask run` serves requests on worker threads by default, so these
        // Promise.all pushes exercise concurrent sync handlers against SQLite.
        const pushResults = await Promise.all(
            changes.map(async (change, index) => {
                const deviceId = index % 2 === 0 ? deviceA : deviceB;
                const response = await syncRequest(request, BASE_URL, access_token, deviceId, null, [change]);
                const text = await response.text();
                let body;
                try {
                    body = JSON.parse(text);
                } catch {
                    body = { raw: text };
                }
                return { status: response.status(), body };
            }),
        );

        const acceptedVersions = [];
        for (const result of pushResults) {
            expect(result.status, JSON.stringify(result.body)).toBe(200);
            expect(result.body.accepted).toHaveLength(1);
            expect(result.body.rejected).toHaveLength(0);
            expect(typeof result.body.accepted[0].sync_version).toBe('number');
            acceptedVersions.push(result.body.accepted[0].sync_version);
        }

        const sortedVersions = [...acceptedVersions].sort((a, b) => a - b);
        const expectedVersions = Array.from({ length: changeCount }, (_, index) => sortedVersions[0] + index);
        expect(new Set(acceptedVersions).size).toBe(changeCount);
        expect(sortedVersions[0]).toBeGreaterThan(0);
        expect(sortedVersions).toEqual(expectedVersions);

        const pullResult = await syncAndExpectOk(request, BASE_URL, access_token, deviceC, null, []);
        const pushedKeys = changes.map((change) => change.key).sort();
        const pulledKeys = pullResult.remote_changes.map((change) => change.key).sort();
        const pulledVersions = pullResult.remote_changes.map((change) => change.sync_version).sort((a, b) => a - b);
        const pulledTextsByKey = Object.fromEntries(
            pullResult.remote_changes.map((change) => [change.key, change.data.text]),
        );

        expect(pullResult.accepted).toEqual([]);
        expect(pullResult.rejected).toEqual([]);
        expect(pullResult.remote_changes).toHaveLength(changeCount);
        expect(pulledKeys).toEqual(pushedKeys);
        expect(pulledVersions).toEqual(sortedVersions);
        expect(pulledTextsByKey).toEqual(pushedTextsByKey);

        const followUpPull = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            deviceC,
            pullResult.delta_cursor,
            [],
        );
        expect(followUpPull.remote_changes).toEqual([]);
    });
});
