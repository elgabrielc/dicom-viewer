# Code Reviews

PR review findings and their resolution status.

**Scoping**: This file tracks what was found and recommended during PR reviews (pre-merge quality gate). For bugs found in the running codebase, see [BUGS.md](BUGS.md). When a finding outlives its PR, it gets promoted to BUGS.md with a `Promoted (BUG-XXX)` status here.

---

## PR #16: Add Tauri desktop app shell and persistence (2026-03-08)

Branch: `codex/tauri-desktop-app` | Score: 6/10

### Critical

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 16-1 | Unbounded recursive traversal in `collectPathSources` -- no depth limit or cycle detection, stack overflow on symlink loops | sources.js:225-247 | Open |
| 16-2 | `DesktopBackend.deleteReport` removes localStorage before file delete -- orphaned files on failure | api.js:306-334 | Open |

### Important

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 16-3 | `fs:default` capability broader than needed, no read-scope restriction on DICOM library paths | capabilities/default.json | Open |
| 16-4 | `deleteReport` rollback partial -- `saveStore` already called before file delete attempt | notes-reports.js:369-385 | Open |
| 16-5 | `markScanComplete` called even on empty scan results | main.js:181-198 | Open |
| 16-6 | Silent failure when Tauri APIs unavailable in desktop path | api.js:523-541 | Open |
| 16-7 | Cargo.toml author email field contains URL, not email | Cargo.toml:5 | Open |
| 16-8 | ADR 003 status not updated to reflect implementation progress | 003-tauri-desktop-shell-with-shared-web-core.md | Open |

### Suggestions

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 16-9 | `joinPath` heuristic fragile, should use Tauri `path.join` | sources.js:59-62 | Open |
| 16-10 | `desktop-smoke` CI job has no artifact upload on failure | pr-validate.yml | Open |
| 16-11 | No registry of localStorage keys across modules | desktop-library.js:5 | Open |
| 16-12 | Redundant state mutations before `applyLibraryConfigPayload` | library.js:128-130 | Open |
| 16-13 | `processFilesFromSources` -- one corrupt file aborts entire batch | sources.js:88-110 | Open |

---

## PR #54: Stabilize desktop XA scrubbing and diagnostics (2026-03-30)

Branch: `codex/desktop-memory-fix` | Score: 6/10

Reviewer note: the claimed `createStagedError` scope bug was a false alarm and is not
tracked below because `desktop-decode.js` already destructured it from `app.utils`.

### Important

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 54-1 | `queueNativeDecodeWithPixels` merged waiters for different frames, so callers waiting for frame A could receive frame B pixels | desktop-decode.js:160-174 | Resolved (0fcff6b) |
| 54-2 | W/L reset heuristic compared against the latest frame defaults instead of the user's original override anchor, which could silently drop or preserve the wrong override while scrubbing XA series | rendering.js:280-313, rendering.js:1238-1263, state.js:56-80, tools.js:389-399 | Resolved (0fcff6b) |

### Suggestions

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 54-3 | Import staged header reads stopped after `SOPInstanceUID` even though destination-path construction also needs Study and Series UIDs | import-pipeline.js:126-189 | Resolved (0fcff6b) |
| 54-4 | `INCOMPATIBLE_WINDOW_WIDTH_RATIO = 4` was undocumented magic | rendering.js:40 | Resolved (0fcff6b) |
| 54-5 | `normalizeBinaryResponse` behaved differently between import probing and desktop decode without explaining why | import-pipeline.js:88-105, desktop-decode.js:21-44 | Resolved (0fcff6b) |

### Follow-up CI Regression

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 54-6 | `coercePixelData` assumed the combined native decode payload was aligned for 16-bit typed arrays, which broke Playwright CI on signed/unsigned desktop decode tests | desktop-decode.js:83-109 | Resolved (50a4565) |

---

## PR #15: Frontend extraction refactor (2026-03-08)

Branch: `codex/frontend-extraction-refactor-pr` | Score: 7/10

### Important

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 15-1 | Inconsistent indentation in dicom.js and rendering.js -- function bodies at column 0 inside IIFE | dicom.js:7-445, rendering.js:21-245 | Open |
| 15-2 | `NotesAPI` referenced as bare global in library.js, bypasses `app` namespace | library.js:443,456 | Open |
| 15-3 | Dead `state` import in dicom.js | dicom.js:3 | Open |
| 15-4 | `section.content` raw HTML injection in help-viewer.js without comment explaining why it is safe | help-viewer.js:47 | Open |

### Suggestions

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| 15-5 | `processFiles` does not initialize `comments: []`, inconsistent with `loadSampleStudies` | sources.js:47 vs 229 | Open |
| 15-6 | CONFIG access pattern inconsistent -- guard vs. no guard across modules | main.js:317 vs notes-reports.js | Open |
| 15-7 | dom.js acquires canvas contexts at module load time, fragile if scripts move | dom.js:46-47 | Open |

---

*Last updated: 2026-03-30*
