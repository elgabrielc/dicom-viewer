// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const path = require('path');
const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';
const MOCK_SQL_INIT_PATH = path.join(__dirname, 'mock-tauri-sql-init.js');

async function installMockTauri(page, options = {}) {
    await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
    await page.addInitScript((options) => {
        const FILE_STORAGE_PREFIX = 'mock-tauri-fs:';
        const SECURE_AUTH_STORAGE_KEY = 'mock-tauri-secure-auth-state';
        const failRemoveAll = !!options.failRemoveAll;
        const failWritePatterns = Array.isArray(options.failWritePatterns) ? options.failWritePatterns : [];

        if (options.initialSecureAuthState) {
            localStorage.setItem(
                SECURE_AUTH_STORAGE_KEY,
                JSON.stringify(options.initialSecureAuthState)
            );
        }

        function joinPaths(...parts) {
            const cleaned = parts
                .filter((part) => part !== null && part !== undefined && part !== '')
                .map((part, index) => {
                    const text = String(part);
                    if (index === 0) {
                        return text.replace(/\/+$/g, '') || '/';
                    }
                    return text.replace(/^\/+/g, '').replace(/\/+$/g, '');
                })
                .filter(Boolean);

            if (!cleaned.length) return '';
            const joined = cleaned.join('/');
            return joined.startsWith('/') ? joined : `/${joined}`;
        }

        window.__TAURI__ = {
            core: {
                convertFileSrc(filePath) {
                    return `asset://local/${encodeURIComponent(filePath)}`;
                },
                async invoke(cmd, args) {
                    if (cmd === 'apply_desktop_migration') {
                        return window.__applyMockDesktopMigration(args.db, args.batch, options);
                    }
                    if (cmd === 'load_legacy_desktop_browser_stores') {
                        return options.legacyDesktopStores || [];
                    }
                    if (cmd === 'load_secure_auth_state') {
                        const raw = localStorage.getItem(SECURE_AUTH_STORAGE_KEY);
                        return raw ? JSON.parse(raw) : {
                            access_token: null,
                            refresh_token: null,
                            user_email: null,
                            user_name: null
                        };
                    }
                    if (cmd === 'store_secure_auth_state') {
                        localStorage.setItem(
                            SECURE_AUTH_STORAGE_KEY,
                            JSON.stringify(args.state || {})
                        );
                        return true;
                    }
                    if (cmd === 'clear_secure_auth_state') {
                        localStorage.removeItem(SECURE_AUTH_STORAGE_KEY);
                        return true;
                    }
                    throw new Error(`Unhandled core invoke: ${cmd}`);
                }
            },
            fs: {
                async exists(filePath) {
                    return localStorage.getItem(`${FILE_STORAGE_PREFIX}${filePath}`) !== null;
                },
                async mkdir() {
                    return undefined;
                },
                async remove(filePath) {
                    if (failRemoveAll) {
                        throw new Error(`Mock remove failure for ${filePath}`);
                    }
                    localStorage.removeItem(`${FILE_STORAGE_PREFIX}${filePath}`);
                },
                async rename(fromPath, toPath) {
                    const raw = localStorage.getItem(`${FILE_STORAGE_PREFIX}${fromPath}`);
                    if (raw === null) {
                        throw new Error(`Mock rename missing source ${fromPath}`);
                    }
                    localStorage.setItem(`${FILE_STORAGE_PREFIX}${toPath}`, raw);
                    localStorage.removeItem(`${FILE_STORAGE_PREFIX}${fromPath}`);
                },
                async writeFile(filePath, bytes) {
                    if (failWritePatterns.some((pattern) => String(filePath).includes(String(pattern)))) {
                        throw new Error(`Mock write failure for ${filePath}`);
                    }
                    localStorage.setItem(
                        `${FILE_STORAGE_PREFIX}${filePath}`,
                        JSON.stringify(Array.from(bytes))
                    );
                }
            },
            path: {
                async appDataDir() {
                    return '/mock/appdata';
                },
                async join(...parts) {
                    return joinPaths(...parts);
                },
                async normalize(path) {
                    return joinPaths(path);
                }
            },
            sql: window.__createMockTauriSql(options),
            webview: {
                getCurrentWebview() {
                    return {
                        onDragDropEvent() {
                            return Promise.resolve(() => {});
                        }
                    };
                }
            }
        };
    }, options);
}

test.describe('Desktop report persistence', () => {
    test('desktop NotesAPI.migrate imports legacy notes into sqlite without falling back', async ({ page }) => {
        const studyUid = '1.2.840.desktop.manual-migrate.study';
        const seriesUid = '1.2.840.desktop.manual-migrate.series';

        await installMockTauri(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const migrated = await page.evaluate(async ({ studyUid, seriesUid }) => {
            const payload = {
                version: 2,
                comments: {
                    [studyUid]: {
                        description: 'Manual migrate study note',
                        study: [
                            { id: 'legacy-study-comment', text: 'Manual migrate study comment', time: 101 }
                        ],
                        series: {
                            [seriesUid]: {
                                description: 'Manual migrate series note',
                                comments: [
                                    { id: 'legacy-series-comment', text: 'Manual migrate series comment', time: 202 }
                                ]
                            }
                        }
                    }
                }
            };

            const result = await window.NotesAPI.migrate(payload);
            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const sqlStore = JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}');

            return {
                result,
                notes,
                sqlStore
            };
        }, { studyUid, seriesUid });

        expect(migrated.result).toBe(true);
        expect(migrated.notes.studies[studyUid].description).toBe('Manual migrate study note');
        expect(migrated.notes.studies[studyUid].comments).toHaveLength(1);
        expect(migrated.notes.studies[studyUid].series[seriesUid].description).toBe('Manual migrate series note');
        expect(migrated.notes.studies[studyUid].series[seriesUid].comments).toHaveLength(1);
        expect(migrated.sqlStore.study_notes).toHaveLength(1);
        expect(migrated.sqlStore.series_notes).toHaveLength(1);
        expect(migrated.sqlStore.comments).toHaveLength(2);
    });

    test('desktop storage migrates legacy local notes and config into sqlite once', async ({ page }) => {
        const studyUid = '1.2.840.desktop.migration.study';
        const seriesUid = '1.2.840.desktop.migration.series';
        const reportId = 'desktop-migrated-report';
        const reportPath = `/mock/appdata/reports/${studyUid}/${reportId}.pdf`;
        const libraryConfig = {
            folder: '/Users/gabriel/Desktop/radiology all discs',
            lastScan: '2026-03-21T18:00:00.000Z'
        };

        await installMockTauri(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const migrated = await page.evaluate(async ({ studyUid, seriesUid, reportId, reportPath, libraryConfig }) => {
            const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
            const legacyStore = {
                studies: {
                    [studyUid]: {
                        description: 'Migrated study note',
                        comments: [
                            { id: 'legacy-study-comment', text: 'Migrated study comment', time: 101 }
                        ],
                        series: {
                            [seriesUid]: {
                                description: 'Migrated series note',
                                comments: [
                                    { id: 'legacy-series-comment', text: 'Migrated series comment', time: 202 }
                                ]
                            }
                        },
                        reports: [
                            {
                                id: reportId,
                                name: 'Migrated report.pdf',
                                type: 'pdf',
                                size: bytes.length,
                                filePath: reportPath,
                                addedAt: 303,
                                updatedAt: 404
                            }
                        ]
                    }
                }
            };

            localStorage.setItem('dicom-viewer-notes-v3', JSON.stringify(legacyStore));
            localStorage.setItem('dicom-viewer-library-config', JSON.stringify(libraryConfig));
            localStorage.setItem(`mock-tauri-fs:${reportPath}`, JSON.stringify(Array.from(bytes)));

            await window.NotesAPI.initializeDesktopStorage();

            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const config = await window.NotesAPI.loadDesktopLibraryConfig();
            const sqlStore = JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}');

            return {
                notes,
                config,
                reportUrl: window.NotesAPI.getReportFileUrl(reportId),
                sqlStore
            };
        }, { studyUid, seriesUid, reportId, reportPath, libraryConfig });

        expect(migrated.notes.studies[studyUid].description).toBe('Migrated study note');
        expect(migrated.notes.studies[studyUid].comments).toHaveLength(1);
        expect(migrated.notes.studies[studyUid].comments[0].text).toBe('Migrated study comment');
        expect(migrated.notes.studies[studyUid].series[seriesUid].description).toBe('Migrated series note');
        expect(migrated.notes.studies[studyUid].series[seriesUid].comments).toHaveLength(1);
        expect(migrated.notes.studies[studyUid].series[seriesUid].comments[0].text).toBe('Migrated series comment');
        expect(migrated.notes.studies[studyUid].reports).toHaveLength(1);
        expect(migrated.notes.studies[studyUid].reports[0].filePath).toBe(reportPath);
        expect(migrated.config).toMatchObject(libraryConfig);
        expect(migrated.reportUrl).toBe(`asset://local/${encodeURIComponent(reportPath)}`);
        expect(migrated.sqlStore.study_notes).toHaveLength(1);
        expect(migrated.sqlStore.series_notes).toHaveLength(1);
        expect(migrated.sqlStore.comments).toHaveLength(2);
        expect(migrated.sqlStore.reports).toHaveLength(1);
        expect(migrated.sqlStore.app_config).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: 'desktop_library_config' }),
                expect.objectContaining({ key: 'localstorage_migrated', value: '1' })
            ])
        );

        await page.reload();
        await expect(page.locator('#libraryView')).toBeVisible();

        const persisted = await page.evaluate(async ({ studyUid, seriesUid }) => {
            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const config = await window.NotesAPI.loadDesktopLibraryConfig();
            const sqlStore = JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}');
            return {
                notes,
                config,
                sqlStore
            };
        }, { studyUid, seriesUid });

        expect(persisted.notes.studies[studyUid].description).toBe('Migrated study note');
        expect(persisted.notes.studies[studyUid].comments).toHaveLength(1);
        expect(persisted.notes.studies[studyUid].series[seriesUid].comments).toHaveLength(1);
        expect(persisted.notes.studies[studyUid].reports).toHaveLength(1);
        expect(persisted.config).toMatchObject(libraryConfig);
        expect(persisted.sqlStore.study_notes).toHaveLength(1);
        expect(persisted.sqlStore.series_notes).toHaveLength(1);
        expect(persisted.sqlStore.comments).toHaveLength(2);
        expect(persisted.sqlStore.reports).toHaveLength(1);
    });

    test('desktop storage repairs migration from legacy packaged browser stores', async ({ page }) => {
        const studyUid = '1.2.840.desktop.packaged-legacy.study';
        const reportId = 'desktop-packaged-legacy-report';
        const reportPath = `/mock/appdata/reports/${studyUid}/${reportId}.pdf`;
        const libraryConfig = {
            folder: '/Users/gabriel/Desktop/radiology all discs',
            lastScan: '2026-03-20T14:51:37.855Z'
        };

        await installMockTauri(page, {
            initialState: {
                'sqlite:viewer.db': {
                    study_notes: [],
                    series_notes: [],
                    comments: [],
                    reports: [],
                    app_config: [
                        { key: 'desktop_library_config', value: JSON.stringify(libraryConfig), updated_at: 1 },
                        { key: 'localstorage_migrated', value: '1', updated_at: 1 }
                    ],
                    meta: { lastCommentId: 0 }
                }
            },
            legacyDesktopStores: [
                {
                    sourcePath: '/Users/gabriel/Library/WebKit/health.divergent.dicomviewer/.../localstorage.sqlite3',
                    notesJson: JSON.stringify({
                        studies: {
                            [studyUid]: {
                                description: '',
                                comments: [],
                                series: {},
                                reports: [
                                    {
                                        id: reportId,
                                        name: 'Migrated report.pdf',
                                        type: 'pdf',
                                        size: 123,
                                        filePath: reportPath,
                                        addedAt: 303,
                                        updatedAt: 404
                                    }
                                ]
                            }
                        }
                    }),
                    libraryConfigJson: JSON.stringify(libraryConfig)
                }
            ]
        });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const repaired = await page.evaluate(async ({ studyUid, reportId, reportPath }) => {
            const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
            localStorage.setItem(`mock-tauri-fs:${reportPath}`, JSON.stringify(Array.from(bytes)));

            await window.NotesAPI.initializeDesktopStorage();

            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const sqlStore = JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}');

            return {
                notes,
                reportUrl: window.NotesAPI.getReportFileUrl(reportId),
                sqlStore
            };
        }, { studyUid, reportId, reportPath });

        expect(repaired.notes.studies[studyUid].reports).toHaveLength(1);
        expect(repaired.notes.studies[studyUid].reports[0].filePath).toBe(reportPath);
        expect(repaired.reportUrl).toBe(`asset://local/${encodeURIComponent(reportPath)}`);
        expect(repaired.sqlStore.reports).toHaveLength(1);
        expect(repaired.sqlStore.app_config).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: 'localstorage_migrated', value: '1' }),
                expect.objectContaining({ key: 'legacy_desktop_browser_store_migrated', value: '1' })
            ])
        );
    });

    test('desktop legacy blob migration continues after an individual report import fails', async ({ page }) => {
        const studyUid = '1.2.840.desktop.legacy-blob-failure.study';
        const failedReportId = 'desktop-legacy-report-fail';
        const goodReportId = 'desktop-legacy-report-good';

        await installMockTauri(page, {
            failWritePatterns: [failedReportId]
        });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async ({ studyUid, failedReportId, goodReportId }) => {
            const failedBytes = new TextEncoder().encode('%PDF-1.4\nfailed');
            const goodBytes = new TextEncoder().encode('%PDF-1.4\ngood');

            localStorage.setItem('dicom-viewer-comments', JSON.stringify({
                version: 2,
                comments: {
                    [studyUid]: {
                        reports: [
                            { id: failedReportId, name: 'failed.pdf', type: 'pdf', size: failedBytes.length },
                            { id: goodReportId, name: 'good.pdf', type: 'pdf', size: goodBytes.length }
                        ]
                    }
                }
            }));

            const request = indexedDB.open('dicom-viewer-reports', 1);
            await new Promise((resolve, reject) => {
                request.onupgradeneeded = () => {
                    request.result.createObjectStore('reports', { keyPath: 'id' });
                };
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });
            const db = request.result;
            await new Promise((resolve, reject) => {
                const tx = db.transaction('reports', 'readwrite');
                const store = tx.objectStore('reports');
                store.put({ id: failedReportId, blob: new Blob([failedBytes], { type: 'application/pdf' }) });
                store.put({ id: goodReportId, blob: new Blob([goodBytes], { type: 'application/pdf' }) });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
            db.close();

            await window.NotesAPI.initializeDesktopStorage();

            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const sqlStore = JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}');
            return {
                notes,
                sqlStore
            };
        }, { studyUid, failedReportId, goodReportId });

        expect(result.notes.studies[studyUid].reports.map((entry) => entry.id)).toEqual([goodReportId]);
        expect(result.sqlStore.reports.map((entry) => entry.id)).toEqual([goodReportId]);
        expect(result.sqlStore.app_config).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: 'localstorage_migrated', value: '1' })
            ])
        );
    });

    test('desktop legacy packaged store migration prefers the newest browser profile data', async ({ page }) => {
        const olderConfig = {
            folder: '/Users/gabriel/Desktop/older-library',
            lastScan: '2026-03-20T14:51:37.855Z'
        };
        const newerConfig = {
            folder: '/Users/gabriel/Desktop/radiology all discs',
            lastScan: '2026-03-22T10:00:00.000Z'
        };

        await installMockTauri(page, {
            legacyDesktopStores: [
                {
                    sourcePath: '/Users/gabriel/Library/WebKit/zzz/localstorage.sqlite3',
                    modifiedMs: 10,
                    notesJson: JSON.stringify({ studies: {} }),
                    libraryConfigJson: JSON.stringify(olderConfig)
                },
                {
                    sourcePath: '/Users/gabriel/Library/WebKit/aaa/localstorage.sqlite3',
                    modifiedMs: 20,
                    notesJson: JSON.stringify({ studies: {} }),
                    libraryConfigJson: JSON.stringify(newerConfig)
                }
            ]
        });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const migratedConfig = await page.evaluate(async () => {
            await window.NotesAPI.initializeDesktopStorage();
            return await window.NotesAPI.loadDesktopLibraryConfig();
        });

        expect(migratedConfig).toMatchObject(newerConfig);
    });

    test('desktop sqlite init backs off repeated failures before retrying', async ({ page }) => {
        await installMockTauri(page, {
            sqlLoadError: 'mock desktop sqlite unavailable'
        });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const loadCalls = await page.evaluate(async () => {
            const key = 'mock-tauri-sql-load-calls:sqlite:viewer.db';
            const initial = Number(localStorage.getItem(key) || '0');
            const realNow = Date.now;
            let now = realNow();
            Date.now = () => now;

            try {
                for (let index = 0; index < 3; index += 1) {
                    try {
                        await window.NotesAPI.initializeDesktopStorage();
                    } catch {}
                }
                const withinBackoff = Number(localStorage.getItem(key) || '0') - initial;

                now += 6000;
                try {
                    await window.NotesAPI.initializeDesktopStorage();
                } catch {}
                const afterRetry = Number(localStorage.getItem(key) || '0') - initial;

                return { withinBackoff, afterRetry };
            } finally {
                Date.now = realNow;
            }
        });

        expect(loadCalls.withinBackoff).toBe(1);
        expect(loadCalls.afterRetry).toBe(2);
    });

    test('desktop auth store migrates legacy browser tokens into secure storage and clears localStorage', async ({ page }) => {
        await installMockTauri(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const migrated = await page.evaluate(async () => {
            localStorage.setItem('dicom-viewer-access-token', 'legacy-access-token');
            localStorage.setItem('dicom-viewer-refresh-token', 'legacy-refresh-token');
            localStorage.setItem('dicom-viewer-user-email', 'legacy@example.com');
            localStorage.setItem('dicom-viewer-user-name', 'Legacy User');

            const accountUi = window.DicomViewerApp.accountUi;
            await accountUi._authStore.hydrate();

            return {
                snapshot: accountUi._authStore._snapshot(),
                secureRaw: localStorage.getItem('mock-tauri-secure-auth-state'),
                legacyAccess: localStorage.getItem('dicom-viewer-access-token'),
                legacyRefresh: localStorage.getItem('dicom-viewer-refresh-token'),
                legacyEmail: localStorage.getItem('dicom-viewer-user-email'),
                legacyName: localStorage.getItem('dicom-viewer-user-name')
            };
        });

        expect(migrated.snapshot).toEqual({
            accessToken: 'legacy-access-token',
            refreshToken: 'legacy-refresh-token',
            userEmail: 'legacy@example.com',
            userName: 'Legacy User'
        });
        expect(JSON.parse(migrated.secureRaw || '{}')).toEqual({
            access_token: 'legacy-access-token',
            refresh_token: 'legacy-refresh-token',
            user_email: 'legacy@example.com',
            user_name: 'Legacy User'
        });
        expect(migrated.legacyAccess).toBeNull();
        expect(migrated.legacyRefresh).toBeNull();
        expect(migrated.legacyEmail).toBeNull();
        expect(migrated.legacyName).toBeNull();

        await page.reload();
        await expect(page.locator('#libraryView')).toBeVisible();

        const restored = await page.evaluate(async () => {
            const accountUi = window.DicomViewerApp.accountUi;
            await accountUi._authStore.hydrate();
            return {
                snapshot: accountUi._authStore._snapshot(),
                legacyAccess: localStorage.getItem('dicom-viewer-access-token')
            };
        });

        expect(restored.snapshot).toEqual({
            accessToken: 'legacy-access-token',
            refreshToken: 'legacy-refresh-token',
            userEmail: 'legacy@example.com',
            userName: 'Legacy User'
        });
        expect(restored.legacyAccess).toBeNull();
    });

    test('desktop sync state and outbox persist via sqlite across reload without legacy localStorage', async ({ page }) => {
        await installMockTauri(page);
        await page.addInitScript(() => {
            if (sessionStorage.getItem('desktop-sync-migration-seeded') === '1') {
                return;
            }
            sessionStorage.setItem('desktop-sync-migration-seeded', '1');
            localStorage.setItem('dicom-viewer-sync-state', JSON.stringify({
                delta_cursor: 'legacy-cursor'
            }));
            localStorage.setItem('dicom-viewer-device-id', 'legacy-device');
            localStorage.setItem('dicom-viewer-sync-outbox', JSON.stringify([
                {
                    operation_uuid: 'legacy-op-1',
                    table_name: 'comments',
                    record_key: 'legacy-comment-1',
                    operation: 'insert',
                    base_sync_version: 0,
                    created_at: 1000
                }
            ]));
        });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const initial = await page.evaluate(async () => {
            await window._SyncOutbox.hydrateFromSqlite();

            return {
                cursor: window._SyncOutbox.getCursor(),
                deviceId: window._SyncOutbox.getDeviceId(),
                pending: await window._SyncOutbox.readPendingChangesAsync(),
                legacySyncState: localStorage.getItem('dicom-viewer-sync-state'),
                legacyDeviceId: localStorage.getItem('dicom-viewer-device-id'),
                legacyOutbox: localStorage.getItem('dicom-viewer-sync-outbox'),
                sqlStore: JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}')
            };
        });

        expect(initial.cursor).toBe('legacy-cursor');
        expect(initial.deviceId).toBe('legacy-device');
        expect(initial.pending).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    operation_uuid: 'legacy-op-1',
                    table_name: 'comments',
                    record_key: 'legacy-comment-1',
                    operation: 'insert'
                })
            ])
        );
        expect(initial.legacySyncState).toBeNull();
        expect(initial.legacyDeviceId).toBeNull();
        expect(initial.legacyOutbox).toBeNull();
        expect(initial.sqlStore.sync_state).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: 'delta_cursor', value: 'legacy-cursor' }),
                expect.objectContaining({ key: 'device_id', value: 'legacy-device' })
            ])
        );
        expect(initial.sqlStore.sync_outbox).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    operation_uuid: 'legacy-op-1',
                    table_name: 'comments',
                    record_key: 'legacy-comment-1'
                })
            ])
        );

        const mutated = await page.evaluate(async () => {
            window._SyncOutbox.setCursor('cursor-1');
            window._SyncOutbox.setDeviceId('device-1');
            window._SyncOutbox.enqueueChange('comments', 'uuid-1', 'insert', 0);
            await new Promise((resolve) => setTimeout(resolve, 25));

            return {
                cursor: window._SyncOutbox.getCursor(),
                deviceId: window._SyncOutbox.getDeviceId(),
                pending: await window._SyncOutbox.readPendingChangesAsync(),
                legacySyncState: localStorage.getItem('dicom-viewer-sync-state'),
                legacyOutbox: localStorage.getItem('dicom-viewer-sync-outbox')
            };
        });

        expect(mutated.cursor).toBe('cursor-1');
        expect(mutated.deviceId).toBe('device-1');
        expect(mutated.pending).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ operation_uuid: 'legacy-op-1' }),
                expect.objectContaining({
                    table_name: 'comments',
                    record_key: 'uuid-1',
                    operation: 'insert'
                })
            ])
        );
        expect(mutated.legacySyncState).toBeNull();
        expect(mutated.legacyOutbox).toBeNull();

        await page.reload();
        await expect(page.locator('#libraryView')).toBeVisible();

        const restored = await page.evaluate(async () => {
            await window._SyncOutbox.hydrateFromSqlite();
            return {
                cursor: window._SyncOutbox.getCursor(),
                deviceId: window._SyncOutbox.getDeviceId(),
                pending: await window._SyncOutbox.readPendingChangesAsync(),
                legacySyncState: localStorage.getItem('dicom-viewer-sync-state'),
                legacyOutbox: localStorage.getItem('dicom-viewer-sync-outbox')
            };
        });

        expect(restored.cursor).toBe('cursor-1');
        expect(restored.deviceId).toBe('device-1');
        expect(restored.pending).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ operation_uuid: 'legacy-op-1' }),
                expect.objectContaining({
                    table_name: 'comments',
                    record_key: 'uuid-1',
                    operation: 'insert'
                })
            ])
        );
        expect(restored.legacySyncState).toBeNull();
        expect(restored.legacyOutbox).toBeNull();
    });

    test('desktop backend persists report files and metadata across reloads', async ({ page }) => {
        const studyUid = '1.2.840.desktop.test.study';
        const reportId = 'desktop-report-001';

        await installMockTauri(page);
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const created = await page.evaluate(async ({ studyUid, reportId }) => {
            const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
            const file = new File([bytes], 'report final.pdf', { type: 'application/pdf' });
            const meta = {
                id: reportId,
                name: file.name,
                type: 'pdf',
                size: file.size,
                addedAt: Date.now(),
                updatedAt: Date.now()
            };

            const saved = await window.NotesAPI.uploadReport(studyUid, file, meta);
            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const stored = notes?.studies?.[studyUid]?.reports?.find((entry) => entry?.id === reportId) || null;

            return {
                deploymentMode: window.CONFIG.deploymentMode,
                saved,
                stored,
                fileExists: stored?.filePath
                    ? await window.__TAURI__.fs.exists(stored.filePath)
                    : false,
                reportUrl: window.NotesAPI.getReportFileUrl(reportId),
                sqlStore: JSON.parse(localStorage.getItem('mock-tauri-sql:sqlite:viewer.db') || '{}')
            };
        }, { studyUid, reportId });

        expect(created.deploymentMode).toBe('desktop');
        expect(created.saved).toMatchObject({
            id: reportId,
            name: 'report final.pdf',
            type: 'pdf'
        });
        expect(created.stored).toMatchObject({
            id: reportId,
            name: 'report final.pdf',
            type: 'pdf'
        });
        expect(created.stored.filePath).toContain('/mock/appdata/reports/');
        expect(created.stored.filePath).toContain('desktop-report-001.pdf');
        expect(created.fileExists).toBe(true);
        expect(created.reportUrl).toBe(`asset://local/${encodeURIComponent(created.stored.filePath)}`);
        expect(created.sqlStore.reports).toHaveLength(1);
        expect(created.sqlStore.reports[0].study_uid).toBe(studyUid);

        await page.reload();
        await expect(page.locator('#libraryView')).toBeVisible();

        const persisted = await page.evaluate(async ({ studyUid, reportId }) => {
            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const stored = notes?.studies?.[studyUid]?.reports?.find((entry) => entry?.id === reportId) || null;
            const fileExistsBeforeDelete = stored?.filePath
                ? await window.__TAURI__.fs.exists(stored.filePath)
                : false;
            const reportUrlBeforeDelete = window.NotesAPI.getReportFileUrl(reportId);
            const deleted = await window.NotesAPI.deleteReport(studyUid, reportId);
            const afterDelete = await window.NotesAPI.loadNotes([studyUid]);

            return {
                deploymentMode: window.CONFIG.deploymentMode,
                stored,
                fileExistsBeforeDelete,
                reportUrlBeforeDelete,
                deleted,
                remainingReports: afterDelete?.studies?.[studyUid]?.reports?.length || 0,
                fileExistsAfterDelete: stored?.filePath
                    ? await window.__TAURI__.fs.exists(stored.filePath)
                    : false,
                reportUrlAfterDelete: window.NotesAPI.getReportFileUrl(reportId)
            };
        }, { studyUid, reportId });

        expect(persisted.deploymentMode).toBe('desktop');
        expect(persisted.stored).not.toBeNull();
        expect(persisted.fileExistsBeforeDelete).toBe(true);
        expect(persisted.reportUrlBeforeDelete).toBe(`asset://local/${encodeURIComponent(persisted.stored.filePath)}`);
        expect(persisted.deleted).toBe(true);
        expect(persisted.remainingReports).toBe(0);
        expect(persisted.fileExistsAfterDelete).toBe(false);
        expect(persisted.reportUrlAfterDelete).toBe('');
    });

    test('desktop backend removes metadata even when report file deletion fails', async ({ page }) => {
        const studyUid = '1.2.840.desktop.test.study';
        const reportId = 'desktop-report-delete-failure';

        await installMockTauri(page, { failRemoveAll: true });
        await page.goto(HOME_URL);
        await expect(page.locator('#libraryView')).toBeVisible();

        const result = await page.evaluate(async ({ studyUid, reportId }) => {
            const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
            const file = new File([bytes], 'failure.pdf', { type: 'application/pdf' });
            const meta = {
                id: reportId,
                name: file.name,
                type: 'pdf',
                size: file.size,
                addedAt: Date.now(),
                updatedAt: Date.now()
            };

            const saved = await window.NotesAPI.uploadReport(studyUid, file, meta);
            const deleted = await window.NotesAPI.deleteReport(studyUid, reportId);
            const notes = await window.NotesAPI.loadNotes([studyUid]);
            const stored = notes?.studies?.[studyUid]?.reports?.find((entry) => entry?.id === reportId) || null;

            return {
                deleted,
                saved,
                stored,
                fileExists: stored?.filePath
                    ? await window.__TAURI__.fs.exists(stored.filePath)
                    : false
            };
        }, { studyUid, reportId });

        expect(result.saved).not.toBeNull();
        expect(result.deleted).toBe(true);
        expect(result.stored).toBeNull();
        expect(result.fileExists).toBe(false);
    });
});
