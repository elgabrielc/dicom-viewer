// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * End-to-end tests for the full cloud sync flow.
 *
 * These tests exercise the complete sync lifecycle: authentication, device
 * registration, two-device propagation, conflict resolution, offline/online
 * transitions, report file sync, and cursor management.
 *
 * Unlike sync-protocol.spec.js (which tests individual server endpoints in
 * isolation), these tests simulate realistic multi-device workflows end-to-end.
 *
 * These tests use Playwright's request API (no browser needed) and run against
 * the Flask server with all Stage 0-3 changes. They will initially FAIL until
 * all Stage 4 implementation lanes are merged -- that is expected.
 *
 * Contract: docs/planning/SYNC-CONTRACT-V1.md (frozen 2026-03-25)
 */

const { test, expect } = require('@playwright/test');
const {
    BASE_URL,
    uniqueEmail,
    uniqueStudyUid,
    uniqueRecordUuid,
    uniqueOperationUuid,
    createTestUser,
    loginUser,
    registerDevice,
    syncRequest,
    syncAndExpectOk,
    commentInsertChange,
    studyNoteUpdateChange,
    reportDeleteChange,
    minimalPdfBuffer,
    sha256Hex,
    setupSyncUser,
} = require('./sync-helpers');

// ---------------------------------------------------------------------------
// Helpers specific to e2e tests
// ---------------------------------------------------------------------------

/**
 * Set up a complete "device" context: create user, log in, register device.
 * Returns all credentials and IDs needed for sync operations.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<{email: string, password: string, access_token: string, refresh_token: string, device_id: string}>}
 */
async function setupDevice(request) {
    return await setupSyncUser(request);
}

/**
 * Set up a second device for an existing user (same account, new device).
 * Logs in again to get a fresh token and registers a new device.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{access_token: string, refresh_token: string, device_id: string}>}
 */
async function setupSecondDevice(request, email, password) {
    const { access_token, refresh_token } = await loginUser(request, BASE_URL, email, password);
    const { device_id } = await registerDevice(request, BASE_URL, access_token);
    return { access_token, refresh_token, device_id };
}

/**
 * Insert a report record via sync and upload its file blob.
 * Returns the report ID, content hash, and sync version.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} token
 * @param {string} deviceId
 * @param {string|null} cursor
 * @param {Buffer} [fileContent]
 * @returns {Promise<{reportId: string, contentHash: string, syncVersion: number, cursor: string}>}
 */
async function insertReportWithFile(request, token, deviceId, cursor, fileContent) {
    const reportId = uniqueRecordUuid();
    const pdfContent = fileContent || minimalPdfBuffer();
    const contentHash = sha256Hex(pdfContent);

    // Register the report metadata via sync
    const insertChange = {
        operation_uuid: uniqueOperationUuid(),
        table: 'reports',
        key: reportId,
        operation: 'insert',
        base_sync_version: 0,
        data: {
            study_uid: uniqueStudyUid(),
            name: `E2E Report ${Date.now()}`,
            type: 'pdf',
            content_hash: contentHash,
            created_at: Date.now(),
            updated_at: Date.now(),
        },
    };
    const result = await syncAndExpectOk(request, BASE_URL, token, deviceId, cursor, [insertChange]);
    const syncVersion = result.accepted[0].sync_version;

    // Upload the file blob
    const uploadResponse = await request.post(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Hash': `sha256:${contentHash}`,
        },
        multipart: {
            file: {
                name: 'report.pdf',
                mimeType: 'application/pdf',
                buffer: pdfContent,
            },
        },
    });
    expect(uploadResponse.status()).toBe(200);

    return { reportId, contentHash, syncVersion, cursor: result.delta_cursor };
}

// ---------------------------------------------------------------------------
// Suite: Authentication flow
// ---------------------------------------------------------------------------

test.describe('E2E Authentication Flow', () => {
    test('signup creates account and allows a subsequent login', async ({ request }) => {
        const email = uniqueEmail();
        const password = 'SecurePass123!';
        const name = 'E2E Test User';

        // Signup
        const signupResponse = await request.post(`${BASE_URL}/api/auth/signup`, {
            data: { email, password, name },
        });
        expect(signupResponse.status()).toBe(202);

        // Verify we can now log in with those credentials
        const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email, password },
        });
        expect(loginResponse.status()).toBe(200);

        const body = await loginResponse.json();
        expect(body).toHaveProperty('access_token');
        expect(body).toHaveProperty('refresh_token');
        expect(typeof body.access_token).toBe('string');
        expect(body.access_token.length).toBeGreaterThan(0);
    });

    test('login returns valid access and refresh tokens', async ({ request }) => {
        const { email, password } = await createTestUser(request);

        const response = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email, password },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('access_token');
        expect(body).toHaveProperty('refresh_token');
        expect(body).toHaveProperty('expires_in');
        expect(typeof body.access_token).toBe('string');
        expect(typeof body.refresh_token).toBe('string');
        expect(typeof body.expires_in).toBe('number');
        expect(body.expires_in).toBeGreaterThan(0);

        // Verify the access token works by making an authenticated request
        const syncResponse = await request.post(`${BASE_URL}/api/sync`, {
            headers: {
                Authorization: `Bearer ${body.access_token}`,
                'Content-Type': 'application/json',
            },
            data: {
                // Need a registered device, so this will fail with 403 (not 401)
                // -- the point is it doesn't fail with 401, proving the token is valid
                device_id: 'temp-unregistered-device',
                delta_cursor: null,
                changes: [],
            },
        });
        // 403 means the token was accepted but device is not registered
        // 401 would mean the token itself was rejected
        expect(syncResponse.status()).toBe(403);
    });

    test('device registration returns server-issued device_id', async ({ request }) => {
        const { email, password } = await createTestUser(request);
        const { access_token } = await loginUser(request, BASE_URL, email, password);

        const response = await request.post(`${BASE_URL}/api/auth/devices`, {
            headers: { Authorization: `Bearer ${access_token}` },
            data: {
                device_name: 'E2E Test Device',
                platform: 'test-e2e',
            },
        });
        expect(response.status()).toBe(201);

        const body = await response.json();
        expect(body).toHaveProperty('device_id');
        expect(typeof body.device_id).toBe('string');
        expect(body.device_id.length).toBeGreaterThan(0);

        // Verify the device_id is usable in a sync request
        const syncResult = await syncAndExpectOk(request, BASE_URL, access_token, body.device_id, null, []);
        expect(syncResult).toHaveProperty('delta_cursor');
    });

    test('refresh token returns new access token', async ({ request }) => {
        const { email, password } = await createTestUser(request);
        const loginResult = await loginUser(request, BASE_URL, email, password);

        const refreshResponse = await request.post(`${BASE_URL}/api/auth/refresh`, {
            data: { refresh_token: loginResult.refresh_token },
        });
        expect(refreshResponse.status()).toBe(200);

        const body = await refreshResponse.json();
        expect(body).toHaveProperty('access_token');
        expect(body).toHaveProperty('expires_in');
        expect(typeof body.access_token).toBe('string');
        expect(body.access_token.length).toBeGreaterThan(0);

        // The new access token should be different from the original
        // (not strictly required by all JWT implementations, but expected)
        // More importantly, verify the new token works
        const { device_id } = await registerDevice(request, BASE_URL, body.access_token);
        const syncResult = await syncAndExpectOk(request, BASE_URL, body.access_token, device_id, null, []);
        expect(syncResult).toHaveProperty('delta_cursor');
    });

    test('refresh endpoint rejects access tokens', async ({ request }) => {
        const { email, password } = await createTestUser(request);
        const loginResult = await loginUser(request, BASE_URL, email, password);

        const refreshResponse = await request.post(`${BASE_URL}/api/auth/refresh`, {
            data: { refresh_token: loginResult.access_token },
        });
        expect(refreshResponse.status()).toBe(401);

        const body = await refreshResponse.json();
        expect(body).toEqual({ error: 'Invalid refresh token' });
    });

    test('device list shows only the authenticated user devices', async ({ request }) => {
        const userA = await setupDevice(request);
        const userADevice2 = await setupSecondDevice(request, userA.email, userA.password);
        const userB = await setupDevice(request);

        const listAResponse = await request.get(`${BASE_URL}/api/auth/devices`, {
            headers: { Authorization: `Bearer ${userA.access_token}` },
        });
        expect(listAResponse.status()).toBe(200);
        const listABody = await listAResponse.json();
        const userADeviceIds = listABody.devices.map((device) => device.id).sort();

        expect(userADeviceIds).toEqual([userA.device_id, userADevice2.device_id].sort());
        expect(userADeviceIds).not.toContain(userB.device_id);

        const listBResponse = await request.get(`${BASE_URL}/api/auth/devices`, {
            headers: { Authorization: `Bearer ${userB.access_token}` },
        });
        expect(listBResponse.status()).toBe(200);
        const listBBody = await listBResponse.json();
        expect(listBBody.devices.map((device) => device.id)).toEqual([userB.device_id]);
    });

    test('invalid credentials return 401', async ({ request }) => {
        const { email } = await createTestUser(request);

        const response = await request.post(`${BASE_URL}/api/auth/login`, {
            data: { email, password: 'WrongPassword999!' },
        });
        expect(response.status()).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// Suite: Two-device sync
// ---------------------------------------------------------------------------

test.describe('E2E Two-Device Sync', () => {
    test('Device A adds a comment, Device B syncs and receives it', async ({ request }) => {
        // Setup: one user, two devices
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Device B does an initial sync to establish a cursor
        const initialSync = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Device A adds a comment
        const commentText = `Comment from Device A at ${Date.now()}`;
        const studyUid = uniqueStudyUid();
        const change = commentInsertChange({ studyUid, text: commentText });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [change]);

        // Device B syncs and should receive the comment
        const pullResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            initialSync.delta_cursor,
            [],
        );

        const found = pullResult.remote_changes.find((rc) => rc.key === change.key && rc.table === 'comments');
        expect(found).toBeDefined();
        expect(found.data.text).toBe(commentText);
        expect(found.data.study_uid).toBe(studyUid);
        expect(found.operation).toBe('insert');
    });

    test('Device A updates a study description, Device B syncs and sees the update', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        const studyUid = uniqueStudyUid();
        const description = `Updated by Device A at ${Date.now()}`;

        // Device A creates a study note
        const insertChange = studyNoteUpdateChange(studyUid, {
            description: 'Initial description',
            baseSyncVersion: 0,
        });
        const insertResult = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [
            insertChange,
        ]);

        // Device B does initial sync to get cursor (will see the initial description)
        const bInitial = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Device A updates the description
        const updateChange = studyNoteUpdateChange(studyUid, {
            description,
            baseSyncVersion: insertResult.accepted[0].sync_version,
        });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, insertResult.delta_cursor, [
            updateChange,
        ]);

        // Device B syncs from its cursor and should see the updated description
        const pullResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bInitial.delta_cursor,
            [],
        );

        const found = pullResult.remote_changes.find((rc) => rc.key === studyUid && rc.table === 'study_notes');
        expect(found).toBeDefined();
        expect(found.data.description).toBe(description);
    });

    test('Device A soft-deletes a report, Device B syncs and report disappears', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Device A creates a report
        const reportId = uniqueRecordUuid();
        const insertChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: reportId,
            operation: 'insert',
            base_sync_version: 0,
            data: {
                study_uid: uniqueStudyUid(),
                name: 'Report to delete',
                type: 'pdf',
                created_at: Date.now(),
                updated_at: Date.now(),
            },
        };
        const insertResult = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [
            insertChange,
        ]);

        // Device B does initial sync -- should see the report
        const bInitial = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);
        const reportOnB = bInitial.remote_changes.find((rc) => rc.key === reportId && rc.table === 'reports');
        expect(reportOnB).toBeDefined();

        // Device A soft-deletes the report
        const deleteChange = reportDeleteChange(reportId, {
            baseSyncVersion: insertResult.accepted[0].sync_version,
        });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, insertResult.delta_cursor, [
            deleteChange,
        ]);

        // Device B syncs again -- should see the tombstone
        const pullResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bInitial.delta_cursor,
            [],
        );

        const tombstoned = pullResult.remote_changes.find((rc) => rc.key === reportId && rc.table === 'reports');
        expect(tombstoned).toBeDefined();
        expect(tombstoned.data.deleted_at).toBeDefined();
        expect(tombstoned.data.deleted_at).not.toBeNull();
        expect(typeof tombstoned.data.deleted_at).toBe('number');
    });

    test("both devices make non-conflicting changes, both receive each other's changes after sync", async ({
        request,
    }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Both devices do initial sync to establish cursors
        const aInitial = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, []);
        const bInitial = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Device A adds a comment on study 1
        const studyUid1 = uniqueStudyUid();
        const changeA = commentInsertChange({ studyUid: studyUid1, text: 'Comment from A' });
        const aResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceA.access_token,
            deviceA.device_id,
            aInitial.delta_cursor,
            [changeA],
        );

        // Device B adds a comment on a different study
        const studyUid2 = uniqueStudyUid();
        const changeB = commentInsertChange({ studyUid: studyUid2, text: 'Comment from B' });
        const bResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bInitial.delta_cursor,
            [changeB],
        );
        const changeAOnBPush = bResult.remote_changes.find((rc) => rc.key === changeA.key);

        // Device A syncs again -- should receive Device B's comment
        const aPull = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceA.access_token,
            deviceA.device_id,
            aResult.delta_cursor,
            [],
        );
        const foundBonA = aPull.remote_changes.find((rc) => rc.key === changeB.key);
        expect(foundBonA).toBeDefined();
        expect(foundBonA.data.text).toBe('Comment from B');

        // Device B may receive Device A's earlier change in the same sync response
        // that pushes B's own change, because remote_changes are computed from the
        // provided cursor before the new cursor is issued.
        const bPull = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bResult.delta_cursor,
            [],
        );
        const foundAonB = changeAOnBPush || bPull.remote_changes.find((rc) => rc.key === changeA.key);
        expect(foundAonB).toBeDefined();
        expect(foundAonB.data.text).toBe('Comment from A');
    });
});

// ---------------------------------------------------------------------------
// Suite: Conflict resolution
// ---------------------------------------------------------------------------

test.describe('E2E Conflict Resolution', () => {
    test('Device A and B both update the same study description with different values', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        const studyUid = uniqueStudyUid();

        // Device A creates the study note
        const insertChange = studyNoteUpdateChange(studyUid, {
            description: 'Original description',
            baseSyncVersion: 0,
        });
        const insertResult = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [
            insertChange,
        ]);
        const baseVersion = insertResult.accepted[0].sync_version;

        // Device B syncs to get the current state
        const bSync = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);
        const bNote = bSync.remote_changes.find((rc) => rc.key === studyUid && rc.table === 'study_notes');
        expect(bNote).toBeDefined();
        expect(bNote.sync_version).toBe(baseVersion);

        // Device A updates the description first
        const changeA = studyNoteUpdateChange(studyUid, {
            description: 'Device A wins',
            baseSyncVersion: baseVersion,
        });
        const aUpdate = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceA.access_token,
            deviceA.device_id,
            insertResult.delta_cursor,
            [changeA],
        );
        expect(aUpdate.accepted.length).toBe(1);
        const aNewVersion = aUpdate.accepted[0].sync_version;

        // Device B tries to update with the same base_sync_version (stale)
        const changeB = studyNoteUpdateChange(studyUid, {
            description: 'Device B loses',
            baseSyncVersion: baseVersion, // stale -- Device A already advanced it
        });
        const bUpdate = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bSync.delta_cursor,
            [changeB],
        );

        // Device B's change should be rejected
        expect(bUpdate.rejected.length).toBe(1);
        const rejected = bUpdate.rejected[0];
        expect(rejected.operation_uuid).toBe(changeB.operation_uuid);
        expect(rejected.key).toBe(studyUid);
        expect(rejected.reason).toBe('stale');
        expect(rejected.current_sync_version).toBe(aNewVersion);
        expect(rejected.current_data.description).toBe('Device A wins');
    });

    test("the second device to sync gets its change rejected with the first device's data", async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        const studyUid = uniqueStudyUid();

        // Create the note and both devices read it
        const insert = studyNoteUpdateChange(studyUid, {
            description: 'Base value',
            baseSyncVersion: 0,
        });
        const r1 = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [insert]);
        const baseVersion = r1.accepted[0].sync_version;

        // Device B sees the base value
        await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Device A updates
        const updateA = studyNoteUpdateChange(studyUid, {
            description: 'First writer',
            baseSyncVersion: baseVersion,
        });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, r1.delta_cursor, [updateA]);

        // Device B attempts update with stale version
        const updateB = studyNoteUpdateChange(studyUid, {
            description: 'Second writer',
            baseSyncVersion: baseVersion,
        });
        const bResult = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, [
            updateB,
        ]);

        // The rejected entry should contain Device A's data so Device B can resolve
        expect(bResult.rejected.length).toBeGreaterThanOrEqual(1);
        const rej = bResult.rejected.find((r) => r.key === studyUid);
        expect(rej).toBeDefined();
        expect(rej.reason).toBe('stale');
        expect(rej.current_data.description).toBe('First writer');
        expect(typeof rej.current_sync_version).toBe('number');
    });

    test('after resolution, both devices converge on the same value', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        const studyUid = uniqueStudyUid();

        // Create and get base version
        const insert = studyNoteUpdateChange(studyUid, {
            description: 'Original',
            baseSyncVersion: 0,
        });
        const r1 = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [insert]);
        const baseVersion = r1.accepted[0].sync_version;

        // Device B syncs to see the note
        const bSync1 = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Device A updates first
        const updateA = studyNoteUpdateChange(studyUid, {
            description: 'Concurrent update A',
            baseSyncVersion: baseVersion,
        });
        const aResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceA.access_token,
            deviceA.device_id,
            r1.delta_cursor,
            [updateA],
        );

        // Device B's update is rejected (stale)
        const updateB = studyNoteUpdateChange(studyUid, {
            description: 'Concurrent update B',
            baseSyncVersion: baseVersion,
        });
        const bResult = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bSync1.delta_cursor,
            [updateB],
        );
        expect(bResult.rejected.length).toBeGreaterThanOrEqual(1);
        const rejected = bResult.rejected.find((r) => r.key === studyUid);
        expect(rejected).toBeDefined();

        // Device B resolves the conflict by accepting server state and re-applying
        // with the correct base_sync_version
        const resolvedVersion = rejected.current_sync_version;
        const resolveChange = studyNoteUpdateChange(studyUid, {
            description: 'Resolved final value',
            baseSyncVersion: resolvedVersion,
        });
        const bResolve = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bResult.delta_cursor,
            [resolveChange],
        );
        expect(bResolve.accepted.length).toBe(1);
        const finalVersion = bResolve.accepted[0].sync_version;

        // Device A syncs and sees the resolved value
        const aPull = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceA.access_token,
            deviceA.device_id,
            aResult.delta_cursor,
            [],
        );
        const aNote = aPull.remote_changes.find((rc) => rc.key === studyUid && rc.table === 'study_notes');
        expect(aNote).toBeDefined();
        expect(aNote.data.description).toBe('Resolved final value');
        expect(aNote.sync_version).toBe(finalVersion);

        // Device B syncs again -- no more changes, converged
        const bFinal = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bResolve.delta_cursor,
            [],
        );
        // No new remote changes since Device B already has the latest
        expect(bFinal.remote_changes.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Suite: Offline/online transitions
// ---------------------------------------------------------------------------

test.describe('E2E Offline/Online Transitions', () => {
    test('device makes changes while "offline" (changes queue in outbox)', async ({ request }) => {
        // Simulate "offline" by accumulating changes locally without syncing,
        // then syncing all at once (as the client outbox would do on reconnect).
        const device = await setupDevice(request);

        // Device establishes a cursor (it was online initially)
        const initial = await syncAndExpectOk(request, BASE_URL, device.access_token, device.device_id, null, []);

        // "Offline" period: device queues three changes without syncing
        const studyUid = uniqueStudyUid();
        const offlineChanges = [
            commentInsertChange({ studyUid, text: 'Offline comment 1' }),
            commentInsertChange({ studyUid, text: 'Offline comment 2' }),
            studyNoteUpdateChange(studyUid, {
                description: 'Offline note update',
                baseSyncVersion: 0,
            }),
        ];

        // "Online" again: all queued changes are pushed in a single sync
        const result = await syncAndExpectOk(
            request,
            BASE_URL,
            device.access_token,
            device.device_id,
            initial.delta_cursor,
            offlineChanges,
        );

        // All three changes should be accepted
        expect(result.accepted.length).toBe(3);
        for (const change of offlineChanges) {
            const accepted = result.accepted.find((a) => a.operation_uuid === change.operation_uuid);
            expect(accepted).toBeDefined();
            expect(accepted.sync_version).toBeGreaterThan(0);
        }
    });

    test('when "online" again, outbox drains and changes appear on server', async ({ request }) => {
        // Two-device scenario: Device A goes offline, makes changes, comes back.
        // Device B should see all changes after Device A reconnects.
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Both devices establish cursors
        const aInit = await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, []);
        const bInit = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Device A goes "offline" and makes changes
        const studyUid = uniqueStudyUid();
        const offlineChanges = [
            commentInsertChange({ studyUid, text: 'Made while offline' }),
            studyNoteUpdateChange(studyUid, {
                description: 'Offline description',
                baseSyncVersion: 0,
            }),
        ];

        // Device A comes back "online" and drains its outbox
        const aDrain = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceA.access_token,
            deviceA.device_id,
            aInit.delta_cursor,
            offlineChanges,
        );
        expect(aDrain.accepted.length).toBe(2);

        // Device B syncs and should see both changes
        const bPull = await syncAndExpectOk(
            request,
            BASE_URL,
            deviceB.access_token,
            deviceB.device_id,
            bInit.delta_cursor,
            [],
        );

        const comment = bPull.remote_changes.find(
            (rc) => rc.table === 'comments' && rc.data.text === 'Made while offline',
        );
        expect(comment).toBeDefined();

        const note = bPull.remote_changes.find((rc) => rc.table === 'study_notes' && rc.key === studyUid);
        expect(note).toBeDefined();
        expect(note.data.description).toBe('Offline description');
    });

    test('multiple offline changes collapse correctly before syncing', async ({ request }) => {
        // Simulate: device goes offline, makes multiple updates to the same record,
        // then syncs. The outbox collapses them, so only the final state is sent.
        const device = await setupDevice(request);

        const initial = await syncAndExpectOk(request, BASE_URL, device.access_token, device.device_id, null, []);

        const studyUid = uniqueStudyUid();

        // First, create the study note while online
        const createChange = studyNoteUpdateChange(studyUid, {
            description: 'Created online',
            baseSyncVersion: 0,
        });
        const createResult = await syncAndExpectOk(
            request,
            BASE_URL,
            device.access_token,
            device.device_id,
            initial.delta_cursor,
            [createChange],
        );
        const baseVersion = createResult.accepted[0].sync_version;

        // "Offline" period: simulate what a collapsed outbox would produce.
        // Multiple updates collapse to the last one with the correct base_sync_version.
        // The outbox module handles this on the client; here we verify the server
        // accepts the collapsed result.
        const collapsedChange = studyNoteUpdateChange(studyUid, {
            description: 'Final offline value (collapsed)',
            baseSyncVersion: baseVersion,
        });

        const result = await syncAndExpectOk(
            request,
            BASE_URL,
            device.access_token,
            device.device_id,
            createResult.delta_cursor,
            [collapsedChange],
        );

        expect(result.accepted.length).toBe(1);
        expect(result.accepted[0].sync_version).toBeGreaterThan(baseVersion);

        // Verify the server has the collapsed value via a second device
        const deviceB = await setupSecondDevice(request, device.email, device.password);
        const bPull = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);
        const note = bPull.remote_changes.find((rc) => rc.key === studyUid && rc.table === 'study_notes');
        expect(note).toBeDefined();
        expect(note.data.description).toBe('Final offline value (collapsed)');
    });
});

// ---------------------------------------------------------------------------
// Suite: Report file sync
// ---------------------------------------------------------------------------

test.describe('E2E Report File Sync', () => {
    test('upload a report on Device A, sync, Device B can download the file', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Device A creates and uploads a report
        const pdfContent = minimalPdfBuffer();
        const { reportId, contentHash } = await insertReportWithFile(
            request,
            deviceA.access_token,
            deviceA.device_id,
            null,
            pdfContent,
        );

        // Device B syncs to learn about the report
        const bSync = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);
        const reportOnB = bSync.remote_changes.find((rc) => rc.key === reportId && rc.table === 'reports');
        expect(reportOnB).toBeDefined();
        expect(reportOnB.data.content_hash).toBe(contentHash);

        // Device B downloads the report file
        const downloadResponse = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${deviceB.access_token}` },
        });
        expect(downloadResponse.status()).toBe(200);

        const downloadedBytes = await downloadResponse.body();
        expect(downloadedBytes).toEqual(pdfContent);
    });

    test('report content hash matches between devices', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Device A uploads a report with known content
        const pdfContent = Buffer.from('%PDF-1.4\nE2E hash verification content\n%%EOF\n');
        const expectedHash = sha256Hex(pdfContent);

        const { reportId } = await insertReportWithFile(
            request,
            deviceA.access_token,
            deviceA.device_id,
            null,
            pdfContent,
        );

        // Device B syncs and verifies the hash in metadata matches
        const bSync = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);
        const reportMeta = bSync.remote_changes.find((rc) => rc.key === reportId && rc.table === 'reports');
        expect(reportMeta).toBeDefined();
        expect(reportMeta.data.content_hash).toBe(expectedHash);

        // Device B downloads the file and independently verifies the hash
        const downloadResponse = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${deviceB.access_token}` },
        });
        expect(downloadResponse.status()).toBe(200);

        const downloadedBytes = await downloadResponse.body();
        const downloadedHash = sha256Hex(downloadedBytes);
        expect(downloadedHash).toBe(expectedHash);
    });

    test('user B cannot download user A report blob even with a known report id', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const userB = await setupDevice(request);

        const pdfContent = minimalPdfBuffer();
        const { reportId } = await insertReportWithFile(
            request,
            deviceA.access_token,
            deviceA.device_id,
            null,
            pdfContent,
        );

        const downloadResponse = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${userB.access_token}` },
        });

        expect(downloadResponse.status()).toBe(404);
    });

    test('soft-deleted report file returns 404 on download', async ({ request }) => {
        const deviceA = await setupDevice(request);

        // Create and upload a report
        const { reportId, syncVersion, cursor } = await insertReportWithFile(
            request,
            deviceA.access_token,
            deviceA.device_id,
            null,
        );

        // Verify the file is downloadable before deletion
        const beforeDelete = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${deviceA.access_token}` },
        });
        expect(beforeDelete.status()).toBe(200);

        // Soft-delete the report
        const deleteChange = reportDeleteChange(reportId, {
            baseSyncVersion: syncVersion,
        });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, cursor, [deleteChange]);

        // After deletion, download should return 404
        const afterDelete = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${deviceA.access_token}` },
        });
        expect(afterDelete.status()).toBe(404);

        // Verify from a second device too
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);
        const bDownload = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${deviceB.access_token}` },
        });
        expect(bDownload.status()).toBe(404);
    });
});

// ---------------------------------------------------------------------------
// Suite: Cursor management
// ---------------------------------------------------------------------------

test.describe('E2E Cursor Management', () => {
    test('first sync with null cursor returns all data', async ({ request }) => {
        const deviceA = await setupDevice(request);

        // Create several records across different tables
        const studyUid = uniqueStudyUid();
        const changes = [
            commentInsertChange({ studyUid, text: 'Cursor test comment 1' }),
            commentInsertChange({ studyUid, text: 'Cursor test comment 2' }),
            studyNoteUpdateChange(studyUid, {
                description: 'Cursor test note',
                baseSyncVersion: 0,
            }),
        ];
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, changes);

        // A brand new device syncs with null cursor -- should get everything
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);
        const fullSync = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);

        // Verify all three records appear
        for (const change of changes) {
            const found = fullSync.remote_changes.find((rc) => rc.key === change.key);
            expect(found).toBeDefined();
        }
        expect(typeof fullSync.delta_cursor).toBe('string');
        expect(fullSync.delta_cursor.length).toBeGreaterThan(0);
    });

    test('subsequent syncs only return changes since last cursor', async ({ request }) => {
        const deviceA = await setupDevice(request);
        const deviceB = await setupSecondDevice(request, deviceA.email, deviceA.password);

        // Phase 1: Device A creates a comment, Device B syncs to get cursor
        const change1 = commentInsertChange({ text: 'Phase 1 comment' });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [change1]);

        const bSync1 = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, null, []);
        const cursor1 = bSync1.delta_cursor;

        // Phase 1 comment should be in the full sync
        const phase1Found = bSync1.remote_changes.find((rc) => rc.key === change1.key);
        expect(phase1Found).toBeDefined();

        // Phase 2: Device A creates another comment
        const change2 = commentInsertChange({ text: 'Phase 2 comment' });
        await syncAndExpectOk(request, BASE_URL, deviceA.access_token, deviceA.device_id, null, [change2]);

        // Device B syncs with cursor -- should only get Phase 2 comment
        const bSync2 = await syncAndExpectOk(request, BASE_URL, deviceB.access_token, deviceB.device_id, cursor1, []);

        const phase2Found = bSync2.remote_changes.find((rc) => rc.key === change2.key);
        expect(phase2Found).toBeDefined();

        // Phase 1 comment should NOT appear (it was before the cursor)
        const phase1Again = bSync2.remote_changes.find((rc) => rc.key === change1.key);
        expect(phase1Again).toBeUndefined();
    });

    test('expired cursor triggers full resync', async ({ request }) => {
        const device = await setupDevice(request);

        // Use a fabricated expired cursor
        const response = await syncRequest(
            request,
            BASE_URL,
            device.access_token,
            device.device_id,
            'clearly-expired-cursor-abc123',
            [],
        );
        expect(response.status()).toBe(410);

        const body = await response.json();
        expect(body.error).toBe('cursor_expired');
        expect(body.hint).toBe('full_resync');

        // Recovery: client does a full resync with null cursor
        const studyUid = uniqueStudyUid();
        const change = commentInsertChange({ studyUid, text: 'Before full resync' });
        await syncAndExpectOk(request, BASE_URL, device.access_token, device.device_id, null, [change]);

        // Full resync (null cursor) works and returns the data
        const fullResync = await syncAndExpectOk(request, BASE_URL, device.access_token, device.device_id, null, []);
        expect(typeof fullResync.delta_cursor).toBe('string');

        // A second device should see the data via full resync too
        const device2 = await setupSecondDevice(request, device.email, device.password);
        const d2Sync = await syncAndExpectOk(request, BASE_URL, device2.access_token, device2.device_id, null, []);
        const found = d2Sync.remote_changes.find((rc) => rc.key === change.key);
        expect(found).toBeDefined();
    });
});
