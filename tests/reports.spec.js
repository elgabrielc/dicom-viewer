// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Playwright API tests for report endpoints.
 *
 * Endpoints covered:
 *   POST /api/notes/<study>/reports           (upload report)
 *   GET  /api/notes/reports/<id>/file         (download report)
 *   DELETE /api/notes/<study>/reports/<id>    (delete report)
 *
 * Test suites: 31-33, 35 (split from notes-api.spec.js)
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, uniqueStudyUid, minimalPdfBuffer, uploadReport } = require('./notes-test-helpers');

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
