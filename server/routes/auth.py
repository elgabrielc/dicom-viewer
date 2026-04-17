"""
Authentication endpoints: signup, login, token refresh, device registration.

All routes live under /api/auth/. These are cloud-mode only -- personal and
desktop modes continue using the existing session-token auth.

Copyright (c) 2026 Divergent Health Technologies
"""

import hashlib
import re
import sqlite3
import threading
import time
from collections import defaultdict, deque

import jwt as pyjwt
from flask import Blueprint, current_app, g, jsonify, request

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

# Sliding-window auth throttling keyed by (route, ip, email). This slows
# repeated guessing for a target account without locking out unrelated signups
# or broad test runs that create many unique users from the same machine.
_AUTH_WINDOW_SECONDS = 15 * 60
_AUTH_MAX_ATTEMPTS = 5
_AUTH_SWEEP_INTERVAL_SECONDS = 60
_AUTH_FAILURES = defaultdict(deque)
_AUTH_FAILURES_LOCK = threading.Lock()
_AUTH_LAST_SWEEP_AT = 0


def _normalize_email(email):
    return (email or '').strip().lower()


def _client_ip():
    forwarded = request.headers.get('X-Forwarded-For', '')
    if current_app.config.get('TRUST_X_FORWARDED_FOR') and forwarded:
        return forwarded.split(',')[0].strip() or 'unknown'
    return request.remote_addr or 'unknown'


def _auth_failure_key(action, email):
    normalized = _normalize_email(email) or '*'
    return f'{action}:{_client_ip()}:{normalized}'


def _prune_attempts(attempts, now_s):
    cutoff = now_s - _AUTH_WINDOW_SECONDS
    while attempts and attempts[0] <= cutoff:
        attempts.popleft()


def _sweep_auth_failures(now_s):
    stale_keys = []
    for key, attempts in list(_AUTH_FAILURES.items()):
        _prune_attempts(attempts, now_s)
        if not attempts:
            stale_keys.append(key)

    for key in stale_keys:
        _AUTH_FAILURES.pop(key, None)


def _maybe_sweep_auth_failures(now_s):
    global _AUTH_LAST_SWEEP_AT

    if now_s - _AUTH_LAST_SWEEP_AT < _AUTH_SWEEP_INTERVAL_SECONDS and _AUTH_FAILURES:
        return

    _sweep_auth_failures(now_s)
    _AUTH_LAST_SWEEP_AT = now_s


def _rate_limit_retry_after(action, email):
    now_s = int(time.time())
    key = _auth_failure_key(action, email)
    with _AUTH_FAILURES_LOCK:
        _maybe_sweep_auth_failures(now_s)
        attempts = _AUTH_FAILURES.get(key)
        if attempts is None:
            return None
        _prune_attempts(attempts, now_s)
        if not attempts:
            _AUTH_FAILURES.pop(key, None)
            return None
        if len(attempts) < _AUTH_MAX_ATTEMPTS:
            return None
        return max(1, _AUTH_WINDOW_SECONDS - (now_s - attempts[0]))


def _record_auth_failure(action, email):
    now_s = int(time.time())
    key = _auth_failure_key(action, email)
    with _AUTH_FAILURES_LOCK:
        _maybe_sweep_auth_failures(now_s)
        attempts = _AUTH_FAILURES[key]
        _prune_attempts(attempts, now_s)
        attempts.append(now_s)


def _clear_auth_failures(action, email):
    key = _auth_failure_key(action, email)
    with _AUTH_FAILURES_LOCK:
        _AUTH_FAILURES.pop(key, None)


def _log_auth_event(action, email, event, retry_after=None):
    normalized = _normalize_email(email)
    hashed_email = (
        hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:12] if normalized else '-'
    )
    current_app.logger.warning(
        'auth_%s action=%s ip=%s email_hash=%s retry_after=%s',
        event,
        action,
        _client_ip(),
        hashed_email,
        retry_after if retry_after is not None else '-',
    )


def _rate_limited_response(retry_after):
    response = jsonify({'error': 'Too many attempts. Please try again later.'})
    response.status_code = 429
    response.headers['Retry-After'] = str(retry_after)
    return response


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------


@auth_bp.route('/api/auth/signup', methods=['POST'])
def signup():
    """Create a new user account.

    Request body: { email, password, name }
    Returns: { accepted: true } without revealing whether the email was new.
    """
    data = request.get_json(silent=True) or {}

    email = _normalize_email(data.get('email'))
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()

    retry_after = _rate_limit_retry_after('signup', email)
    if retry_after is not None:
        _log_auth_event('signup', email, 'rate_limited', retry_after)
        return _rate_limited_response(retry_after)

    # Validate inputs
    if not email or not _EMAIL_RE.match(email):
        return jsonify({'error': 'Valid email is required'}), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify(
            {'error': f'Password must be at least {MIN_PASSWORD_LENGTH} characters'}
        ), 400
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    try:
        create_user(email, password, name)
    except sqlite3.IntegrityError:
        _record_auth_failure('signup', email)
        _log_auth_event('signup', email, 'duplicate')
        return jsonify({'accepted': True}), 202

    _clear_auth_failures('signup', email)
    return jsonify({'accepted': True}), 202


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    """Authenticate with email + password.

    Request body: { email, password }
    Returns: { access_token, refresh_token, expires_in }
    """
    data = request.get_json(silent=True) or {}

    email = _normalize_email(data.get('email'))
    password = data.get('password') or ''

    retry_after = _rate_limit_retry_after('login', email)
    if retry_after is not None:
        _log_auth_event('login', email, 'rate_limited', retry_after)
        return _rate_limited_response(retry_after)

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    user = get_user_by_email(email)
    if user is None or not verify_password(user, password):
        # Deliberately vague to avoid user enumeration
        _record_auth_failure('login', email)
        _log_auth_event('login', email, 'failed')
        return jsonify({'error': 'Invalid email or password'}), 401

    _clear_auth_failures('login', email)
    access_token = create_access_token(user['id'])
    refresh_token = create_refresh_token(user['id'])

    return jsonify(
        {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': ACCESS_TOKEN_LIFETIME,
        }
    )


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

    user_id = _coerce_subject_user_id(payload['sub'])

    # Verify user still exists (could have been deleted)
    user = get_user_by_id(user_id)
    if user is None:
        return jsonify({'error': 'User not found'}), 401

    access_token = create_access_token(user_id)

    return jsonify(
        {
            'access_token': access_token,
            'expires_in': ACCESS_TOKEN_LIFETIME,
        }
    )


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
    return jsonify(
        {
            'devices': [
                {
                    'id': d['id'],
                    'device_name': d['device_name'],
                    'platform': d['platform'],
                    'created_at': d['created_at'],
                }
                for d in devices
            ]
        }
    )


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
        return jsonify(
            {'error': 'device_not_registered', 'message': 'Device not registered for this user'}
        ), 403

    return None, None


def _coerce_subject_user_id(subject):
    """Normalize JWT subject claims back to numeric DB IDs when possible."""
    if isinstance(subject, int):
        return subject
    if isinstance(subject, str) and subject.isdigit():
        return int(subject)
    return subject


def _require_jwt_auth():
    """Extract and validate JWT from Authorization header.

    On success: sets g.user_id and g.device_id, returns None.
    On failure: returns a (response, status_code) tuple.
    """
    auth_header = request.headers.get('Authorization', '')

    if not auth_header.startswith('Bearer '):
        return jsonify(
            {'error': 'unauthorized', 'message': 'Missing or malformed Authorization header'}
        ), 401

    token = auth_header[7:]  # Strip "Bearer " prefix

    try:
        payload = decode_access_token(token)
    except pyjwt.ExpiredSignatureError:
        return jsonify({'error': 'unauthorized', 'message': 'Access token expired'}), 401
    except pyjwt.InvalidTokenError:
        return jsonify({'error': 'unauthorized', 'message': 'Invalid access token'}), 401

    g.user_id = _coerce_subject_user_id(payload['sub'])
    g.device_id = payload.get('device_id')

    return None
