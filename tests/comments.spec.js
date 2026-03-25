// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Playwright API tests for comment endpoints.
 *
 * Endpoints covered:
 *   POST /api/notes/<study>/comments          (add comment)
 *   PUT  /api/notes/<study>/comments/<id>     (edit comment)
 *   DELETE /api/notes/<study>/comments/<id>   (delete comment)
 *
 * Test suites: 28-30 (split from notes-api.spec.js)
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, uniqueStudyUid, uniqueSeriesUid } = require('./notes-test-helpers');

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
