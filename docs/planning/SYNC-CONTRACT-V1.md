# Sync Contract v1 (Frozen)

This document defines the wire protocol and auth model for cloud sync v1.
All Stage 3 agents code against this specification. Changes require orchestrator approval.

Frozen: 2026-03-25

---

## Scope

v1 syncs three entity types: `study_notes`, `comments`, `reports`.
Series-note sync is deferred to v2.

---

## Authentication

### Model: JWT bearer tokens

- Login: `POST /api/auth/login` with `{ email, password }` returns `{ access_token, refresh_token, expires_in }`
- Refresh: `POST /api/auth/refresh` with `{ refresh_token }` returns new `{ access_token, expires_in }`
- All authenticated endpoints require `Authorization: Bearer <access_token>` header
- 401 on missing/expired/invalid token

### Device registration

- Register: `POST /api/auth/devices` with `{ device_name, platform }` returns `{ device_id }`
- `device_id` is server-issued and immutable. Client stores it in `sync_state`.
- All sync requests must include `device_id` in the request body
- Server validates `device_id` belongs to the authenticated user
- Unregistered `device_id` returns 403

### User accounts

- Signup: `POST /api/auth/signup` with `{ email, password, name }`
- Each user owns their data. No cross-user access in v1.

---

## Sync endpoint

### `POST /api/sync`

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request body:**
```json
{
    "device_id": "server-issued-device-uuid",
    "delta_cursor": "opaque-server-token-or-null-for-first-sync",
    "changes": [
        {
            "operation_uuid": "client-generated-uuid-for-idempotency",
            "table": "comments",
            "key": "record-uuid-or-study-uid",
            "operation": "insert",
            "base_sync_version": 0,
            "data": {
                "study_uid": "1.2.840...",
                "text": "Edema visible in T2",
                "created_at": 1711360000000,
                "updated_at": 1711360000000
            }
        },
        {
            "operation_uuid": "another-uuid",
            "table": "study_notes",
            "key": "1.2.840.113619.2.55.3",
            "operation": "update",
            "base_sync_version": 2,
            "data": {
                "description": "Follow-up CT abdomen"
            }
        },
        {
            "operation_uuid": "delete-uuid",
            "table": "reports",
            "key": "report-id",
            "operation": "delete",
            "base_sync_version": 1,
            "data": {}
        }
    ]
}
```

**Response (200 OK):**
```json
{
    "accepted": [
        {
            "operation_uuid": "client-generated-uuid",
            "key": "record-uuid",
            "sync_version": 3
        }
    ],
    "rejected": [
        {
            "operation_uuid": "another-uuid",
            "key": "1.2.840.113619.2.55.3",
            "reason": "stale",
            "current_sync_version": 5,
            "current_data": {
                "description": "Updated by other device"
            }
        }
    ],
    "remote_changes": [
        {
            "table": "comments",
            "key": "uuid-from-other-device",
            "sync_version": 7,
            "operation": "insert",
            "data": {
                "study_uid": "1.2.840...",
                "text": "New comment from device B",
                "created_at": 1711360100000,
                "updated_at": 1711360100000,
                "deleted_at": null
            }
        }
    ],
    "delta_cursor": "new-opaque-server-token",
    "server_time": 1711360500000
}
```

### Semantics

**Push (client changes):**
- Each change includes `operation_uuid` for server-side idempotent dedup. If the server has already processed this `operation_uuid`, it returns it in `accepted` with the existing `sync_version`.
- `base_sync_version` is the record's `sync_version` at the time the client made the local change. Server compares against its current version.
- If `base_sync_version` matches: change accepted, server increments `sync_version`, returns new version in `accepted`.
- If `base_sync_version` does not match: change rejected, server returns current version and data in `rejected`. Client must resolve (typically: accept server version, re-apply local change if still relevant).

**Pull (remote changes):**
- `remote_changes` contains all records changed since the provided `delta_cursor`.
- Each change includes the full current `data`, `sync_version`, and `deleted_at` (for tombstones).
- Client applies these to local SQLite, overwriting local state where `sync_version` is newer.

**Cursor:**
- `delta_cursor` is opaque to the client. Server issues it, client stores it in `sync_state`, and sends it back on next sync.
- `null` cursor means "first sync" -- server returns all records for this user.
- Expired cursor: server returns `410 Gone` with body `{ "error": "cursor_expired", "hint": "full_resync" }`. Client must sync with `null` cursor.

**Operations:**
- `insert`: new record. `data` contains all fields.
- `update`: modified record. `data` contains all fields (full replacement, not partial).
- `delete`: tombstoned record. `data` is empty or contains only `deleted_at`.

---

## Record key format

| Table | key field | Example |
|-------|-----------|---------|
| `study_notes` | `study_uid` | `1.2.840.113619.2.55.3` |
| `comments` | `record_uuid` | `a1b2c3d4-e5f6-...` |
| `reports` | `id` | `f7e8d9c0-b1a2-...` |

---

## Report file sync

Report metadata syncs via `/api/sync` like other entities. Report file blobs sync separately:

- **Upload**: `POST /api/sync/reports/<report_id>/file` with multipart file upload. Include `Content-Hash: sha256:<hex>` header. Server skips storage if hash already exists (dedup).
- **Download**: `GET /api/sync/reports/<report_id>/file` returns the file bytes.
- Server returns `404` for reports that are tombstoned (`deleted_at` set).

---

## Error codes

| HTTP | Body error field | Meaning |
|------|-----------------|---------|
| 200 | (none) | Sync successful. Check `accepted`/`rejected` arrays. |
| 401 | `unauthorized` | Missing or invalid access token |
| 403 | `device_not_registered` | `device_id` not registered for this user |
| 410 | `cursor_expired` | Delta cursor expired. Full resync required. |
| 429 | `rate_limited` | Too many sync requests. Retry after `Retry-After` header. |

---

## Deletion model (from frozen invariants)

| Entity | On clear/delete | Sync behavior |
|--------|----------------|---------------|
| `study_notes` | `UPDATE description = ''` | Persists when empty. Syncs as `update` operation. |
| `comments` | `UPDATE SET deleted_at` | Syncs as `delete` operation with tombstone. |
| `reports` | `UPDATE SET deleted_at` | Syncs as `delete` operation. File retained until purge. |

---

## Polling and notifications

v1 uses periodic polling only. Client calls `/api/sync` every 30 seconds when online.
WebSocket/SSE push notifications deferred to v2.
