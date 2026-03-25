"""
Notes database (SQLite) initialization, connection helpers, and schema.

Copyright (c) 2026 Divergent Health Technologies
"""

import json
import os
import re
import sqlite3
import tempfile
import threading

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


def configure(app_root_path):
    """Set database paths based on app root. Called once from create_app()."""
    global DATA_DIR, DB_PATH, REPORTS_DIR, SETTINGS_PATH

    DATA_DIR = os.environ.get(
        'DICOM_VIEWER_DATA_DIR',
        os.path.join(app_root_path, 'data')
    )
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
        logger.warning("Failed to read settings file %s: %s", SETTINGS_PATH, exc)
    return {}


def _save_settings_unlocked(settings):
    """Persist settings atomically (caller must hold SETTINGS_LOCK)."""
    _ensure_data_dirs()
    fd, temp_path = tempfile.mkstemp(
        prefix='settings-',
        suffix='.tmp',
        dir=DATA_DIR
    )
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
        conn.execute("PRAGMA journal_mode=WAL")
        g.db = conn
    return g.db


def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    _ensure_data_dirs()
    db = sqlite3.connect(DB_PATH)
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
        db.commit()
    finally:
        db.close()


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
