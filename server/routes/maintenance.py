"""
Maintenance API endpoints: backup, purge, GC, status.

Protected by session token in personal mode and JWT auth in cloud mode.
These routes are under /api/maintenance/ which is added to the PHI route
prefixes so the existing session_token_check middleware covers them.

Copyright (c) 2026 Divergent Health Technologies
"""

import os

from flask import Blueprint, current_app, g, jsonify, request

from server import db as db_module
from server.maintenance import (
    DEFAULT_MAX_BACKUPS,
    DEFAULT_TOMBSTONE_RETENTION_DAYS,
    backup_database,
    gc_report_blobs,
    get_maintenance_status,
    list_backups,
    purge_tombstones,
    restore_database,
)

maintenance_bp = Blueprint("maintenance", __name__)


@maintenance_bp.route("/api/maintenance/backup", methods=["POST"])
def trigger_backup():
    """Create a timestamped database backup.

    Optional JSON body: { "max_backups": 10 }
    Returns: { "backup_path": "...", "backups": [...] }
    """
    data = request.get_json(silent=True) or {}
    max_backups = data.get("max_backups", DEFAULT_MAX_BACKUPS)

    if not isinstance(max_backups, int) or max_backups < 1:
        return jsonify({"error": "max_backups must be a positive integer"}), 400

    try:
        backup_path = backup_database(max_backups=max_backups)
    except Exception as exc:
        current_app.logger.error("Backup failed: %s", exc)
        return jsonify({"error": f"Backup failed: {exc}"}), 500

    return jsonify({
        "backup_path": backup_path,
        "backups": list_backups(),
    })


@maintenance_bp.route("/api/maintenance/restore", methods=["POST"])
def trigger_restore():
    """Restore the database from a named backup.

    JSON body: { "backup_name": "20260325-120000.db" }
    Returns: { "restored": true, "backup_name": "..." }
    """
    data = request.get_json(silent=True) or {}
    backup_name = (data.get("backup_name") or "").strip()

    if not backup_name:
        return jsonify({"error": "backup_name is required"}), 400

    # Prevent path traversal: only allow filenames, no slashes or ..
    if "/" in backup_name or "\\" in backup_name or ".." in backup_name:
        return jsonify({"error": "Invalid backup name"}), 400

    backups_dir = os.path.join(db_module.DATA_DIR, "backups")
    backup_path = os.path.join(backups_dir, backup_name)

    # Close the per-request DB connection before restoring
    db_conn = g.pop("db", None)
    if db_conn:
        db_conn.close()

    try:
        restore_database(backup_path)
    except FileNotFoundError:
        return jsonify({"error": "Backup file not found"}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        current_app.logger.error("Restore failed: %s", exc)
        return jsonify({"error": f"Restore failed: {exc}"}), 500

    return jsonify({
        "restored": True,
        "backup_name": backup_name,
    })


@maintenance_bp.route("/api/maintenance/purge", methods=["POST"])
def trigger_purge():
    """Purge tombstoned records older than N days.

    Optional JSON body: { "days": 30, "syncing": false }
    Returns: { "purged": { "comments": N, "reports": N } }
    """
    data = request.get_json(silent=True) or {}
    days = data.get("days", DEFAULT_TOMBSTONE_RETENTION_DAYS)
    syncing = bool(data.get("syncing", False))

    if not isinstance(days, (int, float)) or days < 0:
        return jsonify({"error": "days must be a non-negative number"}), 400

    try:
        counts = purge_tombstones(days=int(days), syncing=syncing)
    except Exception as exc:
        current_app.logger.error("Purge failed: %s", exc)
        return jsonify({"error": f"Purge failed: {exc}"}), 500

    return jsonify({"purged": counts})


@maintenance_bp.route("/api/maintenance/gc", methods=["POST"])
def trigger_gc():
    """Run report blob garbage collection.

    Optional JSON body: { "purge_days": 30 }
    Returns: { "deleted_count": N, "bytes_reclaimed": N }
    """
    data = request.get_json(silent=True) or {}
    purge_days = data.get("purge_days", DEFAULT_TOMBSTONE_RETENTION_DAYS)

    if not isinstance(purge_days, (int, float)) or purge_days < 0:
        return jsonify({"error": "purge_days must be a non-negative number"}), 400

    try:
        result = gc_report_blobs(purge_days=int(purge_days))
    except Exception as exc:
        current_app.logger.error("GC failed: %s", exc)
        return jsonify({"error": f"GC failed: {exc}"}), 500

    return jsonify(result)


@maintenance_bp.route("/api/maintenance/status", methods=["GET"])
def maintenance_status():
    """Return maintenance diagnostics.

    Returns: {
        "database_size_bytes": N,
        "tombstones": { "comments": N, "reports": N },
        "orphaned_report_files": N,
        "last_backup": "YYYYMMDD-HHMMSS" or null,
        "backup_count": N
    }
    """
    try:
        status = get_maintenance_status()
    except Exception as exc:
        current_app.logger.error("Status check failed: %s", exc)
        return jsonify({"error": f"Status check failed: {exc}"}), 500

    return jsonify(status)
