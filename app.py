"""
DICOM CT Viewer - Flask Backend

Divergent Health Technologies
https://divergent.health/

This module provides a Flask web server for the DICOM CT Viewer application.
While the primary workflow uses client-side DICOM processing (via the File System
Access API in the browser), this server provides:

1. Static file serving (HTML, CSS, JS, WASM)
2. Optional server-side DICOM processing APIs (for alternative workflows)
3. File upload endpoints (for environments without File System Access API)

The server-side APIs can scan local folders for DICOM files, organize them by
study/series, and serve rendered slice images. However, the recommended usage
is the client-side drag-and-drop workflow which keeps all data in the browser.

Routes:
    GET  /                          - Main application page
    GET  /api/studies               - List all scanned studies
    GET  /api/study/<id>            - Get study details and series list
    GET  /api/series/<id>/slice/<n> - Get rendered slice image as PNG
    POST /api/upload                - Upload DICOM files
    POST /api/load-folder           - Scan a local folder for DICOM files

Copyright (c) 2026 Divergent Health Technologies
"""

# =============================================================================
# IMPORTS
# =============================================================================

import os
import io
import hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, render_template, jsonify, request, send_file
import pydicom
from pydicom.errors import InvalidDicomError
import numpy as np
from PIL import Image

# =============================================================================
# FLASK APP CONFIGURATION
# =============================================================================

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max

# Test data folder for automated testing (bypasses File System Access API)
TEST_DATA_FOLDER = os.path.expanduser('~/claude 0/MRI sample for debug 1')

# In-memory store for studies (in production, use a database)
# Maps study_id -> study dict containing patient info, series, and slice metadata
studies_cache = {}
test_data_cache = {}  # Separate cache for test data


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def generate_study_id(study_instance_uid):
    """Generate a short ID from Study Instance UID."""
    return hashlib.md5(study_instance_uid.encode()).hexdigest()[:12]


def generate_series_id(series_instance_uid):
    """Generate a short ID from Series Instance UID."""
    return hashlib.md5(series_instance_uid.encode()).hexdigest()[:12]


def apply_window_level(pixel_array, window_center, window_width):
    """Apply window/level to pixel data for display."""
    min_val = window_center - window_width // 2
    max_val = window_center + window_width // 2

    # Clip and scale to 0-255
    img = np.clip(pixel_array, min_val, max_val)
    img = ((img - min_val) / (max_val - min_val) * 255).astype(np.uint8)
    return img


def get_default_window_level(ds):
    """Get window/level from DICOM or calculate defaults."""
    try:
        wc = ds.WindowCenter
        ww = ds.WindowWidth
        # Handle multi-valued window/level
        if isinstance(wc, (list, pydicom.multival.MultiValue)):
            wc = wc[0]
        if isinstance(ww, (list, pydicom.multival.MultiValue)):
            ww = ww[0]
        return int(wc), int(ww)
    except (AttributeError, TypeError):
        # Calculate from pixel data
        try:
            pixels = ds.pixel_array
            return int(np.mean(pixels)), int(np.max(pixels) - np.min(pixels))
        except Exception:
            return 40, 400  # Default CT window


def extract_metadata(ds, file_path):
    """Extract relevant metadata from a DICOM dataset."""
    def get_attr(attr, default=''):
        try:
            val = getattr(ds, attr, default)
            if val is None:
                return default
            return str(val)
        except Exception:
            return default

    return {
        'file_path': str(file_path),
        'patient_name': get_attr('PatientName', 'Unknown'),
        'patient_id': get_attr('PatientID', ''),
        'study_date': get_attr('StudyDate', ''),
        'study_time': get_attr('StudyTime', ''),
        'study_description': get_attr('StudyDescription', ''),
        'study_instance_uid': get_attr('StudyInstanceUID', ''),
        'series_description': get_attr('SeriesDescription', ''),
        'series_instance_uid': get_attr('SeriesInstanceUID', ''),
        'series_number': get_attr('SeriesNumber', ''),
        'modality': get_attr('Modality', ''),
        'instance_number': int(get_attr('InstanceNumber', '0') or '0'),
        'slice_location': float(get_attr('SliceLocation', '0') or '0'),
        'slice_thickness': get_attr('SliceThickness', ''),
        'rows': int(get_attr('Rows', '0') or '0'),
        'columns': int(get_attr('Columns', '0') or '0'),
    }


def read_single_dicom(file_path):
    """Read a single DICOM file and return metadata or None."""
    try:
        ds = pydicom.dcmread(str(file_path), stop_before_pixels=True)
        return extract_metadata(ds, file_path)
    except InvalidDicomError:
        return None
    except Exception:
        return None


def scan_dicom_files(folder_path):
    """Scan a folder for DICOM files and organize by study/series."""
    studies = {}
    folder = Path(folder_path)

    if not folder.exists():
        return studies

    # Collect all file paths first
    file_paths = [f for f in folder.rglob('*') if f.is_file()]
    print(f"Found {len(file_paths)} files, scanning with parallel processing...")

    # Process files in parallel
    with ThreadPoolExecutor(max_workers=os.cpu_count() * 2) as executor:
        futures = {executor.submit(read_single_dicom, fp): fp for fp in file_paths}

        for future in as_completed(futures):
            meta = future.result()
            if meta is None:
                continue

            study_uid = meta['study_instance_uid']
            series_uid = meta['series_instance_uid']

            if not study_uid:
                continue

            study_id = generate_study_id(study_uid)
            series_id = generate_series_id(series_uid)

            # Initialize study if needed
            if study_id not in studies:
                studies[study_id] = {
                    'study_id': study_id,
                    'study_instance_uid': study_uid,
                    'patient_name': meta['patient_name'],
                    'patient_id': meta['patient_id'],
                    'study_date': meta['study_date'],
                    'study_description': meta['study_description'],
                    'modality': meta['modality'],
                    'series': {},
                    'image_count': 0
                }

            # Initialize series if needed
            if series_id not in studies[study_id]['series']:
                studies[study_id]['series'][series_id] = {
                    'series_id': series_id,
                    'series_instance_uid': series_uid,
                    'series_description': meta['series_description'],
                    'series_number': meta['series_number'],
                    'modality': meta['modality'],
                    'slices': []
                }

            # Add slice info
            studies[study_id]['series'][series_id]['slices'].append({
                'file_path': meta['file_path'],
                'instance_number': meta['instance_number'],
                'slice_location': meta['slice_location'],
                'slice_thickness': meta['slice_thickness'],
                'rows': meta['rows'],
                'columns': meta['columns']
            })
            studies[study_id]['image_count'] += 1

    # Sort slices by instance number or slice location
    for study_id, study in studies.items():
        for series_id, series in study['series'].items():
            series['slices'].sort(key=lambda x: (x['instance_number'], x['slice_location']))
        study['series_count'] = len(study['series'])

    print(f"Scan complete: {len(studies)} studies found")
    return studies


def refresh_studies():
    """Refresh the studies cache by scanning the uploads folder."""
    global studies_cache
    studies_cache = scan_dicom_files(app.config['UPLOAD_FOLDER'])
    return studies_cache


# =============================================================================
# FLASK ROUTES - PAGE SERVING
# =============================================================================

@app.route('/')
def index():
    """Render the library view."""
    return render_template('index.html')


@app.route('/viewer/<study_id>')
def viewer(study_id):
    """Render the study viewer."""
    return render_template('viewer.html', study_id=study_id)


@app.route('/viewer-local/<study_uid>')
def viewer_local(study_uid):
    """Render the client-side study viewer."""
    return render_template('viewer-local.html', study_uid=study_uid)


# =============================================================================
# FLASK ROUTES - REST API
# These endpoints are used for server-side DICOM processing workflows.
# The primary client-side workflow does not use these APIs.
# =============================================================================

@app.route('/api/studies')
def get_studies():
    """Get list of all studies."""
    refresh_studies()
    studies_list = []
    for study_id, study in studies_cache.items():
        studies_list.append({
            'study_id': study['study_id'],
            'patient_name': study['patient_name'],
            'patient_id': study['patient_id'],
            'study_date': study['study_date'],
            'study_description': study['study_description'],
            'modality': study['modality'],
            'series_count': study['series_count'],
            'image_count': study['image_count']
        })
    return jsonify(studies_list)


@app.route('/api/study/<study_id>')
def get_study(study_id):
    """Get details for a specific study."""
    if study_id not in studies_cache:
        refresh_studies()

    if study_id not in studies_cache:
        return jsonify({'error': 'Study not found'}), 404

    study = studies_cache[study_id]
    series_list = []
    for series_id, series in study['series'].items():
        series_list.append({
            'series_id': series['series_id'],
            'series_description': series['series_description'],
            'series_number': series['series_number'],
            'modality': series['modality'],
            'slice_count': len(series['slices'])
        })

    return jsonify({
        'study_id': study['study_id'],
        'patient_name': study['patient_name'],
        'patient_id': study['patient_id'],
        'study_date': study['study_date'],
        'study_description': study['study_description'],
        'modality': study['modality'],
        'series': series_list
    })


@app.route('/api/series/<series_id>/info')
def get_series_info(series_id):
    """Get series info including slice count."""
    for study in studies_cache.values():
        if series_id in study['series']:
            series = study['series'][series_id]
            return jsonify({
                'series_id': series['series_id'],
                'series_description': series['series_description'],
                'series_number': series['series_number'],
                'modality': series['modality'],
                'slice_count': len(series['slices'])
            })
    return jsonify({'error': 'Series not found'}), 404


@app.route('/api/series/<series_id>/slice/<int:slice_num>')
def get_slice_image(series_id, slice_num):
    """Get a slice image as PNG."""
    # Find series in cache
    series = None
    for study in studies_cache.values():
        if series_id in study['series']:
            series = study['series'][series_id]
            break

    if not series:
        return jsonify({'error': 'Series not found'}), 404

    if slice_num < 0 or slice_num >= len(series['slices']):
        return jsonify({'error': 'Slice index out of range'}), 404

    slice_info = series['slices'][slice_num]
    file_path = slice_info['file_path']

    try:
        ds = pydicom.dcmread(file_path)
        pixel_array = ds.pixel_array

        # Apply rescale slope/intercept if present
        if hasattr(ds, 'RescaleSlope') and hasattr(ds, 'RescaleIntercept'):
            pixel_array = pixel_array * ds.RescaleSlope + ds.RescaleIntercept

        # Apply window/level
        wc, ww = get_default_window_level(ds)
        img_array = apply_window_level(pixel_array, wc, ww)

        # Convert to PIL Image
        img = Image.fromarray(img_array)

        # Save to bytes buffer
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)

        return send_file(buffer, mimetype='image/png')

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/series/<series_id>/slice/<int:slice_num>/metadata')
def get_slice_metadata(series_id, slice_num):
    """Get metadata for a specific slice."""
    # Find series in cache
    series = None
    for study in studies_cache.values():
        if series_id in study['series']:
            series = study['series'][series_id]
            break

    if not series:
        return jsonify({'error': 'Series not found'}), 404

    if slice_num < 0 or slice_num >= len(series['slices']):
        return jsonify({'error': 'Slice index out of range'}), 404

    slice_info = series['slices'][slice_num]
    file_path = slice_info['file_path']

    try:
        ds = pydicom.dcmread(file_path, stop_before_pixels=True)
        wc, ww = get_default_window_level(ds)

        return jsonify({
            'instance_number': slice_info['instance_number'],
            'slice_location': slice_info['slice_location'],
            'slice_thickness': slice_info['slice_thickness'],
            'rows': slice_info['rows'],
            'columns': slice_info['columns'],
            'window_center': wc,
            'window_width': ww,
            'slice_index': slice_num,
            'total_slices': len(series['slices'])
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =============================================================================
# FLASK ROUTES - FILE UPLOAD / FOLDER LOADING
# =============================================================================

@app.route('/api/upload', methods=['POST'])
def upload_files():
    """Upload DICOM files via HTTP POST."""
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided'}), 400

    files = request.files.getlist('files')
    uploaded_count = 0

    # Ensure upload folder exists
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    for file in files:
        if file.filename:
            # Create subdirectory based on filename to preserve structure
            filename = file.filename.replace('\\', '/')
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(filename))

            # Handle duplicate names
            base, ext = os.path.splitext(file_path)
            counter = 1
            while os.path.exists(file_path):
                file_path = f"{base}_{counter}{ext}"
                counter += 1

            file.save(file_path)
            uploaded_count += 1

    # Refresh studies after upload
    refresh_studies()

    return jsonify({
        'message': f'Uploaded {uploaded_count} files',
        'count': uploaded_count
    })


@app.route('/api/load-folder', methods=['POST'])
def load_folder():
    """Load DICOM files from a local folder path."""
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'No path provided'}), 400

    folder_path = data['path']

    if not os.path.exists(folder_path):
        return jsonify({'error': 'Path does not exist'}), 404

    if not os.path.isdir(folder_path):
        return jsonify({'error': 'Path is not a directory'}), 400

    # Scan the folder and add to cache
    new_studies = scan_dicom_files(folder_path)

    # Merge with existing cache
    studies_cache.update(new_studies)

    return jsonify({
        'message': f'Loaded {len(new_studies)} studies from {folder_path}',
        'study_count': len(new_studies)
    })


@app.route('/api/find-folder', methods=['POST'])
def find_folder():
    """Find a folder by name using Spotlight (macOS) and load it."""
    import subprocess

    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'No folder name provided'}), 400

    folder_name = data['name']

    # Use mdfind (Spotlight) to find the folder - much faster than find
    try:
        result = subprocess.run(
            ['mdfind', '-name', folder_name, '-onlyin', os.path.expanduser('~')],
            capture_output=True, text=True, timeout=10
        )
        paths = [p for p in result.stdout.strip().split('\n') if p and os.path.isdir(p) and p.endswith('/' + folder_name)]
    except Exception:
        paths = []

    if not paths:
        # Fallback: check common locations
        common_paths = [
            os.path.expanduser(f'~/Downloads/{folder_name}'),
            os.path.expanduser(f'~/Desktop/{folder_name}'),
            os.path.expanduser(f'~/Documents/{folder_name}'),
            f'/Volumes/*/{folder_name}',
        ]
        import glob
        for pattern in common_paths:
            matches = glob.glob(pattern)
            paths.extend([p for p in matches if os.path.isdir(p)])

    if not paths:
        return jsonify({'error': f'Could not find folder "{folder_name}"', 'found': False}), 404

    # Use the first match
    folder_path = paths[0]

    # Scan the folder
    new_studies = scan_dicom_files(folder_path)
    studies_cache.update(new_studies)

    return jsonify({
        'message': f'Loaded {len(new_studies)} studies from {folder_path}',
        'path': folder_path,
        'study_count': len(new_studies),
        'found': True
    })


# =============================================================================
# FLASK ROUTES - TEST DATA API
# These endpoints provide test data for automated testing, bypassing the
# File System Access API requirement.
# =============================================================================

def get_test_data():
    """Load test data from the configured test folder."""
    global test_data_cache
    if not test_data_cache:
        if os.path.exists(TEST_DATA_FOLDER):
            test_data_cache = scan_dicom_files(TEST_DATA_FOLDER)
    return test_data_cache


@app.route('/api/test-data/studies')
def get_test_studies():
    """Get list of studies from test data folder."""
    studies = get_test_data()
    studies_list = []
    for study_id, study in studies.items():
        series_list = []
        for series_id, series in study['series'].items():
            series_list.append({
                'seriesInstanceUid': series_id,
                'seriesDescription': series['series_description'],
                'seriesNumber': series['series_number'],
                'modality': series['modality'],
                'sliceCount': len(series['slices'])
            })
        studies_list.append({
            'studyInstanceUid': study_id,
            'patientName': study['patient_name'],
            'patientId': study['patient_id'],
            'studyDate': study['study_date'],
            'studyDescription': study['study_description'],
            'modality': study['modality'],
            'seriesCount': len(study['series']),
            'imageCount': study['image_count'],
            'series': series_list
        })
    return jsonify(studies_list)


@app.route('/api/test-data/dicom/<study_id>/<series_id>/<int:slice_num>')
def get_test_dicom(study_id, series_id, slice_num):
    """Get raw DICOM file bytes for a test data slice."""
    studies = get_test_data()

    if study_id not in studies:
        return jsonify({'error': 'Study not found'}), 404

    study = studies[study_id]
    if series_id not in study['series']:
        return jsonify({'error': 'Series not found'}), 404

    series = study['series'][series_id]
    if slice_num < 0 or slice_num >= len(series['slices']):
        return jsonify({'error': 'Slice index out of range'}), 404

    slice_info = series['slices'][slice_num]
    file_path = slice_info['file_path']

    try:
        return send_file(file_path, mimetype='application/dicom')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/test-data/info')
def get_test_info():
    """Get info about available test data."""
    studies = get_test_data()
    return jsonify({
        'testDataFolder': TEST_DATA_FOLDER,
        'available': os.path.exists(TEST_DATA_FOLDER),
        'studyCount': len(studies),
        'totalImages': sum(s['image_count'] for s in studies.values())
    })


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

if __name__ == '__main__':
    # Ensure upload folder exists
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    # Scan for any existing DICOM files in uploads folder
    refresh_studies()

    # Start Flask development server
    # In production, use a proper WSGI server like gunicorn
    app.run(debug=True, host='0.0.0.0', port=5001)
