# Research: Microsoft Word + OneDrive Sync Architecture

## Context

Benchmarking how Microsoft Word and OneDrive jointly handle document storage, sync, and conflict resolution. Purpose: inform storage architecture for DICOM viewer cloud sync (app.divergent.health).

Prior benchmark: Horos/OsiriX (import-and-manage model with Core Data). This research adds the Word+OneDrive model (reference-in-place with layered sync).

---

## 1. Local Storage Model

### Three-Layer Architecture

Microsoft operates three distinct sync layers:

| Layer | Component | Scope | Our Analog |
|-------|-----------|-------|------------|
| **Platform FS** | CfApi (Windows) / File Provider (macOS) | Transparent file access, placeholder files | Tauri fs plugin |
| **File sync** | OneDrive sync client | Block-level differential transfer | Our sync engine |
| **App sync** | COBALT/FSSHTTP (Office apps) | Document-structure-aware incremental saves | Not needed (no co-authoring) |

### Files On-Demand: Placeholder Files

OneDrive uses OS-level filesystem hooks to present cloud files as if they exist locally without downloading content.

**Windows**: Cloud Filter API (`cldflt.sys` minifilter driver on NTFS). Files are NTFS reparse points consuming ~1 KB. Hidden from all applications except the sync engine.

**macOS**: Apple File Provider framework (`NSFileProviderReplicatedExtension`). Uses APFS dataless files -- metadata exists on disk, content fetched on access.

**Three hydration states** (user-visible):

| State | Icon | Behavior |
|-------|------|----------|
| Cloud-only (placeholder) | Cloud icon | ~1 KB stub. Content fetched on access. |
| Locally available | Green checkmark | Full content present. System may dehydrate when space needed. |
| Always keep | Solid green circle | Full content, guaranteed offline. Dehydration refused. |

**Key technical detail**: Hydration policy is locked at file-open time. Policy is `max(app_policy, provider_policy)` -- a FULL provider with a PROGRESSIVE app results in FULL hydration. Policies include:
- `PROGRESSIVE` (default): Completes user I/O as soon as sufficient data arrives; background fetch continues
- `FULL`: Entire file hydrated before any I/O completes
- `ALWAYS_FULL`: No dehydration allowed, no placeholders

### Change Detection

| Platform | Local changes | Server changes |
|----------|--------------|----------------|
| Windows | CfApi NOTIFY callbacks + `ReadDirectoryChangesW` | Windows Push Notification Service (WNS) |
| macOS | File Provider system notifications | Apple Push Notification Service (APNs) |

The recommended pattern: **push notifications signal "something changed"**, then the **delta API reveals what changed**. Real-time WebSocket notifications (socket.io) provide sub-second awareness; delta queries provide the actual changed items.

---

## 2. Sync Protocol

### Differential Sync

OneDrive's sync client uploads only changed portions of files, not entire files. Originally limited to Office formats, expanded to **all file types** in April 2020.

Mechanism:
1. Divide file into blocks/chunks
2. Compute hashes/signatures per block
3. Compare local signatures against server's known state
4. Transmit only changed blocks

Block sizes, hashing algorithm, and wire protocol are proprietary. Not based on the older Remote Differential Compression (RDC) library.

### Upload Pipeline

**Small files (< 4 MB)**: Simple PUT upload.
```
PUT /me/drive/items/{item-id}/content
```

**Large files (> 4 MB, recommended > 10 MB)**: Resumable upload session.
```
POST /me/drive/items/{parentId}:/{fileName}:/createUploadSession
```

Critical constraints for resumable uploads:
- Each fragment MUST be a multiple of **320 KiB** (except final)
- Maximum per-request: **60 MiB**
- Optimal fragment size: **5-10 MiB**
- Fragments uploaded **sequentially in order**
- Failed requests discard all bytes in that request; resume from last completed fragment
- Sessions expire after inactivity

Conflict behavior on session creation:
```json
{
  "item": {
    "@microsoft.graph.conflictBehavior": "rename"  // or "fail" or "replace"
  }
}
```

Concurrency headers:
- `If-Match: {eTag}` -- fail with 412 if item changed since read
- `If-None-Match: {eTag}` -- fail with 412 if item hasn't changed

### COBALT/FSSHTTP: Application-Level Incremental Sync (Office Only)

Word does NOT upload the entire .docx on every save. The COBALT protocol (MS-FSSHTTP) models documents as **directed graphs of nodes**, not byte streams:

1. A .docx is a ZIP archive (Open Packaging Convention). COBALT treats each ZIP part as a separate node.
2. If only `word/document.xml` changes, only that node is synced.
3. Server-side, SharePoint uses **shredded storage** -- files stored as collections of "shreds" in a `DocStreams` table. Write cost proportional to change size, not file size.

The end-to-end pipeline: client sends delta to web server (COBALT), web server writes delta to database (shredded storage).

**Known architectural flaw**: COBALT's graph generation from a file is **non-deterministic** -- random identifiers produce different graph structures for identical content. This causes unnecessary conflicts when multiple clients generate different internal representations.

---

## 3. Conflict Resolution

### ETag and cTag Semantics

| Tag | Changes when... | Use case |
|-----|----------------|----------|
| **eTag** | Any property changes (metadata OR content) | Optimistic concurrency on writes |
| **cTag** | Only content changes | Content-specific change detection |

Caveat: For Office documents, cTag may NOT change on edits (eTag and lastModifiedDateTime do change). cTag is unreliable for Office files specifically.

### Optimistic Concurrency Control

- `If-Match: {eTag}` on PUT/PATCH/DELETE: succeeds only if current eTag matches. Returns **412 Precondition Failed** on mismatch.
- `@microsoft.graph.conflictBehavior`: `fail` (default), `replace`, or `rename` (auto-rename to `file (1).txt`).

### Sync Client Conflict Resolution

| File type | Conflict behavior |
|-----------|-------------------|
| **Non-Office files** | Creates "conflicting copy" with device name appended. Up to 10 versions. User reconciles manually. |
| **Office files** | Opens in Office app for merge. Fork option removed (Aug 2023). Forces merge resolution. |

### Word Co-Authoring Conflict Resolution (Online)

When multiple editors are online simultaneously:
1. Multiple clients hold shared locks (Schema Lock or Coauthoring Lock via FSSHTTP).
2. Concurrent uploads: all except the first fail with a **coherency error** (ETag mismatch).
3. Failing client downloads latest changes, **automatically merges** with local version.
4. If auto-merge fails, conflict surfaced to user.
5. Client retries upload with merged version.

### Word Paragraph-Level Locking

Client-coordinated (not server-enforced):
- Placing cursor in a paragraph locks it to you. Other co-authors see a colored indicator.
- Lock released when cursor moves to a different paragraph.
- Uses **RSID (Revision Session ID)** attributes in OOXML markup to track which editing session made which changes.
- Different paragraphs: automatic merge. Same paragraph, different words: usually merges. Same text: conflict dialog.

### Offline Conflict Resolution

When two devices edit the same file offline:
1. Connectivity restores, OneDrive syncs.
2. Word opens both versions and attempts merge (5-10 seconds).
3. If merge succeeds: combined changes appear automatically.
4. If merge fails: conflict dialog (fork option no longer available as of 2023).

### Delta API Re-sync

When delta tokens expire (HTTP 410 Gone), two error codes guide behavior:

| Error Code | Strategy |
|------------|----------|
| `resyncChangesApplyDifferences` | Trust server. Replace local with server versions. Upload local changes server doesn't know about. |
| `resyncChangesUploadDifferences` | Don't trust either side. Upload items server didn't return. Keep both copies when unsure. |

### Version History

OneDrive maintains automatic version history:
```
GET /me/drive/items/{item-id}/versions
```
Acts as safety net when conflicts are resolved incorrectly.

---

## 4. Metadata Model

### Microsoft Graph Delta API

Pull-based change tracking:

1. **Initial enumeration**: `GET /me/drive/root/delta` -- returns all items (paginated).
2. **Pagination**: Follow `@odata.nextLink` URLs until exhausted.
3. **Delta link**: Final page returns `@odata.deltaLink` with opaque `$deltatoken`. Store this.
4. **Incremental sync**: Call `@odata.deltaLink` later. Returns only items changed since token.
5. Each response ends with a new `@odata.deltaLink`.

Key behaviors:
- Delta shows **latest state** of each item, not intermediate changes. Renamed twice = appears once with final name.
- Same item may appear multiple times -- always use last occurrence.
- `parentReference.path` never populated in delta (track items by `id`, not path).
- Deleted items have a `deleted` facet present.

### Per-Item Metadata (driveItem)

| Property | Description |
|----------|-------------|
| `id` | Unique, immutable item identifier |
| `eTag` | Changes on any property change |
| `cTag` | Changes on content change only |
| `createdDateTime` | Creation timestamp |
| `lastModifiedDateTime` | Last modification timestamp |
| `lastModifiedBy` | Identity of last modifier |
| `size` | Size in bytes |
| `file.hashes` | SHA1/SHA256/CRC32/quickXorHash |
| `deleted` | Present if deleted (soft delete) |

### Real-Time Notifications

WebSocket endpoint via socket.io:
```
GET /me/drive/root/subscriptions/socketIo
```
Returns a notification URL. Connect with `transports: ['websocket']`. Listen on `"notification"` event. Lightweight signal only -- call delta API for actual changes.

### WOPI: Storage Abstraction Protocol

For Office Online integration, WOPI provides:
- `CheckFileInfo`: Capability negotiation (returns permissions, supported features)
- `GetFile` / `PutFile`: Binary content access
- `Lock` / `Unlock` / `RefreshLock`: 30-minute expiry file locks
- File IDs: URL-safe, immutable across edits/renames/moves
- Access tokens: Opaque, scoped to user+file, recommended 10-hour expiry

When `SupportsCobalt=true`, FSSHTTP cell storage requests tunnel through WOPI, enabling incremental sync through the storage abstraction.

---

## 5. Applicability to DICOM Viewer

### Patterns to Adopt

| Pattern | OneDrive/Word | Our Application |
|---------|---------------|-----------------|
| **Delta-based change tracking** | Graph delta API with opaque tokens | `/api/sync` endpoint with `last_sync_at` cursor. Delta response returns only changed records. |
| **Optimistic concurrency via ETags** | `If-Match` headers, 412 on conflict | `record_version` or `updated_at` field. Server rejects stale writes. |
| **Soft deletes with tombstones** | `deleted` facet in delta responses | `deleted_at` column. Sync propagates deletions. |
| **Push + pull pattern** | WebSocket signals "something changed"; delta API reveals what | WebSocket/SSE notification triggers sync pull. |
| **Resumable uploads for large files** | 320 KiB-aligned chunks, session-based | For DICOM datasets (GB-scale). Chunked upload with resume on failure. |
| **Content hashing for dedup** | `file.hashes` (SHA1, quickXorHash) | `content_hash` (SHA-256) on reports table. Skip re-upload if hash matches. |
| **Conflict behavior enum** | `fail` / `replace` / `rename` | For report uploads: `fail` default, `replace` on explicit overwrite. |
| **Version history as safety net** | Automatic version history on all files | Version history for reports. Lightweight -- just keep prior versions, let user restore. |
| **Immutable IDs** | Track items by `id`, never by path | `record_uuid` as primary sync key. Never use paths or autoincrement IDs for sync identity. |
| **Token expiration with re-sync guidance** | 410 Gone + `resyncChangesApplyDifferences` or `resyncChangesUploadDifferences` | Same pattern. When sync token expires, server instructs client on re-sync strategy. |

### Patterns NOT Applicable

| Pattern | Why Not |
|---------|---------|
| **Placeholder files / Files On-Demand** | Requires OS-level kernel driver (CfApi/File Provider). Overkill for our use case. DICOM files stay where the user puts them locally; cloud mode fetches on demand via API. |
| **COBALT/FSSHTTP incremental document sync** | We don't have collaborative document editing. Our "documents" are immutable DICOM files and user-attached reports. No need for node-granular graph-based sync. |
| **Paragraph-level locking** | No real-time co-authoring on medical notes (single-user desktop app). |
| **Shredded storage** | Server-side optimization for SharePoint's SQL database. Our report files are small enough to store as whole objects in S3/cloud storage. |
| **WOPI** | Third-party Office integration protocol. Not relevant unless we want Office Online to edit our files. |
| **Differential block-level sync** | Proprietary, and our files are either immutable (DICOM) or small (reports, metadata). Full-file upload is fine for reports. Chunked upload is sufficient for DICOM datasets. |

### Recommended Architecture for Our Cloud Sync

```
                    DICOM Viewer Sync Architecture
                    (inspired by OneDrive patterns)

CLIENT (Desktop/Browser)
    |
    +-- Local SQLite (DesktopSqliteBackend)
    |       +-- All mutable records with sync metadata:
    |       |     record_uuid, updated_at, deleted_at, device_id
    |       +-- Sync state:
    |       |     last_sync_at (per table or global)
    |       |     pending_changes queue
    |       +-- Report files in app data
    |
    +-- Sync Engine
    |       +-- Pull: GET /api/sync?since={last_sync_at}
    |       |     Returns changed records since cursor
    |       +-- Push: POST /api/sync
    |       |     Sends local changes, receives conflicts
    |       +-- Conflict: last-writer-wins on updated_at
    |       |     Log conflicts for debugging
    |       +-- Trigger: WebSocket notification or periodic poll
    |
    +-- Report Upload
            +-- Small (<4 MB): simple POST
            +-- Large (>4 MB): chunked upload with resume
            +-- Dedup: skip if content_hash matches server

SERVER (app.divergent.health)
    |
    +-- PostgreSQL
    |       +-- Same schema as local SQLite + user_id column
    |       +-- Soft deletes (deleted_at) for sync propagation
    |       +-- Version history for reports
    |
    +-- Object Storage (S3)
    |       +-- Report files keyed by content_hash
    |       +-- DICOM files keyed by study/series/instance UIDs
    |
    +-- Sync API
    |       +-- GET /api/sync?since={cursor} -- delta response
    |       +-- POST /api/sync -- push changes with optimistic concurrency
    |       +-- 410 Gone when cursor expires + re-sync guidance
    |
    +-- Notifications
            +-- WebSocket/SSE for change signals
```

### Data Type Strategy

| Data type | Size | Sync strategy | Conflict resolution |
|-----------|------|---------------|---------------------|
| **Study/series metadata** | Bytes | Delta sync | Last-writer-wins |
| **Comments** | Bytes | Delta sync | Last-writer-wins |
| **Descriptions** | Bytes | Delta sync | Last-writer-wins |
| **Reports (files)** | KB-MB | Content-hash dedup + upload | No conflict (immutable once uploaded) |
| **DICOM files** | GB | Chunked resumable upload | No conflict (immutable medical data) |

### Key Takeaway from OneDrive

The most transferable insight is the **layered approach**: separate the "what changed" detection (delta API) from the "how to transfer" mechanism (differential sync / chunked upload) from the "how to resolve conflicts" policy (optimistic concurrency / last-writer-wins / fork).

Our current `NotesAPI` dispatcher already separates backends. The cloud addition is:
1. **Delta cursor** (like OneDrive's `$deltatoken`) -- opaque marker for "sync from here"
2. **Optimistic concurrency** (like OneDrive's `If-Match: {eTag}`) -- reject stale writes
3. **Soft deletes** (like OneDrive's `deleted` facet) -- propagate deletions
4. **Push notifications** (like OneDrive's socket.io) -- trigger sync without polling
5. **Resumable uploads** (like OneDrive's upload sessions) -- for large DICOM datasets

---

## Comparison: Three Models

| Aspect | Horos (import-manage) | OneDrive/Word (layered sync) | Our App (reference + cloud) |
|--------|----------------------|------------------------------|----------------------------|
| **Local DICOM storage** | Copies into managed DB | N/A (not medical) | Reference in place |
| **Metadata storage** | Core Data (SQLite) | Filesystem + cloud API | SQLite + cloud API |
| **Sync granularity** | N/A (single machine) | Block-level (files) + node-level (Office docs) | Record-level (metadata) + file-level (reports) |
| **Conflict resolution** | N/A | ETag + paragraph merge + fork files | Last-writer-wins on updated_at |
| **Offline support** | Full (local DB) | Placeholder hydration + queued sync | Full local SQLite + sync on reconnect |
| **Cloud coupling** | None | Tight (OneDrive is primary store) | Loose (cloud is sync target, local is primary) |
| **Complexity** | Low (no sync) | Very high (3 protocol layers) | Medium (1 sync protocol) |

Our model is simpler than OneDrive's because:
1. No real-time co-authoring (eliminates COBALT complexity)
2. No placeholder files (eliminates CfApi/File Provider complexity)
3. Medical data is immutable (eliminates differential sync for images)
4. Single user per device (eliminates paragraph locking)

The parts we DO need from OneDrive are the proven patterns for delta sync, optimistic concurrency, and resumable uploads -- which are well-documented in the Microsoft Graph API.

---

## Sources

### OneDrive Sync Engine
- [Build a Cloud Sync Engine that Supports Placeholder Files](https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine)
- [Cloud Filter API Portal](https://learn.microsoft.com/en-us/windows/win32/cfapi/cloud-files-api-portal)
- [CF_CALLBACK_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/ne-cfapi-cf_callback_type)
- [CF_HYDRATION_POLICY_PRIMARY](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/ne-cfapi-cf_hydration_policy_primary)
- [CF_PLACEHOLDER_STATE](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/ne-cfapi-cf_placeholder_state)
- [driveItem: delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta)
- [driveItem resource type](https://learn.microsoft.com/en-us/graph/api/resources/driveitem)
- [driveItem: createUploadSession](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession)
- [WebSocket endpoint](https://learn.microsoft.com/en-us/graph/api/subscriptions-socketio)
- [OneDrive Differential Sync Rollout](https://techcommunity.microsoft.com/discussions/microsoft-365/onedrive-completes-roll-out-of-differential-sync/1343279)

### Word Co-Authoring
- [MS-FSSHTTP Overview](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-fsshttp/6d078cbe-2651-43a0-b460-685ac3f14c45)
- [MS-FSSHTTP Specification](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-fsshttp/05fa7efd-48ed-48d5-8d85-77995e17cc81)
- [MS-FSSHTTPB Abstract Data Model](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-fsshttpb/6c7e4447-6ccd-4764-8dbc-17a382fb631d)
- [MS-WOPI Specification](https://learn.microsoft.com/en-us/openspecs/office_protocols/ms-wopi/6a8bb410-68ad-47e4-9dc3-6cf29c6b046b)
- [Shredded Storage in SharePoint 2013](https://wbaer.net/2012/11/introduction-to-shredded-storage-in-sharepoint-2013-rtm-update/)
- [Fluid Framework FAQ](https://fluidframework.com/docs/faq)
- [Apple File Provider](https://developer.apple.com/documentation/fileprovider)
