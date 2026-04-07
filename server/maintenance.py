"""
Backup, tombstone purge, and report blob garbage collection.

These operations are intentionally explicit -- none run automatically on
startup.  Callers (the maintenance API endpoints or a cron-like scheduler)
invoke them when appropriate.

Copyright (c) 2026 Divergent Health Technologies
"""

import logging
import os
import sqlite3
import time

from server import db as db_module

logger = logging.getLogger(__name__)

# Default number of backups to retain
DEFAULT_MAX_BACKUPS = 10

# Default tombstone retention period in days
DEFAULT_TOMBSTONE_RETENTION_DAYS = 30


# ---------------------------------------------------------------------------
# SQLite backup
# ---------------------------------------------------------------------------


def _backups_dir():
    """Return the backups directory path, creating it if needed."""
    backups = os.path.join(db_module.DATA_DIR, 'backups')
    os.makedirs(backups, exist_ok=True)
    return backups


def backup_database(max_backups=DEFAULT_MAX_BACKUPS):
    """Create a timestamped SQLite backup using the online backup API.

    Safe to call while the server is handling requests -- the backup API
    acquires a shared lock that does not block readers or writers using WAL
    mode.

    Returns the absolute path to the new backup file.
    """
    backups_dir = _backups_dir()
    timestamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    backup_filename = f'{timestamp}.db'
    backup_path = os.path.join(backups_dir, backup_filename)

    # Open a dedicated read connection to the live database.  We do NOT use
    # the per-request connection from Flask's g because the backup API needs
    # its own connection lifecycle.
    source = sqlite3.connect(db_module.DB_PATH, timeout=10)
    try:
        dest = sqlite3.connect(backup_path)
        try:
            source.backup(dest)
            logger.info('Database backed up to %s', backup_path)
        finally:
            dest.close()
    finally:
        source.close()

    # Prune old backups, keeping the most recent *max_backups*.
    _prune_old_backups(backups_dir, max_backups)

    return backup_path


def _prune_old_backups(backups_dir, max_backups):
    """Delete the oldest backups beyond *max_backups*."""
    existing = sorted(
        (f for f in os.listdir(backups_dir) if f.endswith('.db')),
        reverse=True,  # newest first (lexicographic on YYYYMMDD-HHMMSS)
    )
    for old_file in existing[max_backups:]:
        old_path = os.path.join(backups_dir, old_file)
        try:
            os.remove(old_path)
            logger.info('Pruned old backup %s', old_path)
        except OSError as exc:
            logger.warning('Failed to prune backup %s: %s', old_path, exc)


def list_backups():
    """Return a list of backup filenames sorted newest-first."""
    backups_dir = _backups_dir()
    return sorted(
        (f for f in os.listdir(backups_dir) if f.endswith('.db')),
        reverse=True,
    )


def restore_database(backup_path):
    """Restore the database from a backup file.

    The caller is responsible for ensuring no active database connections
    exist before calling this (e.g. by shutting down the request loop).
    In practice this is invoked from the maintenance endpoint which closes
    the per-request connection first.

    Raises FileNotFoundError if *backup_path* does not exist.
    Raises ValueError if the file is not a valid SQLite database.
    """
    if not os.path.isfile(backup_path):
        raise FileNotFoundError(f'Backup file not found: {backup_path}')

    # Quick validation: open the backup and run an integrity check.
    try:
        check_conn = sqlite3.connect(backup_path)
        result = check_conn.execute('PRAGMA integrity_check').fetchone()
        check_conn.close()
        if result[0] != 'ok':
            raise ValueError(f'Backup integrity check failed: {result[0]}')
    except sqlite3.DatabaseError as exc:
        raise ValueError(f'Not a valid SQLite database: {exc}') from exc

    # Use the backup API in reverse: backup *from* the backup file *to* the
    # live database path.  This overwrites the live DB atomically.
    source = sqlite3.connect(backup_path, timeout=10)
    try:
        dest = sqlite3.connect(db_module.DB_PATH)
        try:
            source.backup(dest)
            logger.info('Database restored from %s', backup_path)
        finally:
            dest.close()
    finally:
        source.close()


# ---------------------------------------------------------------------------
# Tombstone purge
# ---------------------------------------------------------------------------


def purge_tombstones(days=DEFAULT_TOMBSTONE_RETENTION_DAYS, syncing=False):
    """Hard-delete tombstoned records older than *days*.

    Parameters:
        days: Only purge records whose deleted_at timestamp is older than
              this many days.
        syncing: If True, only purge records that have been confirmed synced
                 (sync_version > 0).  In non-syncing (personal/desktop) mode,
                 purge based on age alone.

    Returns a dict mapping table names to the number of rows purged.

    NOTE: study_notes and series_notes are never tombstoned per the frozen
    invariant (they persist when empty), so they are excluded.
    """
    cutoff_ms = int((time.time() - days * 86400) * 1000)
    counts = {}

    conn = sqlite3.connect(db_module.DB_PATH, timeout=10)
    try:
        for table in ('comments', 'reports'):
            conditions = [
                'deleted_at IS NOT NULL',
                'deleted_at < ?',
            ]
            params = [cutoff_ms]

            if syncing:
                conditions.append('sync_version > 0')

            where = ' AND '.join(conditions)
            cursor = conn.execute(
                f'DELETE FROM {table} WHERE {where}',  # noqa: S608 -- table name from static list
                params,
            )
            counts[table] = cursor.rowcount

        conn.commit()
    finally:
        conn.close()

    logger.info(
        'Tombstone purge complete (cutoff=%d, syncing=%s): %s',
        cutoff_ms,
        syncing,
        counts,
    )
    return counts


# ---------------------------------------------------------------------------
# Report blob garbage collection
# ---------------------------------------------------------------------------


def gc_report_blobs(purge_days=DEFAULT_TOMBSTONE_RETENTION_DAYS):
    """Remove orphaned report files from disk.

    A file is considered an orphan if:
    1. No row in the reports table references its path, OR
    2. The corresponding report row is tombstoned AND older than purge_days.

    Returns a dict with 'deleted_count' and 'bytes_reclaimed'.
    """
    reports_dir = db_module.REPORTS_DIR
    if not os.path.isdir(reports_dir):
        return {'deleted_count': 0, 'bytes_reclaimed': 0}

    cutoff_ms = int((time.time() - purge_days * 86400) * 1000)

    # Build a set of file paths that the database still references and needs.
    conn = sqlite3.connect(db_module.DB_PATH, timeout=10)
    try:
        # Paths for live (non-tombstoned) reports
        live_rows = conn.execute(
            'SELECT file_path FROM reports WHERE file_path IS NOT NULL AND deleted_at IS NULL'
        ).fetchall()
        live_paths = {row[0] for row in live_rows}

        # Paths for recently-tombstoned reports (not yet eligible for purge)
        recent_tombstoned = conn.execute(
            (
                'SELECT file_path FROM reports '
                'WHERE file_path IS NOT NULL '
                'AND deleted_at IS NOT NULL '
                'AND deleted_at >= ?'
            ),
            (cutoff_ms,),
        ).fetchall()
        recent_paths = {row[0] for row in recent_tombstoned}
    finally:
        conn.close()

    # All paths that should be kept
    keep_paths = live_paths | recent_paths

    deleted_count = 0
    bytes_reclaimed = 0

    for filename in os.listdir(reports_dir):
        # Skip temp files (ongoing uploads)
        if filename.endswith('.tmp'):
            continue

        file_path = os.path.join(reports_dir, filename)
        if not os.path.isfile(file_path):
            continue

        if file_path in keep_paths:
            continue

        # This file is either orphaned or belongs to a purge-eligible tombstone
        try:
            file_size = os.path.getsize(file_path)
            os.remove(file_path)
            deleted_count += 1
            bytes_reclaimed += file_size
            logger.info('GC removed orphaned report file: %s (%d bytes)', file_path, file_size)
        except OSError as exc:
            logger.warning('GC failed to remove %s: %s', file_path, exc)

    logger.info(
        'Report blob GC complete: %d files deleted, %d bytes reclaimed',
        deleted_count,
        bytes_reclaimed,
    )
    return {'deleted_count': deleted_count, 'bytes_reclaimed': bytes_reclaimed}


# ---------------------------------------------------------------------------
# Status / diagnostics
# ---------------------------------------------------------------------------


def get_maintenance_status():
    """Gather maintenance-related diagnostics.

    Returns a dict with database size, tombstone counts, orphan count,
    last backup timestamp, and backup count.
    """
    status = {}

    # Database size
    if os.path.isfile(db_module.DB_PATH):
        status['database_size_bytes'] = os.path.getsize(db_module.DB_PATH)
    else:
        status['database_size_bytes'] = 0

    # Tombstone counts per table
    tombstones = {}
    conn = sqlite3.connect(db_module.DB_PATH, timeout=10)
    try:
        for table in ('comments', 'reports'):
            row = conn.execute(
                f'SELECT COUNT(*) FROM {table} WHERE deleted_at IS NOT NULL'  # noqa: S608
            ).fetchone()
            tombstones[table] = row[0] if row else 0
    finally:
        conn.close()
    status['tombstones'] = tombstones

    # Orphaned report files
    orphan_count = _count_orphaned_report_files()
    status['orphaned_report_files'] = orphan_count

    # Backup info
    backups = list_backups()
    status['backup_count'] = len(backups)
    if backups:
        # Newest backup filename is YYYYMMDD-HHMMSS.db
        status['last_backup'] = backups[0].replace('.db', '')
    else:
        status['last_backup'] = None

    return status


def _count_orphaned_report_files():
    """Count report files on disk that have no corresponding live DB record."""
    reports_dir = db_module.REPORTS_DIR
    if not os.path.isdir(reports_dir):
        return 0

    conn = sqlite3.connect(db_module.DB_PATH, timeout=10)
    try:
        rows = conn.execute(
            'SELECT file_path FROM reports WHERE file_path IS NOT NULL AND deleted_at IS NULL'
        ).fetchall()
        live_paths = {row[0] for row in rows}
    finally:
        conn.close()

    count = 0
    for filename in os.listdir(reports_dir):
        if filename.endswith('.tmp'):
            continue
        file_path = os.path.join(reports_dir, filename)
        if os.path.isfile(file_path) and file_path not in live_paths:
            count += 1

    return count


# ---------------------------------------------------------------------------
# Startup maintenance (lightweight, safe to run on every boot)
# ---------------------------------------------------------------------------


def run_startup_maintenance(app):
    """Run lightweight cleanup tasks on server startup.

    Only includes safe, fast operations:
    - Clean up expired sync cursors
    - (Future) Clean up expired audit log entries

    Does NOT run tombstone purge or blob GC -- those are destructive and
    must be triggered explicitly.
    """
    conn = sqlite3.connect(db_module.DB_PATH, timeout=10)
    try:
        # Clean up expired sync cursors
        now = int(time.time())
        cursor = conn.execute('DELETE FROM sync_cursors WHERE expires_at < ?', (now,))
        expired_cursors = cursor.rowcount
        if expired_cursors > 0:
            app.logger.info(
                'Startup maintenance: cleaned up %d expired sync cursors',
                expired_cursors,
            )

        conn.commit()
    except sqlite3.OperationalError as exc:
        # Table might not exist yet on first run; that's fine
        app.logger.debug('Startup maintenance skipped (table may not exist): %s', exc)
    finally:
        conn.close()
