// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001/?nolib';

async function setupSyncEnginePage(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => typeof window._SyncEngine?.SyncEngine === 'function', null, {
        timeout: 10000,
    });

    await page.evaluate(() => {
        window.__SYNC_TEST_STORE = { studies: {} };

        function ensureStudy(store, studyUid) {
            if (!store.studies[studyUid]) {
                store.studies[studyUid] = {
                    description: '',
                    comments: [],
                    reports: [],
                    series: {},
                };
            }
            return store.studies[studyUid];
        }

        window._NotesInternals = {
            loadStore() {
                return structuredClone(window.__SYNC_TEST_STORE);
            },
            saveStore(store) {
                window.__SYNC_TEST_STORE = structuredClone(store);
            },
            ensureStudy,
            normalizeReportId(id) {
                return String(id || '').trim();
            },
        };
    });
}

test.describe('Sync Engine', () => {
    test('successful sync updates comment sync_version and emits lifecycle events', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForFunction(() => {
            return !!window._SyncEngine && !!window._SyncOutbox && !!window._NotesInternals;
        });

        const result = await page.evaluate(async () => {
            const studyUid = '1.2.840.sync-engine.test.study';
            const commentKey = 'comment-sync-engine-uuid';

            window._NotesInternals.saveStore({
                studies: {
                    [studyUid]: {
                        description: '',
                        comments: [
                            {
                                id: commentKey,
                                record_uuid: commentKey,
                                text: 'Needs sync',
                                time: 1,
                                created_at: 1,
                                updated_at: 1,
                                sync_version: 0,
                            },
                        ],
                        series: {},
                        reports: [],
                    },
                },
            });
            window._SyncOutbox._saveOutbox([]);
            window._SyncOutbox._saveSyncState({});

            const events = [];
            for (const type of ['sync:started', 'sync:completed', 'sync:error']) {
                window.addEventListener(type, (event) => {
                    events.push({ type, detail: event.detail || null });
                });
            }

            const queued = window._SyncOutbox.enqueueChange('comments', commentKey, 'update', 0);
            const operationUuid = queued.operation_uuid;
            const originalFetch = window.fetch;
            window.fetch = async () =>
                new Response(
                    JSON.stringify({
                        accepted: [{ operation_uuid: operationUuid, sync_version: 7 }],
                        rejected: [],
                        remote_changes: [],
                        delta_cursor: 'cursor-7',
                        server_time: 1700000000000,
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    },
                );

            try {
                const engine = new window._SyncEngine.SyncEngine({
                    getAccessToken: async () => 'valid-access-token',
                    onAuthRequired: () => {},
                });
                const summary = await engine.syncNow();
                const store = window._NotesInternals.loadStore();
                return {
                    summary,
                    events,
                    cursor: window._SyncOutbox.getCursor(),
                    pending: window._SyncOutbox.readPendingChanges(),
                    comment: store.studies[studyUid].comments[0],
                };
            } finally {
                window.fetch = originalFetch;
            }
        });

        expect(result.summary.error).toBeUndefined();
        expect(result.summary.acceptedCount).toBe(1);
        expect(result.summary.rejectedCount).toBe(0);
        expect(result.summary.noopsCleaned).toBe(0);
        expect(result.comment.sync_version).toBe(7);
        expect(result.cursor).toBe('cursor-7');
        expect(result.pending).toEqual([]);
        expect(result.events.map((event) => event.type)).toEqual(['sync:started', 'sync:completed']);
        expect(result.events[1].detail).toMatchObject({
            acceptedCount: 1,
            rejected: [],
            noopsCleaned: 0,
        });
    });

    test('transient refresh failure preserves stored tokens', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForFunction(() => !!window.DicomViewerApp?.accountUi);

        const result = await page.evaluate(async () => {
            const payload = btoa(JSON.stringify({ exp: 1 }))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
            const expiredAccessToken = `header.${payload}.signature`;

            await window.DicomViewerApp.accountUi._storeTokens(expiredAccessToken, 'refresh-token-123');

            const originalFetch = window.fetch;
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : String(input?.url || '');
                if (url.includes('/api/auth/refresh')) {
                    throw new TypeError('Failed to fetch');
                }
                return originalFetch(input, init);
            };

            try {
                let thrown = null;
                try {
                    await window.DicomViewerApp.accountUi.getValidAccessToken();
                } catch (error) {
                    thrown = {
                        message: error.message,
                        transient: !!error.transient,
                    };
                }

                return {
                    thrown,
                    snapshot: window.DicomViewerApp.accountUi._authStore._snapshot(),
                    accessToken: localStorage.getItem('dicom-viewer-access-token'),
                    refreshToken: localStorage.getItem('dicom-viewer-refresh-token'),
                };
            } finally {
                window.fetch = originalFetch;
            }
        });

        expect(result.thrown).toEqual(
            expect.objectContaining({
                transient: true,
            }),
        );
        expect(result.snapshot).toMatchObject({
            accessToken: expect.any(String),
            refreshToken: 'refresh-token-123',
        });
        expect(result.accessToken).toBe(result.snapshot.accessToken);
        expect(result.refreshToken).toBe('refresh-token-123');
    });

    test('remote report metadata uses added_at and updated_at when applying sync data', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForFunction(() => !!window._SyncEngine && !!window._NotesInternals);

        const result = await page.evaluate(() => {
            const studyUid = '1.2.840.sync-engine.report-study';
            const existingReportId = 'report-existing';
            const insertedReportId = 'report-inserted';
            const insertedAddedAt = 1700000000000;
            const insertedUpdatedAt = 1700000005000;
            const updatedAddedAt = 1700000010000;
            const updatedUpdatedAt = 1700000015000;

            window._NotesInternals.saveStore({
                studies: {
                    [studyUid]: {
                        description: '',
                        comments: [],
                        series: {},
                        reports: [
                            {
                                id: existingReportId,
                                name: 'Original',
                                type: 'pdf',
                                size: 1,
                                addedAt: new Date(1).toISOString(),
                                updatedAt: new Date(2).toISOString(),
                                sync_version: 1,
                            },
                        ],
                    },
                },
            });

            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'valid-access-token',
                onAuthRequired: () => {},
            });

            engine._applyRemoteData(
                'reports',
                insertedReportId,
                {
                    study_uid: studyUid,
                    name: 'Inserted Remote',
                    type: 'pdf',
                    size: 42,
                    added_at: insertedAddedAt,
                    updated_at: insertedUpdatedAt,
                },
                5,
            );

            engine._applyRemoteData(
                'reports',
                existingReportId,
                {
                    study_uid: studyUid,
                    name: 'Updated Remote',
                    type: 'png',
                    size: 84,
                    added_at: updatedAddedAt,
                    updated_at: updatedUpdatedAt,
                },
                6,
            );

            const reports = window._NotesInternals.loadStore().studies[studyUid].reports;
            return {
                inserted: reports.find((report) => report.id === insertedReportId),
                updated: reports.find((report) => report.id === existingReportId),
                insertedAddedAt,
                insertedUpdatedAt,
                updatedAddedAt,
                updatedUpdatedAt,
            };
        });

        expect(new Date(result.inserted.addedAt).getTime()).toBe(result.insertedAddedAt);
        expect(new Date(result.inserted.updatedAt).getTime()).toBe(result.insertedUpdatedAt);
        expect(result.inserted.sync_version).toBe(5);
        expect(new Date(result.updated.addedAt).getTime()).toBe(result.updatedAddedAt);
        expect(new Date(result.updated.updatedAt).getTime()).toBe(result.updatedUpdatedAt);
        expect(result.updated.sync_version).toBe(6);
        expect(result.updated).toMatchObject({
            name: 'Updated Remote',
            type: 'png',
            size: 84,
        });
    });

    test('remote report inserts do not create phantom studies', async ({ page }) => {
        await setupSyncEnginePage(page);

        const store = await page.evaluate(() => {
            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'valid-access-token',
                onAuthRequired: () => {},
            });
            engine._applyRemoteData(
                'reports',
                'remote-report-1',
                {
                    study_uid: 'missing-study',
                    name: 'Remote report',
                    type: 'pdf',
                    size: 1024,
                },
                7,
            );
            return window.__SYNC_TEST_STORE;
        });

        expect(store).toEqual({ studies: {} });
    });

    test('remote report inserts still apply when the study already exists', async ({ page }) => {
        await setupSyncEnginePage(page);

        const reports = await page.evaluate(() => {
            window.__SYNC_TEST_STORE = {
                studies: {
                    'known-study': {
                        description: '',
                        comments: [],
                        reports: [],
                        series: {},
                    },
                },
            };

            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'valid-access-token',
                onAuthRequired: () => {},
            });
            engine._applyRemoteData(
                'reports',
                'remote-report-2',
                {
                    study_uid: 'known-study',
                    name: 'Known study report',
                    type: 'pdf',
                    size: 2048,
                },
                9,
            );

            return window.__SYNC_TEST_STORE.studies['known-study'].reports;
        });

        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({
            id: 'remote-report-2',
            name: 'Known study report',
            type: 'pdf',
            size: 2048,
            sync_version: 9,
        });
    });

    test('remote comment updates preserve created time instead of overwriting it with updated_at', async ({
        page,
    }) => {
        await setupSyncEnginePage(page);

        const comment = await page.evaluate(() => {
            window.__SYNC_TEST_STORE = {
                studies: {
                    'study-1': {
                        description: '',
                        comments: [
                            {
                                id: 'comment-1',
                                record_uuid: 'comment-1',
                                text: 'Original',
                                time: 111,
                                created_at: 111,
                                updated_at: 111,
                                sync_version: 1,
                            },
                        ],
                        reports: [],
                        series: {},
                    },
                },
            };

            const engine = new window._SyncEngine.SyncEngine({
                getAccessToken: async () => 'valid-access-token',
                onAuthRequired: () => {},
            });
            engine._applyRemoteData(
                'comments',
                'comment-1',
                {
                    study_uid: 'study-1',
                    text: 'Edited remotely',
                    created_at: 111,
                    updated_at: 222,
                },
                5,
            );

            return window.__SYNC_TEST_STORE.studies['study-1'].comments[0];
        });

        expect(comment.time).toBe(111);
        expect(comment.updated_at).toBe(222);
        expect(comment.sync_version).toBe(5);
    });
});
