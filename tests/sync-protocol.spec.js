// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Integration tests for the cloud sync protocol (server-side).
 *
 * Tests the POST /api/sync endpoint and related auth/device registration
 * endpoints per the frozen SYNC-CONTRACT-V1.md specification.
 *
 * These tests use Playwright's request API (no browser needed). They will
 * initially FAIL because the server sync endpoint does not exist yet --
 * they will pass after the server-sync-api and auth-devices lanes are merged.
 *
 * Contract: docs/planning/SYNC-CONTRACT-V1.md (frozen 2026-03-25)
 */

const { test, expect } = require('@playwright/test');
const {
    BASE_URL,
    uniqueStudyUid,
    uniqueRecordUuid,
    uniqueOperationUuid,
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
// Suite: Auth requirements
// ---------------------------------------------------------------------------

test.describe('Sync Auth Requirements', () => {
    test('POST /api/sync without token returns 401', async ({ request }) => {
        const response = await request.post(`${BASE_URL}/api/sync`, {
            data: {
                device_id: 'any-device-id',
                delta_cursor: null,
                changes: [],
            },
        });
        expect(response.status()).toBe(401);
    });

    test('POST /api/sync with expired token returns 401', async ({ request }) => {
        // An obviously invalid/expired token should be rejected
        const response = await request.post(`${BASE_URL}/api/sync`, {
            headers: { Authorization: 'Bearer expired.invalid.token' },
            data: {
                device_id: 'any-device-id',
                delta_cursor: null,
                changes: [],
            },
        });
        expect(response.status()).toBe(401);
    });

    test('POST /api/sync with unregistered device_id returns 403', async ({ request }) => {
        const { access_token } = await setupSyncUser(request);

        // Use a device_id that was never registered for this user
        const response = await syncRequest(request, BASE_URL, access_token, 'unregistered-device-id-12345', null, []);
        expect(response.status()).toBe(403);

        const body = await response.json();
        expect(body.error).toBe('device_not_registered');
    });
});

// ---------------------------------------------------------------------------
// Suite: Basic sync flow
// ---------------------------------------------------------------------------

test.describe('Sync Basic Flow', () => {
    test('first sync (null cursor) returns all records for user', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        // Push a comment first so there is data to retrieve
        const change = commentInsertChange();
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change]);

        // Second device syncs with null cursor and should receive the comment
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const result = await syncAndExpectOk(request, BASE_URL, access_token, device2, null, []);

        expect(result).toHaveProperty('accepted');
        expect(result).toHaveProperty('rejected');
        expect(result).toHaveProperty('remote_changes');
        expect(result).toHaveProperty('delta_cursor');
        expect(result).toHaveProperty('server_time');
        expect(typeof result.delta_cursor).toBe('string');
        expect(typeof result.server_time).toBe('number');

        // The comment pushed by device 1 should appear in remote_changes for device 2
        const found = result.remote_changes.find((rc) => rc.key === change.key && rc.table === 'comments');
        expect(found).toBeDefined();
        expect(found.data.text).toBe(change.data.text);
    });

    test('sync with valid cursor returns only changes since cursor', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        // Push a comment and capture the cursor
        const change1 = commentInsertChange();
        const result1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change1]);
        const cursor = result1.delta_cursor;

        // Push a second comment
        const change2 = commentInsertChange();
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, cursor, [change2]);

        // A second device syncs from the first cursor -- should see change2 but not change1
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const result2 = await syncAndExpectOk(request, BASE_URL, access_token, device2, cursor, []);

        const foundChange2 = result2.remote_changes.find((rc) => rc.key === change2.key);
        expect(foundChange2).toBeDefined();

        // change1 should NOT appear because it was before the cursor
        const foundChange1 = result2.remote_changes.find((rc) => rc.key === change1.key);
        expect(foundChange1).toBeUndefined();
    });

    test('empty sync (no changes either direction) returns empty arrays', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        // First sync to establish a cursor
        const result1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, []);

        // Second sync with cursor and no changes
        const result2 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, result1.delta_cursor, []);

        expect(result2.accepted).toEqual([]);
        expect(result2.rejected).toEqual([]);
        expect(result2.remote_changes).toEqual([]);
        expect(typeof result2.delta_cursor).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// Suite: Push -- accepted changes
// ---------------------------------------------------------------------------

test.describe('Sync Push - Accepted Changes', () => {
    test('insert a comment, verify it appears in accepted with sync_version', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const change = commentInsertChange();

        const result = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change]);

        expect(result.accepted.length).toBe(1);
        const accepted = result.accepted[0];
        expect(accepted.operation_uuid).toBe(change.operation_uuid);
        expect(accepted.key).toBe(change.key);
        expect(typeof accepted.sync_version).toBe('number');
        expect(accepted.sync_version).toBeGreaterThan(0);
    });

    test('update a study note, verify accepted', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();

        // Insert the study note first
        const insertChange = studyNoteUpdateChange(studyUid, {
            description: 'Initial description',
            baseSyncVersion: 0,
        });
        const insertResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);
        expect(insertResult.accepted.length).toBe(1);
        const insertedVersion = insertResult.accepted[0].sync_version;

        // Update the study note with the correct base_sync_version
        const updateChange = studyNoteUpdateChange(studyUid, {
            description: 'Updated description',
            baseSyncVersion: insertedVersion,
        });
        const updateResult = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            device_id,
            insertResult.delta_cursor,
            [updateChange],
        );

        expect(updateResult.accepted.length).toBe(1);
        expect(updateResult.accepted[0].operation_uuid).toBe(updateChange.operation_uuid);
        expect(updateResult.accepted[0].sync_version).toBeGreaterThan(insertedVersion);
    });

    test('delete (tombstone) a report, verify accepted', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const reportId = uniqueRecordUuid();

        // Insert a report record first via sync
        const insertChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: reportId,
            operation: 'insert',
            base_sync_version: 0,
            data: {
                study_uid: uniqueStudyUid(),
                name: 'Test Report',
                type: 'pdf',
                created_at: Date.now(),
                updated_at: Date.now(),
            },
        };
        const insertResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);
        const insertedVersion = insertResult.accepted[0].sync_version;

        // Delete the report
        const deleteChange = reportDeleteChange(reportId, {
            baseSyncVersion: insertedVersion,
        });
        const deleteResult = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            device_id,
            insertResult.delta_cursor,
            [deleteChange],
        );

        expect(deleteResult.accepted.length).toBe(1);
        expect(deleteResult.accepted[0].operation_uuid).toBe(deleteChange.operation_uuid);
        expect(deleteResult.accepted[0].sync_version).toBeGreaterThan(insertedVersion);
    });
});

// ---------------------------------------------------------------------------
// Suite: Push -- rejected changes (stale base_sync_version)
// ---------------------------------------------------------------------------

test.describe('Sync Push - Rejected Changes (Stale base_sync_version)', () => {
    test('submit change with stale base_sync_version, verify rejected with current data', async ({ request }) => {
        const user = await setupSyncUser(request);
        const { access_token, device_id } = user;
        const studyUid = uniqueStudyUid();

        // Insert a study note (version 0 -> accepted)
        const insertChange = studyNoteUpdateChange(studyUid, {
            description: 'Version one',
            baseSyncVersion: 0,
        });
        const insertResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);
        const currentVersion = insertResult.accepted[0].sync_version;

        // Update from another device to advance the version
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const updateChange = studyNoteUpdateChange(studyUid, {
            description: 'Version two from device B',
            baseSyncVersion: currentVersion,
        });
        const updateResult = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            device2,
            insertResult.delta_cursor,
            [updateChange],
        );
        const newerVersion = updateResult.accepted[0].sync_version;

        // Now device 1 tries to update with the OLD base_sync_version
        const staleChange = studyNoteUpdateChange(studyUid, {
            description: 'Stale update from device A',
            baseSyncVersion: currentVersion, // stale -- device B already advanced it
        });
        const staleResult = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            device_id,
            insertResult.delta_cursor,
            [staleChange],
        );

        // The change should be rejected
        expect(staleResult.rejected.length).toBe(1);
        const rejected = staleResult.rejected[0];
        expect(rejected.operation_uuid).toBe(staleChange.operation_uuid);
        expect(rejected.key).toBe(studyUid);
        expect(rejected.reason).toBe('stale');
        expect(rejected.current_sync_version).toBe(newerVersion);
        expect(rejected).toHaveProperty('current_data');
        expect(rejected.current_data.description).toBe('Version two from device B');
    });

    test('rejected response includes current_sync_version and current_data', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();

        // Insert
        const insert = studyNoteUpdateChange(studyUid, {
            description: 'First',
            baseSyncVersion: 0,
        });
        const r1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insert]);
        const v1 = r1.accepted[0].sync_version;

        // Update
        const update = studyNoteUpdateChange(studyUid, {
            description: 'Second',
            baseSyncVersion: v1,
        });
        const r2 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, r1.delta_cursor, [update]);
        const v2 = r2.accepted[0].sync_version;

        // Stale attempt using v1 (which is now outdated)
        const stale = studyNoteUpdateChange(studyUid, {
            description: 'Should be rejected',
            baseSyncVersion: v1,
        });
        const r3 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, r2.delta_cursor, [stale]);

        expect(r3.rejected.length).toBeGreaterThanOrEqual(1);
        const rej = r3.rejected.find((r) => r.key === studyUid);
        expect(rej).toBeDefined();
        expect(typeof rej.current_sync_version).toBe('number');
        expect(rej.current_sync_version).toBe(v2);
        expect(rej.current_data).toHaveProperty('description');
        expect(rej.current_data.description).toBe('Second');
    });

    test('unknown operation does not advance sync_version for the next valid write', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();

        const insert = studyNoteUpdateChange(studyUid, {
            description: 'Initial version',
            baseSyncVersion: 0,
        });
        const inserted = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insert]);
        const currentVersion = inserted.accepted[0].sync_version;

        const invalid = {
            ...studyNoteUpdateChange(studyUid, {
                description: 'Invalid operation should be rejected',
                baseSyncVersion: currentVersion,
            }),
            operation: 'invalid_op',
        };
        const invalidResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, inserted.delta_cursor, [
            invalid,
        ]);

        expect(invalidResult.accepted).toEqual([]);
        expect(invalidResult.rejected).toHaveLength(1);
        expect(invalidResult.rejected[0]).toMatchObject({
            operation_uuid: invalid.operation_uuid,
            key: studyUid,
            reason: 'unknown_operation',
            current_sync_version: currentVersion,
        });

        const validUpdate = studyNoteUpdateChange(studyUid, {
            description: 'Valid update after rejection',
            baseSyncVersion: currentVersion,
        });
        const updated = await syncAndExpectOk(request, BASE_URL, access_token, device_id, inserted.delta_cursor, [
            validUpdate,
        ]);

        expect(updated.rejected).toEqual([]);
        expect(updated.accepted).toHaveLength(1);
        expect(updated.accepted[0].operation_uuid).toBe(validUpdate.operation_uuid);
        expect(updated.accepted[0].sync_version).toBeGreaterThan(currentVersion);
    });
});

// ---------------------------------------------------------------------------
// Suite: Idempotency (operation_uuid dedup)
// ---------------------------------------------------------------------------

test.describe('Sync Idempotency (operation_uuid dedup)', () => {
    test('submit same operation_uuid twice, both return accepted with same sync_version', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const change = commentInsertChange();

        // First submission
        const result1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change]);
        expect(result1.accepted.length).toBe(1);
        const version1 = result1.accepted[0].sync_version;

        // Second submission with the same operation_uuid
        const result2 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, result1.delta_cursor, [
            change,
        ]);
        expect(result2.accepted.length).toBe(1);
        const version2 = result2.accepted[0].sync_version;

        // Both should return the same sync_version (idempotent)
        expect(version2).toBe(version1);
        expect(result2.accepted[0].operation_uuid).toBe(change.operation_uuid);
    });

    test('second submission does not create duplicate data', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const change = commentInsertChange();

        // Submit twice
        const r1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change]);
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, r1.delta_cursor, [change]);

        // Sync from a second device to pull all data
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const pullResult = await syncAndExpectOk(request, BASE_URL, access_token, device2, null, []);

        // The comment should appear exactly once in remote_changes
        const matches = pullResult.remote_changes.filter((rc) => rc.key === change.key && rc.table === 'comments');
        expect(matches.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Suite: Pull -- remote changes
// ---------------------------------------------------------------------------

test.describe('Sync Pull - Remote Changes', () => {
    test('Device A pushes a change, Device B syncs and receives it in remote_changes', async ({ request }) => {
        const { access_token, device_id: deviceA } = await setupSyncUser(request);
        const { device_id: deviceB } = await registerDevice(request, BASE_URL, access_token);

        // Device B does an initial sync to get a cursor
        const initialSync = await syncAndExpectOk(request, BASE_URL, access_token, deviceB, null, []);

        // Device A pushes a comment
        const change = commentInsertChange({ text: 'Hello from device A' });
        await syncAndExpectOk(request, BASE_URL, access_token, deviceA, null, [change]);

        // Device B syncs from its cursor -- should see device A's comment
        const pullResult = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            deviceB,
            initialSync.delta_cursor,
            [],
        );

        const found = pullResult.remote_changes.find((rc) => rc.key === change.key && rc.table === 'comments');
        expect(found).toBeDefined();
        expect(found.operation).toBe('insert');
        expect(found.data.text).toBe('Hello from device A');
        expect(typeof found.sync_version).toBe('number');
    });

    test('tombstoned records appear in remote_changes with deleted_at set', async ({ request }) => {
        const { access_token, device_id: deviceA } = await setupSyncUser(request);
        const { device_id: deviceB } = await registerDevice(request, BASE_URL, access_token);

        // Device A inserts a comment
        const commentKey = uniqueRecordUuid();
        const insertChange = commentInsertChange({ key: commentKey, text: 'Will be deleted' });
        const r1 = await syncAndExpectOk(request, BASE_URL, access_token, deviceA, null, [insertChange]);
        const insertedVersion = r1.accepted[0].sync_version;

        // Device B syncs to establish cursor
        const deviceBSync = await syncAndExpectOk(request, BASE_URL, access_token, deviceB, null, []);

        // Device A deletes the comment
        const deleteChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'comments',
            key: commentKey,
            operation: 'delete',
            base_sync_version: insertedVersion,
            data: {},
        };
        await syncAndExpectOk(request, BASE_URL, access_token, deviceA, r1.delta_cursor, [deleteChange]);

        // Device B pulls -- should see the tombstoned record
        const pullResult = await syncAndExpectOk(
            request,
            BASE_URL,
            access_token,
            deviceB,
            deviceBSync.delta_cursor,
            [],
        );

        // Find the delete change in remote_changes (may also see the insert if cursor
        // was before it; the key thing is that we see a version with deleted_at set)
        const tombstoned = pullResult.remote_changes.find(
            (rc) => rc.key === commentKey && rc.data.deleted_at !== null && rc.data.deleted_at !== undefined,
        );
        expect(tombstoned).toBeDefined();
        expect(typeof tombstoned.data.deleted_at).toBe('number');
    });
});

// ---------------------------------------------------------------------------
// Suite: Cursor management
// ---------------------------------------------------------------------------

test.describe('Sync Cursor Management', () => {
    test('valid cursor returns changes since that point', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        // Push change 1, get cursor
        const change1 = commentInsertChange({ text: 'Before cursor' });
        const r1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change1]);
        const cursorAfterChange1 = r1.delta_cursor;

        // Push change 2
        const change2 = commentInsertChange({ text: 'After cursor' });
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, cursorAfterChange1, [change2]);

        // New device syncs from cursorAfterChange1 -- should see change2 only
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const result = await syncAndExpectOk(request, BASE_URL, access_token, device2, cursorAfterChange1, []);

        const foundChange2 = result.remote_changes.find((rc) => rc.key === change2.key);
        const foundChange1 = result.remote_changes.find((rc) => rc.key === change1.key);
        expect(foundChange2).toBeDefined();
        expect(foundChange1).toBeUndefined();
    });

    test('expired cursor returns 410 with cursor_expired error', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        // Use a clearly fake/expired cursor
        const response = await syncRequest(
            request,
            BASE_URL,
            access_token,
            device_id,
            'expired-cursor-that-does-not-exist',
            [],
        );
        expect(response.status()).toBe(410);

        const body = await response.json();
        expect(body.error).toBe('cursor_expired');
        expect(body.hint).toBe('full_resync');
    });

    test('null cursor returns full enumeration', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        // Push multiple changes
        const change1 = commentInsertChange({ text: 'Comment one' });
        const change2 = commentInsertChange({ text: 'Comment two' });
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change1, change2]);

        // A new device does a full sync (null cursor)
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const result = await syncAndExpectOk(request, BASE_URL, access_token, device2, null, []);

        // Both changes should appear in remote_changes
        const found1 = result.remote_changes.find((rc) => rc.key === change1.key);
        const found2 = result.remote_changes.find((rc) => rc.key === change2.key);
        expect(found1).toBeDefined();
        expect(found2).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Suite: Report file sync
// ---------------------------------------------------------------------------

test.describe('Sync Report File Operations', () => {
    test('upload report file via POST /api/sync/reports/<id>/file', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const reportId = uniqueRecordUuid();
        const pdfContent = minimalPdfBuffer();
        const contentHash = sha256Hex(pdfContent);

        // First register the report via sync so the server knows about it
        const insertChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: reportId,
            operation: 'insert',
            base_sync_version: 0,
            data: {
                study_uid: uniqueStudyUid(),
                name: 'Test Report',
                type: 'pdf',
                content_hash: contentHash,
                created_at: Date.now(),
                updated_at: Date.now(),
            },
        };
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);

        // Upload the file
        const uploadResponse = await request.post(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
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
    });

    test('download report file via GET /api/sync/reports/<id>/file', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const reportId = uniqueRecordUuid();
        const pdfContent = minimalPdfBuffer();
        const contentHash = sha256Hex(pdfContent);

        // Register and upload
        const insertChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: reportId,
            operation: 'insert',
            base_sync_version: 0,
            data: {
                study_uid: uniqueStudyUid(),
                name: 'Download Test',
                type: 'pdf',
                content_hash: contentHash,
                created_at: Date.now(),
                updated_at: Date.now(),
            },
        };
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);

        await request.post(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
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

        // Download
        const downloadResponse = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        expect(downloadResponse.status()).toBe(200);

        const downloadedBytes = await downloadResponse.body();
        expect(downloadedBytes).toEqual(pdfContent);
    });

    test('Content-Hash dedup: same hash skips re-upload', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const reportId = uniqueRecordUuid();
        const pdfContent = minimalPdfBuffer();
        const contentHash = sha256Hex(pdfContent);

        // Register the report
        const insertChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: reportId,
            operation: 'insert',
            base_sync_version: 0,
            data: {
                study_uid: uniqueStudyUid(),
                name: 'Dedup Test',
                type: 'pdf',
                content_hash: contentHash,
                created_at: Date.now(),
                updated_at: Date.now(),
            },
        };
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);

        const uploadHeaders = {
            Authorization: `Bearer ${access_token}`,
            'Content-Hash': `sha256:${contentHash}`,
        };
        const uploadBody = {
            file: {
                name: 'report.pdf',
                mimeType: 'application/pdf',
                buffer: pdfContent,
            },
        };

        // First upload
        const upload1 = await request.post(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: uploadHeaders,
            multipart: uploadBody,
        });
        expect(upload1.status()).toBe(200);

        // Second upload with same hash -- should be accepted (deduped)
        const upload2 = await request.post(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: uploadHeaders,
            multipart: uploadBody,
        });
        expect(upload2.status()).toBe(200);

        // File should still be downloadable
        const download = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        expect(download.status()).toBe(200);
        expect(await download.body()).toEqual(pdfContent);
    });

    test('tombstoned report file returns 404', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const reportId = uniqueRecordUuid();
        const pdfContent = minimalPdfBuffer();
        const contentHash = sha256Hex(pdfContent);

        // Insert the report
        const insertChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: reportId,
            operation: 'insert',
            base_sync_version: 0,
            data: {
                study_uid: uniqueStudyUid(),
                name: 'Tombstone Test',
                type: 'pdf',
                content_hash: contentHash,
                created_at: Date.now(),
                updated_at: Date.now(),
            },
        };
        const r1 = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insertChange]);
        const insertedVersion = r1.accepted[0].sync_version;

        // Upload the file
        await request.post(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
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

        // Tombstone the report via sync
        const deleteChange = reportDeleteChange(reportId, {
            baseSyncVersion: insertedVersion,
        });
        await syncAndExpectOk(request, BASE_URL, access_token, device_id, r1.delta_cursor, [deleteChange]);

        // Attempting to download should return 404
        const download = await request.get(`${BASE_URL}/api/sync/reports/${reportId}/file`, {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        expect(download.status()).toBe(404);
    });
});

// ---------------------------------------------------------------------------
// Suite: Cross-user isolation
// ---------------------------------------------------------------------------

test.describe('Sync Cross-User Isolation', () => {
    test('User A data is not visible to User B', async ({ request }) => {
        // Setup two separate users
        const userA = await setupSyncUser(request);
        const userB = await setupSyncUser(request);

        // User A pushes a comment
        const change = commentInsertChange({ text: 'Private to user A' });
        await syncAndExpectOk(request, BASE_URL, userA.access_token, userA.device_id, null, [change]);

        // User B does a full sync -- should NOT see user A's comment
        const result = await syncAndExpectOk(request, BASE_URL, userB.access_token, userB.device_id, null, []);

        const found = result.remote_changes.find((rc) => rc.key === change.key);
        expect(found).toBeUndefined();
    });

    test('same study_uid does not collide across different users', async ({ request }) => {
        const userA = await setupSyncUser(request);
        const userB = await setupSyncUser(request);
        const sharedStudyUid = '1.2.840.2026.cross-user.shared-study';

        const changeA = studyNoteUpdateChange(sharedStudyUid, {
            description: 'User A private note',
        });
        const changeB = studyNoteUpdateChange(sharedStudyUid, {
            description: 'User B private note',
        });

        await syncAndExpectOk(request, BASE_URL, userA.access_token, userA.device_id, null, [changeA]);
        await syncAndExpectOk(request, BASE_URL, userB.access_token, userB.device_id, null, [changeB]);

        const { device_id: userASecondDevice } = await registerDevice(request, BASE_URL, userA.access_token);
        const { device_id: userBSecondDevice } = await registerDevice(request, BASE_URL, userB.access_token);

        const userAPull = await syncAndExpectOk(request, BASE_URL, userA.access_token, userASecondDevice, null, []);
        const userBPull = await syncAndExpectOk(request, BASE_URL, userB.access_token, userBSecondDevice, null, []);

        const userAStudyNote = userAPull.remote_changes.find(
            (change) => change.table === 'study_notes' && change.key === sharedStudyUid,
        );
        const userBStudyNote = userBPull.remote_changes.find(
            (change) => change.table === 'study_notes' && change.key === sharedStudyUid,
        );

        expect(userAStudyNote?.data?.description).toBe('User A private note');
        expect(userBStudyNote?.data?.description).toBe('User B private note');
    });

    test('sync versions are allocated independently per user', async ({ request }) => {
        const userA = await setupSyncUser(request);
        const userB = await setupSyncUser(request);

        const changeA = commentInsertChange({ text: 'User A first change' });
        const changeB = commentInsertChange({ text: 'User B first change' });

        const resultA = await syncAndExpectOk(
            request, BASE_URL, userA.access_token, userA.device_id, null, [changeA]
        );
        const resultB = await syncAndExpectOk(
            request, BASE_URL, userB.access_token, userB.device_id, null, [changeB]
        );

        expect(resultA.accepted).toHaveLength(1);
        expect(resultB.accepted).toHaveLength(1);
        expect(resultA.accepted[0].sync_version).toBe(1);
        expect(resultB.accepted[0].sync_version).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Suite: Response shape validation
// ---------------------------------------------------------------------------

test.describe('Sync Response Shape', () => {
    test('sync response contains all required fields per contract', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);

        const result = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, []);

        // Required top-level fields
        expect(result).toHaveProperty('accepted');
        expect(result).toHaveProperty('rejected');
        expect(result).toHaveProperty('remote_changes');
        expect(result).toHaveProperty('delta_cursor');
        expect(result).toHaveProperty('server_time');

        // Type checks
        expect(Array.isArray(result.accepted)).toBe(true);
        expect(Array.isArray(result.rejected)).toBe(true);
        expect(Array.isArray(result.remote_changes)).toBe(true);
        expect(typeof result.delta_cursor).toBe('string');
        expect(typeof result.server_time).toBe('number');
        expect(result.server_time).toBeGreaterThan(0);
    });

    test('accepted items have operation_uuid, key, and sync_version', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const change = commentInsertChange();

        const result = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [change]);

        expect(result.accepted.length).toBe(1);
        const item = result.accepted[0];
        expect(typeof item.operation_uuid).toBe('string');
        expect(typeof item.key).toBe('string');
        expect(typeof item.sync_version).toBe('number');
    });

    test('remote_changes items have table, key, sync_version, operation, and data', async ({ request }) => {
        const { access_token, device_id: deviceA } = await setupSyncUser(request);
        const { device_id: deviceB } = await registerDevice(request, BASE_URL, access_token);

        // Device A pushes data
        const change = commentInsertChange({ text: 'Shape test' });
        await syncAndExpectOk(request, BASE_URL, access_token, deviceA, null, [change]);

        // Device B pulls
        const result = await syncAndExpectOk(request, BASE_URL, access_token, deviceB, null, []);

        expect(result.remote_changes.length).toBeGreaterThan(0);
        const item = result.remote_changes[0];
        expect(typeof item.table).toBe('string');
        expect(typeof item.key).toBe('string');
        expect(typeof item.sync_version).toBe('number');
        expect(typeof item.operation).toBe('string');
        expect(typeof item.data).toBe('object');
    });
});

// ---------------------------------------------------------------------------
// Suite: Multiple changes in single sync
// ---------------------------------------------------------------------------

test.describe('Sync Multiple Changes Per Request', () => {
    test('multiple inserts across different tables in one sync request', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();
        const reportId = uniqueRecordUuid();

        const changes = [
            commentInsertChange({ studyUid, text: 'Multi-table comment' }),
            studyNoteUpdateChange(studyUid, { description: 'Multi-table note' }),
            {
                operation_uuid: uniqueOperationUuid(),
                table: 'reports',
                key: reportId,
                operation: 'insert',
                base_sync_version: 0,
                data: {
                    study_uid: studyUid,
                    name: 'Multi-table report',
                    type: 'pdf',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                },
            },
        ];

        const result = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, changes);

        // All three should be accepted
        expect(result.accepted.length).toBe(3);
        const uuids = result.accepted.map((a) => a.operation_uuid);
        for (const change of changes) {
            expect(uuids).toContain(change.operation_uuid);
        }
    });

    test('mix of accepted and rejected changes in one sync', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();

        // Insert a study note first
        const insert = studyNoteUpdateChange(studyUid, {
            description: 'Original',
            baseSyncVersion: 0,
        });
        const initialSync = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [insert]);

        // Send two changes: one with correct version (new comment), one with stale version
        const freshChange = commentInsertChange({ text: 'Fresh comment' });
        const staleChange = studyNoteUpdateChange(studyUid, {
            description: 'Stale update',
            baseSyncVersion: 0,
        });

        const result = await syncAndExpectOk(request, BASE_URL, access_token, device_id, initialSync.delta_cursor, [
            freshChange,
            staleChange,
        ]);

        // Fresh comment should be accepted
        const acceptedUuids = result.accepted.map((a) => a.operation_uuid);
        expect(acceptedUuids).toContain(freshChange.operation_uuid);

        // Stale update should be rejected
        const rejectedUuids = result.rejected.map((r) => r.operation_uuid);
        expect(rejectedUuids).toContain(staleChange.operation_uuid);
    });
});
