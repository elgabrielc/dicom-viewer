"""
DICOM CT Viewer - Flask application factory.

Divergent Health Technologies
https://divergent.health/

This package provides the Flask web server for the DICOM CT Viewer application.
The primary workflow uses client-side DICOM processing (via the File System
Access API in the browser). This server provides:

1. Static file serving (HTML, CSS, JS, WASM)
2. Test data API for automated Playwright tests
3. Notes persistence API (SQLite) for comments, descriptions, and reports

Copyright (c) 2026 Divergent Health Technologies
"""

import os

from flask import Flask, jsonify

from server import db as db_module
from server.audit import audit_after_request
from server.maintenance import run_startup_maintenance
from server.routes.auth import auth_bp
from server.routes.comments import comments_bp
from server.routes.library import init_library_sources, library_bp
from server.routes.maintenance import maintenance_bp
from server.routes.reports import reports_bp
from server.routes.study_notes import study_notes_bp
from server.routes.sync import sync_bp
from server.routes.test_data import test_data_bp
from server.security import (
    SESSION_TOKEN,
    csrf_origin_check,
    session_token_check,
    set_security_headers,
)

# Project root is the parent of this package directory. The original app.py
# lived at the project root, so Flask's root_path was the project root.
# We preserve that so static_folder='docs' and DATA_DIR resolve correctly.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _env_flag(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def create_app():
    """Flask application factory. Returns a fully configured app instance."""
    app = Flask(
        __name__,
        static_folder=os.path.join(_PROJECT_ROOT, 'docs'),
        static_url_path='',
    )
    # Override root_path so DB paths and other root-relative logic stays correct
    app.root_path = _PROJECT_ROOT
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload limit
    app.config['TRUST_X_FORWARDED_FOR'] = _env_flag('TRUST_X_FORWARDED_FOR', False)

    # Initialize database paths and schema
    db_module.configure(app.root_path)
    db_module.init_db()

    # Initialize library folder source
    init_library_sources(app.logger)

    # Register security hooks.
    # Authenticate PHI routes before applying the Origin check so
    # unauthorized requests fail as 401 rather than leaking route behavior
    # behind a CSRF-oriented 403 path.
    app.before_request(session_token_check)
    app.before_request(csrf_origin_check)
    app.after_request(set_security_headers)
    app.after_request(audit_after_request)

    # Register teardown for DB connections
    app.teardown_appcontext(db_module.close_db)

    # Register blueprints
    app.register_blueprint(library_bp)
    app.register_blueprint(test_data_bp)
    app.register_blueprint(study_notes_bp)
    app.register_blueprint(comments_bp)
    app.register_blueprint(reports_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(sync_bp)
    app.register_blueprint(maintenance_bp)

    # Run lightweight startup maintenance (expired cursor cleanup, etc.)
    run_startup_maintenance(app)

    # Core routes (too small for their own blueprint)
    @app.route('/')
    def index():
        """Serve the main application."""
        return app.send_static_file('index.html')

    @app.route('/api/session')
    def get_session():
        """Return the per-process session token.

        The frontend fetches this once at boot and includes it as
        X-Session-Token on all subsequent API requests to PHI routes.
        Bound to loopback by default, so only local processes can obtain it.
        """
        return jsonify({'token': SESSION_TOKEN})

    return app
