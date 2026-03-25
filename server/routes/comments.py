"""
Comment add/update/delete endpoints.

Uses record_uuid as the canonical identifier for sync compatibility.
Deletes are soft (tombstoned with deleted_at) to support sync replication.

Copyright (c) 2026 Divergent Health Technologies
"""

import time
import uuid

from flask import Blueprint, jsonify, request

from server.db import get_db, parse_int, MAX_TIMESTAMP_DRIFT_MS

comments_bp = Blueprint('comments', __name__)


@comments_bp.route('/api/notes/<study_uid>/comments', methods=['POST'])
def add_comment(study_uid):
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment text is required'}), 400

    series_uid = (data.get('seriesUid') or '').strip() or None
    now = int(time.time() * 1000)
    client_time = parse_int(data.get('time'))
    # Accept client timestamp if within reasonable range, otherwise use server time
    if client_time is not None and abs(client_time - now) <= MAX_TIMESTAMP_DRIFT_MS:
        timestamp = client_time
    else:
        timestamp = now

    record_uuid = data.get('record_uuid') or str(uuid.uuid4())
    # Validate record_uuid is never empty
    if not record_uuid or not record_uuid.strip():
        record_uuid = str(uuid.uuid4())

    db = get_db()
    cursor = db.execute(
        """INSERT INTO comments
           (study_uid, series_uid, text, time, record_uuid, created_at, updated_at, sync_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)""",
        (study_uid, series_uid, text, timestamp, record_uuid, timestamp, timestamp)
    )
    db.commit()

    return jsonify({
        'id': cursor.lastrowid,
        'record_uuid': record_uuid,
        'studyUid': study_uid,
        'seriesUid': series_uid,
        'text': text,
        'time': timestamp
    })


@comments_bp.route('/api/notes/<study_uid>/comments/<comment_uuid>', methods=['PUT'])
def update_comment(study_uid, comment_uuid):
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment text is required'}), 400

    # Always use server time for edits to preserve audit integrity
    now = int(time.time() * 1000)
    db = get_db()

    # Support lookup by either record_uuid or legacy integer id
    cursor = db.execute(
        """UPDATE comments SET text = ?, time = ?, updated_at = ?
           WHERE record_uuid = ? AND study_uid = ? AND deleted_at IS NULL""",
        (text, now, now, comment_uuid, study_uid)
    )
    if cursor.rowcount == 0:
        # Fall back to integer id lookup for backward compatibility
        legacy_id = parse_int(comment_uuid)
        if legacy_id is not None:
            cursor = db.execute(
                """UPDATE comments SET text = ?, time = ?, updated_at = ?
                   WHERE id = ? AND study_uid = ? AND deleted_at IS NULL""",
                (text, now, now, legacy_id, study_uid)
            )
    db.commit()

    if cursor.rowcount == 0:
        return jsonify({'error': 'Comment not found'}), 404

    return jsonify({
        'record_uuid': comment_uuid,
        'studyUid': study_uid,
        'text': text,
        'time': now
    })


@comments_bp.route('/api/notes/<study_uid>/comments/<comment_uuid>', methods=['DELETE'])
def delete_comment(study_uid, comment_uuid):
    now = int(time.time() * 1000)
    db = get_db()

    # Soft delete: set deleted_at timestamp instead of removing the row
    cursor = db.execute(
        """UPDATE comments SET deleted_at = ?, updated_at = ?
           WHERE record_uuid = ? AND study_uid = ? AND deleted_at IS NULL""",
        (now, now, comment_uuid, study_uid)
    )
    if cursor.rowcount == 0:
        # Fall back to integer id lookup for backward compatibility
        legacy_id = parse_int(comment_uuid)
        if legacy_id is not None:
            cursor = db.execute(
                """UPDATE comments SET deleted_at = ?, updated_at = ?
                   WHERE id = ? AND study_uid = ? AND deleted_at IS NULL""",
                (now, now, legacy_id, study_uid)
            )
    db.commit()

    if cursor.rowcount == 0:
        return jsonify({'error': 'Comment not found'}), 404

    return jsonify({'deleted': True, 'record_uuid': comment_uuid})
