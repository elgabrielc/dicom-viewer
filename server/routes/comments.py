"""
Comment add/update/delete endpoints.

Copyright (c) 2026 Divergent Health Technologies
"""

import time

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

    db = get_db()
    cursor = db.execute(
        "INSERT INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)",
        (study_uid, series_uid, text, timestamp)
    )
    db.commit()

    return jsonify({
        'id': cursor.lastrowid,
        'studyUid': study_uid,
        'seriesUid': series_uid,
        'text': text,
        'time': timestamp
    })


@comments_bp.route('/api/notes/<study_uid>/comments/<int:comment_id>', methods=['PUT'])
def update_comment(study_uid, comment_id):
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment text is required'}), 400

    # Always use server time for edits to preserve audit integrity
    now = int(time.time() * 1000)
    db = get_db()
    cursor = db.execute(
        "UPDATE comments SET text = ?, time = ? WHERE id = ? AND study_uid = ?",
        (text, now, comment_id, study_uid)
    )
    db.commit()

    if cursor.rowcount == 0:
        return jsonify({'error': 'Comment not found'}), 404

    return jsonify({
        'id': comment_id,
        'studyUid': study_uid,
        'text': text,
        'time': now
    })


@comments_bp.route('/api/notes/<study_uid>/comments/<int:comment_id>', methods=['DELETE'])
def delete_comment(study_uid, comment_id):
    db = get_db()
    cursor = db.execute(
        "DELETE FROM comments WHERE id = ? AND study_uid = ?",
        (comment_id, study_uid)
    )
    db.commit()

    if cursor.rowcount == 0:
        return jsonify({'error': 'Comment not found'}), 404

    return jsonify({'deleted': True, 'id': comment_id})
