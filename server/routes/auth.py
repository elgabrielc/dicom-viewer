"""
Authentication endpoints: signup, login, token refresh, device registration.

All routes live under /api/auth/. These are cloud-mode only -- personal and
desktop modes continue using the existing session-token auth.

Copyright (c) 2026 Divergent Health Technologies
"""

import re
import sqlite3

import jwt as pyjwt
from flask import Blueprint, g, jsonify, request

from server.auth.jwt_utils import (
    ACCESS_TOKEN_LIFETIME,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
)
from server.auth.models import (
    create_device,
    create_user,
    get_device,
    get_user_by_email,
    get_user_by_id,
    list_devices,
    verify_password,
)

auth_bp = Blueprint('auth', __name__)

# Minimum password length for new accounts
MIN_PASSWORD_LENGTH = 8

# Simple email validation -- just checks structure, not deliverability
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@auth_bp.route('/api/auth/signup', methods=['POST'])
def signup():
    """Create a new user account.

    Request body: { email, password, name }
    Returns: { access_token, refresh_token, expires_in }
    """
    data = request.get_json(silent=True) or {}

    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()

    # Validate inputs
    if not email or not _EMAIL_RE.match(email):
        return jsonify({'error': 'Valid email is required'}), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify({
            'error': f'Password must be at least {MIN_PASSWORD_LENGTH} characters'
        }), 400
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    try:
        user_id = create_user(email, password, name)
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 409

    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)

    return jsonify({
        'access_token': access_token,
        'refresh_token': refresh_token,
        'expires_in': ACCESS_TOKEN_LIFETIME,
    }), 201


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    """Authenticate with email + password.

    Request body: { email, password }
    Returns: { access_token, refresh_token, expires_in }
    """
    data = request.get_json(silent=True) or {}

    email = (data.get('email') or '').strip()
    password = data.get('password') or ''

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    user = get_user_by_email(email)
    if user is None or not verify_password(user, password):
        # Deliberately vague to avoid user enumeration
        return jsonify({'error': 'Invalid email or password'}), 401

    access_token = create_access_token(user['id'])
    refresh_token = create_refresh_token(user['id'])

    return jsonify({
        'access_token': access_token,
        'refresh_token': refresh_token,
        'expires_in': ACCESS_TOKEN_LIFETIME,
    })


@auth_bp.route('/api/auth/refresh', methods=['POST'])
def refresh():
    """Exchange a valid refresh token for a new access token.

    Request body: { refresh_token }
    Returns: { access_token, expires_in }
    """
    data = request.get_json(silent=True) or {}
    token = data.get('refresh_token') or ''

    if not token:
        return jsonify({'error': 'Refresh token is required'}), 400

    try:
        payload = decode_refresh_token(token)
    except pyjwt.ExpiredSignatureError:
        return jsonify({'error': 'Refresh token expired'}), 401
    except pyjwt.InvalidTokenError:
        return jsonify({'error': 'Invalid refresh token'}), 401

    user_id = payload['sub']

    # Verify user still exists (could have been deleted)
    user = get_user_by_id(user_id)
    if user is None:
        return jsonify({'error': 'User not found'}), 401

    access_token = create_access_token(user_id)

    return jsonify({
        'access_token': access_token,
        'expires_in': ACCESS_TOKEN_LIFETIME,
    })


# ---------------------------------------------------------------------------
# Device registration (requires authentication)
# ---------------------------------------------------------------------------

@auth_bp.route('/api/auth/devices', methods=['POST'])
def register_device():
    """Register a new device for the authenticated user.

    Request body: { device_name, platform }
    Returns: { device_id }
    """
    # Require JWT auth for device registration
    auth_error = _require_jwt_auth()
    if auth_error is not None:
        return auth_error

    data = request.get_json(silent=True) or {}
    device_name = (data.get('device_name') or '').strip()
    platform = (data.get('platform') or '').strip()

    if not device_name:
        return jsonify({'error': 'device_name is required'}), 400
    if not platform:
        return jsonify({'error': 'platform is required'}), 400

    device_id = create_device(g.user_id, device_name, platform)

    return jsonify({'device_id': device_id}), 201


@auth_bp.route('/api/auth/devices', methods=['GET'])
def list_user_devices():
    """List all devices registered to the authenticated user.

    Returns: { devices: [{ id, device_name, platform, created_at }] }
    """
    auth_error = _require_jwt_auth()
    if auth_error is not None:
        return auth_error

    devices = list_devices(g.user_id)
    return jsonify({
        'devices': [
            {
                'id': d['id'],
                'device_name': d['device_name'],
                'platform': d['platform'],
                'created_at': d['created_at'],
            }
            for d in devices
        ]
    })


# ---------------------------------------------------------------------------
# JWT auth middleware (for use by this blueprint and sync routes)
# ---------------------------------------------------------------------------

def require_cloud_auth(func):
    """Decorator that enforces JWT bearer-token authentication.

    Sets g.user_id and g.device_id (device_id may be None if the token
    was created before a device was registered).

    Returns 401 JSON response on missing/expired/invalid token.
    """
    from functools import wraps

    @wraps(func)
    def wrapper(*args, **kwargs):
        auth_error = _require_jwt_auth()
        if auth_error is not None:
            return auth_error
        return func(*args, **kwargs)
    return wrapper


def validate_device_ownership(device_id, user_id):
    """Validate that device_id belongs to user_id.

    Returns:
        (None, None) on success.
        (error_response, status_code) on failure.
    """
    if not device_id:
        return jsonify({'error': 'device_not_registered', 'message': 'device_id is required'}), 403

    device = get_device(device_id, user_id)
    if device is None:
        return jsonify({'error': 'device_not_registered', 'message': 'Device not registered for this user'}), 403

    return None, None


def _require_jwt_auth():
    """Extract and validate JWT from Authorization header.

    On success: sets g.user_id and g.device_id, returns None.
    On failure: returns a (response, status_code) tuple.
    """
    auth_header = request.headers.get('Authorization', '')

    if not auth_header.startswith('Bearer '):
        return jsonify({'error': 'unauthorized', 'message': 'Missing or malformed Authorization header'}), 401

    token = auth_header[7:]  # Strip "Bearer " prefix

    try:
        payload = decode_access_token(token)
    except pyjwt.ExpiredSignatureError:
        return jsonify({'error': 'unauthorized', 'message': 'Access token expired'}), 401
    except pyjwt.InvalidTokenError:
        return jsonify({'error': 'unauthorized', 'message': 'Invalid access token'}), 401

    g.user_id = payload['sub']
    g.device_id = payload.get('device_id')

    return None
