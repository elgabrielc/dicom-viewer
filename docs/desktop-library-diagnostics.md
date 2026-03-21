# Desktop Library Diagnostics

This note is the quick reference for rerunning desktop library scan diagnostics without turning them into normal app behavior.

## Default Behavior

The desktop app always uses the optimized header-first scan path.

Scan timing and report writing are **off by default**:

- normal desktop scans do not write `scan-timing.json`
- normal progress callbacks do not include timing fields
- diagnostics are enabled only when explicitly requested

## When To Use This

Turn diagnostics on when you need to:

- profile a slow real-world library scan
- compare performance before and after a scan-path change
- verify whether a regression is coming from directory walk time, file reads, parse time, or header fallback behavior

## Enable Diagnostics

Use either of these methods.

### Option 1: Query Parameter

Add `?scanTiming=1` to the desktop app URL.

For a one-off Tauri dev run, the simplest path is to temporarily change `build.devUrl` in [tauri.conf.json](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-scan-timing/desktop/src-tauri/tauri.conf.json) from:

```json
"devUrl": "http://127.0.0.1:1420"
```

to:

```json
"devUrl": "http://127.0.0.1:1420/?scanTiming=1"
```

Then launch:

```bash
cd desktop
npm run tauri -- dev
```

Revert `devUrl` after the diagnostic run.

### Option 2: localStorage Flag

From the desktop window devtools console:

```js
localStorage.setItem('dicom-viewer-debug-scan-timing', '1');
location.reload();
```

This keeps diagnostics enabled across reloads until removed.

To turn it back off:

```js
localStorage.removeItem('dicom-viewer-debug-scan-timing');
location.reload();
```

### Explicit Disable

If the localStorage flag is set but you want one launch without diagnostics, use `?scanTiming=0`.

## Running A Diagnostic Scan

1. Enable diagnostics.
2. Launch the desktop app.
3. Let the configured desktop library auto-load, or choose/refresh the folder from the desktop library UI.
4. Wait for the scan to finish.
5. Read the timing report from app data.

If you need startup determinism during testing, `?nolib` still disables library auto-load.

## Report Location

The report is written to Tauri app data as:

```text
$APPDATA/reports/scan-timing.json
```

On macOS that is currently:

```text
~/Library/Application Support/health.divergent.dicomviewer/reports/scan-timing.json
```

Example:

```bash
cat ~/Library/Application\ Support/health.divergent.dicomviewer/reports/scan-timing.json
```

## Report Fields

Typical report shape:

```json
{
  "totalMs": 99361,
  "readDirMs": 17792,
  "readFileMs": 183524,
  "parseMs": 5406,
  "finalizeMs": 6,
  "headerReadCount": 75653,
  "headerHitCount": 52545,
  "headerShortCount": 20719,
  "headerFallbackCount": 1076,
  "headerRejectedCount": 1313,
  "discovered": 75725,
  "valid": 53265
}
```

Field meanings:

- `totalMs`: wall-clock scan time seen by the user
- `readDirMs`: cumulative time spent in directory listing calls
- `readFileMs`: cumulative time spent reading header chunks and any fallback full-file reads
- `parseMs`: cumulative metadata parse time
- `finalizeMs`: time spent sorting and finalizing the studies map after scanning
- `headerReadCount`: files that used the native header-read command
- `headerHitCount`: files whose metadata was fully resolved from the header read alone
- `headerShortCount`: files smaller than the scan header size, so no full-read fallback was needed
- `headerFallbackCount`: files that needed a full-file retry after a truncation-like header parse failure
- `headerRejectedCount`: large files rejected after header parse failure without paying for a second full read
- `discovered`: total files seen during the walk
- `valid`: renderable image DICOM objects admitted into the library

## Reading The Numbers

Two important interpretation rules:

- `totalMs` is wall-clock latency. That is the number to optimize for user experience.
- `readFileMs` and `parseMs` are cumulative across concurrent work, so they can exceed `totalMs`.

If `readFileMs` dominates, focus on file I/O shape and fallback behavior.

If `headerFallbackCount` spikes after a scan-path change, the header-read heuristic is too aggressive or the retry rule is too broad.

If `readDirMs` becomes large relative to `totalMs`, inspect directory walk behavior and hot-loop path operations.

## Related Files

- [desktop-library.js](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-scan-timing/docs/js/app/desktop-library.js)
- [sources.js](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-scan-timing/docs/js/app/sources.js)
- [decode.rs](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-scan-timing/desktop/src-tauri/src/decode.rs)
