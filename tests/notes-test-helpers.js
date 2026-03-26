// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Shared helpers for notes API tests.
 *
 * Extracted during test-split refactoring so that comments, study-notes,
 * reports, and cross-cutting notes-api test files can share utilities
 * without duplication.
 */

const BASE_URL = 'http://127.0.0.1:5001';

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

module.exports = {
    BASE_URL,
    uniqueStudyUid,
    uniqueSeriesUid,
    minimalPdfBuffer,
    uploadReport,
};
