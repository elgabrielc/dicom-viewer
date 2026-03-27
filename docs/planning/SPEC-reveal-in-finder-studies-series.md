# Spec: Reveal in Finder for Studies and Series

## Goal

Add a right-click context menu to study rows and series rows in the desktop library view with a single action: `Reveal in Finder`.

Target behavior:

- study row -> reveal the study folder in Finder
- series row -> reveal a representative DICOM file so Finder selects it

This should feel consistent with the report right-click menu that already exists on `origin/main`.

## Current state on `origin/main`

- `desktop/src-tauri/src/main.rs` already exposes `reveal_in_finder(path)`:
  - file path -> `open -R <path>` selects the file in Finder
  - directory path -> `open <path>` opens the directory in Finder
- Reports already have a right-click menu in `docs/js/app/reports-ui.js`
- Report context-menu styling already exists in `docs/css/style.css` under:
  - `.report-context-menu`
  - `.report-context-item`
  - `.report-context-sep`
  - `.report-context-meta`
- That report menu is still implemented with report-specific local state and helpers:
  - `activeContextMenu`
  - `dismissContextMenu()`
  - `showReportContextMenu(...)`
- Study rows render as `.study-row` with `data-uid`
- Series containers render as `.series-dropdown-item` with `data-study-uid` and `data-series-uid`
- Series click-to-open is bound on `.series-main-row`
- Slice file paths are available at `state.studies[studyUid].series[seriesUid].slices[0].source.path`
- `docs/js/app/library.js` uses the local alias `config = window.CONFIG`, so desktop checks there should use `config?.deploymentMode === 'desktop'`

## Important data constraint

The desktop scan pipeline tracks `rootPath` while scanning and caching, but that is the scan root, not the study folder, and it is not carried through to the in-memory slice state used by the library UI.

That means study reveal cannot rely on `rootPath`, and it also should not assume that the parent of the first file is always the study directory.

The study target should be computed from the actual series file paths currently stored in `state`.

## Implementation

### 1. Extract a shared context-menu helper from the existing report code

Refactor the current report-only menu code in `docs/js/app/reports-ui.js` into a small shared helper on `app.contextMenu`:

- `app.contextMenu.dismiss()`
- `app.contextMenu.show(e, items)`

`show(e, items)` should:

- call `e.preventDefault()` and `e.stopPropagation()`
- dismiss any existing menu first
- render menu items using the existing report-prefixed CSS classes
- support three item shapes:
  - `{ label, action }`
  - `{ separator: true }`
  - `{ meta: "..." }`
- append the menu to `document.body` before measuring it
- position it using `getBoundingClientRect()` so it stays inside the viewport

Register the global click and outside-right-click dismissal once when the helper is initialized.

### 2. Move report menus onto the shared helper

Keep the current report UX, but have it call the shared helper instead of its own private menu renderer.

Report behavior should remain:

- right-click a report item -> show `Reveal in Finder` in desktop mode
- optionally show `Added <timestamp>` metadata below the action
- right-click the report toggle with one report -> show that report menu directly
- right-click the report toggle with multiple reports -> expand the report panel instead

### 3. Add library reveal helpers

In `docs/js/app/library.js`, add:

```javascript
function getSeriesFilePath(studyUid, seriesUid) {
    return state.studies[studyUid]?.series?.[seriesUid]?.slices?.[0]?.source?.path || '';
}

function getParentDirectory(path) {
    // Return the directory portion of a file path using either / or \ separators.
}

function getStudyFolderPath(studyUid) {
    // Collect one representative file path per series.
    // Convert each file path to its parent directory first.
    // Compute the deepest common parent directory across those directories.
}

async function revealInFinder(path) {
    try {
        await window.__TAURI__.core.invoke('reveal_in_finder', { path });
    } catch (err) {
        console.error('Failed to reveal in Finder:', err);
    }
}
```

Rules for `getStudyFolderPath(studyUid)`:

- collect one representative file path per series
- convert those file paths to parent directories first
- compute the deepest common parent across those directories
- single-series fallback: return that series directory
- if no usable path exists, return `''`

Do not compute the common prefix across raw file paths. That can overfit to filenames instead of directories.

Use `[\\\\/]` or equivalent path-aware splitting so the helper is robust if non-macOS paths ever appear in state.

### 4. Add study-row right-click

In `displayStudies()` in `docs/js/app/library.js`, attach `contextmenu` to `.study-row` in desktop mode only.

Handler requirements:

- call `e.preventDefault()` and `e.stopPropagation()` immediately
- if the target is inside `.comment-cell` or `.report-cell`, return after suppressing the native menu
- compute the study folder with `getStudyFolderPath(studyUid)`
- if a folder path exists, show `Reveal in Finder` through `app.contextMenu.show(e, items)`
- right-click must not expand or collapse the study row

### 5. Add series-row right-click

Attach `contextmenu` to `.series-main-row`, not `.series-dropdown-item`.

Handler requirements:

- call `e.preventDefault()` and `e.stopPropagation()` immediately
- if the target is inside `.comment-toggle`, return after suppressing the native menu
- get `studyUid` / `seriesUid` from the closest `.series-dropdown-item`
- get the series file path with `getSeriesFilePath(studyUid, seriesUid)`
- if a file path exists, show `Reveal in Finder`
- right-click must not open the viewer

### 6. CSS

No CSS rename is needed for this task.

Reuse the existing `.report-context-*` classes so reports, studies, and series all share one menu style.

`docs/css/style.css` only needs changes if the shared menu helper exposes a visual problem that the existing styles cannot handle.

## Critical details

- The main bug to avoid is native-menu leakage. Once a study-row or series-row handler owns the event, it must call `preventDefault()` before any path lookup or early return.
- Do not duplicate menu-rendering logic in both `reports-ui.js` and `library.js`.
- Study rows should reveal a folder; series rows should reveal a file.
- Study right-click belongs on `.study-row`.
- Series right-click belongs on `.series-main-row`.
- Use `config?.deploymentMode === 'desktop'` inside `library.js`.
- Non-desktop mode should not attach these custom library context-menu handlers.
- Report right-click behavior must keep working after the helper extraction.

## Files to modify

- `docs/js/app/library.js`
- `docs/js/app/reports-ui.js`
- `docs/css/style.css` only if a follow-up visual tweak is actually needed

## Verification

1. `node --check docs/js/app/library.js`
2. `node --check docs/js/app/reports-ui.js`
3. Relaunch the desktop app
4. Right-click a normal study-row cell -> custom `Reveal in Finder` menu appears, not the native WebView menu
5. Click it -> Finder opens to the study folder
6. Right-click a normal series row -> custom `Reveal in Finder` menu appears
7. Click it -> Finder opens with a DICOM file selected
8. Right-click does not expand/collapse the study row
9. Right-click does not open the series in the viewer
10. Right-click on report items and report toggles still behaves the same as before
11. Right-click with no usable path does not leak the native menu
