# DICOM Viewer - Configuration Reference

Configuration settings for the DICOM Viewer application.

Copyright (c) 2026 Divergent Health Technologies

---

## Environment Variables

### DICOM_TEST_DATA

| Property | Value |
|----------|-------|
| Purpose | Path to folder containing DICOM files for automated testing |
| Default | `~/claude 0/test-data-mri-1` |
| Format | Absolute or expandable path to a directory |

The test data folder should contain DICOM files organized by study/series. The Flask server scans this folder recursively, reading DICOM metadata to organize files into studies and series. Files are identified by their DICOM UIDs, not by folder structure.

**Usage:**
```bash
# Use default path
python app.py

# Specify alternate test data
DICOM_TEST_DATA="/path/to/dicom/folder" python app.py
```

### Flask Environment Variables

Standard Flask environment variables apply:

| Variable | Default | Description |
|----------|---------|-------------|
| `FLASK_ENV` | `production` | Set to `development` for debug mode |
| `FLASK_DEBUG` | `0` | Set to `1` to enable debug mode |

When running via `python app.py`, debug mode is enabled automatically (see `app.run(debug=True)`).

---

## Configuration Files

### requirements.txt

Python dependencies for the Flask backend.

| Package | Purpose |
|---------|---------|
| `flask>=2.0.0` | Web framework for static file serving and test data API |
| `pydicom>=2.3.0` | DICOM file parsing for test data scanning (reads headers, not pixels) |

**Why these specific versions:**
- Flask 2.0+ provides async support and improved routing
- pydicom 2.3+ has better handling of malformed DICOM files

### package.json

Node.js dependencies and build scripts.

#### Dependencies

| Package | Purpose |
|---------|---------|
| `@cornerstonejs/codec-openjpeg` | WebAssembly JPEG 2000 decoder for compressed DICOM images |
| `@playwright/test` | End-to-end testing framework |
| `playwright` | Browser automation library (required by @playwright/test) |

#### Scripts

**postinstall** - Runs automatically after `npm install`:
```bash
cp node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegwasm* static/js/
```

This copies the OpenJPEG WASM files from node_modules to the static directory where the browser can load them. The WASM decoder is necessary for JPEG 2000 compressed DICOM files (Transfer Syntax 1.2.840.10008.1.2.4.90).

**Why postinstall:** Ensures WASM files are always in the correct location after any npm install, preventing broken builds when the dependency updates.

### playwright.config.js

Playwright test runner configuration.

#### Key Settings

| Setting | Value | Reason |
|---------|-------|--------|
| `testDir` | `./tests` | Test files location |
| `fullyParallel` | `true` | Run independent tests concurrently for speed |
| `forbidOnly` | `true` (CI) | Prevent accidental commit of `test.only` |
| `retries` | 2 (CI), 0 (local) | CI retries help with flaky network conditions |
| `workers` | 1 (CI), auto (local) | Serial execution in CI for stability |
| `baseURL` | `http://127.0.0.1:5001` | Flask server address |
| `timeout` | 60000 (60s) | Per-test timeout (DICOM loading can be slow) |
| `expect.timeout` | 10000 (10s) | Timeout for expect assertions |

#### webServer Configuration

```javascript
webServer: {
  command: './venv/bin/flask run --host=127.0.0.1 --port=5001',
  url: 'http://127.0.0.1:5001/api/test-data/info',
  reuseExistingServer: !process.env.CI,
  timeout: 60000
}
```

| Setting | Value | Reason |
|---------|-------|--------|
| `command` | Flask run via venv | Uses project's virtual environment |
| `url` | `/api/test-data/info` | Health check endpoint (confirms server started and scanned test data) |
| `reuseExistingServer` | `true` (local) | Reuse running server during development |
| `reuseExistingServer` | `false` (CI) | Start fresh server in CI for isolation |
| `timeout` | 60000 | Initial test data scan can take time with large datasets |

**Why check `/api/test-data/info`:** This endpoint confirms both that the server started AND that test data scanning completed. A simple health check on `/` would pass before the scan finishes.

#### Browser Projects

Only Chromium is configured because the File System Access API (used for folder selection in normal mode) is only available in Chrome/Edge. Testing other browsers is unnecessary since the core functionality requires Chromium-based browsers.

---

## Runtime Configuration

### Flask Port

The application runs on port **5001** by default.

**Why 5001 instead of 5000:** macOS Monterey and later use port 5000 for AirPlay Receiver. Using 5001 avoids conflicts.

**To change the port:**
```bash
# Command line
python app.py --port 8080

# Or edit app.py:
app.run(debug=True, host='0.0.0.0', port=8080)
```

If you change the port, also update `playwright.config.js`:
- `use.baseURL`
- `webServer.command`
- `webServer.url`

### Test Mode URL Parameter

| URL | Behavior |
|-----|----------|
| `http://127.0.0.1:5001/` | Normal mode - user must drop a folder |
| `http://127.0.0.1:5001/?test` | Test mode - auto-loads from DICOM_TEST_DATA |

Test mode exists because the File System Access API requires user interaction (folder picker). Automated tests cannot trigger this UI. Test mode bypasses the folder picker by having the Flask server read DICOM files and serve them via API endpoints.

**Test mode endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `/api/test-data/studies` | List all studies with series metadata |
| `/api/test-data/dicom/<study>/<series>/<slice>` | Get raw DICOM file bytes |
| `/api/test-data/info` | Get test data availability and counts |

---

## Browser Requirements

### Chrome 86+ or Edge 86+

The DICOM Viewer requires a Chromium-based browser version 86 or later.

**Why these browsers:**

1. **File System Access API** - The primary user workflow (selecting a folder of DICOM files) uses the File System Access API. This API is only available in Chrome and Edge, starting from version 86 (October 2020).

2. **showDirectoryPicker()** - This method lets users select a folder and grant read access to all files within it. This is essential for loading DICOM studies which typically contain hundreds of files across multiple folders.

3. **No Firefox or Safari support** - These browsers do not implement the File System Access API and have no announced plans to do so. The fallback would be individual file selection via `<input type="file">`, which is impractical for DICOM workflows.

**How to check API support:**
```javascript
if ('showDirectoryPicker' in window) {
  // File System Access API available
} else {
  // Show browser upgrade message
}
```

### File System Access API Dependency

The viewer uses the File System Access API for:

| Feature | API Method |
|---------|-----------|
| Folder selection | `showDirectoryPicker()` |
| Reading files | `FileSystemFileHandle.getFile()` |
| Recursive folder access | `FileSystemDirectoryHandle.values()` |

**Security model:** The user explicitly grants permission by selecting a folder. The browser remembers this permission for the session but does not persist it across browser restarts. This protects patient data by ensuring users consciously choose which DICOM data to load.

**Alternative for testing:** The `?test` URL parameter bypasses the File System Access API entirely, loading DICOM data from the server instead. This is only for automated testing, not for production use.

---

## Quick Reference

```bash
# Default configuration
python app.py                    # Server on port 5001
# → Visit http://127.0.0.1:5001/ (normal mode)
# → Visit http://127.0.0.1:5001/?test (test mode)

# Custom test data
DICOM_TEST_DATA="/path/to/data" python app.py

# Run tests (uses playwright.config.js settings)
npx playwright test
```

---

*See also: `TESTING.md` for testing documentation*
