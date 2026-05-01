// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Tests for deleting records that were never inserted to the cloud.
 *
 * When a device inserts then deletes a record before syncing, the outbox
 * collapses the pair to a single "delete" operation. The server must still
 * create a tombstone so other devices see the deletion. If the server uses
 * UPDATE ... WHERE instead of INSERT ... ON CONFLICT DO UPDATE, the UPDATE
 * matches 0 rows and the tombstone is silently lost.
 *
 * This file captures the desired behaviour for a known sync gap. It is marked
 * fixme until the server accepts delete-only changes as tombstones instead of
 * returning 500.
 */

const { test, expect } = require('@playwright/test');
const {
    BASE_URL,
    uniqueStudyUid,
    uniqueRecordUuid,
    uniqueOperationUuid,
    registerDevice,
    syncAndExpectOk,
    setupSyncUser,
} = require('./sync-helpers');

test.describe('Sync: delete of never-inserted records', () => {
    test.fixme(true, 'Delete-only changes should create tombstones instead of returning 500.');

    test('comment delete without prior insert produces a visible tombstone', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();
        const recordUuid = uniqueRecordUuid();

        // Send a delete for a comment that was never inserted to the cloud.
        // This simulates: device created + deleted a comment before first sync,
        // outbox collapsed to a single delete operation.
        const deleteChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'comments',
            key: recordUuid,
            operation: 'delete',
            base_sync_version: 0,
            data: {
                study_uid: studyUid,
            },
        };

        const deleteResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [deleteChange]);

        expect(deleteResult.accepted).toHaveLength(1);
        expect(deleteResult.accepted[0].operation_uuid).toBe(deleteChange.operation_uuid);

        // A second device pulling from before the delete should see the tombstone.
        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const pullResult = await syncAndExpectOk(request, BASE_URL, access_token, device2, null, []);

        const tombstone = pullResult.remote_changes.find(
            (change) => change.table === 'comments' && change.key === recordUuid,
        );
        expect(tombstone).toBeDefined();
        expect(tombstone.operation).toBe('delete');
        expect(tombstone.data.deleted_at).toBeDefined();
        expect(tombstone.data.deleted_at).not.toBeNull();
    });

    test('report delete without prior insert produces a visible tombstone', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();
        const recordUuid = uniqueRecordUuid();

        const deleteChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'reports',
            key: recordUuid,
            operation: 'delete',
            base_sync_version: 0,
            data: {
                study_uid: studyUid,
            },
        };

        const deleteResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [deleteChange]);

        expect(deleteResult.accepted).toHaveLength(1);

        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const pullResult = await syncAndExpectOk(request, BASE_URL, access_token, device2, null, []);

        const tombstone = pullResult.remote_changes.find(
            (change) => change.table === 'reports' && change.key === recordUuid,
        );
        expect(tombstone).toBeDefined();
        expect(tombstone.operation).toBe('delete');
        expect(tombstone.data.deleted_at).toBeDefined();
        expect(tombstone.data.deleted_at).not.toBeNull();
    });

    test('study_notes delete without prior insert produces a visible tombstone', async ({ request }) => {
        const { access_token, device_id } = await setupSyncUser(request);
        const studyUid = uniqueStudyUid();

        const deleteChange = {
            operation_uuid: uniqueOperationUuid(),
            table: 'study_notes',
            key: studyUid,
            operation: 'delete',
            base_sync_version: 0,
            data: {},
        };

        const deleteResult = await syncAndExpectOk(request, BASE_URL, access_token, device_id, null, [deleteChange]);

        expect(deleteResult.accepted).toHaveLength(1);

        const { device_id: device2 } = await registerDevice(request, BASE_URL, access_token);
        const pullResult = await syncAndExpectOk(request, BASE_URL, access_token, device2, null, []);

        const tombstone = pullResult.remote_changes.find(
            (change) => change.table === 'study_notes' && change.key === studyUid,
        );
        expect(tombstone).toBeDefined();
        expect(tombstone.operation).toBe('delete');
        expect(typeof tombstone.data.deleted_at).toBe('number');
    });
});
