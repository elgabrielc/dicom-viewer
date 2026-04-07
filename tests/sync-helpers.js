// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Shared helpers for cloud sync integration tests.
 *
 * These utilities wrap the auth and sync endpoints defined in SYNC-CONTRACT-V1.md.
 * They are designed to work with Playwright's request API for server-side tests.
 */

const { expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

const BASE_URL = 'http://127.0.0.1:5001';

// ---------------------------------------------------------------------------
// Unique test data generators
// ---------------------------------------------------------------------------

/**
 * Generate a unique email address for test isolation.
 * Each test user gets a distinct email to prevent cross-test contamination.
 */
function uniqueEmail() {
    return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Generate a unique study UID for test isolation.
 */
function uniqueStudyUid() {
    return `test-sync-study-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate a unique record UUID (for comments, reports, etc.).
 */
function uniqueRecordUuid() {
    return randomUUID();
}

/**
 * Generate a unique operation UUID for idempotency testing.
 */
function uniqueOperationUuid() {
    return randomUUID();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Sign up a new test user and return credentials.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [baseUrl]
 * @returns {Promise<{email: string, password: string, name: string}>}
 */
async function createTestUser(request, baseUrl = BASE_URL) {
    const email = uniqueEmail();
    const password = 'TestPassword123!';
    const name = 'Test User';

    const response = await request.post(`${baseUrl}/api/auth/signup`, {
        data: { email, password, name },
    });
    expect(response.status()).toBe(201);

    return { email, password, name };
}

/**
 * Log in and return the access token.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [baseUrl]
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
 */
async function loginUser(request, baseUrl = BASE_URL, email, password) {
    const response = await request.post(`${baseUrl}/api/auth/login`, {
        data: { email, password },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body).toHaveProperty('expires_in');

    return body;
}

/**
 * Register a device for the authenticated user and return the device_id.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [baseUrl]
 * @param {string} token - Bearer access token
 * @returns {Promise<{device_id: string}>}
 */
async function registerDevice(request, baseUrl = BASE_URL, token) {
    const response = await request.post(`${baseUrl}/api/auth/devices`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
            device_name: `test-device-${Date.now()}`,
            platform: 'test',
        },
    });
    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body).toHaveProperty('device_id');
    expect(typeof body.device_id).toBe('string');

    return body;
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/**
 * Perform a sync request (POST /api/sync).
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [baseUrl]
 * @param {string} token - Bearer access token
 * @param {string} deviceId - Registered device ID
 * @param {string|null} cursor - Delta cursor (null for first sync)
 * @param {Array} [changes] - Array of change objects to push
 * @returns {Promise<import('@playwright/test').APIResponse>}
 */
async function syncRequest(request, baseUrl = BASE_URL, token, deviceId, cursor, changes = []) {
    return await request.post(`${baseUrl}/api/sync`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        data: {
            device_id: deviceId,
            delta_cursor: cursor,
            changes,
        },
    });
}

/**
 * Perform a sync request and parse the JSON response body.
 * Asserts 200 status before returning.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [baseUrl]
 * @param {string} token
 * @param {string} deviceId
 * @param {string|null} cursor
 * @param {Array} [changes]
 * @returns {Promise<{accepted: Array, rejected: Array, remote_changes: Array, delta_cursor: string, server_time: number}>}
 */
async function syncAndExpectOk(request, baseUrl = BASE_URL, token, deviceId, cursor, changes = []) {
    const response = await syncRequest(request, baseUrl, token, deviceId, cursor, changes);
    expect(response.status()).toBe(200);
    return await response.json();
}

// ---------------------------------------------------------------------------
// Change object builders
// ---------------------------------------------------------------------------

/**
 * Build a change object for inserting a comment.
 *
 * @param {Object} [opts]
 * @param {string} [opts.operationUuid]
 * @param {string} [opts.key]
 * @param {string} [opts.studyUid]
 * @param {string} [opts.text]
 * @param {number} [opts.baseSyncVersion]
 * @returns {Object}
 */
function commentInsertChange(opts = {}) {
    const key = opts.key || uniqueRecordUuid();
    const studyUid = opts.studyUid || uniqueStudyUid();
    const now = Date.now();
    return {
        operation_uuid: opts.operationUuid || uniqueOperationUuid(),
        table: 'comments',
        key,
        operation: 'insert',
        base_sync_version: opts.baseSyncVersion || 0,
        data: {
            study_uid: studyUid,
            text: opts.text || `Test comment ${now}`,
            created_at: now,
            updated_at: now,
        },
    };
}

/**
 * Build a change object for updating a study note.
 *
 * @param {string} studyUid
 * @param {Object} [opts]
 * @param {string} [opts.operationUuid]
 * @param {string} [opts.description]
 * @param {number} [opts.baseSyncVersion]
 * @returns {Object}
 */
function studyNoteUpdateChange(studyUid, opts = {}) {
    return {
        operation_uuid: opts.operationUuid || uniqueOperationUuid(),
        table: 'study_notes',
        key: studyUid,
        operation: 'update',
        base_sync_version: opts.baseSyncVersion || 0,
        data: {
            description: opts.description || `Updated description ${Date.now()}`,
        },
    };
}

/**
 * Build a change object for deleting (tombstoning) a report.
 *
 * @param {string} reportId
 * @param {Object} [opts]
 * @param {string} [opts.operationUuid]
 * @param {number} [opts.baseSyncVersion]
 * @returns {Object}
 */
function reportDeleteChange(reportId, opts = {}) {
    return {
        operation_uuid: opts.operationUuid || uniqueOperationUuid(),
        table: 'reports',
        key: reportId,
        operation: 'delete',
        base_sync_version: opts.baseSyncVersion || 0,
        data: {},
    };
}

/**
 * Build a minimal PDF buffer for report file upload tests.
 */
function minimalPdfBuffer() {
    return Buffer.from('%PDF-1.4\ntest content\n%%EOF\n');
}

/**
 * Compute a hex-encoded SHA-256 hash for a buffer.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function sha256Hex(buffer) {
    const crypto = require('node:crypto');
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// Full setup helper -- creates user, logs in, registers device
// ---------------------------------------------------------------------------

/**
 * Create a test user, log in, and register a device in one call.
 * Returns everything needed for sync tests.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [baseUrl]
 * @returns {Promise<{email: string, password: string, access_token: string, refresh_token: string, device_id: string}>}
 */
async function setupSyncUser(request, baseUrl = BASE_URL) {
    const { email, password } = await createTestUser(request, baseUrl);
    const { access_token, refresh_token } = await loginUser(request, baseUrl, email, password);
    const { device_id } = await registerDevice(request, baseUrl, access_token);

    return { email, password, access_token, refresh_token, device_id };
}

module.exports = {
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
};
