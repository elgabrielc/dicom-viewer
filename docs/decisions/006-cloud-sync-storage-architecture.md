# ADR 006: Cloud Sync Storage Architecture

## Status
Proposed

## Context

The DICOM viewer currently serves four deployment modes (demo, personal, desktop, cloud -- see
CLAUDE.md). Desktop persistence landed in ADR 005 with native SQLite and app-data file storage.
Cloud sync is the next major feature: users will be able to sync study notes, comments, and
attached reports across devices via app.divergent.health.

The core question is how to layer cloud sync onto the existing local-first architecture without
rewriting the storage layer or compromising the desktop experience.

### Research inputs

Three storage models were benchmarked before this decision:

1. **Horos/OsiriX** -- import-and-manage with Core Data. Copies DICOM files into a managed
   database. Rejected: doubles disk usage, creates lock-in, wrong model for a local-first viewer.

2. **Microsoft Word + OneDrive** -- layered sync with platform FS integration (CfApi/File
   Provider), block-level differential transfer, and application-level incremental saves
   (COBALT/FSSHTTP). See research note for details.

3. **Current app** -- reference-in-place for DICOM files, opaque file storage for reports,
   lightweight SQLite metadata. This is the model we are extending.

From the OneDrive research, the transferable patterns are: opaque delta cursors, optimistic
concurrency via server-issued ETags, tombstones for deletion propagation, push-to-trigger-pull
notifications, resumable uploads for large blobs, and content hashing for dedup.

The non-transferable patterns are: placeholder files (requires OS kernel drivers), block-diff sync
(our metadata is small, images are immutable), COBALT/FSSHTTP (no co-authoring), and paragraph-
level locking (single user per device).

### Problems with the current schema

The current desktop schema (001_initial_schema.sql) has several gaps that block cross-device sync:

- **Comments use autoincrement integer IDs.** Two devices creating comments offline will generate
  conflicting IDs. Comments need immutable UUIDs.

- **Comments overload `time` as both display and mutation timestamp.** There is no way to
  distinguish "when was this comment written" from "when was it last edited." Sync needs both
  `created_at` and `updated_at`.

- **Hard deletes everywhere.** When a comment or report is deleted, it vanishes from the database.
  A sync engine cannot propagate a deletion it cannot see. All synced tables need tombstones.

- **Series identity is non-canonical.** The `resolveSeriesKey()` function in sources.js:101 and
  app.py:407 may produce `uid|description` composite keys when two series share a UID but differ
  in description (common with X-ray stitching). If two devices derive different series keys for
  the same series, series-level notes will drift across devices.

- **No change tracking.** There is no outbox, change log, or sync version on any record. The sync
  engine has no way to know which local records have been modified since the last sync.

### The main architectural mismatch

The current `NotesAPI` dispatcher in api.js selects exactly one backend per deployment mode via
`getBackend()` and `withFallback()`. Cloud sync is not "just another backend" -- it requires local
and remote active simultaneously. The desktop writes locally first (source of truth), then
replicates to the cloud. Remote changes flow back into the local database. This is a fundamentally
different pattern than backend selection.

### Authentication is a release blocker

The Flask server exposes notes, reports, migration, and library-scanning routes with no auth
boundary (app.py:111, app.py:736, app.py:960, app.py:1358). The CSRF check explicitly allows
headerless mutating requests. The server can bind to `0.0.0.0`. This is acceptable for
single-user localhost but is a hard blocker for any networked or cloud use. Auth/authz must be
solved before cloud sync ships -- not as an afterthought.

### Session transcript

This decision was developed in the "report storage" session (2026-03-25). The session included:
- Comparison of Horos import-manage vs. reference-in-place storage models
- Initial architectural recommendation from an architect agent (partially superseded below)
- Deep research on Microsoft Word + OneDrive sync architecture
- Security audit of current and planned storage
- Two external review critiques that corrected design-level errors and validated the final direction

## Decision

Keep the local-first storage philosophy. Do not model cloud as another backend behind `NotesAPI`.
Instead, layer a sync engine on top of the local SQLite database.

### Core principles

1. **Local SQLite is the desktop source of truth.** All writes go to local SQLite first. The UI
   reads from local SQLite. Cloud is a replication target, not a primary store.

2. **Sync is a separate layer, not a backend.** The sync engine drains an outbox of local changes
   to the server and applies remote deltas back into SQLite. It does not replace or compete with
   the local backend.

3. **Server issues all sync tokens.** Delta cursors, version ETags, and conflict resolution tokens
   are server-issued and opaque to the client. The client never uses wall-clock timestamps as sync
   cursors.

4. **Natural keys where stable, UUIDs where not.** `study_notes` uses StudyInstanceUID (globally
   unique by DICOM spec). `series_notes` uses SeriesInstanceUID. Comments and reports use
   client-generated UUIDs (immutable after creation).

5. **Tombstones, not hard deletes.** Every synced table gets a `deleted_at` column. Deleted
   records are retained until the server confirms propagation. Purge policy TBD.

6. **Series identity must be canonical before cross-device sync ships.** The `uid|description`
   composite key fallback must be resolved so two devices always derive the same series key.

## Alternatives Considered

- **Cloud as a fourth backend behind NotesAPI**: Rejected. The `getBackend()` pattern picks one
  backend. Sync requires local and remote active simultaneously. Forcing sync into the backend
  abstraction would require the abstraction to know about replication, outboxes, and conflict
  resolution -- concerns that belong in a dedicated sync layer.

- **Client-provided `last_sync_at` timestamp as delta cursor**: Rejected. Client clocks drift,
  timestamps are forgeable, and replay attacks become trivial. Server-issued opaque tokens (like
  OneDrive's `$deltatoken`) are the industry standard.

- **`updated_at` alone as the conflict resolution token**: Rejected. A client can set any
  `updated_at` value, either maliciously or due to clock skew. Server-issued monotonic versions
  (ETags) provide tamper-proof optimistic concurrency.

- **Forcing `record_uuid` on all tables**: Rejected for tables with stable natural keys.
  StudyInstanceUID and SeriesInstanceUID are globally unique by the DICOM specification. Adding a
  synthetic UUID would create a second identity axis without benefit. Comments and reports do need
  UUIDs because their current IDs (autoincrement integers and client-generated strings) are not
  guaranteed unique across devices.

- **DICOM Structured Reports (SR) for report storage**: Rejected. SR is a complex standard
  requiring coded terminology (SNOMED-CT, RadLex) and template hierarchies. Our reports are
  user-attached PDFs and images, not structured clinical data. If PACS interoperability is needed
  later, Encapsulated PDF (a much simpler IOD) can be added as an export option.

- **Horos-style import-and-manage for DICOM files**: Rejected. Doubles disk usage, creates
  lock-in, and the app's reference-in-place model is already correct for a local-first viewer.
  Cloud mode uploads on demand; the user's local files are untouched.

## Design Details

### Schema changes (migration 003)

All changes are additive. No columns are removed or renamed.

**comments table:**

| Column | Change | Rationale |
|--------|--------|-----------|
| `id` | Keep as local autoincrement for backward compat | Local CRUD still works |
| `record_uuid` | Add TEXT NOT NULL (backfill with UUID) | Cross-device identity |
| `created_at` | Add INTEGER (backfill from `time`) | Immutable creation timestamp |
| `updated_at` | Add INTEGER (backfill from `time`) | Mutation tracking for sync |
| `deleted_at` | Add INTEGER NULL | Tombstone for sync propagation |
| `device_id` | Add TEXT | Attribution for debugging |
| `sync_version` | Add INTEGER DEFAULT 0 | Server-stamped optimistic concurrency token |

The existing `time` column is retained for backward compatibility but new code should use
`created_at` and `updated_at`.

**reports table:**

| Column | Change | Rationale |
|--------|--------|-----------|
| `content_hash` | Add TEXT | SHA-256 of file bytes for dedup and integrity |
| `deleted_at` | Add INTEGER NULL | Tombstone |
| `device_id` | Add TEXT | Attribution |
| `sync_version` | Add INTEGER DEFAULT 0 | Optimistic concurrency |

Reports already have stable text IDs (`id TEXT PRIMARY KEY`), so no `record_uuid` needed.

**study_notes and series_notes tables:**

| Column | Change | Rationale |
|--------|--------|-----------|
| `deleted_at` | Add INTEGER NULL | Tombstone |
| `device_id` | Add TEXT | Attribution |
| `sync_version` | Add INTEGER DEFAULT 0 | Optimistic concurrency |

Natural keys (StudyInstanceUID, SeriesInstanceUID) are stable. No `record_uuid` needed.

**New table: sync_outbox**

```sql
CREATE TABLE IF NOT EXISTS sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_key TEXT NOT NULL,      -- primary key of the changed record
    operation TEXT NOT NULL,        -- 'insert', 'update', 'delete'
    created_at INTEGER NOT NULL,
    synced_at INTEGER               -- NULL until confirmed by server
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
ON sync_outbox(synced_at) WHERE synced_at IS NULL;
```

**New table: sync_state**

```sql
CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
);
```

Stores: `delta_cursor` (opaque server token), `device_id` (generated once on first launch),
`last_sync_at` (informational only -- not used as sync cursor).

### Backfill strategy

On migration 003 execution:

1. Generate `device_id` once via `hex(randomblob(16))` and store in `sync_state`.
2. Backfill `comments.record_uuid` with `lower(hex(randomblob(16)))` for each existing row.
3. Backfill `comments.created_at` and `comments.updated_at` from existing `time` column.
4. Set `sync_version = 0` on all existing rows (unsynced).
5. Leave `deleted_at` as NULL on all existing rows (not deleted).
6. Leave `content_hash` as NULL on existing reports (computed on next access or background task).

### Sync engine (built later, not in migration 003)

The sync engine operates in a loop:

1. **Push**: Read unsynced outbox entries. POST to `/api/sync` with the entries and the current
   `delta_cursor`. Server validates, applies writes, returns server-stamped versions and a new
   cursor. Client updates `sync_version` on affected records and marks outbox entries as synced.

2. **Pull**: Server returns remote changes since the cursor. Client applies them to local SQLite,
   respecting `sync_version` (server version wins if local version is stale).

3. **Conflict**: Server rejects writes where the client's `sync_version` does not match the
   server's current version (412 Precondition Failed). Client must pull the latest version, decide
   whether to overwrite or keep server version, then retry.

4. **Trigger**: WebSocket/SSE notification from server signals "something changed." Client calls
   the sync loop. Periodic polling as fallback.

5. **Cursor expiry**: If the server returns 410 Gone, the client must re-enumerate all records
   (full sync). Server may include a hint code indicating whether to trust server state or upload
   local state.

### Series identity canonicalization

Before cross-device sync ships, the series identity issue must be resolved. Two options:

**Option A: Always use bare SeriesInstanceUID.** Drop the `uid|description` composite key.
Treat same-UID-different-description series as one series. This loses the ability to
distinguish stitched X-ray panels but guarantees canonical identity.

**Option B: Deterministic composite key.** When a collision is detected, always produce the
composite key from `(SeriesInstanceUID, SeriesDescription)` regardless of scan order. This
preserves the distinction but requires both devices to scan in a way that detects the
collision.

Decision deferred to implementation. The constraint is: two devices scanning the same DICOM
folder must always produce the same series keys. Whichever option is chosen, existing
series-level notes keyed under old-style keys must be migrated.

### Flask server changes

The Flask notes API endpoints (app.py) need the same schema additions. The Flask server is the
personal-mode backend and may also serve as the sync server for cloud v1.

### Content hash computation

SHA-256 of file bytes, computed at upload time. Stored as lowercase hex string. Verified on
download in cloud mode. Added to `storeDesktopReportWithDb()` and Flask upload endpoint.

The hash serves three purposes:
1. Dedup on cloud upload (skip if server already has this hash)
2. Integrity verification on download
3. Detect corruption in local storage

### Security prerequisites by category

These are distinct problems that require different solutions:

**Mandatory for cloud launch:**
- **Authentication/authorization.** Server must reject unauthenticated requests. Device
  registration must be server-side, not client-asserted. Ownership and sharing rules must be
  first-class server concepts. This is the single biggest blocker.
- **TLS.** All cloud traffic over HTTPS. No exceptions.
- **Audit logging.** HIPAA requires access logs for PHI: who accessed what, when. Server-side
  at minimum.

**Required for PHI handling (any mode):**
- **Encryption at rest.** Should be platform-backed (FileVault on macOS, LUKS on Linux, BitLocker
  on Windows for desktop; server-managed encryption for cloud storage). Do not bolt on ad hoc
  app-layer crypto.
- **Backup and recovery.** SQLite corruption recovery, report file integrity checks. Needs
  explicit design before treating local app data as durable PHI storage.

**Required for compliance posture:**
- **BAA with cloud vendors.** AWS, GCP, or Azure BAA required before storing PHI in their
  infrastructure.
- **Data retention and deletion.** Legal/compliance deletion semantics. Tombstone purge policy
  must align with HIPAA retention rules.

### Testing requirements

Tests that must exist before cloud sync ships:

**Auth tests:**
- All mutating routes reject unauthenticated requests
- All PHI-bearing reads reject unauthenticated requests
- Headerless requests are rejected unless a local secret/token is present

**Sync correctness tests:**
- Stale `If-Match` (sync_version mismatch) returns 412
- Opaque cursor expiry returns 410 with re-sync guidance
- Tombstone propagation: delete on device A appears as deleted on device B
- Outbox replay is idempotent (same outbox entry applied twice produces same result)
- Outbox drains completely after reconnection

**Series identity tests:**
- Two devices scanning the same folder produce identical series keys
- Scan-order variance does not change series keys
- Collision case (same UID, different description) produces deterministic keys

## Consequences

Positive:

- Desktop remains fully functional offline. Cloud is additive, not required.
- The outbox pattern guarantees no data loss on network failure -- writes queue locally.
- Server-issued tokens prevent clock-skew and replay attacks.
- Schema changes are backward-compatible. Existing desktop installations migrate cleanly.
- Natural keys on study/series notes avoid synthetic ID overhead.
- Content hashing provides integrity and dedup from day one.
- Tombstones enable reliable cross-device deletion.

Negative:

- Migration 003 adds columns to every table. Existing desktop databases must migrate.
- The outbox table grows until entries are synced and purged. Needs a retention policy.
- Series identity canonicalization may require migrating existing series-level notes.
- `sync_version` is meaningless until the cloud server exists -- it will be 0 on all records
  until first sync.
- The sync engine is a significant new subsystem with its own failure modes.

## Research References

- Horos/OsiriX benchmark: discussed in session, not committed (import-manage model comparison)
- OneDrive/Word sync research: [RESEARCH-word-onedrive-sync-prompt_2026-03-25_1124.md](../planning/RESEARCH-word-onedrive-sync-prompt_2026-03-25_1124.md)
- OneDrive research prompt: [RESEARCH-word-onedrive-sync-prompt.md](../planning/RESEARCH-word-onedrive-sync-prompt.md)
- Security audit: conducted in "report storage" session (2026-03-25), findings summarized in
  session transcript
- ADR 005 (predecessor): [005-native-desktop-persistence.md](005-native-desktop-persistence.md)
- Session transcript: "report storage" session, 2026-03-25

## Review Iterations

This ADR went through two review cycles that shaped the final design:

**Review 1 (architectural critique):** Corrected the initial recommendation, which modeled cloud
as a fourth backend behind `NotesAPI`. The review identified that `getBackend()` / `withFallback()`
picks one backend per mode, but sync requires local and remote active simultaneously. It also
caught that client-supplied `updated_at` and `last_sync_at` are unsafe as sync primitives, that
an outbox matters more than a `CloudBackend`, and that series identity must be canonicalized.
These corrections are incorporated into the Decision and Design Details above.

**Review 2 (security critique):** Validated the architectural direction and added precision.
Elevated authentication from an open question to a release blocker. Clarified that TLS, audit
logging, encryption at rest, and BAA are different kinds of problems requiring different
solutions. Added concrete testing gaps for auth, sync correctness, and series identity. These
are incorporated into the Security Prerequisites and Testing Requirements sections above.

## Open Questions

1. **Series identity**: Option A (bare UID) or Option B (deterministic composite)? Needs testing
   with real X-ray stitching datasets.

2. **Purge policy**: How long to retain tombstoned records and synced outbox entries? Candidates:
   30 days after sync confirmation, or server-issued purge watermark.

3. **Cloud server stack**: Flask (extend existing) or separate service? Flask is the simplest
   path for v1 but may not scale for multi-tenant cloud.

4. **Auth model**: JWT vs session tokens vs OAuth2. Impacts every sync request. Must also cover
   device registration (server-side, not client-asserted).
