"""
Library routes: local DICOM folder config, study listing, DICOM file serving,
folder scanning, and the DicomFolderSource cache.

Copyright (c) 2026 Divergent Health Technologies
"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pydicom
from flask import Blueprint, jsonify, request, send_file, current_app
from pydicom.errors import InvalidDicomError

from server import db as db_module

library_bp = Blueprint('library', __name__)

# Persistent local library folder defaults (personal mode)
DEFAULT_LIBRARY_FOLDER_RAW = '~/DICOMs'
DEFAULT_LIBRARY_FOLDER = os.path.expanduser(DEFAULT_LIBRARY_FOLDER_RAW)

# Library config synchronization
LIBRARY_CONFIG_LOCK = threading.Lock()


# =============================================================================
# DICOM SCANNING
# =============================================================================

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
        'study_instance_uid': get_attr('StudyInstanceUID', '').strip(),
        'series_description': get_attr('SeriesDescription', ''),
        'series_instance_uid': get_attr('SeriesInstanceUID', '').strip(),
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


def scan_dicom_folder(folder_path, logger=None):
    """Scan a folder for DICOM files and organize by study/series."""
    studies = {}
    folder = Path(folder_path)

    if not folder.exists():
        return studies

    file_paths = [f for f in folder.rglob('*') if f.is_file()]
    if logger:
        logger.info("Scanning %d files in %s", len(file_paths), folder_path)

    with ThreadPoolExecutor(max_workers=(os.cpu_count() or 4) * 2) as executor:
        futures = {executor.submit(_read_single_dicom, fp): fp for fp in file_paths}

        for future in as_completed(futures):
            meta = future.result()
            if meta is None or not meta['study_instance_uid'] or not meta['series_instance_uid']:
                continue

            study_id = meta['study_instance_uid']
            series_id = meta['series_instance_uid']

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

    if logger:
        logger.info("Found %d studies in %s", len(studies), folder_path)
    return studies


# =============================================================================
# DICOM FOLDER SOURCE (CACHED SCANNER)
# =============================================================================

class DicomFolderSource:
    """Reusable DICOM folder scanner with caching."""

    def __init__(self, folder_path):
        self.folder_path = folder_path
        self._cache = None
        self._lock = threading.Lock()
        self._scan_cv = threading.Condition(self._lock)
        self._scan_in_progress = False

    def is_available(self):
        return os.path.exists(self.folder_path)

    def get_data(self):
        """Load studies from the folder (cached)."""
        with self._scan_cv:
            while True:
                if self._cache is not None:
                    return self._cache
                if self._scan_in_progress:
                    self._scan_cv.wait()
                    continue
                if not os.path.exists(self.folder_path):
                    return {}
                self._scan_in_progress = True
                break

        try:
            scanned = scan_dicom_folder(self.folder_path)
        except Exception:
            with self._scan_cv:
                self._scan_in_progress = False
                self._scan_cv.notify_all()
            raise

        with self._scan_cv:
            if self._cache is None:
                self._cache = scanned
            self._scan_in_progress = False
            self._scan_cv.notify_all()
            return self._cache or {}

    def refresh(self):
        """Rescan folder and refresh cache."""
        with self._scan_cv:
            while self._scan_in_progress:
                self._scan_cv.wait()
            self._scan_in_progress = True

        try:
            if os.path.exists(self.folder_path):
                scanned = scan_dicom_folder(self.folder_path)
            else:
                scanned = None
        except Exception:
            with self._scan_cv:
                self._scan_in_progress = False
                self._scan_cv.notify_all()
            raise

        with self._scan_cv:
            self._cache = scanned
            self._scan_in_progress = False
            self._scan_cv.notify_all()
            return self._cache or {}

    def set_folder(self, new_path):
        """Change source folder path and refresh cache from that folder."""
        with self._scan_cv:
            while self._scan_in_progress:
                self._scan_cv.wait()
            folder_path = new_path
            self.folder_path = folder_path
            self._cache = None
            self._scan_in_progress = True

        try:
            if os.path.exists(folder_path):
                scanned = scan_dicom_folder(folder_path)
            else:
                scanned = None
        except Exception:
            with self._scan_cv:
                self._scan_in_progress = False
                self._scan_cv.notify_all()
            raise

        with self._scan_cv:
            self._cache = scanned
            self._scan_in_progress = False
            self._scan_cv.notify_all()
            return self._cache or {}

    def format_studies(self, studies=None):
        """Format studies in the JSON shape expected by the frontend."""
        if studies is None:
            studies = self.get_data()
        return [
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
        ]

    def get_slice_path(self, study_id, series_id, slice_num):
        """Look up file path for a specific slice. Returns path or None."""
        studies = self.get_data()
        study = studies.get(study_id)
        if not study:
            return None

        series = study['series'].get(series_id)
        if not series:
            return None

        if slice_num < 0 or slice_num >= len(series['slices']):
            return None

        return series['slices'][slice_num]['file_path']

    def get_safe_slice_path(self, study_id, series_id, slice_num):
        """Look up a slice path and ensure it stays inside source folder."""
        file_path = self.get_slice_path(study_id, series_id, slice_num)
        if not file_path:
            return None

        try:
            resolved_path = Path(file_path).resolve()
            resolved_root = Path(self.folder_path).resolve()
            if not resolved_path.is_relative_to(resolved_root):
                return None
            return str(resolved_path)
        except Exception:
            return None


# =============================================================================
# MODULE-LEVEL STATE (initialized by init_library_sources)
# =============================================================================

# These are set once at app startup via init_library_sources().
library_source = None
library_folder_raw = None
library_folder_source = None


def _resolve_library_folder(logger):
    """Resolve active library folder from env/settings/default precedence."""
    env = os.environ.get('DICOM_LIBRARY')
    if isinstance(env, str) and env.strip():
        raw = env.strip()
        return {
            'folder': raw,
            'folder_resolved': os.path.expanduser(raw),
            'source': 'env'
        }

    settings = db_module.load_settings(logger)
    saved = settings.get('library_folder')
    if isinstance(saved, str) and saved.strip():
        raw = saved.strip()
        return {
            'folder': raw,
            'folder_resolved': os.path.expanduser(raw),
            'source': 'settings'
        }

    return {
        'folder': DEFAULT_LIBRARY_FOLDER_RAW,
        'folder_resolved': DEFAULT_LIBRARY_FOLDER,
        'source': 'default'
    }


def init_library_sources(logger):
    """Initialize the library source from settings. Called once at startup."""
    global library_source, library_folder_raw, library_folder_source

    config = _resolve_library_folder(logger)
    library_folder_raw = config['folder']
    library_folder_source = config['source']
    library_source = DicomFolderSource(config['folder_resolved'])


# =============================================================================
# LIBRARY ROUTE HELPERS
# =============================================================================

def _ensure_library_folder():
    """Ensure active library folder exists/readable (auto-create default only)."""
    with LIBRARY_CONFIG_LOCK:
        folder_path = library_source.folder_path
        folder_label = library_folder_raw
        source = library_folder_source

    if source != 'default':
        if not os.path.isdir(folder_path):
            return False, f"Directory does not exist: {folder_label}"
        if not os.access(folder_path, os.R_OK | os.X_OK):
            return False, f"Directory is not readable: {folder_label}"
        return True, None

    try:
        os.makedirs(folder_path, exist_ok=True)
    except PermissionError:
        current_app.logger.warning("Permission denied creating library folder: %s", folder_path)
        return False, f"Permission denied creating {folder_label}"
    except OSError as exc:
        current_app.logger.warning("Failed to create library folder %s: %s", folder_path, exc)
        return False, f"Failed to create {folder_label}"

    if not os.access(folder_path, os.R_OK | os.X_OK):
        return False, f"Directory is not readable: {folder_label}"
    return True, None


def _build_library_config_payload():
    with LIBRARY_CONFIG_LOCK:
        return {
            'folder': library_folder_raw,
            'folderResolved': library_source.folder_path,
            'source': library_folder_source
        }


# =============================================================================
# LIBRARY ROUTES
# =============================================================================

@library_bp.route('/api/library/config')
def get_library_config():
    payload = _build_library_config_payload()
    payload['overridden'] = payload['source'] == 'env'
    return jsonify(payload)


@library_bp.route('/api/library/config', methods=['POST'])
def update_library_config():
    global library_folder_raw
    global library_folder_source

    payload = request.get_json(silent=True) or {}
    folder = payload.get('folder')
    if not isinstance(folder, str) or not folder.strip():
        return jsonify({'error': 'Folder is required'}), 400

    folder_raw = folder.strip()
    folder_path = os.path.expanduser(folder_raw)

    if not os.path.isdir(folder_path):
        return jsonify({'error': f'Directory does not exist: {folder_raw}'}), 400

    if not os.access(folder_path, os.R_OK | os.X_OK):
        return jsonify({'error': f'Directory is not readable: {folder_raw}'}), 400

    try:
        db_module.save_library_folder_setting(folder_raw, current_app.logger)
    except OSError as exc:
        current_app.logger.warning("Failed to save library settings %s: %s", db_module.SETTINGS_PATH, exc)
        return jsonify({'error': 'Failed to save settings'}), 500

    with LIBRARY_CONFIG_LOCK:
        source = library_folder_source

    # Environment variable has highest precedence; keep runtime folder unchanged.
    if source == 'env':
        available, error = _ensure_library_folder()
        response = {
            **_build_library_config_payload(),
            'available': available,
            'studies': library_source.format_studies() if available else [],
            'overridden': True
        }
        if error:
            response['error'] = error
        return jsonify(response)

    try:
        refreshed = library_source.set_folder(folder_path)
    except Exception:
        current_app.logger.exception("Failed to rescan updated library folder: %s", folder_path)
        return jsonify({'error': 'Failed to scan library folder'}), 500

    with LIBRARY_CONFIG_LOCK:
        library_folder_raw = folder_raw
        library_folder_source = 'settings'

    return jsonify({
        **_build_library_config_payload(),
        'available': True,
        'studies': library_source.format_studies(refreshed),
        'overridden': False
    })


@library_bp.route('/api/library/studies')
def get_library_studies():
    """Get studies from local persistent library folder."""
    available, error = _ensure_library_folder()
    current_config = _build_library_config_payload()

    payload = {
        'available': available,
        'folder': current_config['folder'],
        'studies': library_source.format_studies() if available else []
    }
    if error:
        payload['error'] = error
    return jsonify(payload)


@library_bp.route('/api/library/dicom/<study_id>/<series_id>/<int:slice_num>')
def get_library_dicom(study_id, series_id, slice_num):
    """Get raw DICOM file bytes for a local library slice."""
    file_path = library_source.get_safe_slice_path(study_id, series_id, slice_num)
    if not file_path:
        return jsonify({'error': 'Slice not found'}), 404

    try:
        return send_file(file_path, mimetype='application/dicom')
    except Exception:
        return jsonify({'error': 'Failed to read DICOM file'}), 500


@library_bp.route('/api/library/refresh', methods=['POST'])
def refresh_library():
    """Rescan local library folder and return updated studies."""
    available, error = _ensure_library_folder()
    current_config = _build_library_config_payload()
    if not available:
        return jsonify({
            'available': False,
            'folder': current_config['folder'],
            'studies': [],
            'error': error
        }), 500

    refreshed = library_source.refresh()
    return jsonify({
        'available': available,
        'folder': current_config['folder'],
        'studies': library_source.format_studies(refreshed)
    })
