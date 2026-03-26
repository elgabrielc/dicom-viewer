// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001/?nolib';

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
                                sync_version: 0
                            }
                        ],
                        series: {},
                        reports: []
                    }
                }
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
            window.fetch = async () => new Response(JSON.stringify({
                accepted: [
                    { operation_uuid: operationUuid, sync_version: 7 }
                ],
                rejected: [],
                remote_changes: [],
                delta_cursor: 'cursor-7',
                server_time: 1700000000000
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });

            try {
                const engine = new window._SyncEngine.SyncEngine({
                    getAccessToken: async () => 'valid-access-token',
                    onAuthRequired: () => {}
                });
                const summary = await engine.syncNow();
                const store = window._NotesInternals.loadStore();
                return {
                    summary,
                    events,
                    cursor: window._SyncOutbox.getCursor(),
                    pending: window._SyncOutbox.readPendingChanges(),
                    comment: store.studies[studyUid].comments[0]
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
        expect(result.events.map((event) => event.type)).toEqual([
            'sync:started',
            'sync:completed'
        ]);
        expect(result.events[1].detail).toMatchObject({
            acceptedCount: 1,
            rejected: [],
            noopsCleaned: 0
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

            await window.DicomViewerApp.accountUi._storeTokens(
                expiredAccessToken,
                'refresh-token-123'
            );

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
                        transient: !!error.transient
                    };
                }

                return {
                    thrown,
                    snapshot: window.DicomViewerApp.accountUi._authStore._snapshot(),
                    accessToken: localStorage.getItem('dicom-viewer-access-token'),
                    refreshToken: localStorage.getItem('dicom-viewer-refresh-token')
                };
            } finally {
                window.fetch = originalFetch;
            }
        });

        expect(result.thrown).toEqual(
            expect.objectContaining({
                transient: true
            })
        );
        expect(result.snapshot).toMatchObject({
            accessToken: expect.any(String),
            refreshToken: 'refresh-token-123'
        });
        expect(result.accessToken).toBe(result.snapshot.accessToken);
        expect(result.refreshToken).toBe('refresh-token-123');
    });
});
