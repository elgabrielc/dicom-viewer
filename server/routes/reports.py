"""
Report upload/download/delete endpoints and localStorage migration.

Copyright (c) 2026 Divergent Health Technologies
"""

import hashlib
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from server import db as db_module
from server.db import (
    get_db, parse_int, sanitize_report_id, resolve_report_type,
    REPORT_TYPE_MAP, MAX_BATCH_STUDY_UIDS,
    _ensure_data_dirs,
)

reports_bp = Blueprint('reports', __name__)


def _get_device_id(db):
    """Read the device_id from sync_state, or return None if not yet seeded."""
    row = db.execute(
        "SELECT value FROM sync_state WHERE key = 'device_id'"
    ).fetchone()
    return row['value'] if row else None


def _build_notes_payload(study_uids, db):
    if not study_uids:
        return {}

    placeholders = ','.join('?' for _ in study_uids)

    study_rows = db.execute(
        f"SELECT study_uid, description FROM study_notes WHERE study_uid IN ({placeholders})",
        study_uids
    ).fetchall()

    series_rows = db.execute(
        f"SELECT study_uid, series_uid, description FROM series_notes WHERE study_uid IN ({placeholders})",
        study_uids
    ).fetchall()

    comment_rows = db.execute(
        f"""
        SELECT id, study_uid, series_uid, text, time, record_uuid
        FROM comments
        WHERE study_uid IN ({placeholders})
          AND deleted_at IS NULL
        ORDER BY time ASC, id ASC
        """,
        study_uids
    ).fetchall()

    report_rows = db.execute(
        f"""
        SELECT id, study_uid, name, type, size, added_at, updated_at
        FROM reports
        WHERE study_uid IN ({placeholders})
        AND file_path IS NOT NULL
        AND deleted_at IS NULL
        ORDER BY added_at ASC, id ASC
        """,
        study_uids
    ).fetchall()

    notes = {}

    def ensure(study_uid):
        if study_uid not in notes:
            notes[study_uid] = {
                'description': '',
                'comments': [],
                'series': {},
                'reports': []
            }

    for row in study_rows:
        study_uid = row['study_uid']
        ensure(study_uid)
        notes[study_uid]['description'] = row['description'] or ''

    for row in series_rows:
        study_uid = row['study_uid']
        series_uid = row['series_uid']
        ensure(study_uid)
        series = notes[study_uid]['series'].setdefault(
            series_uid,
            {'description': '', 'comments': []}
        )
        series['description'] = row['description'] or ''

    for row in comment_rows:
        study_uid = row['study_uid']
        ensure(study_uid)
        comment = {
            'id': row['record_uuid'] or row['id'],
            'text': row['text'],
            'time': row['time']
        }
        series_uid = row['series_uid']
        if series_uid:
            series = notes[study_uid]['series'].setdefault(
                series_uid,
                {'description': '', 'comments': []}
            )
            series['comments'].append(comment)
        else:
            notes[study_uid]['comments'].append(comment)

    for row in report_rows:
        study_uid = row['study_uid']
        ensure(study_uid)
        notes[study_uid]['reports'].append({
            'id': row['id'],
            'name': row['name'],
            'type': row['type'],
            'size': row['size'],
            'addedAt': row['added_at'],
            'updatedAt': row['updated_at']
        })

    def has_notes(entry):
        if entry['description'] or entry['comments'] or entry['reports']:
            return True
        for series_entry in entry['series'].values():
            if series_entry['description'] or series_entry['comments']:
                return True
        return False

    return {uid: data for uid, data in notes.items() if has_notes(data)}


@reports_bp.route('/api/notes/', methods=['GET'])
def get_notes():
    studies_param = request.args.get('studies', '').strip()
    if not studies_param:
        return jsonify({'studies': {}})

    study_uids = [uid.strip() for uid in studies_param.split(',') if uid.strip()]
    if not study_uids:
        return jsonify({'studies': {}})
    if len(study_uids) > MAX_BATCH_STUDY_UIDS:
        return jsonify({'error': f'Too many study UIDs (max {MAX_BATCH_STUDY_UIDS})'}), 400

    db = get_db()
    payload = _build_notes_payload(study_uids, db)
    return jsonify({'studies': payload})


@reports_bp.route('/api/notes/<study_uid>/reports', methods=['POST'])
def upload_report(study_uid):
    if 'file' not in request.files:
        return jsonify({'error': 'Report file is required'}), 400

    file = request.files['file']
    if not file or not file.filename:
        return jsonify({'error': 'Report file is required'}), 400

    provided_id = request.form.get('id')
    report_id = sanitize_report_id(provided_id) or str(uuid.uuid4())
    name = (request.form.get('name') or file.filename or 'report').strip()[:255]

    provided_type = request.form.get('type')
    report_type, ext, mime = resolve_report_type(file.filename, provided_type, file.mimetype)
    if not report_type:
        return jsonify({'error': 'Unsupported report file type'}), 400

    now = int(time.time() * 1000)
    added_at = parse_int(request.form.get('addedAt'), now)
    updated_at = parse_int(request.form.get('updatedAt'), now)

    report_path = os.path.join(db_module.REPORTS_DIR, f"{report_id}.{ext}")

    # Save upload to a temp file first, then commit DB, then move into place.
    # This prevents orphan files if the DB operation fails.
    _ensure_data_dirs()
    tmp_fd, tmp_path = tempfile.mkstemp(dir=db_module.REPORTS_DIR, suffix=f".{ext}.tmp")
    try:
        os.close(tmp_fd)
        file.save(tmp_path)

        # Compute SHA-256 content hash from the saved bytes
        with open(tmp_path, 'rb') as fh:
            file_bytes = fh.read()
        content_hash = hashlib.sha256(file_bytes).hexdigest()

        size = parse_int(request.form.get('size'))
        if size is None:
            size = len(file_bytes)

        db = get_db()
        device_id = _get_device_id(db)

        existing = db.execute(
            "SELECT file_path, added_at FROM reports WHERE id = ?",
            (report_id,)
        ).fetchone()

        if existing and existing['added_at'] and not request.form.get('addedAt'):
            added_at = existing['added_at']

        # Upsert clears deleted_at (resurrection) and populates sync columns
        db.execute(
            """
            INSERT INTO reports (id, study_uid, name, type, size, file_path,
                                 added_at, updated_at, content_hash, device_id,
                                 sync_version, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
            ON CONFLICT(id) DO UPDATE SET
                study_uid=excluded.study_uid,
                name=excluded.name,
                type=excluded.type,
                size=excluded.size,
                file_path=excluded.file_path,
                added_at=excluded.added_at,
                updated_at=excluded.updated_at,
                content_hash=excluded.content_hash,
                device_id=excluded.device_id,
                sync_version=0,
                deleted_at=NULL
            """,
            (report_id, study_uid, name, report_type, size, report_path,
             added_at, updated_at, content_hash, device_id)
        )
        db.commit()

        # DB committed successfully -- move temp file to final path
        if existing and existing['file_path'] and existing['file_path'] != report_path:
            try:
                if os.path.exists(existing['file_path']):
                    os.remove(existing['file_path'])
            except OSError:
                pass
        shutil.move(tmp_path, report_path)
    except Exception:
        # Clean up temp file on any failure
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

    return jsonify({
        'id': report_id,
        'studyUid': study_uid,
        'name': name,
        'type': report_type,
        'size': size,
        'addedAt': added_at,
        'updatedAt': updated_at,
        'contentHash': content_hash
    })


@reports_bp.route('/api/notes/reports/<report_id>/file', methods=['GET'])
def get_report_file(report_id):
    db = get_db()
    row = db.execute(
        "SELECT file_path, type FROM reports WHERE id = ? AND deleted_at IS NULL",
        (report_id,)
    ).fetchone()

    if not row or not row['file_path'] or not os.path.exists(row['file_path']):
        return jsonify({'error': 'Report file not found'}), 404

    # Verify the file path is within db_module.REPORTS_DIR (prevent path traversal via DB tampering)
    resolved = Path(row['file_path']).resolve()
    if not resolved.is_relative_to(Path(db_module.REPORTS_DIR).resolve()):
        return jsonify({'error': 'Report file not found'}), 404

    mimetype = REPORT_TYPE_MAP.get(row['type'], ('', '', 'application/octet-stream'))[2]
    return send_file(str(resolved), mimetype=mimetype, as_attachment=False)


@reports_bp.route('/api/notes/<study_uid>/reports/<report_id>', methods=['DELETE'])
def delete_report(study_uid, report_id):
    db = get_db()
    row = db.execute(
        "SELECT file_path FROM reports WHERE id = ? AND study_uid = ? AND deleted_at IS NULL",
        (report_id, study_uid)
    ).fetchone()

    if not row:
        return jsonify({'error': 'Report not found'}), 404

    # Soft delete: tombstone the record with deleted_at timestamp.
    # Physical file is retained on disk until purge (Stage 5).
    now = int(time.time() * 1000)
    device_id = _get_device_id(db)
    db.execute(
        "UPDATE reports SET deleted_at = ?, updated_at = ?, device_id = ? WHERE id = ? AND study_uid = ?",
        (now, now, device_id, report_id, study_uid)
    )
    db.commit()

    return jsonify({'deleted': True, 'id': report_id})


@reports_bp.route('/api/notes/migrate', methods=['POST'])
def migrate_notes():
    data = request.get_json(silent=True) or {}
    comments_blob = data.get('comments') or {}
    if not isinstance(comments_blob, dict):
        return jsonify({'error': 'Invalid migration payload'}), 400

    db = get_db()
    now = int(time.time() * 1000)
    migrated = 0

    for study_uid, stored in comments_blob.items():
        if not isinstance(stored, dict):
            continue

        description = (stored.get('description') or '').strip()
        if description:
            db.execute(
                """
                INSERT INTO study_notes (study_uid, description, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(study_uid) DO NOTHING
                """,
                (study_uid, description, now)
            )

        for comment in stored.get('study') or []:
            if not isinstance(comment, dict):
                continue
            text = (comment.get('text') or '').strip()
            if not text:
                continue
            timestamp = parse_int(comment.get('time'), now)
            db.execute(
                "INSERT OR IGNORE INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)",
                (study_uid, '', text, timestamp)
            )

        series_blob = stored.get('series') or {}
        if isinstance(series_blob, dict):
            for series_uid, series_data in series_blob.items():
                series_comments = []
                series_description = ''

                if isinstance(series_data, list):
                    series_comments = series_data
                elif isinstance(series_data, dict):
                    series_description = (series_data.get('description') or '').strip()
                    series_comments = series_data.get('comments') or []

                if series_description:
                    db.execute(
                        """
                        INSERT INTO series_notes (study_uid, series_uid, description, updated_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(study_uid, series_uid) DO NOTHING
                        """,
                        (study_uid, series_uid, series_description, now)
                    )

                for comment in series_comments:
                    if not isinstance(comment, dict):
                        continue
                    text = (comment.get('text') or '').strip()
                    if not text:
                        continue
                    timestamp = parse_int(comment.get('time'), now)
                    db.execute(
                        "INSERT OR IGNORE INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)",
                        (study_uid, series_uid, text, timestamp)
                    )

        migrated += 1

    db.commit()
    return jsonify({'migrated': migrated})
