"""
Change detection and delta computation for the sync protocol.

Handles:
- Processing incoming client changes (insert/update/delete)
- Idempotent dedup via operation_uuid
- Optimistic concurrency via base_sync_version
- Computing remote changes since a cursor position

Copyright (c) 2026 Divergent Health Technologies
"""

import json
import time

# Tables the sync protocol supports in v1
SYNC_TABLES = {'study_notes', 'series_notes', 'comments', 'reports'}

# Cloud-scoped storage tables used exclusively by /api/sync
TABLE_STORAGE = {
    'study_notes': 'cloud_study_notes',
    'series_notes': 'cloud_series_notes',
    'comments': 'cloud_comments',
    'reports': 'cloud_reports',
}

# Column that serves as the primary key for each synced table
TABLE_KEY_COLUMN = {
    'study_notes': 'study_uid',
    'series_notes': 'record_key',
    'comments': 'record_uuid',
    'reports': 'id',
}

# Columns to include in sync data payloads for each table.
TABLE_DATA_COLUMNS = {
    'study_notes': ['study_uid', 'description', 'updated_at', 'deleted_at'],
    'series_notes': ['study_uid', 'series_uid', 'description', 'updated_at', 'deleted_at'],
    'comments': [
        'record_uuid',
        'study_uid',
        'series_uid',
        'text',
        'created_at',
        'updated_at',
        'deleted_at',
    ],
    'reports': [
        'id',
        'study_uid',
        'name',
        'type',
        'size',
        'content_hash',
        'added_at',
        'updated_at',
        'deleted_at',
    ],
}


def _parse_series_record_key(record_key):
    try:
        study_uid, series_uid = json.loads(record_key)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError(f'Invalid series_notes record key: {record_key}') from exc

    if not isinstance(study_uid, str) or not isinstance(series_uid, str):
        raise ValueError(f'Invalid series_notes record key: {record_key}')

    return study_uid, series_uid


def process_change(db, user_id, device_id, change):
    """Process a single change from a client push."""
    operation_uuid = change['operation_uuid']
    table = change['table']
    key = change['key']
    operation = change['operation']
    base_version = change.get('base_sync_version', 0)
    data = change.get('data') or {}

    if table not in SYNC_TABLES:
        return {
            'status': 'rejected',
            'operation_uuid': operation_uuid,
            'key': key,
            'reason': 'unknown_table',
            'current_sync_version': 0,
            'current_data': {},
        }

    if table == 'series_notes':
        try:
            _parse_series_record_key(key)
        except ValueError:
            return {
                'status': 'rejected',
                'operation_uuid': operation_uuid,
                'key': key,
                'reason': 'invalid_key',
                'current_sync_version': 0,
                'current_data': {},
            }

    existing_op = db.execute(
        'SELECT sync_version FROM sync_processed_ops WHERE operation_uuid = ? AND user_id = ?',
        (operation_uuid, user_id),
    ).fetchone()
    if existing_op is not None:
        return {
            'status': 'accepted',
            'operation_uuid': operation_uuid,
            'key': key,
            'sync_version': existing_op['sync_version'],
        }

    version_row = db.execute(
        """
        SELECT sync_version
        FROM sync_server_versions
        WHERE table_name = ? AND record_key = ? AND user_id = ?
        """,
        (table, key, user_id),
    ).fetchone()
    current_version = version_row['sync_version'] if version_row else 0

    if base_version != current_version:
        current_data = _read_record_data(db, table, key, user_id)
        return {
            'status': 'rejected',
            'operation_uuid': operation_uuid,
            'key': key,
            'reason': 'stale',
            'current_sync_version': current_version,
            'current_data': current_data,
        }

    if operation not in {'insert', 'update', 'delete'}:
        return {
            'status': 'rejected',
            'operation_uuid': operation_uuid,
            'key': key,
            'reason': 'unknown_operation',
            'current_sync_version': current_version,
            'current_data': {},
        }

    new_version = _next_sync_version(db, table, key, device_id, user_id)
    now = int(time.time() * 1000)

    if operation == 'insert':
        _apply_insert(db, table, user_id, key, data, device_id, new_version, now)
    elif operation == 'update':
        _apply_update(db, table, user_id, key, data, device_id, new_version, now)
    else:
        _apply_delete(db, table, user_id, key, device_id, new_version, now)

    db.execute(
        """
        INSERT INTO sync_processed_ops (
            operation_uuid, table_name, record_key, user_id, sync_version, processed_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (operation_uuid, table, key, user_id, new_version, int(time.time())),
    )

    return {
        'status': 'accepted',
        'operation_uuid': operation_uuid,
        'key': key,
        'sync_version': new_version,
    }


def compute_remote_changes(db, user_id, device_id, cursor_position):
    """Find all records changed since cursor_position, excluding self-echo."""
    changes = []

    for table in SYNC_TABLES:
        storage_table = TABLE_STORAGE[table]
        key_col = TABLE_KEY_COLUMN[table]
        data_cols = TABLE_DATA_COLUMNS[table]
        select_cols = [key_col, 'sync_version', 'deleted_at', 'last_operation'] + [
            c for c in data_cols if c not in (key_col, 'sync_version', 'deleted_at')
        ]
        cols_sql = ', '.join(f'{c}' for c in select_cols)

        rows = db.execute(
            f"""
            SELECT {cols_sql}
            FROM {storage_table}
            WHERE user_id = ?
              AND sync_version > ?
              AND (device_id IS NULL OR device_id != ?)
            """,
            (user_id, cursor_position, device_id),
        ).fetchall()

        for row in rows:
            record_data = {col: row[col] for col in data_cols}
            changes.append(
                {
                    'table': table,
                    'key': row[key_col],
                    'sync_version': row['sync_version'],
                    'operation': row['last_operation']
                    or ('delete' if row['deleted_at'] is not None else 'update'),
                    'data': record_data,
                }
            )

    changes.sort(key=lambda c: c['sync_version'])
    return changes


def get_max_sync_version(db, user_id=None):
    """Return the highest sync_version across cloud sync records."""
    if user_id is not None:
        row = db.execute(
            'SELECT MAX(sync_version) AS max_ver FROM sync_server_versions WHERE user_id = ?',
            (user_id,),
        ).fetchone()
        return row['max_ver'] if row and row['max_ver'] is not None else 0

    row = db.execute('SELECT MAX(sync_version) AS max_ver FROM sync_server_versions').fetchone()
    return row['max_ver'] if row and row['max_ver'] is not None else 0


def _next_sync_version(db, table, key, device_id, user_id):
    """Allocate the next sync_version for a user-scoped record.

    Caller must hold an immediate write transaction before invoking this
    function. The MAX(sync_version) read followed by the write below can
    otherwise race under concurrent sync pushes, allocating duplicate versions
    and causing cursor-based pulls to silently miss changes.
    """
    if not db.in_transaction:
        raise RuntimeError('sync_version allocation requires an active write transaction')

    now = int(time.time())
    new_version = get_max_sync_version(db, user_id) + 1
    db.execute(
        """
        INSERT INTO sync_server_versions (
            table_name, record_key, user_id, sync_version, device_id, updated_at
        )
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
    """Read the current data for a record, used when rejecting a stale change."""
    key_col = TABLE_KEY_COLUMN[table]
    data_cols = TABLE_DATA_COLUMNS[table]
    storage_table = TABLE_STORAGE[table]

    if user_id is not None:
        row = db.execute(
            (
                f'SELECT {", ".join(data_cols)} FROM {storage_table} '
                f'WHERE user_id = ? AND {key_col} = ?'
            ),
            (user_id, key),
        ).fetchone()
    else:
        row = db.execute(
            f'SELECT {", ".join(data_cols)} FROM {storage_table} WHERE {key_col} = ?',
            (key,),
        ).fetchone()

    if row is None:
        return {}

    return {col: row[col] for col in data_cols}


def _apply_insert(db, table, user_id, key, data, device_id, new_version, now_ms):
    """Apply an insert operation to a cloud entity table."""
    if table == 'study_notes':
        db.execute(
            """
            INSERT INTO cloud_study_notes (
                user_id,
                study_uid,
                description,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, NULL, ?, ?, 'insert')
            ON CONFLICT(user_id, study_uid) DO UPDATE SET
                description = excluded.description,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                data.get('description', ''),
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )
        return

    if table == 'series_notes':
        study_uid, series_uid = _parse_series_record_key(key)
        db.execute(
            """
            INSERT INTO cloud_series_notes (
                user_id,
                record_key,
                study_uid,
                series_uid,
                description,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'insert')
            ON CONFLICT(user_id, record_key) DO UPDATE SET
                study_uid = excluded.study_uid,
                series_uid = excluded.series_uid,
                description = excluded.description,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                study_uid,
                series_uid,
                data.get('description', ''),
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )
        return

    if table == 'comments':
        created_at = data.get('created_at', now_ms)
        db.execute(
            """
            INSERT INTO cloud_comments (
                user_id,
                record_uuid,
                study_uid,
                series_uid,
                text,
                time,
                created_at,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'insert')
            ON CONFLICT(user_id, record_uuid) DO UPDATE SET
                study_uid = excluded.study_uid,
                series_uid = excluded.series_uid,
                text = excluded.text,
                time = excluded.time,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                data.get('study_uid', ''),
                data.get('series_uid'),
                data.get('text', ''),
                created_at,
                created_at,
                data.get('updated_at', created_at),
                device_id,
                new_version,
            ),
        )
        return

    if table == 'reports':
        added_at = data.get('added_at', now_ms)
        db.execute(
            """
            INSERT INTO cloud_reports (
                user_id,
                id,
                study_uid,
                name,
                type,
                size,
                content_hash,
                added_at,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'insert')
            ON CONFLICT(user_id, id) DO UPDATE SET
                study_uid = excluded.study_uid,
                name = excluded.name,
                type = excluded.type,
                size = excluded.size,
                content_hash = excluded.content_hash,
                added_at = excluded.added_at,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                data.get('study_uid', ''),
                data.get('name', ''),
                data.get('type', ''),
                data.get('size', 0),
                data.get('content_hash'),
                added_at,
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )


def _apply_update(db, table, user_id, key, data, device_id, new_version, now_ms):
    """Apply an update operation to a cloud entity table."""
    if table == 'study_notes':
        db.execute(
            """
            INSERT INTO cloud_study_notes (
                user_id,
                study_uid,
                description,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, NULL, ?, ?, 'update')
            ON CONFLICT(user_id, study_uid) DO UPDATE SET
                description = excluded.description,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                data.get('description', ''),
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )
        return

    if table == 'series_notes':
        study_uid, series_uid = _parse_series_record_key(key)
        db.execute(
            """
            INSERT INTO cloud_series_notes (
                user_id,
                record_key,
                study_uid,
                series_uid,
                description,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'update')
            ON CONFLICT(user_id, record_key) DO UPDATE SET
                study_uid = excluded.study_uid,
                series_uid = excluded.series_uid,
                description = excluded.description,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                study_uid,
                series_uid,
                data.get('description', ''),
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )
        return

    if table == 'comments':
        existing = _read_cloud_row(db, 'cloud_comments', user_id, 'record_uuid', key)
        created_at = data.get('created_at')
        if created_at is None and existing is not None:
            created_at = existing['created_at']
        if created_at is None:
            created_at = now_ms
        time_value = data.get('time', created_at)
        db.execute(
            """
            INSERT INTO cloud_comments (
                user_id,
                record_uuid,
                study_uid,
                series_uid,
                text,
                time,
                created_at,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'update')
            ON CONFLICT(user_id, record_uuid) DO UPDATE SET
                study_uid = excluded.study_uid,
                series_uid = excluded.series_uid,
                text = excluded.text,
                time = excluded.time,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                data.get('study_uid', existing['study_uid'] if existing else ''),
                data.get('series_uid', existing['series_uid'] if existing else None),
                data.get('text', existing['text'] if existing else ''),
                time_value,
                created_at,
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )
        return

    if table == 'reports':
        existing = _read_cloud_row(db, 'cloud_reports', user_id, 'id', key)
        added_at = data.get('added_at')
        if added_at is None and existing is not None:
            added_at = existing['added_at']
        if added_at is None:
            added_at = now_ms
        db.execute(
            """
            INSERT INTO cloud_reports (
                user_id,
                id,
                study_uid,
                name,
                type,
                size,
                content_hash,
                added_at,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'update')
            ON CONFLICT(user_id, id) DO UPDATE SET
                study_uid = excluded.study_uid,
                name = excluded.name,
                type = excluded.type,
                size = excluded.size,
                content_hash = excluded.content_hash,
                added_at = excluded.added_at,
                updated_at = excluded.updated_at,
                deleted_at = NULL,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                data.get('study_uid', existing['study_uid'] if existing else ''),
                data.get('name', existing['name'] if existing else ''),
                data.get('type', existing['type'] if existing else ''),
                data.get('size', existing['size'] if existing else 0),
                data.get('content_hash', existing['content_hash'] if existing else None),
                added_at,
                data.get('updated_at', now_ms),
                device_id,
                new_version,
            ),
        )


def _apply_delete(db, table, user_id, key, device_id, new_version, now_ms):
    """Apply a delete (tombstone) operation to a cloud entity table."""
    if table == 'study_notes':
        db.execute(
            """
            INSERT INTO cloud_study_notes (
                user_id,
                study_uid,
                description,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, '', ?, ?, ?, ?, 'delete')
            ON CONFLICT(user_id, study_uid) DO UPDATE SET
                description = '',
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (user_id, key, now_ms, now_ms, device_id, new_version),
        )
        return

    if table == 'series_notes':
        study_uid, series_uid = _parse_series_record_key(key)
        existing = _read_cloud_row(db, 'cloud_series_notes', user_id, 'record_key', key)
        db.execute(
            """
            INSERT INTO cloud_series_notes (
                user_id,
                record_key,
                study_uid,
                series_uid,
                description,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delete')
            ON CONFLICT(user_id, record_key) DO UPDATE SET
                study_uid = excluded.study_uid,
                series_uid = excluded.series_uid,
                description = excluded.description,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                existing['study_uid'] if existing else study_uid,
                existing['series_uid'] if existing else series_uid,
                existing['description'] if existing else '',
                now_ms,
                now_ms,
                device_id,
                new_version,
            ),
        )
        return

    if table == 'comments':
        existing = _read_cloud_row(db, 'cloud_comments', user_id, 'record_uuid', key)
        db.execute(
            """
            INSERT INTO cloud_comments (
                user_id,
                record_uuid,
                study_uid,
                series_uid,
                text,
                time,
                created_at,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delete')
            ON CONFLICT(user_id, record_uuid) DO UPDATE SET
                study_uid = excluded.study_uid,
                series_uid = excluded.series_uid,
                text = excluded.text,
                time = excluded.time,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                existing['study_uid'] if existing else '',
                existing['series_uid'] if existing else None,
                existing['text'] if existing else '',
                existing['time'] if existing else now_ms,
                existing['created_at'] if existing else now_ms,
                now_ms,
                now_ms,
                device_id,
                new_version,
            ),
        )
        return

    if table == 'reports':
        existing = _read_cloud_row(db, 'cloud_reports', user_id, 'id', key)
        db.execute(
            """
            INSERT INTO cloud_reports (
                user_id,
                id,
                study_uid,
                name,
                type,
                size,
                content_hash,
                added_at,
                updated_at,
                deleted_at,
                device_id,
                sync_version,
                last_operation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delete')
            ON CONFLICT(user_id, id) DO UPDATE SET
                study_uid = excluded.study_uid,
                name = excluded.name,
                type = excluded.type,
                size = excluded.size,
                content_hash = excluded.content_hash,
                added_at = excluded.added_at,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at,
                device_id = excluded.device_id,
                sync_version = excluded.sync_version,
                last_operation = excluded.last_operation
            """,
            (
                user_id,
                key,
                existing['study_uid'] if existing else '',
                existing['name'] if existing else '',
                existing['type'] if existing else '',
                existing['size'] if existing else 0,
                existing['content_hash'] if existing else None,
                existing['added_at'] if existing else now_ms,
                now_ms,
                now_ms,
                device_id,
                new_version,
            ),
        )


def _read_cloud_row(db, table_name, user_id, key_col, key):
    """Read a raw cloud-table row for upsert fallback behavior."""
    if table_name not in TABLE_STORAGE.values():
        raise ValueError(f'Unsupported cloud table: {table_name}')
    if key_col not in {'study_uid', 'record_key', 'record_uuid', 'id'}:
        raise ValueError(f'Unsupported cloud table key column: {key_col}')
    return db.execute(
        f'SELECT * FROM {table_name} WHERE user_id = ? AND {key_col} = ?',
        (user_id, key),
    ).fetchone()
