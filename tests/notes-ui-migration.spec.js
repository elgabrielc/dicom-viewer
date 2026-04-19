// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

const { test, expect } = require('@playwright/test');

const HOME_URL = 'http://127.0.0.1:5001/?nolib';

async function setupNotesUiPage(page) {
    await page.goto(HOME_URL);
    await page.waitForFunction(() => typeof window.DicomViewerApp?.notesUi?.migrateIfNeeded === 'function', null, {
        timeout: 10000,
    });
}

test.describe('Notes UI migration', () => {
    test('failed legacy report uploads leave migration retryable and retry on the next pass', async ({ page }) => {
        await setupNotesUiPage(page);

        const result = await page.evaluate(async () => {
            const studyUid = 'notes-ui-migration-study';
            const reportId = 'legacy-report-retryable';
            const legacyPayload = {
                version: 2,
                comments: {
                    [studyUid]: {
                        reports: [{ id: reportId, name: 'legacy-report.pdf', type: 'pdf', size: 16 }],
                    },
                },
            };

            localStorage.removeItem('dicom-viewer-migrated');
            localStorage.setItem('dicom-viewer-comments', JSON.stringify(legacyPayload));

            await new Promise((resolve, reject) => {
                const deleteRequest = indexedDB.deleteDatabase('dicom-viewer-reports');
                deleteRequest.onerror = () => reject(deleteRequest.error);
                deleteRequest.onblocked = () => reject(new Error('legacy reports database delete blocked'));
                deleteRequest.onsuccess = () => resolve();
            });

            const openRequest = indexedDB.open('dicom-viewer-reports', 1);
            await new Promise((resolve, reject) => {
                openRequest.onupgradeneeded = () => {
                    openRequest.result.createObjectStore('reports', { keyPath: 'id' });
                };
                openRequest.onerror = () => reject(openRequest.error);
                openRequest.onsuccess = () => resolve();
            });

            const db = openRequest.result;
            await new Promise((resolve, reject) => {
                const tx = db.transaction('reports', 'readwrite');
                tx.objectStore('reports').put({
                    id: reportId,
                    blob: new Blob([new TextEncoder().encode('%PDF-1.4\nretryable')], {
                        type: 'application/pdf',
                    }),
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
            db.close();

            const notesApi = window.NotesAPI;
            const originalIsEnabled = notesApi.isEnabled;
            const originalMigrate = notesApi.migrate;
            const originalUploadReport = notesApi.uploadReport;
            const originalNotesServer = window.CONFIG?.features?.notesServer;
            const uploadAttempts = [];
            let migrateCalls = 0;

            if (!window.CONFIG) {
                window.CONFIG = { features: { notesServer: true } };
            } else if (!window.CONFIG.features) {
                window.CONFIG.features = { notesServer: true };
            } else {
                window.CONFIG.features.notesServer = true;
            }

            notesApi.isEnabled = () => true;
            notesApi.migrate = async () => {
                migrateCalls += 1;
                return true;
            };
            notesApi.uploadReport = async (incomingStudyUid, file, report) => {
                uploadAttempts.push({
                    studyUid: incomingStudyUid,
                    fileName: file.name,
                    reportId: report.id,
                });
                if (uploadAttempts.length === 1) {
                    return null;
                }
                return {
                    id: report.id,
                    name: report.name,
                    type: report.type,
                    size: report.size,
                };
            };

            try {
                await window.DicomViewerApp.notesUi.migrateIfNeeded();
                const flagAfterFirstRun = localStorage.getItem('dicom-viewer-migrated');

                await window.DicomViewerApp.notesUi.migrateIfNeeded();
                const flagAfterSecondRun = localStorage.getItem('dicom-viewer-migrated');

                return {
                    flagAfterFirstRun,
                    flagAfterSecondRun,
                    migrateCalls,
                    uploadAttempts,
                };
            } finally {
                notesApi.isEnabled = originalIsEnabled;
                notesApi.migrate = originalMigrate;
                notesApi.uploadReport = originalUploadReport;
                if (window.CONFIG?.features) {
                    window.CONFIG.features.notesServer = originalNotesServer;
                }
            }
        });

        expect(result.flagAfterFirstRun).toBeNull();
        expect(result.flagAfterSecondRun).toBe('1');
        expect(result.migrateCalls).toBe(2);
        expect(result.uploadAttempts).toEqual([
            {
                studyUid: 'notes-ui-migration-study',
                fileName: 'legacy-report.pdf',
                reportId: 'legacy-report-retryable',
            },
            {
                studyUid: 'notes-ui-migration-study',
                fileName: 'legacy-report.pdf',
                reportId: 'legacy-report-retryable',
            },
        ]);
    });
});
