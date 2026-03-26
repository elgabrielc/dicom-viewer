// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Playwright API tests for study and series description endpoints.
 *
 * Endpoints covered:
 *   PUT /api/notes/<study>/description                    (save study description)
 *   PUT /api/notes/<study>/series/<series>/description    (save series description)
 *
 * Test suites: 26-27 (split from notes-api.spec.js)
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, uniqueStudyUid, uniqueSeriesUid } = require('./notes-test-helpers');

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

    test('saving empty string clears the description and study disappears from batch results', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        // Write a description first
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'will be cleared' },
        });

        // Now overwrite with empty string (row persists with empty description)
        const clearResponse = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '' },
        });
        expect(clearResponse.status()).toBe(200);

        const clearBody = await clearResponse.json();
        expect(clearBody.description).toBe('');

        // The study should no longer appear in batch results (has_notes = False now)
        const batchBody = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        expect(batchBody.studies).not.toHaveProperty(studyUid);
    });

    test('clearing then re-setting description resurrects the row', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        // Write, clear, then re-set
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'original' },
        });
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '' },
        });
        await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: 'resurrected' },
        });

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();
        expect(body.studies[studyUid].description).toBe('resurrected');
    });

    test('saving whitespace-only description behaves like empty (gets stripped)', async ({ request }) => {
        const studyUid = uniqueStudyUid();

        const response = await request.put(`${BASE_URL}/api/notes/${studyUid}/description`, {
            data: { description: '   \t  ' },
        });
        expect(response.status()).toBe(200);

        const body = await response.json();
        // Server strips leading/trailing whitespace; result is empty which clears the description
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

    test('saving empty series description clears it (row persists with empty description)', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        // Write description
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'to be cleared' } }
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

    test('clearing then re-setting series description resurrects the row', async ({ request }) => {
        const studyUid = uniqueStudyUid();
        const seriesUid = uniqueSeriesUid();

        // Write, clear, then re-set
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'original series' } }
        );
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: '' } }
        );
        await request.put(
            `${BASE_URL}/api/notes/${studyUid}/series/${seriesUid}/description`,
            { data: { description: 'resurrected series' } }
        );

        const body = await (
            await request.get(`${BASE_URL}/api/notes/?studies=${studyUid}`)
        ).json();

        const seriesEntry = body.studies[studyUid]?.series?.[seriesUid];
        expect(seriesEntry).toBeDefined();
        expect(seriesEntry.description).toBe('resurrected series');
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
