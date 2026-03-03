# ADR 002: Persistent Local DICOM Library

## Status
Implemented (PRs #6-#10, merged Feb 25-26 2026)

## Context

Every time the app was opened, the user had to drag-and-drop their DICOM folders again. There was no persistent library. The request was to make the app work "like Horos" -- import images once, and they're always there.

The existing `?test` mode already had 90% of the infrastructure: `scan_dicom_folder()` recursively finds DICOMs, groups by study/series UIDs, caches results in memory, and serves them via API. The feature was about generalizing this into a reusable pattern for any folder, not building from scratch.

This ADR covers the library architecture. The launcher script is covered in [ADR 001](001-launch-command.md).

Related sessions: 2026-02-24 (Architecture and Planning), 2026-02-25 (Implementation), 2026-02-25/26 (Configurable Folder and Review Fixes).

## Decision

Designate a local folder (`~/DICOMs` by default) that Flask scans on startup. Serve the results via API. The frontend auto-loads the library in personal mode. Users can change the folder path from the UI at runtime.

The implementation reuses the test-mode scanning infrastructure via a shared `DicomFolderSource` class, with two instances: `test_source` (test data) and `library_source` (`~/DICOMs` or user-configured path).

## Alternatives Considered

- **Duplicate test-data endpoints under `/api/library/`**: The initial plan proposed mirroring the existing test-data routes. Two independent critiques flagged this as the biggest problem -- near-identical code paths that would triple if cloud mode was added later. Led to the `DicomFolderSource` extraction.

- **Source-provider architecture** with `state.sources.library`, `state.sources.session`, active source switching, and a source selector UI: Proposed in a counter-plan. Rejected as over-engineered for the "extremely simple and dirty" goal. Drag-and-drop simply replaces `state.studies` (library is the default, drop is the override).

- **Auth-ready notes seam** (adding `actor_id` to notes tables, composite keys, request context helpers): Proposed alongside the source-provider pattern. Rejected as YAGNI -- real DICOM UIDs work unchanged for cloud since notes are already keyed by UID.

- **Hashed IDs for library** (reusing `_generate_id()` from test mode): The test-mode scanner hashed UIDs via SHA-256 into 12-char hex strings. If the library used hashed IDs but drag-and-drop used raw UIDs, the same study would have different IDs depending on how it was loaded -- notes wouldn't match. Rated P1 in first critique. Fix: use raw `StudyInstanceUID`/`SeriesInstanceUID` everywhere. DICOM UIDs are digits and dots only, already URL-safe.

- **Keep the `loadSlice` monkey-patch**: Test mode worked by monkey-patching `loadSlice()` -- a degraded copy missing Location metadata, MRI params, blank slice handling, and `drawMeasurements()`. Instead of extending the monkey-patch, the plan added `apiBase` as a third source type in the original `loadSlice`. Deleted ~60 lines, gave API-loaded slices full feature parity.

- **`slice.fetchUrl` (pre-built URL per slice)** vs **`slice.apiBase` (base path)**: v3 of the plan proposed `fetchUrl`. A counter-plan proposed `apiBase` with URL construction at fetch time. `apiBase` won as cleaner -- one field instead of two, URL logic in one place. Claude's response: *"This is a cleaner plan than mine."*

- **Single PR**: Claude collapsed to one PR in v3. Gabriel pushed back: *"Why did you get rid of the chunking by PR?"* Restored to 3 PRs for modularity and visible progress.

- **Swapping entire `DicomFolderSource` object on folder change**: A critique suggested "swap library_source under a lock." Refined to just adding a `set_folder()` method that reuses the existing condition variable lock. No new object creation, no race where readers hold a reference to the old object.

- **Browser File Picker for folder selection**: File Picker APIs don't return persistent filesystem paths. A text input was the right approach for a setting that persists in a config file.

- **Auto-creating arbitrary user-specified directories**: Only the default `~/DICOMs` is auto-created. User-specified paths must already exist and be readable. Creating `/tmp/foo/bar/baz` because someone typed it would be wrong.

## Design Details

### DicomFolderSource class (`app.py`)

Encapsulates folder scanning with caching and thread safety:
- `get_data()` -- scans or returns cached results
- `refresh()` -- invalidates cache and re-scans
- `format_studies()` -- formats scan results into the JSON shape the frontend expects
- `get_slice_path()` -- looks up a file path for a specific slice
- `set_folder(path)` -- hot-swaps the folder and re-scans without restart

Thread safety uses `threading.Condition` with a `_scan_in_progress` flag. The lock is held only for cache reads/writes, never during the actual scan (which can take seconds on large libraries). Waiting threads block on the condition variable until the scan completes.

Two instances: `test_source = DicomFolderSource(TEST_DATA_FOLDER)` and `library_source = DicomFolderSource(LIBRARY_FOLDER)`. All test-data and library endpoints are thin wrappers around these.

### Configurable folder with precedence chain

`DICOM_LIBRARY` env var > `data/settings.json` > `~/DICOMs`

`POST /api/library/config` validates the path (exists, readable directory), saves to `data/settings.json` via atomic write (`tempfile` + `os.replace()`), and calls `set_folder()` to apply immediately. When env var is active, the UI saves but shows "currently overridden by DICOM_LIBRARY env var."

### Frontend auto-load (`docs/index.html`, `docs/js/config.js`)

- `libraryAutoLoad` feature flag in `config.js` (personal mode only)
- `loadStudiesFromApi(apiBase, options)` replaces both `loadTestData()` and the planned library loader, handling both test-array and library-object response shapes
- `AbortController` cancels in-flight library fetch if user drops a folder or loads a sample (race protection, not in original plan)
- `?nolib` URL parameter suppresses library auto-load for test determinism
- Refresh Library button with capability-based visibility (shown when API returns `available: true`, not mode-based)

### Path traversal prevention

`get_safe_slice_path()` uses `Path.resolve()` + `is_relative_to()` on all DICOM-serving routes. Symlinks inside `~/DICOMs` pointing outside the library folder are rejected. Added during implementation, not in original plan.

## Review Iterations

The plan went through 5 major revisions with 2 external critique cycles:

1. **V1**: Mirror test-data endpoints, `~/DICOMs` default, auto-load in personal mode.
2. **Critique 1** (7 issues, 3 P1): Hashed ID blocker, DRY violation (duplicate endpoints), GET for refresh (wrong verb), no locking, coexistence with drag-and-drop unspecified.
3. **V2**: Real UIDs, POST for refresh, `threading.Lock`, capability detection.
4. **Critique 2** (8 issues): DRY still the biggest problem, missing `config.js` integration, no loading indicator, performance for large libraries.
5. **Counter-plans**: One proposed 4-PR enterprise architecture with source-provider and auth-ready notes (rejected as over-engineered). Another proposed `DicomFolderSource` + `apiBase` (adopted).
6. **Final plan**: 3 PRs -- backend (DicomFolderSource), frontend (apiBase + auto-load), launcher (.command).

Implementation went through 4 code review rounds (5/10 to 7/10):
- **Round 1 (5/10)**: Double-fetch in `refreshLibrary()`, path traversal vulnerability, TOCTOU on `available` flag, lock held during scan.
- **Round 2 (7/10)**: Double-checked locking broken (two threads could scan concurrently), `os.cpu_count()` returning `None`.
- **Round 3 (7/10)**: `_save_settings()` not atomic or thread-safe.
- **Round 4 (7/10)**: `LIBRARY_CONFIG_LOCK` held across entire `set_folder()` scan, blocking all library API requests. Fixed with a 4-line change (PR #9).

## Consequences

Positive:
- DICOMs persist across sessions -- import once, always available.
- `DicomFolderSource` abstraction provides a clean path to cloud mode (`DicomDatabaseSource` with same interface).
- Eliminating the monkey-patch gave API-loaded slices full feature parity with drag-and-drop (MRI params, blank slice handling, measurements).
- 197 Playwright tests passing, including path traversal and library API coverage.

Negative:
- Adds server-side state (folder path, scan cache) that must stay consistent.
- `threading.Condition` adds concurrency complexity to `app.py`.
- Configurable folder requires `data/settings.json` file management (atomic writes, lock coordination).

Operational note:
- Feature directly sparked the sortable study table feature -- after loading 65 real studies, the user's first reaction was: *"it worked. but what order are these in?"*
