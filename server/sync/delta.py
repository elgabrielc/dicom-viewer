"""
Change detection and delta computation for the sync protocol.

Handles:
- Processing incoming client changes (insert/update/delete)
- Idempotent dedup via operation_uuid
- Optimistic concurrency via base_sync_version
- Computing remote changes since a cursor position

Copyright (c) 2026 Divergent Health Technologies
"""

import time

# Tables the sync protocol supports in v1
SYNC_TABLES = {"study_notes", "comments", "reports"}

# Column that serves as the primary key for each synced table
TABLE_KEY_COLUMN = {
    "study_notes": "study_uid",
    "comments": "record_uuid",
    "reports": "id",
}

# Columns to include in sync data payloads for each table.
# These are the "data" fields sent to/from clients.
TABLE_DATA_COLUMNS = {
    "study_notes": ["study_uid", "description", "updated_at", "deleted_at"],
    "comments": [
        "record_uuid", "study_uid", "series_uid", "text",
        "created_at", "updated_at", "deleted_at",
    ],
    "reports": [
        "id", "study_uid", "name", "type", "size",
        "content_hash", "added_at", "updated_at", "deleted_at",
    ],
}


def process_change(db, user_id, device_id, change):
    """Process a single change from a client push.

    Args:
        db: SQLite connection
        user_id: authenticated user's ID
        device_id: the pushing device
        change: dict with keys: operation_uuid, table, key, operation,
                base_sync_version, data

    Returns:
        dict -- either an "accepted" result or a "rejected" result.
        Accepted: {"status": "accepted", "operation_uuid", "key", "sync_version"}
        Rejected: {"status": "rejected", "operation_uuid", "key", "reason",
                   "current_sync_version", "current_data"}
    """
    operation_uuid = change["operation_uuid"]
    table = change["table"]
    key = change["key"]
    operation = change["operation"]
    base_version = change.get("base_sync_version", 0)
    data = change.get("data") or {}

    if table not in SYNC_TABLES:
        return {
            "status": "rejected",
            "operation_uuid": operation_uuid,
            "key": key,
            "reason": "unknown_table",
            "current_sync_version": 0,
            "current_data": {},
        }

    # Idempotency check: if we already processed this operation_uuid, return
    # the previously assigned sync_version without re-applying.
    existing_op = db.execute(
        "SELECT sync_version FROM sync_processed_ops WHERE operation_uuid = ?",
        (operation_uuid,),
    ).fetchone()
    if existing_op is not None:
        return {
            "status": "accepted",
            "operation_uuid": operation_uuid,
            "key": key,
            "sync_version": existing_op["sync_version"],
        }

    key_col = TABLE_KEY_COLUMN[table]

    # Fetch current server state for this record
    current_row = db.execute(
        f"SELECT sync_version FROM {table} WHERE {key_col} = ?",
        (key,),
    ).fetchone()

    current_version = current_row["sync_version"] if current_row else 0

    # Optimistic concurrency: base_sync_version must match current
    if base_version != current_version:
        current_data = _read_record_data(db, table, key)
        return {
            "status": "rejected",
            "operation_uuid": operation_uuid,
            "key": key,
            "reason": "stale",
            "current_sync_version": current_version,
            "current_data": current_data,
        }

    # Allocate next global sync_version from the server version counter
    new_version = _next_sync_version(db, table, key, device_id)

    now = int(time.time() * 1000)

    if operation == "insert":
        _apply_insert(db, table, key, data, device_id, new_version, now)
    elif operation == "update":
        _apply_update(db, table, key, data, device_id, new_version, now)
    elif operation == "delete":
        _apply_delete(db, table, key, device_id, new_version, now)
    else:
        return {
            "status": "rejected",
            "operation_uuid": operation_uuid,
            "key": key,
            "reason": "unknown_operation",
            "current_sync_version": current_version,
            "current_data": {},
        }

    # Record the operation for idempotency
    db.execute(
        """
        INSERT INTO sync_processed_ops (operation_uuid, table_name, record_key, sync_version, processed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (operation_uuid, table, key, new_version, int(time.time())),
    )

    return {
        "status": "accepted",
        "operation_uuid": operation_uuid,
        "key": key,
        "sync_version": new_version,
    }


def compute_remote_changes(db, user_id, device_id, cursor_position):
    """Find all records changed since cursor_position, excluding changes
    made by the requesting device (to avoid echo).

    Args:
        db: SQLite connection
        user_id: authenticated user's ID
        device_id: the requesting device (excluded from results)
        cursor_position: sync_version watermark from the cursor

    Returns:
        list[dict] -- remote changes with table, key, sync_version, operation, data
    """
    changes = []

    for table in SYNC_TABLES:
        key_col = TABLE_KEY_COLUMN[table]
        data_cols = TABLE_DATA_COLUMNS[table]

        # Build SELECT columns: key, sync_version, deleted_at, plus all data columns
        select_cols = [key_col, "sync_version", "deleted_at"] + [
            c for c in data_cols if c not in (key_col, "sync_version", "deleted_at")
        ]
        cols_sql = ", ".join(select_cols)

        # Query records with sync_version > cursor_position, excluding this device
        # For the server DB, we use sync_server_versions to track which device made
        # each change, but the actual data lives in the entity tables.
        rows = db.execute(
            f"""
            SELECT {cols_sql}
            FROM {table}
            WHERE sync_version > ?
              AND (device_id IS NULL OR device_id != ?)
            """,
            (cursor_position, device_id),
        ).fetchall()

        for row in rows:
            key_value = row[key_col]
            deleted_at = row["deleted_at"]

            # Determine operation type from record state
            if deleted_at is not None:
                op = "delete"
            else:
                # If sync_version == 1 it was an insert, otherwise update.
                # But from the remote's perspective, the distinction is less
                # important than having the full data. We use "upsert" semantics
                # on the client side. Mark as "insert" for version 1, "update" otherwise.
                op = "insert" if row["sync_version"] == 1 else "update"

            record_data = {}
            for col in data_cols:
                record_data[col] = row[col]

            changes.append({
                "table": table,
                "key": key_value,
                "sync_version": row["sync_version"],
                "operation": op,
                "data": record_data,
            })

    # Sort by sync_version so the client can apply them in order
    changes.sort(key=lambda c: c["sync_version"])
    return changes


def get_max_sync_version(db):
    """Return the highest sync_version across all synced tables.

    This is used as the cursor position for newly issued cursors.
    """
    max_ver = 0
    for table in SYNC_TABLES:
        row = db.execute(
            f"SELECT MAX(sync_version) AS max_ver FROM {table}"
        ).fetchone()
        if row and row["max_ver"] is not None:
            table_max = row["max_ver"]
            if table_max > max_ver:
                max_ver = table_max
    return max_ver


# -- Private helpers --


def _next_sync_version(db, table, key, device_id):
    """Allocate the next sync_version for a record.

    Uses the sync_server_versions table as a monotonic counter per
    (table, key) pair, and also tracks globally so cursors can use
    a single watermark.
    """
    now = int(time.time())

    # Get the current global max to ensure monotonic increase
    global_max = get_max_sync_version(db)
    new_version = global_max + 1

    # Upsert the server version tracker
    db.execute(
        """
        INSERT INTO sync_server_versions (table_name, record_key, sync_version, device_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(table_name, record_key) DO UPDATE SET
            sync_version = excluded.sync_version,
            device_id = excluded.device_id,
            updated_at = excluded.updated_at
        """,
        (table, key, new_version, device_id, now),
    )

    return new_version


def _read_record_data(db, table, key):
    """Read the current data for a record, used when rejecting a stale change."""
    key_col = TABLE_KEY_COLUMN[table]
    data_cols = TABLE_DATA_COLUMNS[table]
    cols_sql = ", ".join(data_cols)

    row = db.execute(
        f"SELECT {cols_sql} FROM {table} WHERE {key_col} = ?",
        (key,),
    ).fetchone()

    if row is None:
        return {}

    return {col: row[col] for col in data_cols}


def _apply_insert(db, table, key, data, device_id, new_version, now_ms):
    """Apply an insert operation to an entity table."""
    key_col = TABLE_KEY_COLUMN[table]

    if table == "study_notes":
        db.execute(
            """
            INSERT INTO study_notes (study_uid, description, updated_at, device_id, sync_version, deleted_at)
            VALUES (?, ?, ?, ?, ?, NULL)
            ON CONFLICT(study_uid) DO UPDATE SET
                description = excluded.description,
                updated_at = excluded.updated_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                deleted_at = NULL
            """,
            (key, data.get("description", ""), data.get("updated_at", now_ms), device_id, new_version),
        )

    elif table == "comments":
        db.execute(
            """
            INSERT INTO comments (record_uuid, study_uid, series_uid, text, time, created_at, updated_at,
                                  device_id, sync_version, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(study_uid, series_uid, text, time) DO UPDATE SET
                record_uuid = excluded.record_uuid,
                updated_at = excluded.updated_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                deleted_at = NULL
            """,
            (
                key,
                data.get("study_uid", ""),
                data.get("series_uid"),
                data.get("text", ""),
                data.get("created_at", now_ms),
                data.get("created_at", now_ms),
                data.get("updated_at", now_ms),
                device_id,
                new_version,
            ),
        )

    elif table == "reports":
        db.execute(
            """
            INSERT INTO reports (id, study_uid, name, type, size, content_hash,
                                 added_at, updated_at, device_id, sync_version, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO UPDATE SET
                study_uid = excluded.study_uid,
                name = excluded.name,
                type = excluded.type,
                size = excluded.size,
                content_hash = excluded.content_hash,
                added_at = excluded.added_at,
                updated_at = excluded.updated_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                deleted_at = NULL
            """,
            (
                key,
                data.get("study_uid", ""),
                data.get("name", ""),
                data.get("type", ""),
                data.get("size", 0),
                data.get("content_hash"),
                data.get("added_at", now_ms),
                data.get("updated_at", now_ms),
                device_id,
                new_version,
            ),
        )


def _apply_update(db, table, key, data, device_id, new_version, now_ms):
    """Apply an update operation to an entity table."""
    key_col = TABLE_KEY_COLUMN[table]

    if table == "study_notes":
        db.execute(
            """
            UPDATE study_notes SET
                description = ?,
                updated_at = ?,
                device_id = ?,
                sync_version = ?,
                deleted_at = NULL
            WHERE study_uid = ?
            """,
            (data.get("description", ""), data.get("updated_at", now_ms), device_id, new_version, key),
        )

    elif table == "comments":
        db.execute(
            """
            UPDATE comments SET
                text = ?,
                updated_at = ?,
                device_id = ?,
                sync_version = ?,
                deleted_at = NULL
            WHERE record_uuid = ?
            """,
            (data.get("text", ""), data.get("updated_at", now_ms), device_id, new_version, key),
        )

    elif table == "reports":
        db.execute(
            """
            UPDATE reports SET
                name = ?,
                type = ?,
                size = ?,
                content_hash = ?,
                updated_at = ?,
                device_id = ?,
                sync_version = ?,
                deleted_at = NULL
            WHERE id = ?
            """,
            (
                data.get("name", ""),
                data.get("type", ""),
                data.get("size", 0),
                data.get("content_hash"),
                data.get("updated_at", now_ms),
                device_id,
                new_version,
                key,
            ),
        )


def _apply_delete(db, table, key, device_id, new_version, now_ms):
    """Apply a delete (tombstone) operation to an entity table."""
    key_col = TABLE_KEY_COLUMN[table]

    if table == "study_notes":
        # Study notes use empty description on clear, not deleted_at.
        # Per the contract's deletion model: study_notes clears description.
        db.execute(
            """
            UPDATE study_notes SET
                description = '',
                updated_at = ?,
                device_id = ?,
                sync_version = ?
            WHERE study_uid = ?
            """,
            (now_ms, device_id, new_version, key),
        )

    elif table == "comments":
        db.execute(
            """
            UPDATE comments SET
                deleted_at = ?,
                updated_at = ?,
                device_id = ?,
                sync_version = ?
            WHERE record_uuid = ?
            """,
            (now_ms, now_ms, device_id, new_version, key),
        )

    elif table == "reports":
        db.execute(
            """
            UPDATE reports SET
                deleted_at = ?,
                updated_at = ?,
                device_id = ?,
                sync_version = ?
            WHERE id = ?
            """,
            (now_ms, now_ms, device_id, new_version, key),
        )
