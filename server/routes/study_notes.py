"""
Study/series description save endpoints.

Description-clear invariant: clearing a description sets it to empty string
(UPDATE), never deletes the row. Rows persist once created. This is a frozen
invariant required for sync -- tombstoned rows are resurrected by setting a
new description (deleted_at = NULL in the ON CONFLICT clause).

Copyright (c) 2026 Divergent Health Technologies
"""

import time

from flask import Blueprint, jsonify, request

from server.db import get_db

study_notes_bp = Blueprint('study_notes', __name__)


def _get_device_id(db):
    """Read device_id from sync_state, or None if not yet provisioned."""
    row = db.execute(
        "SELECT value FROM sync_state WHERE key = 'device_id'"
    ).fetchone()
    return row['value'] if row else None


@study_notes_bp.route('/api/notes/<study_uid>/description', methods=['PUT'])
def save_study_description(study_uid):
    data = request.get_json(silent=True) or {}
    description = (data.get('description') or '').strip()
    db = get_db()
    now = int(time.time() * 1000)
    device_id = _get_device_id(db)

    if description:
        db.execute(
            """
            INSERT INTO study_notes (study_uid, description, updated_at, device_id, sync_version)
            VALUES (?, ?, ?, ?, 0)
            ON CONFLICT(study_uid) DO UPDATE SET
                description=excluded.description,
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                deleted_at=NULL
            """,
            (study_uid, description, now, device_id)
        )
    else:
        # Frozen invariant: clear = UPDATE to empty string, never DELETE.
        # Upsert so the row exists even if this is the first write.
        db.execute(
            """
            INSERT INTO study_notes (study_uid, description, updated_at, device_id, sync_version)
            VALUES (?, '', ?, ?, 0)
            ON CONFLICT(study_uid) DO UPDATE SET
                description='',
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                deleted_at=NULL
            """,
            (study_uid, now, device_id)
        )

    db.commit()
    return jsonify({'studyUid': study_uid, 'description': description, 'updatedAt': now})


@study_notes_bp.route('/api/notes/<study_uid>/series/<series_uid>/description', methods=['PUT'])
def save_series_description(study_uid, series_uid):
    data = request.get_json(silent=True) or {}
    description = (data.get('description') or '').strip()
    db = get_db()
    now = int(time.time() * 1000)
    device_id = _get_device_id(db)

    if description:
        db.execute(
            """
            INSERT INTO series_notes (study_uid, series_uid, description, updated_at, device_id, sync_version)
            VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(study_uid, series_uid) DO UPDATE SET
                description=excluded.description,
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                deleted_at=NULL
            """,
            (study_uid, series_uid, description, now, device_id)
        )
    else:
        # Frozen invariant: clear = UPDATE to empty string, never DELETE.
        db.execute(
            """
            INSERT INTO series_notes (study_uid, series_uid, description, updated_at, device_id, sync_version)
            VALUES (?, ?, '', ?, ?, 0)
            ON CONFLICT(study_uid, series_uid) DO UPDATE SET
                description='',
                updated_at=excluded.updated_at,
                device_id=excluded.device_id,
                deleted_at=NULL
            """,
            (study_uid, series_uid, now, device_id)
        )

    db.commit()
    return jsonify({
        'studyUid': study_uid,
        'seriesUid': series_uid,
        'description': description,
        'updatedAt': now
    })
