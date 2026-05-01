"""
Notes database (SQLite) initialization, connection helpers, and schema.

Copyright (c) 2026 Divergent Health Technologies
"""

import json
import logging
import os
import re
import sqlite3
import tempfile
import threading
import uuid

from flask import g

# Notes database storage (SQLite + report files)
# These are initialized by create_app() and should be treated as read-only after that.
DATA_DIR = None
DB_PATH = None
REPORTS_DIR = None
SETTINGS_PATH = None

REPORT_TYPE_MAP = {
    'pdf': ('pdf', 'pdf', 'application/pdf'),
    'png': ('png', 'png', 'image/png'),
    'jpg': ('jpg', 'jpg', 'image/jpeg'),
    'jpeg': ('jpg', 'jpg', 'image/jpeg'),
}

# Reverse lookup: MIME type -> (canonical_type, extension, mime)
MIME_TO_TYPE = {
    'application/pdf': ('pdf', 'pdf', 'application/pdf'),
    'image/png': ('png', 'png', 'image/png'),
    'image/jpeg': ('jpg', 'jpg', 'image/jpeg'),
}

# Maximum number of study UIDs accepted in a single batch request
MAX_BATCH_STUDY_UIDS = 200

# Comment timestamps must be within this range of server time
MAX_TIMESTAMP_DRIFT_MS = 365 * 24 * 60 * 60 * 1000  # 1 year

# Settings/config synchronization
SETTINGS_LOCK = threading.Lock()
_SQLITE_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
_SQLITE_COLUMN_DEFINITION_RE = re.compile(r"^[A-Z]+(?: [A-Z]+)*(?: DEFAULT (?:''|[0-9]+))?$")


def configure(app_root_path):
    """Set database paths based on app root. Called once from create_app()."""
    global DATA_DIR, DB_PATH, REPORTS_DIR, SETTINGS_PATH

    DATA_DIR = os.environ.get('DICOM_VIEWER_DATA_DIR', os.path.join(app_root_path, 'data'))
    DB_PATH = os.path.join(DATA_DIR, 'viewer.db')
    REPORTS_DIR = os.path.join(DATA_DIR, 'reports')
    SETTINGS_PATH = os.path.join(DATA_DIR, 'settings.json')


def _ensure_data_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(REPORTS_DIR, exist_ok=True)


def _load_settings_unlocked(logger):
    """Load persisted settings from disk (caller must hold SETTINGS_LOCK)."""
    if not os.path.exists(SETTINGS_PATH):
        return {}

    try:
        with open(SETTINGS_PATH, 'r', encoding='utf-8') as f:
            payload = json.load(f)
            if isinstance(payload, dict):
                return payload
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning('Failed to read settings file %s: %s', SETTINGS_PATH, exc)
    return {}


def _save_settings_unlocked(settings):
    """Persist settings atomically (caller must hold SETTINGS_LOCK)."""
    _ensure_data_dirs()
    fd, temp_path = tempfile.mkstemp(prefix='settings-', suffix='.tmp', dir=DATA_DIR)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, SETTINGS_PATH)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def load_settings(logger):
    """Load persisted settings from disk."""
    with SETTINGS_LOCK:
        return _load_settings_unlocked(logger)


def save_settings(settings):
    """Persist settings to disk."""
    with SETTINGS_LOCK:
        _save_settings_unlocked(settings)


def save_library_folder_setting(folder_raw, logger):
    """Persist library folder setting atomically under one lock."""
    with SETTINGS_LOCK:
        settings = _load_settings_unlocked(logger)
        settings['library_folder'] = folder_raw
        _save_settings_unlocked(settings)


def get_db():
    if 'db' not in g:
        _ensure_data_dirs()
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        g.db = conn
    return g.db


def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    _ensure_data_dirs()
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS study_notes (
                study_uid TEXT PRIMARY KEY,
                description TEXT,
                updated_at INTEGER
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS series_notes (
                study_uid TEXT NOT NULL,
                series_uid TEXT NOT NULL,
                description TEXT,
                updated_at INTEGER,
                PRIMARY KEY (study_uid, series_uid)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                study_uid TEXT NOT NULL,
                series_uid TEXT,
                text TEXT NOT NULL,
                time INTEGER NOT NULL,
                UNIQUE(study_uid, series_uid, text, time)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                study_uid TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                size INTEGER NOT NULL,
                file_path TEXT,
                added_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        # Idempotency index for migration -- safe to run on existing DBs
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_dedup
            ON comments(study_uid, series_uid, text, time)
            """
        )

        # -- Auth tables (cloud mode) --

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                device_name TEXT NOT NULL,
                platform TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_devices_user_id
            ON devices(user_id)
            """
        )

        # -- Cloud sync entity tables --

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS cloud_study_notes (
                user_id INTEGER NOT NULL,
                study_uid TEXT NOT NULL,
                description TEXT,
                updated_at INTEGER,
                deleted_at INTEGER,
                device_id TEXT,
                sync_version INTEGER NOT NULL DEFAULT 0,
                last_operation TEXT NOT NULL DEFAULT 'update',
                PRIMARY KEY (user_id, study_uid),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cloud_study_notes_study_uid
            ON cloud_study_notes(study_uid)
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS cloud_series_notes (
                user_id INTEGER NOT NULL,
                record_key TEXT NOT NULL,
                study_uid TEXT NOT NULL,
                series_uid TEXT NOT NULL,
                description TEXT,
                updated_at INTEGER,
                deleted_at INTEGER,
                device_id TEXT,
                sync_version INTEGER NOT NULL DEFAULT 0,
                last_operation TEXT NOT NULL DEFAULT 'update',
                PRIMARY KEY (user_id, record_key),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cloud_series_notes_study_uid
            ON cloud_series_notes(user_id, study_uid, series_uid)
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS cloud_comments (
                user_id INTEGER NOT NULL,
                record_uuid TEXT NOT NULL,
                study_uid TEXT NOT NULL,
                series_uid TEXT,
                text TEXT NOT NULL,
                time INTEGER NOT NULL,
                created_at INTEGER,
                updated_at INTEGER,
                deleted_at INTEGER,
                device_id TEXT,
                sync_version INTEGER NOT NULL DEFAULT 0,
                last_operation TEXT NOT NULL DEFAULT 'insert',
                PRIMARY KEY (user_id, record_uuid),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cloud_comments_study_uid
            ON cloud_comments(user_id, study_uid)
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS cloud_reports (
                user_id INTEGER NOT NULL,
                id TEXT NOT NULL,
                study_uid TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                size INTEGER NOT NULL,
                content_hash TEXT,
                added_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted_at INTEGER,
                device_id TEXT,
                sync_version INTEGER NOT NULL DEFAULT 0,
                last_operation TEXT NOT NULL DEFAULT 'insert',
                PRIMARY KEY (user_id, id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cloud_reports_study_uid
            ON cloud_reports(user_id, study_uid)
            """
        )

        # -- Sync infrastructure tables --

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation_uuid TEXT NOT NULL,
                table_name TEXT NOT NULL,
                record_key TEXT NOT NULL,
                operation TEXT NOT NULL,
                base_sync_version INTEGER,
                created_at INTEGER NOT NULL,
                synced_at INTEGER,
                attempts INTEGER DEFAULT 0,
                last_error TEXT
            )
            """
        )
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_operation_uuid
            ON sync_outbox(operation_uuid)
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_outbox_pending
            ON sync_outbox(synced_at) WHERE synced_at IS NULL
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at INTEGER
            )
            """
        )

        # -- Sync columns on entity tables (idempotent ALTER TABLE) --

        _add_column(db, 'comments', 'record_uuid', 'TEXT')
        _add_column(db, 'comments', 'created_at', 'INTEGER')
        _add_column(db, 'comments', 'updated_at', 'INTEGER')
        _add_column(db, 'comments', 'deleted_at', 'INTEGER')
        _add_column(db, 'comments', 'device_id', 'TEXT')
        _add_column(db, 'comments', 'sync_version', 'INTEGER DEFAULT 0')

        _add_column(db, 'study_notes', 'deleted_at', 'INTEGER')
        _add_column(db, 'study_notes', 'device_id', 'TEXT')
        _add_column(db, 'study_notes', 'sync_version', 'INTEGER DEFAULT 0')

        _add_column(db, 'series_notes', 'deleted_at', 'INTEGER')
        _add_column(db, 'series_notes', 'device_id', 'TEXT')
        _add_column(db, 'series_notes', 'sync_version', 'INTEGER DEFAULT 0')

        _add_column(db, 'reports', 'content_hash', 'TEXT')
        _add_column(db, 'reports', 'deleted_at', 'INTEGER')
        _add_column(db, 'reports', 'device_id', 'TEXT')
        _add_column(db, 'reports', 'sync_version', 'INTEGER DEFAULT 0')

        # -- Server-side sync tables --

        # Version tracking per record per user (monotonic counter for cursor watermarks)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_server_versions (
                table_name TEXT NOT NULL,
                record_key TEXT NOT NULL,
                user_id TEXT NOT NULL,
                sync_version INTEGER NOT NULL DEFAULT 1,
                device_id TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (table_name, record_key, user_id)
            )
            """
        )

        # Idempotent migration: add user_id column if table already exists
        # without it (pre-isolation schema). Safe no-op on fresh databases.
        _add_column(db, 'sync_server_versions', 'user_id', "TEXT NOT NULL DEFAULT ''")
        _ensure_sync_server_versions_user_pk(db)

        # Processed operations for idempotent dedup (scoped by user_id)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_processed_ops (
                operation_uuid TEXT PRIMARY KEY,
                table_name TEXT NOT NULL,
                record_key TEXT NOT NULL,
                user_id TEXT NOT NULL DEFAULT '',
                sync_version INTEGER NOT NULL,
                processed_at INTEGER NOT NULL
            )
            """
        )

        # Idempotent migration: add user_id column to existing sync_processed_ops
        _add_column(db, 'sync_processed_ops', 'user_id', "TEXT NOT NULL DEFAULT ''")

        # Opaque cursor tracking (token -> position mapping)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_cursors (
                cursor_token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                device_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )

        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sync_cursors_expires
            ON sync_cursors(expires_at)
            """
        )

        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sync_processed_ops_table_key
            ON sync_processed_ops(table_name, record_key)
            """
        )

        # -- HIPAA audit log --

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                user_id TEXT,
                device_id TEXT,
                session_token_hash TEXT,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                status_code INTEGER,
                study_uid TEXT,
                ip_address TEXT,
                user_agent TEXT
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
            ON audit_log(timestamp)
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_audit_log_user
            ON audit_log(user_id)
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_audit_log_study
            ON audit_log(study_uid)
            """
        )

        # -- Backfill existing comments with UUIDs --
        db.execute(
            """
            UPDATE comments SET
                record_uuid = (
                    lower(hex(randomblob(4))) || '-' ||
                    lower(hex(randomblob(2))) || '-' ||
                    '4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
                    substr('89ab', abs(random()) % 4 + 1, 1) ||
                    substr(lower(hex(randomblob(2))), 2) || '-' ||
                    lower(hex(randomblob(6)))
                ),
                created_at = time,
                updated_at = time
            WHERE record_uuid IS NULL
            """
        )

        duplicate_rows = db.execute(
            """
            SELECT record_uuid
            FROM comments
            WHERE record_uuid IS NOT NULL
            GROUP BY record_uuid
            HAVING COUNT(*) > 1
            """
        ).fetchall()
        for duplicate in duplicate_rows:
            rows = db.execute(
                'SELECT id FROM comments WHERE record_uuid = ? ORDER BY id ASC',
                (duplicate['record_uuid'],),
            ).fetchall()
            for row in rows[1:]:
                db.execute(
                    'UPDATE comments SET record_uuid = ? WHERE id = ?',
                    (str(uuid.uuid4()), row['id']),
                )

        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_record_uuid
            ON comments(record_uuid)
            WHERE record_uuid IS NOT NULL
            """
        )

        db.commit()
    finally:
        db.close()


def _add_column(db, table, column, col_type):
    """Add a column to a table if it does not already exist. Idempotent."""
    if not _SQLITE_IDENTIFIER_RE.fullmatch(table):
        raise ValueError(f'Invalid SQLite table identifier: {table}')
    if not _SQLITE_IDENTIFIER_RE.fullmatch(column):
        raise ValueError(f'Invalid SQLite column identifier: {column}')

    column_definition = ' '.join(str(col_type or '').split())
    if not _SQLITE_COLUMN_DEFINITION_RE.fullmatch(column_definition):
        raise ValueError(f'Invalid SQLite column definition: {col_type}')

    try:
        db.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {column_definition}')
    except sqlite3.OperationalError as exc:
        # "duplicate column name" means it already exists -- safe to ignore
        if 'duplicate column' not in str(exc).lower():
            logging.getLogger(__name__).warning(
                'Failed to add column %s.%s: %s', table, column, exc
            )


def _ensure_sync_server_versions_user_pk(db):
    """Rebuild legacy sync version tables that were not scoped by user_id."""
    table_info = db.execute("PRAGMA table_info('sync_server_versions')").fetchall()
    pk_columns = [
        row['name'] for row in sorted(table_info, key=lambda row: row['pk']) if row['pk']
    ]
    if pk_columns == ['table_name', 'record_key', 'user_id']:
        return

    db.execute('DROP TABLE IF EXISTS sync_server_versions_new')
    db.execute(
        """
        CREATE TABLE sync_server_versions_new (
            table_name TEXT NOT NULL,
            record_key TEXT NOT NULL,
            user_id TEXT NOT NULL,
            sync_version INTEGER NOT NULL DEFAULT 1,
            device_id TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (table_name, record_key, user_id)
        )
        """
    )
    db.execute(
        """
        INSERT OR REPLACE INTO sync_server_versions_new (
            table_name, record_key, user_id, sync_version, device_id, updated_at
        )
        SELECT table_name, record_key, user_id, sync_version, device_id, updated_at
        FROM sync_server_versions
        ORDER BY sync_version ASC, updated_at ASC
        """
    )
    db.execute('DROP TABLE sync_server_versions')
    db.execute('ALTER TABLE sync_server_versions_new RENAME TO sync_server_versions')


def parse_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def sanitize_report_id(value):
    if not value:
        return None
    value = value.strip()
    if not re.match(r'^[a-zA-Z0-9_-]{8,64}$', value):
        return None
    return value


def resolve_report_type(filename, provided_type, mimetype):
    if provided_type:
        provided = provided_type.lower().strip()
        if provided in REPORT_TYPE_MAP:
            report_type, ext, mime = REPORT_TYPE_MAP[provided]
            return report_type, ext, mime

    if filename:
        ext = os.path.splitext(filename)[1].lower().lstrip('.')
        if ext in REPORT_TYPE_MAP:
            report_type, resolved_ext, mime = REPORT_TYPE_MAP[ext]
            return report_type, resolved_ext, mime

    if mimetype and mimetype in MIME_TO_TYPE:
        return MIME_TO_TYPE[mimetype]

    return None, None, None
