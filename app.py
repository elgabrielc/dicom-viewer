"""
DICOM CT Viewer - Flask Backend

Divergent Health Technologies
https://divergent.health/

This module provides a Flask web server for the DICOM CT Viewer application.
The primary workflow uses client-side DICOM processing (via the File System
Access API in the browser). This server provides:

1. Static file serving (HTML, CSS, JS, WASM)
2. Test data API for automated Playwright tests

Routes:
    GET  /                                      - Main application page
    GET  /api/test-data/studies                 - List test studies (for tests)
    GET  /api/test-data/dicom/<study>/<series>/<slice> - Get DICOM bytes (for tests)
    GET  /api/test-data/info                    - Test data info (for tests)

Copyright (c) 2026 Divergent Health Technologies
"""

import os
import hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, jsonify, send_file
import pydicom
from pydicom.errors import InvalidDicomError


# =============================================================================
# FLASK APP CONFIGURATION
# =============================================================================

app = Flask(__name__, static_folder='docs', static_url_path='')

# Test data folder for automated testing (bypasses File System Access API)
TEST_DATA_FOLDER = os.environ.get(
    'DICOM_TEST_DATA',
    os.path.expanduser('~/claude 0/test-data-mri-1')
)

# Cache for test data (loaded once on first request)
_test_data_cache = None


# =============================================================================
# DICOM SCANNING
# =============================================================================

def _generate_id(uid):
    """Generate a short ID from a DICOM UID."""
    return hashlib.md5(uid.encode()).hexdigest()[:12]


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
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/test-data/info')
def get_test_info():
    """Get info about available test data."""
    studies = _get_test_data()
    return jsonify({
        'testDataFolder': TEST_DATA_FOLDER,
        'available': os.path.exists(TEST_DATA_FOLDER),
        'studyCount': len(studies),
        'totalImages': sum(s['image_count'] for s in studies.values())
    })


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
