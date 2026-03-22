# ADR 005: Native Desktop Persistence for Notes, Reports, and Library Config

## Status
Implemented

## Context

The Tauri desktop app originally stored durable user data in the embedded webview's browser storage:

- study descriptions
- study and series comments
- report metadata
- desktop library folder configuration

That was a design error for a desktop product.

The report files themselves already lived in the app's data directory, but the metadata that made
those files visible in the UI lived in `localStorage`. As a result, data could appear to
"disappear" when the webview origin changed between packaged and dev builds, when browser storage
was cleared, or when the runtime profile changed during upgrades or rebuilds.

For a local-first desktop viewer, durable user data must live in native app storage rather than in
browser-profile storage.

## Decision

Move desktop durable persistence to native SQLite plus app-data file storage.

The desktop app now uses:

- `tauri-plugin-sql` with SQLite for structured metadata
- the existing app-data `reports/` directory for uploaded report files
- a desktop-specific backend in the shared JS persistence layer

Browser storage is no longer the source of truth for desktop notes, report metadata, or desktop
library configuration.

## Alternatives Considered

- **Keep using browser `localStorage`**: Rejected because it ties durable data to webview origin
  and profile boundaries, which is not acceptable for a desktop app.

- **Move to a JSON file in app data**: Rejected as the long-term architecture because the app
  already has a relational model, will need schema migrations, and benefits from transactional
  updates and a queryable format.

- **Implement desktop persistence directly in Rust with custom commands per operation**: Rejected
  because the repo already keeps application data logic in the shared JS layer. A thin native SQL
  runtime keeps desktop-specific code smaller and preserves the shared backend abstraction.

## Design Details

### Storage layout

- SQLite database: `viewer.db`
- Report files: `$APPDATA/reports/<studyUid>/<reportId>.<ext>`
- Desktop config: `app_config` table in the same database

### Schema

Desktop reuses the existing Flask-backed notes schema as closely as possible:

- `study_notes`
- `series_notes`
- `comments`
- `reports`

Desktop adds:

- `app_config` for local desktop settings such as the configured library folder

### Backend boundary

The shared `NotesAPI` dispatcher remains the integration point:

- browser demo/preview modes still use the browser-local backend
- personal/cloud modes still use the Flask API backend
- desktop mode now uses `DesktopSqliteBackend`

This keeps UI callers unchanged while moving desktop persistence behind a native-backed adapter.

### Migration

Desktop performs a one-time migration from legacy browser storage into SQLite:

- notes metadata from `dicom-viewer-notes-v3`
- desktop library config from `dicom-viewer-library-config`
- older legacy report blobs from IndexedDB when present

The migration is idempotent and marks completion in `app_config`.

Operational limitation:

- migration can only read browser storage from the current desktop webview origin
- packaged builds can therefore self-migrate packaged-build data
- dev builds can self-migrate dev-build data

This is acceptable because the migration's purpose is to stop future dependence on browser
storage, not to make separate historical webview profiles magically share state.

### Report writes

Report files and report metadata are persisted with file-first ordering and cleanup rules so that
the system prefers an orphaned file over orphaned metadata. A temporary file is written first, then
promoted into place, and database writes clean up any failed filesystem attempt.

### Desktop diagnostics

The scan diagnostics work remains debug-only. Timing reports are opt-in and separate from the new
persistent notes/report store.

## Consequences

Positive:

- Desktop notes, reports, and library settings survive webview-origin changes and browser-cache
  clears
- Desktop persistence now matches user expectations for a native app
- The data model is aligned with the existing Flask-backed schema
- Future desktop migrations and cloud-sync work now have a stable native storage foundation

Negative:

- Desktop mode now depends on SQLite migration correctness
- The desktop stack has an additional native dependency (`tauri-plugin-sql`)
- Legacy browser-storage migration can only see the current origin's data, not every historical
  desktop profile automatically
