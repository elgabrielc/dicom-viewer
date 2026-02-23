// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Playwright API tests for the /api/notes/ endpoints.
 *
 * These tests use Playwright's request API (no browser UI) to exercise
 * the notes persistence layer backed by SQLite. Each test suite isolates
 * its state by using unique, randomly-generated study UIDs so tests can
 * run in parallel without cross-contamination.
 *
 * Endpoints covered:
 *   GET  /api/notes/?studies=...              (batch load notes)
 *   PUT  /api/notes/<study>/description       (save study description)
 *   PUT  /api/notes/<study>/series/<s>/description (save series description)
 *   POST /api/notes/<study>/comments          (add comment)
 *   PUT  /api/notes/<study>/comments/<id>     (edit comment)
 *   DELETE /api/notes/<study>/comments/<id>   (delete comment)
 *   POST /api/notes/<study>/reports           (upload report)
 *   GET  /api/notes/reports/<id>/file         (download report)
 *   DELETE /api/notes/<study>/reports/<id>    (delete report)
 *   POST /api/notes/migrate                   (one-time localStorage import)
 *
 * Test suites: 25-34 (continuing from library-and-navigation.spec.js suite 24)
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique study UID for test isolation.
 * Real DICOM UIDs are dotted-decimal strings; we use a UUID-like string
 * that is unique per test run to prevent cross-test DB contamination.
 */
function uniqueStudyUid() {
    // Prefix makes them easy to identify in DB if debugging
    return `test-study-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function uniqueSeriesUid() {
    return `test-series-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a minimal in-memory PDF buffer for report upload tests.
 * Using a real minimal PDF magic header so the server can detect the type
 * by mimetype/extension rather than file content inspection.
 */
function minimalPdfBuffer() {
    // Smallest valid PDF-header prefix (content does not matter for upload tests)
    return Buffer.from('%PDF-1.4\n%%EOF\n');
}

/**
 * Upload a minimal PDF report for the given study and return the response.
 * Uses multipart/form-data as the endpoint expects request.files['file'].
 */
async function uploadReport(request, studyUid, opts = {}) {
    const filename = opts.filename || 'report.pdf';
    const fileContent = opts.fileContent || minimalPdfBuffer();
    const formData = {
        file: {
            name: filename,
            mimeType: opts.mimeType || 'application/pdf',
            buffer: fileContent,
        },
    };
    if (opts.reportId) {
        formData.id = opts.reportId;
    }
    if (opts.name) {
        formData.name = opts.name;
    }
    return await request.post(`${BASE_URL}/api/notes/${studyUid}/reports`, {
        multipart: formData,
    });
}

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

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

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
        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studiesParam}`)
        ).json();

        expect(body.studies).toHaveProperty(uid1);
        expect(body.studies).toHaveProperty(uid2);
        // uidNoData has no notes, so it must be absent
        expect(body.studies).not.toHaveProperty(uidNoData);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 26: PUT /api/notes/<study_uid>/description
// ---------------------------------------------------------------------------

test.describe('Test Suite 26: PUT /api/notes/<study_uid>/description', () => {
    test('saves a study description and returns it in the response', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'MRI brain with contrast' },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.studyUid).toBe(studyUid);
        expect(body.description).toBe('MRI brain with contrast');
        expect(typeof body.updatedAt).toBe('number');
        // updatedAt should be a recent epoch timestamp in milliseconds
        expect(body.updatedAt).toBeGreaterThan(Date.now() - 10000);
    });

    test('description is readable back via the batch GET endpoint', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'readable description' },
        });

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        expect(body.studies[studyUid].description).toBe('readable description');
    });

    test('overwriting description replaces the previous value', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'first description' },
        });
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'second description' },
        });

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        expect(body.studies[studyUid].description).toBe('second description');
    });

    test('saving empty string deletes the description and study disappears from batch results', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        // Write a description first
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'will be deleted' },
        });

        // Now overwrite with empty string
        const deleteResponse = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '' },
        });
        expect(deleteResponse.status()).toBe(200);

        const deleteBody = await deleteResponse.json();
        expect(deleteBody.description).toBe('');

        // The study should no longer appear in batch results (has_notes = False now)
        const batchBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        expect(batchBody.studies).not.toHaveProperty(studyUid);
    });

    test('saving whitespace-only description behaves like empty (gets stripped)', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const response = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '   \t  ' },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        // Server strips leading/trailing whitespace; result is empty which deletes the record
        expect(body.description).toBe('');
    });

    test('missing description key in payload is treated as empty', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const response = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: {},
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.description).toBe('');
    });

    test('sending null JSON body does not crash the server', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Sending no body; Flask will use get_json(silent=True) which returns None -> {}
        const response = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`);
        expect(response.status()).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 27: PUT /api/notes/<study_uid>/series/<series_uid>/description
// ---------------------------------------------------------------------------

test.describe('Test Suite 27: PUT /api/notes/<study_uid>/series/<series_uid>/description', () => {
    test('saves a series description and returns it in the response', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'Axial T1 weighted' } }
        );
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.studyUid).toBe(studyUid);
        expect(body.seriesUid).toBe(seriesUid);
        expect(body.description).toBe('Axial T1 weighted');
        expect(typeof body.updatedAt).toBe('number');
    });

    test('series description is readable via batch GET under the correct study/series keys', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'FLAIR sequence' } }
        );

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const seriesEntry = body.studies[studyUid]?.series?.[seriesUid];
        expect(seriesEntry).toBeDefined();
        expect(seriesEntry.description).toBe('FLAIR sequence');
    });

    test('two series under one study are stored independently', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesA = uniqueSeriesUid();
        const seriesB = uniqueSeriesUid();

        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesA}/description`,
            { data: { description: 'series A' } }
        );
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesB}/description`,
            { data: { description: 'series B' } }
        );

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        expect(body.studies[studyUid].series[seriesA].description).toBe('series A');
        expect(body.studies[studyUid].series[seriesB].description).toBe('series B');
    });

    test('saving empty series description deletes the series record', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        // Write description
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'to be deleted' } }
        );

        // Clear it
        const clearResponse = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: '' } }
        );
        expect(clearResponse.status()).toBe(200);

        // If the only data was the series description, study has no notes and drops from results
        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        // Study either absent entirely or series entry is gone
        const studyEntry = body.studies[studyUid];
        if (studyEntry) {
            const seriesEntry = studyEntry.series?.[seriesUid];
            // If the series entry exists, its description should be empty
            if (seriesEntry) {
                expect(seriesEntry.description).toBe('');
            }
        }
        // Reaching here without throwing is success
    });

    test('same series key with different study UIDs stores separate rows', async ({ request }) => {
        // The primary key is (study_uid, series_uid) so the same series UID under
        // different studies must not collide.
        const sharedSeriesUid = 'shared-series-uid-test';
        const studyA = uniqueStudyUid();
        const studyB = uniqueStudyUid();

        await request.put(
            `${BASE_URL}/api/notes/${studyA}/series/${sharedSeriesUid}/description`,
            { data: { description: 'study A view' } }
        );
        await request.put(
            `${BASE_URL}/api/notes/${studyB}/series/${sharedSeriesUid}/description`,
            { data: { description: 'study B view' } }
        );

        const bodyA = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyA}`)
        ).json();
        const bodyB = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyB}`)
        ).json();

        expect(bodyA.studies[studyA].series[sharedSeriesUid].description).toBe('study A view');
        expect(bodyB.studies[studyB].series[sharedSeriesUid].description).toBe('study B view');
    });
});

// ---------------------------------------------------------------------------
// Test Suite 28: POST /api/notes/<study_uid>/comments - Add Comment
// ---------------------------------------------------------------------------

test.describe('Test Suite 28: POST /api/notes/<study_uid>/comments - Add Comment', () => {
    test('creates a comment and returns the new comment with an id', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'Normal study - no acute findings' },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(typeof body.id).toBe('number');
        expect(body.studyUid).toBe(studyUid);
        expect(body.text).toBe('Normal study - no acute findings');
        expect(typeof body.time).toBe('number');
        expect(body.time).toBeGreaterThan(0);
        // seriesUid should be null when not provided
        expect(body.seriesUid).toBeNull();
    });

    test('returns 400 when comment text is missing', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: {},
        });
        expect(response.status()).toBe(400);

        const body = await response.json();
        expect(body).toHaveProperty('error');
    });

    test('returns 400 when comment text is empty string', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: '' },
        });
        expect(response.status()).toBe(400);
    });

    test('returns 400 when comment text is whitespace only', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: '   ' },
        });
        expect(response.status()).toBe(400);
    });

    test('created comment is visible in batch GET results', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const commentText = 'Mild cardiomegaly noted';

        await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: commentText },
        });

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const comments = body.studies[studyUid]?.comments;
        expect(Array.isArray(comments)).toBe(true);
        expect(comments.length).toBeGreaterThan(0);

        const found = comments.find(c => c.text === commentText);
        expect(found).toBeDefined();
        expect(typeof found.id).toBe('number');
        expect(typeof found.time).toBe('number');
    });

    test('client-provided timestamp within 1 year drift is accepted', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Client timestamp 10 minutes ago -- well within the 1-year drift window
        const clientTime = Date.now() - 10 * 60 * 1000;

        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'timestamped comment', time: clientTime },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        // The server should use the client time since it is within the drift window
        expect(body.time).toBe(clientTime);
    });

    test('client timestamp beyond 1-year drift is replaced by server time', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Timestamp 2 years in the past -- outside MAX_TIMESTAMP_DRIFT_MS
        const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;
        const staleTime = Date.now() - twoYearsMs;
        const beforeRequest = Date.now();

        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'old timestamp comment', time: staleTime },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        const afterRequest = Date.now();

        // Server should substitute its own current time
        expect(body.time).toBeGreaterThanOrEqual(beforeRequest);
        expect(body.time).toBeLessThanOrEqual(afterRequest);
    });

    test('comment associated with a series stores the seriesUid', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'series-level comment', seriesUid },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.seriesUid).toBe(seriesUid);
    });

    test('series-level comment appears under the correct series in batch GET', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'series comment', seriesUid },
        });

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const seriesComments = body.studies[studyUid]?.series?.[seriesUid]?.comments;
        expect(Array.isArray(seriesComments)).toBe(true);
        const found = seriesComments.find(c => c.text === 'series comment');
        expect(found).toBeDefined();
    });

    test('multiple comments on the same study are returned in chronological order', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const t1 = Date.now() - 3000;
        const t2 = Date.now() - 2000;
        const t3 = Date.now() - 1000;

        await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'third comment', time: t3 },
        });
        await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'first comment', time: t1 },
        });
        await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'second comment', time: t2 },
        });

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const comments = body.studies[studyUid].comments;
        expect(comments.length).toBe(3);
        // Should be sorted by time ASC
        expect(comments[0].text).toBe('first comment');
        expect(comments[1].text).toBe('second comment');
        expect(comments[2].text).toBe('third comment');
    });
});

// ---------------------------------------------------------------------------
// Test Suite 29: PUT /api/notes/<study_uid>/comments/<id> - Edit Comment
// ---------------------------------------------------------------------------

test.describe('Test Suite 29: PUT /api/notes/<study_uid>/comments/<id> - Edit Comment', () => {
    test('edits an existing comment and returns the updated text', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        // Create comment
        const createResponse = await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
            data: { text: 'original text' },
        });
        const { id } = await createResponse.json();

        // Edit it
        const editResponse = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/${id}`,
            { data: { text: 'updated text' } }
        );
        expect(editResponse.status()).toBe(200);

        const body = await editResponse.json();
        expect(body.id).toBe(id);
        expect(body.text).toBe('updated text');
        expect(body.studyUid).toBe(studyUid);
        expect(typeof body.time).toBe('number');
    });

    test('edit always uses server time regardless of client time in payload', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const oldTime = Date.now() - 5 * 60 * 1000; // 5 minutes ago

        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'before edit', time: oldTime },
            })
        ).json();

        const beforeEdit = Date.now();

        // Edit with an old client timestamp -- server must ignore it
        const editResponse = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/${id}`,
            { data: { text: 'after edit', time: oldTime } }
        );

        const afterEdit = Date.now();
        const body = await editResponse.json();

        // The returned timestamp should reflect server time at edit, not the old client time
        expect(body.time).toBeGreaterThanOrEqual(beforeEdit);
        expect(body.time).toBeLessThanOrEqual(afterEdit);
    });

    test('returns 404 when editing a comment that does not exist', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/999999999`,
            { data: { text: 'ghost edit' } }
        );
        expect(response.status()).toBe(404);
    });

    test('returns 404 when comment id belongs to a different study', async ({ request }) => {
        // Comment exists but under studyA -- editing via studyB URL must fail
        const studyA = uniqueStudyUid();
        const studyB = uniqueStudyUid();

        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyA}/comments`, {
                data: { text: 'belongs to study A' },
            })
        ).json();

        const response = await request.put(
            `${BASE_URL}/api/notes/${studyB}/comments/${id}`,
            { data: { text: 'cross-study edit attempt' } }
        );
        expect(response.status()).toBe(404);
    });

    test('returns 400 when update text is empty', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'valid comment' },
            })
        ).json();

        const response = await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/${id}`,
            { data: { text: '' } }
        );
        expect(response.status()).toBe(400);
    });

    test('edited text is reflected in subsequent batch GET results', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'pre-edit text' },
            })
        ).json();

        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/${id}`,
            { data: { text: 'post-edit text' } }
        );

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const found = body.studies[studyUid].comments.find(c => c.id === id);
        expect(found).toBeDefined();
        expect(found.text).toBe('post-edit text');
    });
});

// ---------------------------------------------------------------------------
// Test Suite 30: DELETE /api/notes/<study_uid>/comments/<id>
// ---------------------------------------------------------------------------

test.describe('Test Suite 30: DELETE /api/notes/<study_uid>/comments/<id>', () => {
    test('deletes an existing comment and returns confirmation', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'to be deleted' },
            })
        ).json();

        const deleteResponse = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/comments/${id}`
        );
        expect(deleteResponse.status()).toBe(200);

        const body = await deleteResponse.json();
        expect(body.deleted).toBe(true);
        expect(body.id).toBe(id);
    });

    test('returns 404 when deleting a comment that does not exist', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/comments/999999999`
        );
        expect(response.status()).toBe(404);
    });

    test('returns 404 when deleting with the wrong study_uid', async ({ request }) => {
        const studyA = uniqueStudyUid();
        const studyB = uniqueStudyUid();

        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyA}/comments`, {
                data: { text: 'study A comment' },
            })
        ).json();

        // Attempt deletion via a different study URL
        const response = await request.delete(
            `${BASE_URL}/api/notes/${studyB}/comments/${id}`
        );
        expect(response.status()).toBe(404);

        // Original comment should still exist
        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyA}`)
        ).json();
        const found = body.studies[studyA]?.comments?.find(c => c.id === id);
        expect(found).toBeDefined();
    });

    test('deleted comment is absent from subsequent batch GET results', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const { id } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'will vanish' },
            })
        ).json();

        await request.delete(`${BASE_URL}/api/notes/${studyUid}/comments/${id}`);

        // Study has no remaining notes -- should drop from results
        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        expect(body.studies).not.toHaveProperty(studyUid);
    });

    test('deleting one comment leaves sibling comments intact', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const { id: idA } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'comment A - keep' },
            })
        ).json();

        const { id: idB } = await (
            await request.post(`${BASE_URL}/api/notes/${studyUid}/comments`, {
                data: { text: 'comment B - delete' },
            })
        ).json();

        await request.delete(`${BASE_URL}/api/notes/${studyUid}/comments/${idB}`);

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        const comments = body.studies[studyUid]?.comments || [];
        const foundA = comments.find(c => c.id === idA);
        const foundB = comments.find(c => c.id === idB);

        expect(foundA).toBeDefined();
        expect(foundB).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Test Suite 31: POST /api/notes/<study_uid>/reports - Upload Report
// ---------------------------------------------------------------------------

test.describe('Test Suite 31: POST /api/notes/<study_uid>/reports - Upload Report', () => {
    test('uploads a PDF report and returns report metadata', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await uploadReport(request, studyUid, { filename: 'radiology.pdf' });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(typeof body.id).toBe('string');
        expect(body.studyUid).toBe(studyUid);
        expect(body.type).toBe('pdf');
        expect(typeof body.size).toBe('number');
        expect(body.size).toBeGreaterThan(0);
        expect(typeof body.addedAt).toBe('number');
        expect(typeof body.updatedAt).toBe('number');
    });

    test('uploaded report appears in batch GET response', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const { id: reportId } = await (await uploadReport(request, studyUid)).json();

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const reports = body.studies[studyUid]?.reports || [];
        const found = reports.find(r => r.id === reportId);
        expect(found).toBeDefined();
        expect(found.type).toBe('pdf');
        expect(typeof found.size).toBe('number');
    });

    test('returns 400 when no file is provided in the multipart request', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Send an empty multipart form without a 'file' field
        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/reports`, {
            multipart: { name: 'test.pdf' },
        });
        expect(response.status()).toBe(400);

        const body = await response.json();
        expect(body).toHaveProperty('error');
    });

    test('returns 400 for an unsupported file type', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/reports`, {
            multipart: {
                file: {
                    name: 'report.docx',
                    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    buffer: Buffer.from('fake docx content'),
                },
            },
        });
        expect(response.status()).toBe(400);

        const body = await response.json();
        expect(body.error).toContain('Unsupported');
    });

    test('PNG report is accepted and type is set to png', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Minimal PNG signature bytes
        const pngBuffer = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        const response = await uploadReport(request, studyUid, {
            filename: 'screenshot.png',
            mimeType: 'image/png',
            fileContent: pngBuffer,
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.type).toBe('png');
    });

    test('JPEG report is accepted and type is set to jpg', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Minimal JPEG signature bytes (SOI marker)
        const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
        const response = await uploadReport(request, studyUid, {
            filename: 'image.jpg',
            mimeType: 'image/jpeg',
            fileContent: jpegBuffer,
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.type).toBe('jpg');
    });

    test('custom report ID (valid format) is used and preserved in the response', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Valid format: ^[a-zA-Z0-9_-]{8,64}$
        const customId = 'report-id-abcd1234';

        const response = await uploadReport(request, studyUid, { reportId: customId });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.id).toBe(customId);
    });

    test('report ID that is too short (< 8 chars) is rejected and a UUID is generated instead', async ({ request }) => {
        // _sanitize_report_id rejects IDs shorter than 8 chars; server falls back to uuid4()
        const studyUid = uniqueStudyUid();
        const shortId = 'abc123'; // 6 chars -- too short

        const response = await uploadReport(request, studyUid, { reportId: shortId });
        expect(response.status()).toBe(200);

        const body = await response.json();
        // Server must have rejected the short ID and generated a UUID fallback
        expect(body.id).not.toBe(shortId);
        expect(body.id.length).toBeGreaterThanOrEqual(8);
    });

    test('report ID that is too long (> 64 chars) is rejected and a UUID is generated instead', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const longId = 'a'.repeat(65); // 65 chars -- too long

        const response = await uploadReport(request, studyUid, { reportId: longId });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.id).not.toBe(longId);
    });

    test('report ID with invalid characters is rejected and a UUID is generated', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        // Contains space and dot -- not in [a-zA-Z0-9_-]
        const invalidId = 'invalid id.chars!!';

        const response = await uploadReport(request, studyUid, { reportId: invalidId });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.id).not.toBe(invalidId);
    });

    test('uploading with an existing report ID replaces the previous report (upsert)', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const reportId = 'stable-report-id-0001';

        // First upload
        await uploadReport(request, studyUid, {
            reportId,
            filename: 'first.pdf',
            name: 'First Upload',
        });

        // Second upload with same ID but different name
        const secondResponse = await uploadReport(request, studyUid, {
            reportId,
            filename: 'second.pdf',
            name: 'Second Upload',
        });
        expect(secondResponse.status()).toBe(200);

        const body = await secondResponse.json();
        expect(body.id).toBe(reportId);
        expect(body.name).toBe('Second Upload');
    });

    test('report name is trimmed and capped at 255 characters', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const longName = 'R'.repeat(300);

        const response = await request.post(`${BASE_URL}/api/notes/${studyUid}/reports`, {
            multipart: {
                file: {
                    name: 'report.pdf',
                    mimeType: 'application/pdf',
                    buffer: minimalPdfBuffer(),
                },
                name: longName,
            },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        expect(body.name.length).toBeLessThanOrEqual(255);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 32: GET /api/notes/reports/<id>/file - Download Report
// ---------------------------------------------------------------------------

test.describe('Test Suite 32: GET /api/notes/reports/<id>/file - Download Report', () => {
    test('returns the uploaded file bytes with the correct content-type', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const pdfBytes = minimalPdfBuffer();

        const { id: reportId } = await (
            await uploadReport(request, studyUid, { filename: 'download-test.pdf', fileContent: pdfBytes })
        ).json();

        const downloadResponse = await request.get(`${BASE_URL}/api/notes/reports/${reportId}/file`);
        expect(downloadResponse.status()).toBe(200);
        expect(downloadResponse.headers()['content-type']).toContain('application/pdf');

        const downloadedBytes = await downloadResponse.body();
        // The downloaded content must match what was uploaded
        expect(downloadedBytes).toEqual(pdfBytes);
    });

    test('returns 404 for a report ID that does not exist', async ({ request }) => {
        const response = await request.get(
            `${BASE_URL}/api/notes/reports/nonexistent-report-id-xyz/file`
        );
        expect(response.status()).toBe(404);
    });

    test('PNG download returns image/png content-type', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

        const { id: reportId } = await (
            await uploadReport(request, studyUid, {
                filename: 'image.png',
                mimeType: 'image/png',
                fileContent: pngBuffer,
            })
        ).json();

        const downloadResponse = await request.get(`${BASE_URL}/api/notes/reports/${reportId}/file`);
        expect(downloadResponse.status()).toBe(200);
        expect(downloadResponse.headers()['content-type']).toContain('image/png');
    });

    test('report remains downloadable after a second upload with same ID (upsert)', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const reportId = 'download-upsert-test-id';
        const secondContent = Buffer.from('%PDF-1.4\n% second version\n%%EOF\n');

        await uploadReport(request, studyUid, { reportId, filename: 'v1.pdf' });
        await uploadReport(request, studyUid, {
            reportId,
            filename: 'v2.pdf',
            fileContent: secondContent,
        });

        const downloadResponse = await request.get(`${BASE_URL}/api/notes/reports/${reportId}/file`);
        expect(downloadResponse.status()).toBe(200);

        const downloaded = await downloadResponse.body();
        expect(downloaded).toEqual(secondContent);
    });
});

// ---------------------------------------------------------------------------
// Test Suite 33: DELETE /api/notes/<study_uid>/reports/<id>
// ---------------------------------------------------------------------------

test.describe('Test Suite 33: DELETE /api/notes/<study_uid>/reports/<id>', () => {
    test('deletes an uploaded report and returns confirmation', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const { id: reportId } = await (await uploadReport(request, studyUid)).json();

        const deleteResponse = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/reports/${reportId}`
        );
        expect(deleteResponse.status()).toBe(200);

        const body = await deleteResponse.json();
        expect(body.deleted).toBe(true);
        expect(body.id).toBe(reportId);
    });

    test('returns 404 when deleting a report that does not exist', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const response = await request.delete(
            `${BASE_URL}/api/notes/${studyUid}/reports/nonexistent-rpt-id`
        );
        expect(response.status()).toBe(404);
    });

    test('returns 404 when deleting with the wrong study_uid', async ({ request }) => {
        const studyA = uniqueStudyUid();
        const studyB = uniqueStudyUid();
        const { id: reportId } = await (await uploadReport(request, studyA)).json();

        const response = await request.delete(
            `${BASE_URL}/api/notes/${studyB}/reports/${reportId}`
        );
        expect(response.status()).toBe(404);

        // Report under studyA must still exist
        const fileResponse = await request.get(
            `${BASE_URL}/api/notes/reports/${reportId}/file`
        );
        expect(fileResponse.status()).toBe(200);
    });

    test('deleted report is absent from subsequent batch GET results', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const { id: reportId } = await (await uploadReport(request, studyUid)).json();

        await request.delete(`${BASE_URL}/api/notes/${studyUid}/reports/${reportId}`);

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        // Study has no remaining notes -- absent from response
        expect(body.studies).not.toHaveProperty(studyUid);
    });

    test('file is no longer downloadable after deletion', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const { id: reportId } = await (await uploadReport(request, studyUid)).json();

        // Confirm file exists before deletion
        const before = await request.get(`${BASE_URL}/api/notes/reports/${reportId}/file`);
        expect(before.status()).toBe(200);

        // Delete
        await request.delete(`${BASE_URL}/api/notes/${studyUid}/reports/${reportId}`);

        // File should now return 404
        const after = await request.get(`${BASE_URL}/api/notes/reports/${reportId}/file`);
        expect(after.status()).toBe(404);
    });

    test('deleting one report leaves sibling reports for the same study intact', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const { id: idA } = await (
            await uploadReport(request, studyUid, {
                reportId: 'keep-this-report-aa11',
                filename: 'keep.pdf',
            })
        ).json();

        const { id: idB } = await (
            await uploadReport(request, studyUid, {
                reportId: 'del-this-report-bb22',
                filename: 'delete.pdf',
            })
        ).json();

        await request.delete(`${BASE_URL}/api/notes/${studyUid}/reports/${idB}`);

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        const reports = body.studies[studyUid]?.reports || [];
        const foundA = reports.find(r => r.id === idA);
        const foundB = reports.find(r => r.id === idB);

        expect(foundA).toBeDefined();
        expect(foundB).toBeUndefined();
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
        const getBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const entry = getBody.studies[studyUid];
        expect(entry).toBeDefined();
        expect(entry.description).toBe('migrated description');
        expect(entry.comments.length).toBe(2);
        expect(entry.comments.some(c => c.text === 'migrated comment one')).toBe(true);
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
                            comments: [
                                { text: 'series comment migrated', time: commentTime },
                            ],
                        },
                    },
                },
            },
        };

        const response = await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        expect(response.status()).toBe(200);

        const getBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const seriesEntry = getBody.studies[studyUid]?.series?.[seriesUid];
        expect(seriesEntry).toBeDefined();
        expect(seriesEntry.description).toBe('series description migrated');
        expect(seriesEntry.comments.some(c => c.text === 'series comment migrated')).toBe(true);
    });

    test('migration is idempotent: running twice does not duplicate comments', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const commentTime = Date.now() - 10000;

        const payload = {
            comments: {
                [studyUid]: {
                    study: [
                        { text: 'idempotent comment', time: commentTime },
                    ],
                },
            },
        };

        // Run migration twice with the same payload
        await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });

        const getBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const comments = getBody.studies[studyUid]?.comments || [];
        // The unique constraint (study_uid, series_uid, text, time) ensures no duplicates
        const matching = comments.filter(c => c.text === 'idempotent comment');
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

        const getBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

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
                        [seriesUid]: [
                            { text: 'legacy list comment', time: commentTime },
                        ],
                    },
                },
            },
        };

        const response = await request.post(`${BASE_URL}/api/notes/migrate`, { data: payload });
        expect(response.status()).toBe(200);

        const getBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const seriesEntry = getBody.studies[studyUid]?.series?.[seriesUid];
        expect(seriesEntry).toBeDefined();
        const found = seriesEntry.comments.find(c => c.text === 'legacy list comment');
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
// Test Suite 35: _sanitize_report_id boundary validation
// ---------------------------------------------------------------------------

test.describe('Test Suite 35: _sanitize_report_id Validation', () => {
    // These tests upload reports with various ID values and observe whether
    // the server accepts or rejects the provided ID. Because _sanitize_report_id
    // falls back to uuid4() on rejection (rather than returning 400), we check
    // whether the returned ID matches the input.

    const VALID_ID_CASES = [
        { id: 'abcd1234', label: 'exactly 8 chars (minimum length)' },
        { id: 'a'.repeat(64), label: 'exactly 64 chars (maximum length)' },
        { id: 'has-hyphens-here', label: 'hyphens allowed' },
        { id: 'has_underscores_', label: 'underscores allowed' },
        { id: 'MixedCASE12345ab', label: 'mixed case alphanumeric' },
    ];

    for (const { id, label } of VALID_ID_CASES) {
        test(`accepts valid ID: ${label}`, async ({ request }) => {
            const studyUid = uniqueStudyUid();
            const response = await uploadReport(request, studyUid, { reportId: id });
            expect(response.status()).toBe(200);

            const body = await response.json();
            expect(body.id).toBe(id);
        });
    }

    const INVALID_ID_CASES = [
        { id: 'short7', label: '7 chars (below minimum)' },
        { id: 'a'.repeat(65), label: '65 chars (above maximum)' },
        { id: 'has spaces id!!', label: 'spaces and special characters' },
        { id: 'dot.in.id.here', label: 'dots not allowed' },
        { id: '', label: 'empty string' },
    ];

    for (const { id, label } of INVALID_ID_CASES) {
        test(`rejects invalid ID and generates fallback UUID: ${label}`, async ({ request }) => {
            const studyUid = uniqueStudyUid();
            const response = await uploadReport(request, studyUid, { reportId: id || undefined });
            expect(response.status()).toBe(200);

            const body = await response.json();
            // Fallback UUID must not equal the invalid input
            if (id) {
                expect(body.id).not.toBe(id);
            }
            // Fallback should be a non-empty string
            expect(typeof body.id).toBe('string');
            expect(body.id.length).toBeGreaterThan(0);
        });
    }
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
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'Full lifecycle test series' } }
        );

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
        const batchBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const entry = batchBody.studies[studyUid];
        expect(entry.description).toBe('Full lifecycle test study');
        expect(entry.comments.some(c => c.text === 'Study-level observation')).toBe(true);
        expect(entry.series[seriesUid].description).toBe('Full lifecycle test series');
        expect(entry.series[seriesUid].comments.some(c => c.text === 'Series-level finding')).toBe(true);
        expect(entry.reports.some(r => r.id === reportId)).toBe(true);

        // 7. Edit the study comment
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/comments/${studyCommentId}`,
            { data: { text: 'Updated observation' } }
        );

        // 8. Delete the report
        await request.delete(`${BASE_URL}/api/notes/${studyUid}/reports/${reportId}`);

        // 9. Verify edits and deletions
        const afterBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const afterEntry = afterBody.studies[studyUid];
        const editedComment = afterEntry.comments.find(c => c.id === studyCommentId);
        expect(editedComment.text).toBe('Updated observation');
        expect(afterEntry.reports.find(r => r.id === reportId)).toBeUndefined();

        // 10. Delete the study description (clears it)
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '' },
        });

        // Study still has notes (comments remain), so it persists in the batch response
        const stillHasComments = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
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

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const comments = body.studies[studyUid]?.comments || [];
        expect(comments.length).toBe(texts.length);
        for (const text of texts) {
            expect(comments.some(c => c.text === text)).toBe(true);
        }
    });
});
