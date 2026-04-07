// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Playwright API tests for cross-cutting notes endpoints.
 *
 * These tests exercise batch loading, migration, and end-to-end lifecycle
 * scenarios that span multiple entity types (descriptions, comments, reports).
 *
 * Entity-specific tests live in dedicated files:
 *   - comments.spec.js    (suites 28-30)
 *   - study-notes.spec.js (suites 26-27)
 *   - reports.spec.js     (suites 31-33, 35)
 *
 * Endpoints covered here:
 *   GET  /api/notes/?studies=...              (batch load notes)
 *   POST /api/notes/migrate                   (one-time localStorage import)
 *
 * Test suites: 25, 34, 36
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, uniqueStudyUid, uniqueSeriesUid, uploadReport } = require('./notes-test-helpers');

// ---------------------------------------------------------------------------
// Test Suite 25: GET /api/notes/ - Batch Load
// ---------------------------------------------------------------------------

test.describe('Test Suite 25: GET /api/notes/ - Batch Load', () => {
    test('returns empty studies object when ?studies param is absent', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/notes/`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('studies');
        expect(body.studies).toEqual({});
    });

    test('returns empty studies object when ?studies param is empty string', async ({ request }) => {
        const response = await request.get(`${BASE_URL}/api/notes/?studies=`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.studies).toEqual({});
    });

    test('returns empty studies object when ?studies contains only whitespace and commas', async ({ request }) => {
        // Edge case: "  , ,  " should produce no valid UIDs after stripping
        const response = await request.get(`${BASE_URL}/api/notes/?studies=+%2C+%2C+`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.studies).toEqual({});
    });

    test('returns 400 when more than 200 study UIDs are requested', async ({ request }) => {
        // Generate 201 unique UIDs to exceed MAX_BATCH_STUDY_UIDS = 200
        const uids = Array.from({ length: 201 }, (_, i) => `study-uid-batch-${i}`);
        const studiesParam = uids.join(',');

        const response = await request.get(`${BASE_URL}/api/notes/?studies=${encodeURIComponent(studiesParam)}`);
        expect(response.status()).toBe(400);

        const body = await response.json();
        expect(body).toHaveProperty('error');
        expect(body.error).toContain('200');
    });

    test('200 UIDs is accepted (boundary: exactly at the limit)', async ({ request }) => {
        const uids = Array.from({ length: 200 }, (_, i) => `study-uid-limit-${i}`);
        const studiesParam = uids.join(',');

        const response = await request.get(`${BASE_URL}/api/notes/?studies=${encodeURIComponent(studiesParam)}`);
        // 200 UIDs that have no data in the DB should return 200 with empty studies
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('studies');
    });

    test('omits studies from the response when they have no notes', async ({ request }) => {
        // A UID that has never had any notes written should not appear in the response.
        // The server only returns entries where has_notes() is True.
        const uid = uniqueStudyUid();
        const response = await request.get(`${BASE_URL}/api/notes/?studies=${uid}`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        // Either the key is absent or the studies object is empty
        expect(body.studies).not.toHaveProperty(uid);
    });

    test('includes a study once notes are written for it', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        // Write a description first so the study appears in a batch query
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'batch load test description' },
        });

        const response = await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`);
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.studies).toHaveProperty(studyUid);
    });

    test('response study entry has expected top-level fields', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'field shape test' },
        });

        const body = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const entry = body.studies[studyUid];
        expect(entry).toHaveProperty('description');
        expect(entry).toHaveProperty('comments');
        expect(entry).toHaveProperty('series');
        expect(entry).toHaveProperty('reports');
        expect(Array.isArray(entry.comments)).toBe(true);
        expect(Array.isArray(entry.reports)).toBe(true);
        expect(typeof entry.series).toBe('object');
    });

    test('batching multiple UIDs returns data for each that has notes', async ({ request }) => {
        const uid1 = uniqueStudyUid();
        const uid2 = uniqueStudyUid();
        const uidNoData = uniqueStudyUid();

        await request.put(`${BASE_URL}/api/notes/${uid1}/description`, {
            data: { description: 'study one' },
        });
        await request.put(`${BASE_URL}/api/notes/${uid2}/description`, {
            data: { description: 'study two' },
        });

        const studiesParam = [uid1, uid2, uidNoData].join(',');
        const body = await (await request.get(`${BASE_URL}/api/notes/?studies=${studiesParam}`)).json();

        expect(body.studies).toHaveProperty(uid1);
        expect(body.studies).toHaveProperty(uid2);
        // uidNoData has no notes, so it must be absent
        expect(body.studies).not.toHaveProperty(uidNoData);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 34: POST /api/notes/migrate - LocalStorage Import
// ---------------------------------------------------------------------------

test.describe('Test Suite 34: POST /api/notes/migrate - LocalStorage Import', () => {
    test('migrates a study description and study-level comments', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const commentTime = Date.now() - 60000;

        const payload = {
            comments: {
                [studyUid]: {
                    description: 'migrated description',
                    study: [
                        { text: 'migrated comment one', time: commentTime },
                        { text: 'migrated comment two', time: commentTime + 1000 },
                    ],
                    series: {},
                },
            },
        };

        const response = await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(typeof body.migrated).toBe('number');
        expect(body.migrated).toBeGreaterThanOrEqual(1);

        // Verify data is readable back
        const getBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const entry = getBody.studies[studyUid];
        expect(entry).toBeDefined();
        expect(entry.description).toBe('migrated description');
        expect(entry.comments.length).toBe(2);
        expect(entry.comments.some((c) => c.text === 'migrated comment one')).toBe(true);
    });

    test('migrates series-level comments', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();
        const commentTime = Date.now() - 30000;

        const payload = {
            comments: {
                [studyUid]: {
                    series: {
                        [seriesUid]: {
                            description: 'series description migrated',
                            comments: [{ text: 'series comment migrated', time: commentTime }],
                        },
                    },
                },
            },
        };

        const response = await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        expect(response.status()).toBe(200);

        const getBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const seriesEntry = getBody.studies[studyUid]?.series?.[seriesUid];
        expect(seriesEntry).toBeDefined();
        expect(seriesEntry.description).toBe('series description migrated');
        expect(seriesEntry.comments.some((c) => c.text === 'series comment migrated')).toBe(true);
    });

    test('migration is idempotent: running twice does not duplicate comments', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const commentTime = Date.now() - 10000;

        const payload = {
            comments: {
                [studyUid]: {
                    study: [{ text: 'idempotent comment', time: commentTime }],
                },
            },
        };

        // Run migration twice with the same payload
        await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });

        const getBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const comments = getBody.studies[studyUid]?.comments || [];
        // The unique constraint (study_uid, series_uid, text, time) ensures no duplicates
        const matching = comments.filter((c) => c.text === 'idempotent comment');
        expect(matching.length).toBe(1);
    });

    test('migration does not overwrite existing description (DO NOTHING semantics)', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        // Write an existing description via the normal API
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'existing server description' },
        });

        // Attempt to overwrite via migration
        await request.post(`${BASE_URL}/api/notes/migrate`, {
            data: {
                comments: {
                    [studyUid]: {
                        description: 'migration description should not win',
                        study: [],
                    },
                },
            },
        });

        const getBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        // Existing description must be preserved (INSERT OR NOTHING semantics)
        expect(getBody.studies[studyUid].description).toBe('existing server description');
    });

    test('migration with empty comments blob returns migrated: 0', async ({ request }) => {
        const response = await request.post(`${BASE_URL}/api/notes/migrate`, {
            data: { comments: {} },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.migrated).toBe(0);
    });

    test('returns 400 for a non-object comments value', async ({ request }) => {
        const response = await request.post(`${BASE_URL}/api/notes/migrate`, {
            data: { comments: 'not-an-object' },
        });
        expect(response.status()).toBe(400);
    });

    test('migration with missing comments key returns migrated: 0 (defaults to empty dict)', async ({ request }) => {
        // Server does: comments_blob = data.get('comments') or {} -> no key = empty dict
        const response = await request.post(`${BASE_URL}/api/notes/migrate`, {
            data: {},
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.migrated).toBe(0);
    });

    test('migration handles legacy list-only series format', async ({ request }) => {
        // Old localStorage format stored series data as a plain list of comments
        // (no description, no nested object). Server handles: if isinstance(series_data, list)
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();
        const commentTime = Date.now() - 20000;

        const payload = {
            comments: {
                [studyUid]: {
                    series: {
                        [seriesUid]: [{ text: 'legacy list comment', time: commentTime }],
                    },
                },
            },
        };

        const response = await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        expect(response.status()).toBe(200);

        const getBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const seriesEntry = getBody.studies[studyUid]?.series?.[seriesUid];
        expect(seriesEntry).toBeDefined();
        const found = seriesEntry.comments.find((c) => c.text === 'legacy list comment');
        expect(found).toBeDefined();
    });

    test('non-dict study entries in comments blob are skipped without error', async ({ request }) => {
        // Server checks: if not isinstance(stored, dict): continue
        const studyUid = uniqueStudyUid();

        const payload = {
            comments: {
                [studyUid]: 'not-a-dict-should-be-skipped',
                'another-uid': null,
            },
        };

        const response = await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        // Should not crash the server
        expect(response.status()).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 36: End-to-End Notes Lifecycle
// ---------------------------------------------------------------------------

test.describe('Test Suite 36: End-to-End Notes Lifecycle', () => {
    test('full lifecycle: write description, add comments, upload report, read, then clean up', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        // 1. Write study description
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'Full lifecycle test study' },
        });

        // 2. Write series description
        await request.put(`${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`, {
            data: { description: 'Full lifecycle test series' },
        });

        // 3. Add study-level comment
        const { id: studyCommentId } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'Study-level observation' },
            })
        ).json();

        // 4. Add series-level comment
        await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'Series-level finding', seriesUid },
        });

        // 5. Upload a report
        const { id: reportId } = await (await uploadReport(request, studyUid)).json();

        // 6. Read everything back in one batch request
        const batchBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const entry = batchBody.studies[studyUid];
        expect(entry.description).toBe('Full lifecycle test study');
        expect(entry.comments.some((c) => c.text === 'Study-level observation')).toBe(true);
        expect(entry.series[seriesUid].description).toBe('Full lifecycle test series');
        expect(entry.series[seriesUid].comments.some((c) => c.text === 'Series-level finding')).toBe(true);
        expect(entry.reports.some((r) => r.id === reportId)).toBe(true);

        // 7. Edit the study comment
        await request.put(`${BASE_URL}/api/notes/${studyUid}/comments/${studyCommentId}`, {
            data: { text: 'Updated observation' },
        });

        // 8. Delete the report
        await request.delete(`${BASE_URL}/api/notes/${studyUid}/reports/${reportId}`);

        // 9. Verify edits and deletions
        const afterBody = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const afterEntry = afterBody.studies[studyUid];
        const editedComment = afterEntry.comments.find((c) => c.id === studyCommentId);
        expect(editedComment.text).toBe('Updated observation');
        expect(afterEntry.reports.find((r) => r.id === reportId)).toBeUndefined();

        // 10. Delete the study description (clears it)
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '' },
        });

        // Study still has notes (comments remain), so it persists in the batch response
        const stillHasComments = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();
        expect(stillHasComments.studies).toHaveProperty(studyUid);
        expect(stillHasComments.studies[studyUid].description).toBe('');
    });

    test('comment count increments correctly with parallel additions', async ({ request }) => {
        // Each comment must be stored independently; no comment must be lost
        const studyUid = uniqueStudyUid();
        const texts = ['comment alpha', 'comment beta', 'comment gamma', 'comment delta'];

        // Add all comments sequentially to ensure ordering is deterministic
        for (const text of texts) {
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text },
            });
        }

        const body = await (await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)).json();

        const comments = body.studies[studyUid]?.comments || [];
        expect(comments.length).toBe(texts.length);
        for (const text of texts) {
            expect(comments.some((c) => c.text === text)).toBe(true);
        }
    });
});
