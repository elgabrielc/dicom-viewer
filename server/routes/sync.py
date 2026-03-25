"""
POST /api/sync endpoint and report file sync endpoints.

Implements the full sync protocol from SYNC-CONTRACT-V1.md:
- Push: process client changes with idempotent dedup and optimistic concurrency
- Pull: compute remote changes since the client's cursor
- Cursor: issue opaque delta cursors with 7-day TTL
- Report files: upload/download report blobs with content-hash dedup

Copyright (c) 2026 Divergent Health Technologies
"""

import hashlib
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

from flask import Blueprint, g, jsonify, request, send_file

from server import db as db_module
from server.db import get_db, sanitize_report_id, REPORT_TYPE_MAP
from server.sync.cursor import (
    CursorExpiredError,
    CursorInvalidError,
    cleanup_expired_cursors,
    issue_cursor,
    validate_cursor,
)
from server.sync.delta import (
    compute_remote_changes,
    get_max_sync_version,
    process_change,
)

logger = logging.getLogger(__name__)

sync_bp = Blueprint("sync", __name__)

# Directory for content-addressed report blob storage (separate from local reports)
SYNC_REPORTS_SUBDIR = "sync-reports"


def _get_sync_reports_dir():
    """Return the path to the sync-reports directory, creating it if needed."""
    sync_dir = os.path.join(db_module.DATA_DIR, SYNC_REPORTS_SUBDIR)
    os.makedirs(sync_dir, exist_ok=True)
    return sync_dir


def _require_auth():
    """Validate that the request has an authenticated user.

    Expects auth middleware to set g.user_id before this runs.
    Returns (user_id, None) on success or (None, error_response) on failure.
    """
    # TODO: Auth middleware (owned by auth-devices lane) sets g.user_id from
    # the JWT bearer token. Until that middleware is merged, this placeholder
    # checks for g.user_id and returns 401 if missing.
    user_id = getattr(g, "user_id", None)
    if user_id is None:
        return None, (jsonify({"error": "unauthorized"}), 401)
    return user_id, None


def _validate_device(db, user_id, device_id):
    """Validate that device_id belongs to the authenticated user.

    Returns True if valid, False otherwise.
    """
    # TODO: Once the auth-devices lane merges the devices table, validate
    # device_id ownership here. For now, accept any non-empty device_id
    # since we cannot query the devices table yet.
    if not device_id or not isinstance(device_id, str) or not device_id.strip():
        return False
    return True


@sync_bp.route("/api/sync", methods=["POST"])
def sync():
    """Main sync endpoint per SYNC-CONTRACT-V1.md."""
    # -- Authentication --
    user_id, error = _require_auth()
    if error:
        return error

    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "invalid_request"}), 400

    device_id = body.get("device_id")
    delta_cursor = body.get("delta_cursor")
    changes = body.get("changes", [])

    # -- Device validation --
    db = get_db()
    if not _validate_device(db, user_id, device_id):
        return jsonify({"error": "device_not_registered"}), 403

    # -- Cursor validation --
    cursor_position = 0  # default: full enumeration

    if delta_cursor is not None:
        try:
            cursor_position = validate_cursor(db, delta_cursor, user_id)
        except CursorExpiredError:
            db.commit()  # persist cursor cleanup
            return jsonify({"error": "cursor_expired", "hint": "full_resync"}), 410
        except CursorInvalidError:
            return jsonify({"error": "cursor_expired", "hint": "full_resync"}), 410

    # -- Process client changes --
    accepted = []
    rejected = []

    if isinstance(changes, list):
        for change in changes:
            if not isinstance(change, dict):
                continue

            # Validate required fields
            required_fields = ("operation_uuid", "table", "key", "operation")
            if not all(change.get(f) for f in required_fields):
                continue

            result = process_change(db, user_id, device_id, change)

            if result["status"] == "accepted":
                accepted.append({
                    "operation_uuid": result["operation_uuid"],
                    "key": result["key"],
                    "sync_version": result["sync_version"],
                })
            else:
                entry = {
                    "operation_uuid": result["operation_uuid"],
                    "key": result["key"],
                    "reason": result["reason"],
                    "current_sync_version": result["current_sync_version"],
                    "current_data": result["current_data"],
                }
                rejected.append(entry)

    # -- Compute remote changes --
    remote_changes = compute_remote_changes(db, user_id, device_id, cursor_position)

    # -- Issue new cursor at current max sync_version --
    new_position = get_max_sync_version(db)
    new_cursor = issue_cursor(db, user_id, device_id, new_position)

    # Opportunistically clean up expired cursors (cheap, bounded work)
    cleanup_expired_cursors(db)

    db.commit()

    server_time = int(time.time() * 1000)

    return jsonify({
        "accepted": accepted,
        "rejected": rejected,
        "remote_changes": remote_changes,
        "delta_cursor": new_cursor,
        "server_time": server_time,
    })


# -- Report file sync endpoints --


@sync_bp.route("/api/sync/reports/<report_id>/file", methods=["POST"])
def upload_report_file(report_id):
    """Upload a report blob with content-hash dedup.

    Headers:
        Content-Hash: sha256:<hex>  (required)
    """
    user_id, error = _require_auth()
    if error:
        return error

    report_id = sanitize_report_id(report_id)
    if not report_id:
        return jsonify({"error": "Invalid report ID"}), 400

    db = get_db()

    # Verify the report exists and belongs to this user (via device ownership)
    # TODO: Once user_id is on entity tables, filter by user_id directly.
    # For now, just check the report exists and is not tombstoned.
    report_row = db.execute(
        "SELECT id, type, deleted_at FROM reports WHERE id = ?",
        (report_id,),
    ).fetchone()

    if not report_row:
        return jsonify({"error": "Report not found"}), 404

    if report_row["deleted_at"] is not None:
        return jsonify({"error": "Report is deleted"}), 404

    # Parse Content-Hash header
    content_hash_header = request.headers.get("Content-Hash", "")
    if not content_hash_header.startswith("sha256:"):
        return jsonify({"error": "Content-Hash header required (sha256:<hex>)"}), 400

    declared_hash = content_hash_header[7:]  # strip "sha256:" prefix
    if not declared_hash or len(declared_hash) != 64:
        return jsonify({"error": "Invalid Content-Hash format"}), 400

    sync_reports_dir = _get_sync_reports_dir()

    # Content-addressed storage: file is stored by hash, not by report ID
    blob_path = os.path.join(sync_reports_dir, declared_hash)

    # Dedup: if the blob already exists, skip storage
    if os.path.exists(blob_path):
        # Update the report's content_hash pointer if needed
        db.execute(
            "UPDATE reports SET content_hash = ? WHERE id = ?",
            (declared_hash, report_id),
        )
        db.commit()
        return jsonify({"stored": True, "content_hash": declared_hash, "dedup": True})

    # Read upload data (supports both multipart file and raw body)
    if "file" in request.files:
        file_data = request.files["file"].read()
    else:
        file_data = request.get_data()

    if not file_data:
        return jsonify({"error": "No file data provided"}), 400

    # Verify hash matches
    actual_hash = hashlib.sha256(file_data).hexdigest()
    if actual_hash != declared_hash:
        return jsonify({"error": "Content-Hash mismatch"}), 400

    # Write to temp file, then move into place atomically
    fd, tmp_path = tempfile.mkstemp(dir=sync_reports_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(file_data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, blob_path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

    # Update the report's content_hash pointer
    db.execute(
        "UPDATE reports SET content_hash = ? WHERE id = ?",
        (declared_hash, report_id),
    )
    db.commit()

    return jsonify({"stored": True, "content_hash": declared_hash, "dedup": False})


@sync_bp.route("/api/sync/reports/<report_id>/file", methods=["GET"])
def download_report_file(report_id):
    """Download a report blob by report ID. Returns 404 for tombstoned reports."""
    user_id, error = _require_auth()
    if error:
        return error

    report_id = sanitize_report_id(report_id)
    if not report_id:
        return jsonify({"error": "Invalid report ID"}), 400

    db = get_db()

    report_row = db.execute(
        "SELECT id, type, content_hash, deleted_at FROM reports WHERE id = ?",
        (report_id,),
    ).fetchone()

    if not report_row:
        return jsonify({"error": "Report not found"}), 404

    if report_row["deleted_at"] is not None:
        return jsonify({"error": "Report is deleted"}), 404

    content_hash = report_row["content_hash"]
    if not content_hash:
        return jsonify({"error": "Report file not available"}), 404

    sync_reports_dir = _get_sync_reports_dir()
    blob_path = os.path.join(sync_reports_dir, content_hash)

    # Verify the blob path is within sync-reports dir (prevent traversal)
    resolved = Path(blob_path).resolve()
    if not resolved.is_relative_to(Path(sync_reports_dir).resolve()):
        return jsonify({"error": "Report file not found"}), 404

    if not os.path.exists(blob_path):
        return jsonify({"error": "Report file not found"}), 404

    # Determine MIME type from report type
    report_type = report_row["type"]
    mime_info = REPORT_TYPE_MAP.get(report_type)
    mimetype = mime_info[2] if mime_info else "application/octet-stream"

    return send_file(str(resolved), mimetype=mimetype, as_attachment=False)
