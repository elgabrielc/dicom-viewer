# DICOM Viewer - API Documentation

Divergent Health Technologies
https://divergent.health/

Copyright (c) 2026 Divergent Health Technologies

---

## Overview

This document describes the REST API endpoints provided by the DICOM Viewer Flask backend. These endpoints are designed **for automated testing only** and are not intended for production use.

The primary workflow for the DICOM Viewer uses client-side DICOM processing via the File System Access API in the browser. Medical image data never leaves the user's machine. The server-side API exists solely to support Playwright end-to-end tests by providing a way to load test data without requiring user interaction with the file picker dialog.

---

## Base URL

```
http://127.0.0.1:5001
```

The Flask development server runs on port 5001 by default. This can be changed in `app.py`.

---

## Requirements

- Flask server running (`python app.py`)
- Test data folder available (configured via `DICOM_TEST_DATA` environment variable or default path)

---

## Authentication

None required. These endpoints are intended for local development and testing only.

---

## Rate Limiting

None implemented. The server handles requests synchronously.

---

## Endpoints

### GET /

Serves the main application page.

**Description:**
Returns the static `index.html` file which contains the full single-page application.

**Parameters:** None

**Response:**
- Content-Type: `text/html`
- Returns the main application HTML

**Example Request:**
```bash
curl http://127.0.0.1:5001/
```

---

### GET /api/test-data/info

Get information about available test data.

**Description:**
Returns metadata about the test data folder configuration and availability. Useful for verifying the test environment is correctly set up before running tests.

**Parameters:** None

**Response Format:**
```json
{
  "testDataFolder": "/path/to/test/data",
  "available": true,
  "studyCount": 1,
  "totalImages": 188
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `testDataFolder` | string | Absolute path to the configured test data folder |
| `available` | boolean | Whether the test data folder exists |
| `studyCount` | integer | Number of DICOM studies found |
| `totalImages` | integer | Total number of DICOM images across all studies |

**Example Request:**
```bash
curl http://127.0.0.1:5001/api/test-data/info
```

**Example Response:**
```json
{
  "testDataFolder": "/Users/gabriel/claude 0/test-data-mri-1",
  "available": true,
  "studyCount": 1,
  "totalImages": 188
}
```

**Notes:**
- If the test data folder does not exist, `available` will be `false` and counts will be `0`
- The folder is scanned lazily on first request and cached for subsequent requests

---

### GET /api/test-data/studies

Get a list of all studies in the test data folder.

**Description:**
Scans the test data folder for DICOM files and returns a structured list of studies, each containing their series. The results are cached after the first request for performance.

**Parameters:** None

**Response Format:**
```json
[
  {
    "studyInstanceUid": "a1b2c3d4e5f6",
    "patientName": "DOE^JOHN",
    "patientId": "12345",
    "studyDate": "20260115",
    "studyDescription": "Brain MRI",
    "modality": "MR",
    "seriesCount": 3,
    "imageCount": 188,
    "series": [
      {
        "seriesInstanceUid": "f6e5d4c3b2a1",
        "seriesDescription": "T1 AXIAL",
        "seriesNumber": "1",
        "modality": "MR",
        "sliceCount": 64
      }
    ]
  }
]
```

**Response Fields (Study):**

| Field | Type | Description |
|-------|------|-------------|
| `studyInstanceUid` | string | 12-character hash of the DICOM StudyInstanceUID |
| `patientName` | string | Patient name from DICOM tag (0010,0010) |
| `patientId` | string | Patient ID from DICOM tag (0010,0020) |
| `studyDate` | string | Study date in YYYYMMDD format |
| `studyDescription` | string | Study description from DICOM tag (0008,1030) |
| `modality` | string | Imaging modality (CT, MR, US, etc.) |
| `seriesCount` | integer | Number of series in this study |
| `imageCount` | integer | Total images across all series |
| `series` | array | List of series objects |

**Response Fields (Series):**

| Field | Type | Description |
|-------|------|-------------|
| `seriesInstanceUid` | string | 12-character hash of the DICOM SeriesInstanceUID |
| `seriesDescription` | string | Series description from DICOM tag (0008,103E) |
| `seriesNumber` | string | Series number from DICOM tag (0020,0011) |
| `modality` | string | Imaging modality for this series |
| `sliceCount` | integer | Number of slices (images) in this series |

**Example Request:**
```bash
curl http://127.0.0.1:5001/api/test-data/studies
```

**Example Response:**
```json
[
  {
    "studyInstanceUid": "7f3a8c2e1d4b",
    "patientName": "ANONYMIZED",
    "patientId": "ANON001",
    "studyDate": "20260101",
    "studyDescription": "MRI BRAIN W/O CONTRAST",
    "modality": "MR",
    "seriesCount": 2,
    "imageCount": 96,
    "series": [
      {
        "seriesInstanceUid": "b4d1e2c3a8f7",
        "seriesDescription": "T1 AXIAL",
        "seriesNumber": "1",
        "modality": "MR",
        "sliceCount": 48
      },
      {
        "seriesInstanceUid": "c5e2f3d4b9a8",
        "seriesDescription": "T2 AXIAL",
        "seriesNumber": "2",
        "modality": "MR",
        "sliceCount": 48
      }
    ]
  }
]
```

**Notes:**
- Returns an empty array `[]` if no test data is available
- Slices within each series are sorted by slice location and instance number
- The `studyInstanceUid` and `seriesInstanceUid` are MD5 hashes (first 12 characters) of the original DICOM UIDs

---

### GET /api/test-data/dicom/:study_id/:series_id/:slice_num

Get raw DICOM file bytes for a specific slice.

**Description:**
Returns the raw DICOM file content for a specific image slice. Used by the viewer in test mode to fetch image data without requiring file system access.

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `study_id` | string | Study instance UID hash (from `/api/test-data/studies`) |
| `series_id` | string | Series instance UID hash (from `/api/test-data/studies`) |
| `slice_num` | integer | Zero-based slice index within the series |

**Response:**
- Content-Type: `application/dicom`
- Returns raw DICOM file bytes

**Example Request:**
```bash
curl http://127.0.0.1:5001/api/test-data/dicom/7f3a8c2e1d4b/b4d1e2c3a8f7/0
```

**Example Response:**
Binary DICOM data (not shown).

**Error Responses:**

| Status Code | Response | Condition |
|-------------|----------|-----------|
| 404 | `{"error": "Study not found"}` | Invalid `study_id` |
| 404 | `{"error": "Series not found"}` | Invalid `series_id` |
| 404 | `{"error": "Slice index out of range"}` | `slice_num` >= series slice count or < 0 |
| 500 | `{"error": "<message>"}` | File read error |

**Example Error Response:**
```json
{
  "error": "Study not found"
}
```

**Notes:**
- Slice numbering is zero-based
- Slices are ordered by slice location and instance number (as determined during folder scan)
- The DICOM file is returned as-is; no server-side processing or decompression is performed

---

## Workflow Example

A typical test workflow using these endpoints:

```bash
# 1. Verify test data is available
curl http://127.0.0.1:5001/api/test-data/info

# 2. Get list of studies
curl http://127.0.0.1:5001/api/test-data/studies

# 3. Fetch a specific slice (using IDs from step 2)
curl -o slice.dcm http://127.0.0.1:5001/api/test-data/dicom/7f3a8c2e1d4b/b4d1e2c3a8f7/0
```

In the browser, test mode is activated by adding `?test` to the URL:
```
http://127.0.0.1:5001/?test
```

This triggers the frontend to use these API endpoints instead of the File System Access API.

---

## Configuration

### Test Data Folder

The test data folder can be configured via environment variable:

```bash
export DICOM_TEST_DATA="/path/to/your/test/data"
python app.py
```

Default path if not set:
```
~/claude 0/test-data-mri-1
```

---

## Static Files

All files in the `docs/` folder are served as static assets. This includes:

| Path | Description |
|------|-------------|
| `/css/style.css` | Application stylesheet |
| `/js/openjpeg.js` | OpenJPEG WASM loader |
| `/js/openjpeg.wasm` | OpenJPEG WebAssembly binary |
| `/sample/` | Sample CT scan data for demo |

---

*For testing documentation, see `TESTING.md`*
