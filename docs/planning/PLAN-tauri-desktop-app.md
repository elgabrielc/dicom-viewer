# Plan: Tauri Desktop App for DICOM Viewer

**Status**: Historical plan, completed

This document restores the Claude-authored Tauri desktop plan into the tracked documentation tree so it is easy to find from the normal project docs.

**Outcome**:
- Implemented on the `codex/tauri-desktop-app` stack
- Merged as [PR #16](https://github.com/elgabrielc/dicom-viewer/pull/16)
- Hardened by [PR #17](https://github.com/elgabrielc/dicom-viewer/pull/17)

**Key commits**:
- `e67108a` `Normalize slice source model`
- `d03ca58` `Scaffold Tauri desktop spike`
- `d61dad1` `Add Tauri path-based file loading`
- `06e7935` `Add desktop persistent library`
- `a9383b6` `Persist desktop reports locally`
- `f5e94c4` `Productize Tauri desktop shell`
- `cdfaf41` `Address Tauri desktop review findings`

See [ADR 003](../decisions/003-tauri-desktop-shell-with-shared-web-core.md) for the decision record and [session-summaries.md](../history/session-summaries.md) for the surrounding timeline.

---

## Context

The DICOM viewer needed to ship as a consumer-grade macOS application: one-click download, one-click launch, no technical setup. After evaluating DIY `.app` bundles, Platypus, py2app, Electron, and Tauri across multiple external reviews and critique rounds, the decision was **Tauri v2**, gated by a validation spike.

This plan was written after the frontend extraction into modular `docs/js/app/*.js` files and before the desktop implementation landed.

---

## Codebase Assumptions at Planning Time

The plan assumed the extracted web frontend architecture:

```
state.js -> dom.js -> utils.js -> dicom.js -> tools.js -> rendering.js ->
sources.js -> notes-reports.js -> help-viewer.js -> viewer.js -> library.js -> main.js
```

Key assumptions:
- The app stayed on classic `<script>` tags and IIFEs with `window.DicomViewerApp`
- No bundler or ESM migration
- Tauri APIs would be exposed via `withGlobalTauri: true`
- Desktop support would be layered as environment adapters on the shared web core

---

## Planned PR Breakdown

### PR 1: Normalize slice source model

**Goal**: Introduce a unified `slice.source = { kind, ... }` abstraction so browser handles, blobs, API slices, and later desktop paths all flow through one loading contract.

**Planned change**:
- Refactor `readSliceBuffer()` in `docs/js/app/sources.js` to switch on `slice.source.kind`
- Normalize slice creation for:
  - browser file handles
  - in-memory blobs
  - API-backed slices

**Why it mattered**:
- Pure refactor, low risk
- Reduced later Tauri blast radius

**Implemented as**:
- `e67108a` `Normalize slice source model`

### PR 2: Tauri project scaffold + spike validation

**Goal**: Stand up the Tauri shell and validate the existing viewer inside WKWebView before committing to the desktop path.

**Planned change**:
- Add `desktop/` Tauri scaffold
- Configure `tauri.conf.json`, capabilities, Rust entry point, and desktop package metadata
- Add desktop deployment mode detection in `docs/js/config.js`
- Run spike checklist:
  - scripts load cleanly
  - `window.__TAURI__` exists
  - JPEG 2000 WASM works
  - sample studies load
  - 2D canvas rendering and W/L work
  - vtk.js WebGL2 validation informational only

**Why it mattered**:
- This was the go/no-go spike
- Failure would have redirected the project back to Electron

**Implemented as**:
- `d03ca58` `Scaffold Tauri desktop spike`

### PR 3: Tauri drag-drop and file loading

**Goal**: Make OS drag-drop and filesystem-backed loading work inside Tauri.

**Planned change**:
- Add `path` as a `slice.source.kind`
- Add `collectPathSources()`, `processFilesFromSources()`, and `loadDroppedPaths()`
- Branch `main.js` drag-drop registration between browser DOM events and Tauri `onDragDropEvent`

**Why it mattered**:
- Drag-drop is the core desktop intake path
- This was the main integration seam between native file paths and the existing JS viewer

**Implemented as**:
- `d61dad1` `Add Tauri path-based file loading`

### PR 4: Desktop persistent library

**Goal**: Replace Flask-backed library loading with a client-side desktop library built on Tauri fs access and persisted scope.

**Planned change**:
- Add a new desktop library adapter
- Persist chosen folder in localStorage
- Use native directory picker via Tauri dialog plugin
- Auto-load the library on relaunch
- Rewire library config / refresh UI paths for desktop mode

**Why it mattered**:
- The desktop product needed “import once, always there”
- This replaced the Flask-only library assumptions in the browser/test setup

**Implemented as**:
- `06e7935` `Add desktop persistent library`

### PR 5: Desktop report persistence

**Goal**: Make report uploads survive desktop restarts by storing both bytes and metadata locally.

**Planned change**:
- Add a `DesktopBackend` in `docs/js/api.js`
- Save report file bytes into app data
- Persist report metadata in the local notes store
- Support reopening via `convertFileSrc()`

**Why it mattered**:
- The browser fallback behavior kept reports in memory only
- Desktop mode needed actual persistence semantics

**Implemented as**:
- `a9383b6` `Persist desktop reports locally`

### PR 6: Productize desktop app

**Goal**: Turn the working Tauri spike into a consumer-grade desktop shell.

**Planned change**:
- Add production icons
- Configure window defaults
- Add native menu bar entries
- Add CI build smoke
- Update docs for desktop architecture and release flow
- Treat code signing/notarization as release work

**Why it mattered**:
- Shipping quality required more than just “Tauri dev works”

**Implemented as**:
- `f5e94c4` `Productize Tauri desktop shell`
- `cdfaf41` `Address Tauri desktop review findings`
- [PR #17](https://github.com/elgabrielc/dicom-viewer/pull/17) then hardened scan and decode behavior further

---

## Planned Dependency Graph

```text
PR 1 (source model) ----+
                         +--> PR 3 (file loading) --> PR 4 (library) --+
PR 2 (scaffold/spike) --+                                              +--> PR 6 (productize)
                         +--> PR 5 (reports) --------------------------+
```

This dependency graph is what the implementation broadly followed, even though the GitHub delivery was consolidated into a smaller number of PRs than originally envisioned.

---

## Validation Strategy in the Plan

The plan separated validation into three layers:

1. Shared web core:
   - `npx playwright test`
   - Protect the common rendering / interaction / notes stack
2. Desktop integration:
   - Tauri spike validation
   - config / capability / build checks
3. Pre-release manual gate:
   - clean-Mac install and launch flow
   - library persistence
   - notes/report persistence

This strategy did land:
- the shared Playwright suite remained the main regression guard
- desktop-specific tests were added instead of replacing browser coverage
- Tauri build smoke became part of the productization work

---

## Risk Mitigations in the Original Plan

The original plan explicitly called out these risks:

- WKWebView WASM / CSP problems
- vtk.js WebGL2 uncertainty in desktop mode
- Tauri drag-drop event differences
- no bundler / no ESM imports for Tauri APIs
- relative asset fetch breakage between `devUrl` and built `frontendDist`
- persisted filesystem scope restoring incorrectly
- client-side library scan performance
- local report-file persistence semantics
- Apple Developer enrollment and notarization timing
- lack of robust macOS desktop automation support

Most of these were later validated or hardened in PR #16 and PR #17, with additional desktop decode hardening following afterward in ADR-004.

---

## Out of Scope in the Original Plan

The plan explicitly left these for later:

- cloud adapter implementation
- Windows distribution
- auto-updater
- report migration to a future cloud mode
- library metadata caching beyond scan-on-launch

Those limits are still useful context for follow-on desktop work.

---

## What Happened After This Plan

The Tauri plan completed, then the next major desktop work moved into **ADR-004 native decode fallback**:

- the local Claude plan `indexed-growing-kite.md`
- PRs #19 through #23

The broader product roadmap after desktop stabilization remained:
- [PLAN-3d-volume-rendering.md](./PLAN-3d-volume-rendering.md)
- [RESEARCH-3d-volume-rendering.md](./RESEARCH-3d-volume-rendering.md)

So this plan is best read as the bridge between:
- the extracted shared web app, and
- the later native desktop hardening / 3D rendering phases.
