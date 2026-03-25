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

    # Idempotency check: if we already processed this operation_uuid for this
    # user, return the previously assigned sync_version without re-applying.
    existing_op = db.execute(
        "SELECT sync_version FROM sync_processed_ops WHERE operation_uuid = ? AND user_id = ?",
        (operation_uuid, user_id),
    ).fetchone()
    if existing_op is not None:
        return {
            "status": "accepted",
            "operation_uuid": operation_uuid,
            "key": key,
            "sync_version": existing_op["sync_version"],
        }

    key_col = TABLE_KEY_COLUMN[table]

    # Fetch current server state for this record, scoped to the authenticated user.
    # We use sync_server_versions (which carries user_id) to determine the current
    # sync_version, rather than the entity table directly.
    version_row = db.execute(
        "SELECT sync_version FROM sync_server_versions WHERE table_name = ? AND record_key = ? AND user_id = ?",
        (table, key, user_id),
    ).fetchone()

    current_version = version_row["sync_version"] if version_row else 0

    # Optimistic concurrency: base_sync_version must match current
    if base_version != current_version:
        current_data = _read_record_data(db, table, key, user_id)
        return {
            "status": "rejected",
            "operation_uuid": operation_uuid,
            "key": key,
            "reason": "stale",
            "current_sync_version": current_version,
            "current_data": current_data,
        }

    # Allocate next global sync_version from the server version counter
    new_version = _next_sync_version(db, table, key, device_id, user_id)

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

    # Record the operation for idempotency (scoped by user_id)
    db.execute(
        """
        INSERT INTO sync_processed_ops (operation_uuid, table_name, record_key, user_id, sync_version, processed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (operation_uuid, table, key, user_id, new_version, int(time.time())),
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
        # Prefix entity columns with the table alias to avoid ambiguity with the join.
        select_cols = [key_col, "sync_version", "deleted_at"] + [
            c for c in data_cols if c not in (key_col, "sync_version", "deleted_at")
        ]
        cols_sql = ", ".join(f"t.{c}" for c in select_cols)

        # Query records changed since cursor_position that belong to this user,
        # excluding changes made by the requesting device (to avoid echo).
        # The JOIN on sync_server_versions enforces per-user data isolation:
        # only records with a version row for this user are returned.
        rows = db.execute(
            f"""
            SELECT {cols_sql}
            FROM {table} t
            INNER JOIN sync_server_versions sv
                ON sv.table_name = ?
               AND sv.record_key = t.{key_col}
               AND sv.user_id = ?
            WHERE t.sync_version > ?
              AND (sv.device_id IS NULL OR sv.device_id != ?)
            """,
            (table, user_id, cursor_position, device_id),
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


def get_max_sync_version(db, user_id=None):
    """Return the highest sync_version across all synced tables.

    When user_id is provided, only considers records belonging to that user
    (via sync_server_versions). When None, returns the global max across
    all users (used internally for version allocation).

    This is used as the cursor position for newly issued cursors.
    """
    if user_id is not None:
        row = db.execute(
            "SELECT MAX(sync_version) AS max_ver FROM sync_server_versions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["max_ver"] if row and row["max_ver"] is not None else 0

    # Global max across all users -- used by _next_sync_version to ensure
    # monotonic increase even across user boundaries.
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


def _next_sync_version(db, table, key, device_id, user_id):
    """Allocate the next sync_version for a record owned by user_id.

    Uses the sync_server_versions table as a monotonic counter per
    (table, key, user_id) triple, and also tracks globally so cursors
    can use a single watermark.
    """
    now = int(time.time())

    # Get the current global max to ensure monotonic increase
    global_max = get_max_sync_version(db)
    new_version = global_max + 1

    # Upsert the server version tracker (scoped by user_id)
    db.execute(
        """
        INSERT INTO sync_server_versions (table_name, record_key, user_id, sync_version, device_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(table_name, record_key, user_id) DO UPDATE SET
            sync_version = excluded.sync_version,
            device_id = excluded.device_id,
            updated_at = excluded.updated_at
        """,
        (table, key, user_id, new_version, device_id, now),
    )

    return new_version


def _read_record_data(db, table, key, user_id=None):
    """Read the current data for a record, used when rejecting a stale change.

    When user_id is provided, verifies the record belongs to this user via
    sync_server_versions before returning data. Returns empty dict if the
    record doesn't exist or doesn't belong to the user.
    """
    key_col = TABLE_KEY_COLUMN[table]
    data_cols = TABLE_DATA_COLUMNS[table]
    cols_sql = ", ".join(f"t.{c}" for c in data_cols)

    if user_id is not None:
        # Only return data for records that belong to this user
        row = db.execute(
            f"""
            SELECT {cols_sql}
            FROM {table} t
            INNER JOIN sync_server_versions sv
                ON sv.table_name = ?
               AND sv.record_key = t.{key_col}
               AND sv.user_id = ?
            WHERE t.{key_col} = ?
            """,
            (table, user_id, key),
        ).fetchone()
    else:
        cols_sql_plain = ", ".join(data_cols)
        row = db.execute(
            f"SELECT {cols_sql_plain} FROM {table} WHERE {key_col} = ?",
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
