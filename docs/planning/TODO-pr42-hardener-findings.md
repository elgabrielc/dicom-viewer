# PR #42 Hardener Audit Findings

Audit date: 2026-03-27. To be addressed before or after merge.

## High

1. **`reveal_in_finder` accepts arbitrary paths** -- `main.rs:13-27`. No path validation. Should validate under `$APPDATA/reports/` or accept reportId instead of raw path.
2. **`fs_scope` removal from scan/decode commands** -- `decode.rs`, `scan.rs`. Read commands have no Tauri-side path restriction. Need compensating controls or restore scope with working persisted-scope.
3. **`capabilities/default.json` scope widened to `$APPDATA/**`** -- Should enumerate specific paths (`reports/`, `decode-cache/`, `viewer.db`) instead of blanket access.
4. **DICOMDIR processing is dead code** -- `sources.js` `processDesktopPathDicomDirFile`. Parses DICOMDIR but discards results. Remove entirely or restore with transferSyntax fix.

## Medium

5. **`markFailed` uses regex on error messages** -- `sync-engine.js`. Fragile string matching. Use typed error flags (`err.transient = true`) instead.
6. **Duplicate `waitForDesktopRuntime` polling** -- `main.js` and `desktop.js` both poll with 5s/50ms but for different APIs. Extract shared `waitForTauriApi(predicate)` helper.
7. **`_dispatchSyncEvent` still duplicated** -- `sync-engine.js` instance method is identical to `sync.js` export. Use `window.SyncOutbox.dispatchSyncEvent` instead.
8. **Context menu hardcoded height** -- `reports-ui.js`. Uses 70px guess. Measure with `getBoundingClientRect()` instead.

## Low

9. **Context menu click listener always active** -- Register/remove on show/dismiss instead of permanent listener.
10. **`formatTimestamp` US-only** -- Consider `Intl.DateTimeFormat` for locale awareness.
11. **`revealReportInFinder` fails silently** -- Show user-facing message when file not found.
12. **`sql:allow-execute` undocumented** -- Add comment in capabilities file.
