# Spec: Reveal in Finder for Studies and Series

## Goal

Right-click context menu on study rows and series rows in the desktop library view with "Reveal in Finder". Matches Horos behavior.

## Current state

- `reveal_in_finder` Rust command exists in `desktop/src-tauri/src/main.rs` (accepts a path, calls `open -R`)
- Report context menu exists in `docs/js/app/reports-ui.js` with shared helpers on `app.contextMenu.show(e, items)` and `app.contextMenu.dismiss()`
- CSS classes `.report-context-menu`, `.report-context-item`, `.report-context-sep` exist in `docs/css/style.css`
- Desktop mode detected via `CONFIG.deploymentMode === 'desktop'` (or local `config?.deploymentMode`)
- Slice file paths stored at `state.studies[studyUid].series[seriesUid].slices[0].source.path`

## What to implement

In `docs/js/app/library.js`:

### 1. Study row right-click

Attach `contextmenu` listener to `.study-row` elements inside `displayStudies()`. Desktop mode only.

- Skip if `e.target.closest('.report-cell')` (report cell has its own context menu)
- Always call `e.preventDefault()` and `e.stopPropagation()` immediately (before any path checks) to suppress the native WebView menu
- Compute the study folder path: deepest common parent directory across all series' first-slice file paths
- If path found, show context menu with "Reveal in Finder" using `app.contextMenu.show(e, [{ label, action }])`
- If no path, return silently (native menu already suppressed)

### 2. Series row right-click

Attach `contextmenu` listener to `.series-main-row` elements (not `.series-dropdown-item`). Desktop mode only.

- Skip if `e.target.closest('.comment-toggle')`
- Always call `e.preventDefault()` and `e.stopPropagation()` immediately
- Get the first slice's file path: `state.studies[studyUid].series[seriesUid].slices[0].source.path`
- If path found, show context menu with "Reveal in Finder"
- `reveal_in_finder` with a file path calls `open -R` which selects the file in Finder

### 3. Study folder path computation

```javascript
function getStudyFolderPath(studyUid) {
    // Collect one file path per series (first slice)
    // Compute deepest common parent directory across all paths
    // For single series: parent directory of the first file
    // For multiple series: longest common path prefix (split by '/')
}
```

### 4. Reveal helper

```javascript
async function revealInFinder(path) {
    await window.__TAURI__.core.invoke('reveal_in_finder', { path });
}
```

## Critical details

- `e.preventDefault()` MUST be called before any conditional returns. Without it, the native WebView context menu appears. This was the bug in the initial attempt.
- Right-click must NOT expand/collapse the study row or open the viewer for series
- The context menu uses existing `app.contextMenu.show()` from `reports-ui.js` -- do NOT duplicate the show/dismiss/position logic
- Use existing CSS classes (`.report-context-menu`, etc.) -- do NOT create new ones
- The local variable `config` (line 5 of library.js) is `window.CONFIG` -- use `config?.deploymentMode` not `CONFIG.deploymentMode`

## Files to modify

- `docs/js/app/library.js` only

## Verification

1. Right-click study row -> "Reveal in Finder" menu appears (not native menu)
2. Click it -> Finder opens to the study's folder
3. Right-click series row -> "Reveal in Finder" menu appears
4. Click it -> Finder opens with the first DICOM file selected
5. Right-click on report cell -> shows report context menu (not study menu)
6. Right-click does NOT expand study or open viewer
7. Non-desktop mode -> no custom context menu (and no native menu leak)
8. `node -c docs/js/app/library.js` passes
