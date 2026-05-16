# ADR 014: Per-Channel Bundle Identity for Desktop Builds

## Status

Implemented

## Context

The Tauri dev and release builds historically shared the same bundle identifier,
`health.divergent.dicomviewer`. On macOS, Tauri derives the app data directory
from that identifier, so both builds used:

```text
~/Library/Application Support/health.divergent.dicomviewer/
```

That meant a dev launch could read or mutate the same `viewer.db`, managed
library folder, notes, comments, reports, and persisted file-scope grants used
by the installed release app. During the 2026-05-15 BUG-014 investigation, a
dev-side attempt to repair migration state for the consent popup touched the
installed app's database because both channels shared this identity.

The shared display name created a second problem: both builds appeared as
`myradone` in the macOS menu bar and Dock, which made it easy to mistake the
dev shell for the installed app. A runtime title/menu workaround was not enough
because macOS bundle metadata such as `CFBundleName` is derived from the Tauri
build config.

## Decision

Each desktop build channel gets a distinct Tauri bundle identifier:

```text
health.divergent.dicomviewer[.<channel>]
```

The empty channel is reserved for production to preserve continuity with the
existing installed app and its data directory. The initial channels are:

- Production: `health.divergent.dicomviewer`
- Development: `health.divergent.dicomviewer.dev`

The development channel also uses `productName = "myradone Dev"` and an initial
window title of `myradone Dev`, so it is visually distinct before and after the
webview loads.

The existing managed launcher, `desktop/scripts/dev-desktop.sh`, remains the
entry point for desktop development. It injects the dev identity and current
dev server URL with Tauri 2.5.6's `TAURI_CONFIG` inline JSON merge overlay
before invoking `cargo run`. This preserves the launcher's port cleanup and
static docs server behavior without adding `tauri-cli` as a new required tool.

## Alternatives Considered

### `tauri dev --config`

Rejected for now. It is the most recognizable Tauri CLI pattern for config
overlays, but this repository already has a managed launcher that handles stale
port cleanup and serves `docs/` directly. Replacing that orchestration solely
to set the dev bundle identity would create more moving parts than this change
requires.

### Custom `build.rs` config selection

Rejected. The pinned Tauri build and codegen crates already read the
`TAURI_CONFIG` environment variable and merge it into the compile-time config.
Adding custom `build.rs` selection would duplicate a supported hook and make the
configuration path harder to inspect.

### Runtime app-data path redirection

Rejected. Redirecting `app_data_dir()` consumers in application code would
invert the responsibility: every filesystem, SQL, persisted-scope, and future
desktop feature would need to remember which channel it was running in. Bundle
identity is the platform-level source of truth and keeps data isolation below
the app feature layer.

### Runtime display-name patch only

Rejected. Renaming menu items or windows at runtime can reduce visual confusion
but does not isolate data. It also cannot reliably replace bundle-derived macOS
metadata such as the app menu label.

## Design Details

- `desktop/src-tauri/tauri.conf.json` remains the production config and keeps
  `identifier = "health.divergent.dicomviewer"`.
- `desktop/src-tauri/tauri.conf.dev.json` contains only the dev-channel overlay:
  dev product name, dev identifier, full window block, updater artifact
  suppression, and removal of updater endpoint config.
- The dev launcher reads `tauri.conf.dev.json`, injects the active
  `build.devUrl` derived from `DICOM_DESKTOP_DEV_HOST` /
  `DICOM_DESKTOP_DEV_PORT`, then sets:

  ```bash
  CARGO_TARGET_DIR="${DESKTOP_DIR}/src-tauri/target-dev"
  TAURI_CONFIG="$(dev_tauri_config)"
  ```

  before running Cargo.

- `target-dev/` keeps debug artifacts for the dev channel separate from the
  normal `target/` tree so generated Tauri context code cannot be reused across
  channel flips.
- The stale-server guard in `dev-desktop.sh` checks both `target/debug` and
  `target-dev/debug` so a second dev launch cannot accidentally tear down the
  server used by an already-running dev app.
- The dev overlay sets `"plugins": { "updater": null }`, which removes the dev
  channel's updater endpoint config from the merged Tauri config. The Rust
  updater plugin is still registered, but the dev channel has no production
  update endpoint configured.
- The full `windows[0]` block is repeated in the overlay because JSON merge
  behavior for arrays replaces the window entry rather than merging individual
  fields.

## Consequences

Positive:

- Dev and production data are isolated by macOS bundle identity.
- The installed app keeps its existing data directory unchanged.
- The dev app creates and uses
  `~/Library/Application Support/health.divergent.dicomviewer.dev/`.
- The menu bar, Dock label, and initial window title distinguish the dev build.
- BUG-014 first-launch and migration scenarios can be reproduced against a
  disposable dev database.
- Future beta or nightly channels can follow the same identifier convention
  with one additional overlay file per channel.

Tradeoffs:

- The dev channel creates an additional `target-dev/` build directory.
- The dev app starts with an empty library and no persisted file-scope grants.
  That is intentional isolation, but developers must re-grant folders or import
  test data in the dev channel.
- Keychain and secure-store entries are channel-specific because the bundle
  identifier changes. This is desirable for isolation but should not surprise
  anyone testing credentials.
- If the dev channel is ever bundled for distribution, signing and provisioning
  must be configured explicitly for the `.dev` identifier. The current workflow
  launches dev with `cargo run`, so this ADR does not introduce a dev release
  channel.

## Rollback

Delete `desktop/src-tauri/tauri.conf.dev.json` and remove the `TAURI_CONFIG` /
`CARGO_TARGET_DIR` prefixes from `desktop/scripts/dev-desktop.sh`. That returns
dev and production builds to a shared identifier and shared app data directory.
