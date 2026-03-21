# ADR 003: Tauri Desktop Shell with Shared Web Core

## Status
Accepted; initial implementation completed through Phase 3 on macOS, with signing/notarization still pending

## Context

The launch path is no longer a personal convenience problem. The app is now expected to be a real product that users download, open, and judge on first launch.

ADR 001 solved a different problem: reducing startup friction for internal/personal macOS use via a `.command` launcher. That remains valid for local development and personal use, but it is not an acceptable end-user distribution model.

The current codebase has two important constraints:

- Local file import is tightly coupled to browser-specific File System Access APIs (`getAsFileSystemHandle()`, `FileSystemDirectoryHandle`, `handle.getFile()`).
- Personal mode assumes a local Flask backend for persistent library config, library scanning, notes, and report storage.

At the same time, the product direction includes a future cloud platform. The desktop choice should therefore optimize for:

- A polished native desktop result
- Clear separation between shared viewer logic and environment-specific I/O
- Low long-term security and maintenance debt
- Maximum reuse of the viewer core across desktop and cloud

## Decision

Use **Tauri v2** as the target desktop shell, and refactor the app into a **shared web core plus environment adapters**.

The target architecture is:

- **Shared web core**: study/series domain model, DICOM parsing, decode pipeline, rendering, measurements, notes/report UI, and general viewer workflow
- **Desktop adapter**: native folder selection, local file reads, local persistence, updater, and OS integration
- **Cloud adapter**: authenticated HTTP APIs for studies, slice bytes, notes, reports, sharing, and future account features

Flask is **not** part of the target shipped desktop runtime. It remains useful as:

- the current local development server
- the Playwright test harness
- a temporary migration aid while desktop-native adapters are built

Electron is the fallback option if a Tauri validation spike fails defined acceptance gates, especially around WKWebView compatibility, performance, or near-term 3D requirements.

## Alternatives Considered

- **Electron with bundled Flask sidecar**: Best short-term compatibility with the current repo. Rejected as the target architecture because it preserves browser-only and local-server assumptions, ships a heavier runtime, and delays the desktop/cloud separation the product needs anyway.

- **Electron without Flask (pure Chromium shell)**: Simpler than Tauri in the short term because Chromium preserves the current file-access model. Rejected as the target architecture because it keeps Chromium-specific APIs at the center of the product instead of forcing a clean environment boundary.

- **Tauri as a thin wrapper around the current app**: Rejected because the current app still assumes browser file handles and Flask APIs in personal mode. Wrapping those assumptions would not solve the architectural problem.

- **Keep the browser app plus launcher script**: Rejected for end-user distribution. It is not consumer-grade product packaging.

- **Permanent Python sidecar inside a desktop shell**: Rejected as the target state because it adds runtime complexity, packaging surface, and update complexity without advancing the long-term architecture. A temporary sidecar is acceptable during migration if it reduces risk.

## Design Details

### Target Architecture

The desktop and cloud products should share a single viewer core, with environment-specific concerns pushed to adapters.

#### Shared web core

- DICOM metadata parsing and grouping
- Slice decode and render pipeline
- Study/series state model
- Measurement and annotation UI
- Notes/report interaction logic
- Generic study loading and slice loading interfaces

The shared core should not depend directly on:

- browser `FileSystemHandle` objects
- Flask route shapes
- Tauri plugin APIs
- cloud API details

#### Desktop adapter (Tauri)

- Native folder/file pickers
- Recursive local file discovery
- Byte reads from selected files
- Persisted access to configured library folders
- Local storage for notes, reports, and desktop settings
- Native menus, Dock behavior, window lifecycle, updater, and packaging

Rust commands should be added only where Tauri plugins or frontend code are insufficient. The default should be to keep viewer logic in the shared web core, not move application logic into Rust prematurely.

Operational note:

- Desktop library scan timing is intentionally debug-only. The optimized header-first scan path is always on, but timing/report writing must be explicitly enabled. See [Desktop Library Diagnostics](../desktop-library-diagnostics.md) for the current toggle and report workflow.

#### Cloud adapter

- Authenticated study listing and slice retrieval
- Cloud-backed notes and reports
- Future user/account/sharing APIs
- Browser-safe runtime behavior without native desktop privileges

### Validation Gates

Before fully committing the desktop implementation, run a Tauri spike against the real app and real datasets. The spike must prove:

- native folder selection and recursive library scanning work on macOS
- OpenJPEG WASM decode and 2D slice rendering perform acceptably in WKWebView
- notes, reports, and library configuration persist across relaunches
- packaged app startup, quit, and reopen behavior feels production-grade

If 3D volume rendering becomes part of the desktop release before cloud launch, the spike must also validate vtk.js/WebGL2 behavior in WKWebView. Failure on that gate is a valid reason to fall back to Electron.

### Spike Result: March 8, 2026

The initial Tauri v2 validation spike passed the required bootstrap and 2D imaging gates on macOS:

- The desktop shell compiled and launched from `desktop/` with a static `docs/` dev server and `withGlobalTauri: true`
- The extracted frontend loaded in WKWebView without falling back into the Flask-backed personal mode path
- Relative sample loading worked inside Tauri via `fetch('sample/manifest.json')`
- A JPEG 2000 dataset rendered successfully in the desktop shell, confirming the OpenJPEG WASM decode path works in WKWebView
- A follow-up render using a changed window/level override also succeeded, confirming the shared 2D render path survives desktop execution
- A later desktop scan optimization pass replaced full-file metadata reads with native header reads plus selective fallback, cutting one real macOS library scan from `192744 ms` to `99361 ms` while leaving timing/reporting behind a debug toggle

Implementation note:

- Tauri expects an icon asset at compile time, so the desktop scaffold includes a temporary placeholder `icon.png`; the product icon still belongs to the later productization phase

### Windows Note

This ADR does not block Windows support, but Windows packaging should be treated as a separate distribution task. Tauri's WebView2 dependency introduces installer choices that should be decided explicitly when Windows distribution becomes a release requirement.

## Phased Migration Plan

### Phase 0: Validation Spike

- Create a minimal Tauri shell that loads the existing frontend
- Prove native folder selection, file reads, and study loading
- Measure startup, memory, and slice navigation on real studies
- Record blockers and fallback criteria

### Phase 1: Extract File and Study Source Adapters

- Replace direct File System Access API usage with explicit file-access adapters
- Replace `fileHandle`-specific assumptions in study/slice objects with generic byte-loading or file-access interfaces
- Keep existing API-backed loading as another adapter, not a special case

### Phase 2: Extract Persistence Adapters

- Move library config, notes, and report storage behind environment-specific interfaces
- Implement desktop-native persistence in Tauri-backed app data
- Retain Flask only for local web development and automated tests

### Phase 3: Productize the Desktop App

- Add native menus, icons, app metadata, updater, and signing/notarization
- Support drag-and-drop and "open with" flows where appropriate
- Polish launch, reopen, error handling, and recovery behavior

### Phase 4: Cloud Convergence

- Implement cloud-backed adapters for studies, notes, reports, and auth
- Keep the viewer core shared between desktop and cloud
- Decide later whether the desktop app remains a local-first companion or becomes a thin client to the cloud platform

## Consequences

Positive:

- Produces a better long-term desktop product than a Chromium wrapper
- Forces the right architectural seams between viewer logic and environment I/O
- Preserves optionality for a future cloud platform
- Reduces long-term dependence on a local Python server for shipped desktop UX

Negative:

- Requires more upfront refactoring than Electron
- Introduces WebKit/WKWebView compatibility risk that must be validated early
- Creates multi-engine reality: desktop behavior may differ from Chromium-based web deployments
- Defers the easiest packaging path in favor of the cleaner long-term architecture

Scope note:

ADR 001 remains the decision for internal/personal launch convenience. This ADR governs the product-grade desktop architecture and distribution direction.
