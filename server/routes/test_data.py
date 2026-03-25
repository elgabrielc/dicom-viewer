"""
Test data routes: endpoints for automated Playwright tests.

Serves anonymized test DICOM data from a local folder, bypassing
the File System Access API that requires a real browser context.

Copyright (c) 2026 Divergent Health Technologies
"""

import os

from flask import Blueprint, jsonify, send_file

from server.routes.library import DicomFolderSource

test_data_bp = Blueprint('test_data', __name__)

# Test data folder for automated testing (bypasses File System Access API)
TEST_DATA_FOLDER = os.environ.get(
    'DICOM_TEST_DATA',
    os.path.expanduser('~/claude 0/test-data-mri-1')
)

# Module-level source, initialized at import time (same as original app.py)
test_source = DicomFolderSource(TEST_DATA_FOLDER)


@test_data_bp.route('/api/test-data/studies')
def get_test_studies():
    """Get list of studies from test data folder."""
    return jsonify(test_source.format_studies())


@test_data_bp.route('/api/test-data/dicom/<study_id>/<series_id>/<int:slice_num>')
def get_test_dicom(study_id, series_id, slice_num):
    """Get raw DICOM file bytes for a test data slice."""
    file_path = test_source.get_safe_slice_path(study_id, series_id, slice_num)
    if not file_path:
        return jsonify({'error': 'Slice not found'}), 404

    try:
        return send_file(file_path, mimetype='application/dicom')
    except Exception:
        return jsonify({'error': 'Failed to read DICOM file'}), 500


@test_data_bp.route('/api/test-data/info')
def get_test_info():
    """Get info about available test data."""
    studies = test_source.get_data()
    return jsonify({
        'available': test_source.is_available(),
        'studyCount': len(studies),
        'totalImages': sum(s['image_count'] for s in studies.values())
    })
