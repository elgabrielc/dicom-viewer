"""
Study/series description save endpoints.

Copyright (c) 2026 Divergent Health Technologies
"""

import time

from flask import Blueprint, jsonify, request

from server.db import get_db

study_notes_bp = Blueprint('study_notes', __name__)


@study_notes_bp.route('/api/notes/<study_uid>/description', methods=['PUT'])
def save_study_description(study_uid):
    data = request.get_json(silent=True) or {}
    description = (data.get('description') or '').strip()
    db = get_db()
    now = int(time.time() * 1000)

    if description:
        db.execute(
            """
            INSERT INTO study_notes (study_uid, description, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(study_uid) DO UPDATE SET
                description=excluded.description,
                updated_at=excluded.updated_at
            """,
            (study_uid, description, now)
        )
    else:
        db.execute("DELETE FROM study_notes WHERE study_uid = ?", (study_uid,))

    db.commit()
    return jsonify({'studyUid': study_uid, 'description': description, 'updatedAt': now})


@study_notes_bp.route('/api/notes/<study_uid>/series/<series_uid>/description', methods=['PUT'])
def save_series_description(study_uid, series_uid):
    data = request.get_json(silent=True) or {}
    description = (data.get('description') or '').strip()
    db = get_db()
    now = int(time.time() * 1000)

    if description:
        db.execute(
            """
            INSERT INTO series_notes (study_uid, series_uid, description, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(study_uid, series_uid) DO UPDATE SET
                description=excluded.description,
                updated_at=excluded.updated_at
            """,
            (study_uid, series_uid, description, now)
        )
    else:
        db.execute(
            "DELETE FROM series_notes WHERE study_uid = ? AND series_uid = ?",
            (study_uid, series_uid)
        )

    db.commit()
    return jsonify({
        'studyUid': study_uid,
        'seriesUid': series_uid,
        'description': description,
        'updatedAt': now
    })
