# PR #120 — Harness Promotion Follow-Ups

Filed: 2026-05-17. After PR #120 completed the v3 plan's migration sequence (all four desktop specs now share `installMockDesktopTauri`), the v3 plan's 3-spec promotion rule is triggered for three behaviors that were kept spec-local during PRs #4 and #5. Documenting them here so future work can promote without re-deriving the analysis.

Context: the v3 plan's promotion rule states that "if a per-command handler or behavior appears in three specs, graduate it from spec-local to a first-class harness option. If a graduation happens, the same PR must update the harness, the README, and the contract tests."

## Medium

### 1. Graduate `dialog.open returns null` to a first-class harness option

**Affected specs (4):** `desktop-report-persistence.spec.js`, `desktop-import.spec.js` (both `installMockDesktop` and `installMockDesktopIntegration` helpers), `desktop-library.spec.js`.

**Current state:** every spec wrapper installs `window.__TAURI__.dialog = { async open() { return null; } }` as a post-install monkey-patch. The harness intentionally does not install `dialog` (per its scope boundary of "minimal Tauri surface; specs own extensions"), but four-of-four migrated specs install the same null-returning stub.

**Proposed promotion:** add `options.dialog.openReturns` (default: `undefined` → harness still omits dialog; if set, harness installs `dialog.open` returning that value). Specs that want the null-returning default pass `options.dialog.openReturns = null`. Specs that want a real return value (a path, an array of paths) pass that value.

**Required changes in the graduation PR:**
- `tests/helpers/mock-desktop-tauri.js`: add `options.dialog` handling.
- `tests/helpers/mock-desktop-tauri.README.md`: document the option + when to use it.
- `tests/helpers/mock-desktop-tauri.contracts.spec.js`: new test asserting that without the option, `dialog` is undefined; with the option, `dialog.open` returns the configured value.
- All 4 migrated spec helpers: remove the post-install `window.__TAURI__.dialog = ...` line and pass `dialog: { openReturns: null }` to `installMockDesktopTauri`.

**Note:** before promoting, verify no current spec passes a non-null return from `dialog.open` (a path or array of paths for file-picker tests). If yes, the option shape needs to support those values.

### 2. Graduate `read_scan_manifest` invoke to a harness option (with care)

**Affected specs (3):** `desktop-import.spec.js` (both helpers), `desktop-library.spec.js`.

**Current state:** all three wrappers intercept `core.invoke('read_scan_manifest', ...)` and return spec-local data, but **the return-value source differs**:

- `installMockDesktop` (import unit) and `installMockDesktopIntegration` (import) return `window.__importMockState.manifestEntries` (mutable spec-local state, populated from `opts.manifestEntries`).
- `installMockDesktop` (library) returns `opts.nativeScanManifest || null`.

**Proposed promotion:** add `options.invoke.scanManifest` to the harness. Default behavior: if `options.invoke.scanManifest` is set, the harness's `read_scan_manifest` invoke returns it. If unset, the harness throws the "unknown command" sentinel (per invariant #7).

**Design wrinkle:** the import specs rely on **mutable** `manifestEntries` (tests modify `__importMockState.manifestEntries` after install in some flows — verify via grep). The library spec is static. The promotion either:
- (a) accepts only static values (specs that mutate keep their wrappers), OR
- (b) supports both — the option is a function/getter, or specs mutate a documented `window.__mockDesktopTauriState.scanManifest` field that the harness reads on each invoke.

Recommend (a) for simplicity; only graduate the static case. Specs needing mutation continue to wrap.

**Required changes in the graduation PR:** same as above (harness + README + contract test + spec helpers updated).

### 3. Graduate `fs.stat` / `fs.exists` per-path override maps

**Affected specs (3):** `desktop-import.spec.js` (both helpers), `desktop-library.spec.js`.

**Current state:** all three accept `options.existsOverrides` / `options.statOverrides` (library uses `options.stats` for stat) as per-path maps, and the wrapper overrides `fs.exists` / `fs.stat` to consult the maps first. The harness's default `fs.exists` / `fs.stat` are deterministic from seeded files.

**Proposed promotion:** add `options.fs.existsOverrides` and `options.fs.statOverrides` to the harness. Defaults remain the current harness behavior; if overrides are passed, the harness consults them first per path (with normalization).

**Required changes in the graduation PR:** same pattern (harness + README + contract test). Spec helpers can drop the post-install wrappers for these two methods entirely.

## Low

### 4. Consider promoting the `mock-tauri-fs:` keyspace prefix as a documented constant

The harness's `FILE_STORAGE_PREFIX = 'mock-tauri-fs:'` is currently a private closure constant. PR #5 had to manually update three direct-localStorage assertions in `desktop-library.spec.js` (lines 3316/3324/3384) to switch from the bespoke `mock-desktop-fs:` prefix. Exposing the prefix as a named export (`FILE_STORAGE_PREFIX`) would let future tests reference it symbolically instead of hardcoding the string.

This is purely a clarity / refactor improvement; no behavioral change. Defer unless a future migration needs it.

## Order of operations if all three graduations land together

If a single graduation PR addresses items 1, 2, and 3, the harness API expansion is ~30 lines, the README addition is ~40 lines, the contract test additions are ~50 lines, and each spec helper loses ~10-15 lines. Net change: probably -100 to -150 lines across the four specs. Reviewable in one focused PR.

If they ship as separate PRs, item 1 (dialog) is the cleanest to do first — no design wrinkle, four-of-four use case. Items 2 and 3 each have a minor design decision (mutable vs static for #2; integration of two override map names for #3).

## What this doc does NOT cover

- The two follow-ups from `TODO-pr118-compat-runtime-followups.md` (Node-side test runner for `installCompatFromInternals`, immutability assertion, `__TAURI__` restoration). Those remain open and unrelated.
- Any structural changes to the harness beyond options-grouping additions.
- Real-Tauri smoke suite expansion (PR #1's one test stays nightly-only per its own stability policy).
