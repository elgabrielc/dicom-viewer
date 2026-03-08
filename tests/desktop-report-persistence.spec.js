// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';

async function installMockTauri(page, options = {}) {
    await page.addInitScript((options) => {
        const FILE_STORAGE_PREFIX = 'mock-tauri-fs:';
        const failRemoveAll = !!options.failRemoveAll;

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
                async writeFile(filePath, bytes) {
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
                store: JSON.parse(localStorage.getItem('dicom-viewer-notes-v3') || '{}')
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
        expect(created.stored.filePath).toContain('desktop-report-001_report_final.pdf');
        expect(created.fileExists).toBe(true);
        expect(created.reportUrl).toBe(`asset://local/${encodeURIComponent(created.stored.filePath)}`);
        expect(created.store.studies[studyUid].reports).toHaveLength(1);

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

    test('desktop backend preserves metadata when report file deletion fails', async ({ page }) => {
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
        expect(result.deleted).toBe(false);
        expect(result.stored).not.toBeNull();
        expect(result.fileExists).toBe(true);
    });
});
