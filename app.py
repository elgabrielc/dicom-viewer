"""
DICOM CT Viewer - Flask Backend

Divergent Health Technologies
https://divergent.health/

This module provides a Flask web server for the DICOM CT Viewer application.
The primary workflow uses client-side DICOM processing (via the File System
Access API in the browser). This server provides:

1. Static file serving (HTML, CSS, JS, WASM)
2. Test data API for automated Playwright tests
3. Notes persistence API (SQLite) for comments, descriptions, and reports

Routes:
    GET  /                                                  - Main application page
    GET  /api/test-data/studies                             - List test studies
    GET  /api/test-data/dicom/<study>/<series>/<slice>      - Get DICOM bytes
    GET  /api/test-data/info                                - Test data info
    GET  /api/notes/?studies=uid1,uid2                      - Batch load notes
    PUT  /api/notes/<study_uid>/description                 - Save study description
    PUT  /api/notes/<study_uid>/series/<series_uid>/description - Save series description
    POST /api/notes/<study_uid>/comments                    - Add comment
    PUT  /api/notes/<study_uid>/comments/<id>               - Edit comment
    DELETE /api/notes/<study_uid>/comments/<id>              - Delete comment
    POST /api/notes/<study_uid>/reports                     - Upload report
    GET  /api/notes/reports/<id>/file                       - Download report file
    DELETE /api/notes/<study_uid>/reports/<id>               - Delete report
    POST /api/notes/migrate                                 - One-time localStorage import

Copyright (c) 2026 Divergent Health Technologies
"""

import os
import hashlib
import re
import shutil
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, jsonify, send_file, request, g
import pydicom
from pydicom.errors import InvalidDicomError


# =============================================================================
# FLASK APP CONFIGURATION
# =============================================================================

app = Flask(__name__, static_folder='docs', static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload limit

# Test data folder for automated testing (bypasses File System Access API)
TEST_DATA_FOLDER = os.environ.get(
    'DICOM_TEST_DATA',
    os.path.expanduser('~/claude 0/test-data-mri-1')
)

# Notes database storage (SQLite + report files)
DATA_DIR = os.environ.get(
    'DICOM_VIEWER_DATA_DIR',
    os.path.join(app.root_path, 'data')
)
DB_PATH = os.path.join(DATA_DIR, 'viewer.db')
REPORTS_DIR = os.path.join(DATA_DIR, 'reports')

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

# Cache for test data (loaded once on first request)
_test_data_cache = None


# =============================================================================
# SECURITY MIDDLEWARE
# =============================================================================

@app.before_request
def _csrf_origin_check():
    """Block cross-origin state-modifying requests (CSRF protection).

    For POST/PUT/DELETE, verify that the Origin or Referer header matches
    the server's own host. This prevents malicious websites from submitting
    forms or fetch requests to the local server while a user is browsing.
    Multipart uploads are the primary concern since they bypass CORS preflight.
    """
    if request.method in ('POST', 'PUT', 'DELETE'):
        origin = request.headers.get('Origin')
        if not origin:
            # Fall back to Referer if Origin is absent (some browsers strip it)
            referer = request.headers.get('Referer')
            if referer:
                from urllib.parse import urlparse
                origin = f"{urlparse(referer).scheme}://{urlparse(referer).netloc}"

        if origin:
            from urllib.parse import urlparse
            origin_host = urlparse(origin).netloc
            server_host = request.host  # includes port
            if origin_host != server_host:
                return jsonify({'error': 'Cross-origin request blocked'}), 403


@app.after_request
def _set_security_headers(response):
    """Add standard security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response


# =============================================================================
# NOTES DATABASE (SQLITE)
# =============================================================================

def _ensure_data_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(REPORTS_DIR, exist_ok=True)


def _parse_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _sanitize_report_id(value):
    if not value:
        return None
    value = value.strip()
    if not re.match(r'^[a-zA-Z0-9_-]{8,64}$', value):
        return None
    return value


def _resolve_report_type(filename, provided_type, mimetype):
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


def get_db():
    if 'db' not in g:
        _ensure_data_dirs()
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        g.db = conn
    return g.db


@app.teardown_appcontext
def _close_db(exception=None):
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


# Initialize the database on startup
init_db()


# =============================================================================
# DICOM SCANNING
# =============================================================================

def _generate_id(uid):
    """Generate a short ID from a DICOM UID."""
    return hashlib.sha256(uid.encode()).hexdigest()[:12]


def _extract_metadata(ds, file_path):
    """Extract relevant metadata from a DICOM dataset."""
    def get_attr(attr, default=''):
        try:
            val = getattr(ds, attr, default)
            return str(val) if val is not None else default
        except Exception:
            return default

    return {
        'file_path': str(file_path),
        'patient_name': get_attr('PatientName', 'Unknown'),
        'patient_id': get_attr('PatientID', ''),
        'study_date': get_attr('StudyDate', ''),
        'study_description': get_attr('StudyDescription', ''),
        'study_instance_uid': get_attr('StudyInstanceUID', ''),
        'series_description': get_attr('SeriesDescription', ''),
        'series_instance_uid': get_attr('SeriesInstanceUID', ''),
        'series_number': get_attr('SeriesNumber', ''),
        'modality': get_attr('Modality', ''),
        'instance_number': int(get_attr('InstanceNumber', '0') or '0'),
        'slice_location': float(get_attr('SliceLocation', '0') or '0'),
    }


def _read_single_dicom(file_path):
    """Read a single DICOM file and return metadata or None."""
    try:
        ds = pydicom.dcmread(str(file_path), stop_before_pixels=True)
        return _extract_metadata(ds, file_path)
    except (InvalidDicomError, Exception):
        return None


def scan_dicom_folder(folder_path):
    """Scan a folder for DICOM files and organize by study/series."""
    studies = {}
    folder = Path(folder_path)

    if not folder.exists():
        return studies

    file_paths = [f for f in folder.rglob('*') if f.is_file()]
    print(f"Scanning {len(file_paths)} files...")

    with ThreadPoolExecutor(max_workers=os.cpu_count() * 2) as executor:
        futures = {executor.submit(_read_single_dicom, fp): fp for fp in file_paths}

        for future in as_completed(futures):
            meta = future.result()
            if meta is None or not meta['study_instance_uid']:
                continue

            study_id = _generate_id(meta['study_instance_uid'])
            series_id = _generate_id(meta['series_instance_uid'])

            # Initialize study
            if study_id not in studies:
                studies[study_id] = {
                    'study_id': study_id,
                    'patient_name': meta['patient_name'],
                    'patient_id': meta['patient_id'],
                    'study_date': meta['study_date'],
                    'study_description': meta['study_description'],
                    'modality': meta['modality'],
                    'series': {},
                    'image_count': 0
                }

            # Initialize series
            if series_id not in studies[study_id]['series']:
                studies[study_id]['series'][series_id] = {
                    'series_id': series_id,
                    'series_description': meta['series_description'],
                    'series_number': meta['series_number'],
                    'modality': meta['modality'],
                    'slices': []
                }

            # Add slice
            studies[study_id]['series'][series_id]['slices'].append({
                'file_path': meta['file_path'],
                'instance_number': meta['instance_number'],
                'slice_location': meta['slice_location'],
            })
            studies[study_id]['image_count'] += 1

    # Sort slices and count series
    for study in studies.values():
        for series in study['series'].values():
            series['slices'].sort(key=lambda x: (x['slice_location'], x['instance_number']))
        study['series_count'] = len(study['series'])

    print(f"Found {len(studies)} studies")
    return studies


# =============================================================================
# FLASK ROUTES
# =============================================================================

@app.route('/')
def index():
    """Serve the main application."""
    return app.send_static_file('index.html')


# =============================================================================
# TEST DATA API (for Playwright tests)
# =============================================================================

def _get_test_data():
    """Load test data from the configured folder (cached)."""
    global _test_data_cache
    if _test_data_cache is None and os.path.exists(TEST_DATA_FOLDER):
        _test_data_cache = scan_dicom_folder(TEST_DATA_FOLDER)
    return _test_data_cache or {}


@app.route('/api/test-data/studies')
def get_test_studies():
    """Get list of studies from test data folder."""
    studies = _get_test_data()
    return jsonify([
        {
            'studyInstanceUid': study_id,
            'patientName': study['patient_name'],
            'patientId': study['patient_id'],
            'studyDate': study['study_date'],
            'studyDescription': study['study_description'],
            'modality': study['modality'],
            'seriesCount': len(study['series']),
            'imageCount': study['image_count'],
            'series': [
                {
                    'seriesInstanceUid': series_id,
                    'seriesDescription': series['series_description'],
                    'seriesNumber': series['series_number'],
                    'modality': series['modality'],
                    'sliceCount': len(series['slices'])
                }
                for series_id, series in study['series'].items()
            ]
        }
        for study_id, study in studies.items()
    ])


@app.route('/api/test-data/dicom/<study_id>/<series_id>/<int:slice_num>')
def get_test_dicom(study_id, series_id, slice_num):
    """Get raw DICOM file bytes for a test data slice."""
    studies = _get_test_data()

    if study_id not in studies:
        return jsonify({'error': 'Study not found'}), 404

    study = studies[study_id]
    if series_id not in study['series']:
        return jsonify({'error': 'Series not found'}), 404

    series = study['series'][series_id]
    if slice_num < 0 or slice_num >= len(series['slices']):
        return jsonify({'error': 'Slice index out of range'}), 404

    file_path = series['slices'][slice_num]['file_path']

    try:
        return send_file(file_path, mimetype='application/dicom')
    except Exception:
        return jsonify({'error': 'Failed to read DICOM file'}), 500


@app.route('/api/test-data/info')
def get_test_info():
    """Get info about available test data."""
    studies = _get_test_data()
    return jsonify({
        'available': os.path.exists(TEST_DATA_FOLDER),
        'studyCount': len(studies),
        'totalImages': sum(s['image_count'] for s in studies.values())
    })


# =============================================================================
# NOTES API (PERSISTENT COMMENTS/REPORTS)
# =============================================================================

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
        SELECT id, study_uid, series_uid, text, time
        FROM comments
        WHERE study_uid IN ({placeholders})
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
            'id': row['id'],
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


@app.route('/api/notes/', methods=['GET'])
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


@app.route('/api/notes/<study_uid>/description', methods=['PUT'])
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


@app.route('/api/notes/<study_uid>/series/<series_uid>/description', methods=['PUT'])
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


@app.route('/api/notes/<study_uid>/comments', methods=['POST'])
def add_comment(study_uid):
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment text is required'}), 400

    series_uid = (data.get('seriesUid') or '').strip() or None
    now = int(time.time() * 1000)
    client_time = _parse_int(data.get('time'))
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


@app.route('/api/notes/<study_uid>/comments/<int:comment_id>', methods=['PUT'])
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


@app.route('/api/notes/<study_uid>/comments/<int:comment_id>', methods=['DELETE'])
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


@app.route('/api/notes/<study_uid>/reports', methods=['POST'])
def upload_report(study_uid):
    if 'file' not in request.files:
        return jsonify({'error': 'Report file is required'}), 400

    file = request.files['file']
    if not file or not file.filename:
        return jsonify({'error': 'Report file is required'}), 400

    provided_id = request.form.get('id')
    report_id = _sanitize_report_id(provided_id) or str(uuid.uuid4())
    name = (request.form.get('name') or file.filename or 'report').strip()[:255]

    provided_type = request.form.get('type')
    report_type, ext, mime = _resolve_report_type(file.filename, provided_type, file.mimetype)
    if not report_type:
        return jsonify({'error': 'Unsupported report file type'}), 400

    now = int(time.time() * 1000)
    added_at = _parse_int(request.form.get('addedAt'), now)
    updated_at = _parse_int(request.form.get('updatedAt'), now)

    report_path = os.path.join(REPORTS_DIR, f"{report_id}.{ext}")

    # Save upload to a temp file first, then commit DB, then move into place.
    # This prevents orphan files if the DB operation fails.
    _ensure_data_dirs()
    tmp_fd, tmp_path = tempfile.mkstemp(dir=REPORTS_DIR, suffix=f".{ext}.tmp")
    try:
        os.close(tmp_fd)
        file.save(tmp_path)
        size = _parse_int(request.form.get('size'))
        if size is None:
            try:
                size = os.path.getsize(tmp_path)
            except OSError:
                size = 0

        db = get_db()
        existing = db.execute(
            "SELECT file_path, added_at FROM reports WHERE id = ?",
            (report_id,)
        ).fetchone()

        if existing and existing['added_at'] and not request.form.get('addedAt'):
            added_at = existing['added_at']

        db.execute(
            """
            INSERT INTO reports (id, study_uid, name, type, size, file_path, added_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                study_uid=excluded.study_uid,
                name=excluded.name,
                type=excluded.type,
                size=excluded.size,
                file_path=excluded.file_path,
                added_at=excluded.added_at,
                updated_at=excluded.updated_at
            """,
            (report_id, study_uid, name, report_type, size, report_path, added_at, updated_at)
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
        'updatedAt': updated_at
    })


@app.route('/api/notes/reports/<report_id>/file', methods=['GET'])
def get_report_file(report_id):
    db = get_db()
    row = db.execute(
        "SELECT file_path, type FROM reports WHERE id = ?",
        (report_id,)
    ).fetchone()

    if not row or not row['file_path'] or not os.path.exists(row['file_path']):
        return jsonify({'error': 'Report file not found'}), 404

    # Verify the file path is within REPORTS_DIR (prevent path traversal via DB tampering)
    resolved = Path(row['file_path']).resolve()
    if not resolved.is_relative_to(Path(REPORTS_DIR).resolve()):
        return jsonify({'error': 'Report file not found'}), 404

    mimetype = REPORT_TYPE_MAP.get(row['type'], ('', '', 'application/octet-stream'))[2]
    return send_file(str(resolved), mimetype=mimetype, as_attachment=False)


@app.route('/api/notes/<study_uid>/reports/<report_id>', methods=['DELETE'])
def delete_report(study_uid, report_id):
    db = get_db()
    row = db.execute(
        "SELECT file_path FROM reports WHERE id = ? AND study_uid = ?",
        (report_id, study_uid)
    ).fetchone()

    if not row:
        return jsonify({'error': 'Report not found'}), 404

    # Delete DB record first, then remove file.
    # If file removal fails, the orphan file is acceptable;
    # the reverse (dangling DB reference) is worse.
    file_path = row['file_path']
    db.execute(
        "DELETE FROM reports WHERE id = ? AND study_uid = ?",
        (report_id, study_uid)
    )
    db.commit()

    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass

    return jsonify({'deleted': True, 'id': report_id})


@app.route('/api/notes/migrate', methods=['POST'])
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
            timestamp = _parse_int(comment.get('time'), now)
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
                    timestamp = _parse_int(comment.get('time'), now)
                    db.execute(
                        "INSERT OR IGNORE INTO comments (study_uid, series_uid, text, time) VALUES (?, ?, ?, ?)",
                        (study_uid, series_uid, text, timestamp)
                    )

        migrated += 1

    db.commit()
    return jsonify({'migrated': migrated})


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    host = '0.0.0.0' if os.environ.get('FLASK_HOST') == '0.0.0.0' else '127.0.0.1'
    app.run(debug=debug, host=host, port=5001)
