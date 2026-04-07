"""
Security middleware: CSRF origin check, session token auth, security headers.

Copyright (c) 2026 Divergent Health Technologies
"""

import secrets
from urllib.parse import urlparse

from flask import jsonify, request

# Per-process session token for browser-session authentication.
# Generated once at startup; the frontend fetches it via GET /api/session.
# This prevents browser CSRF and casual unauthenticated access to PHI routes.
# Threat model: a local hostile process that can GET /api/session can obtain
# the token. That's acceptable -- the goal is browser-level hardening, not
# OS-level process isolation.
SESSION_TOKEN = secrets.token_urlsafe(32)

# Routes that carry PHI and require session-token authentication.
# /api/test-data/* is intentionally excluded (anonymized sample data).
_PHI_ROUTE_PREFIXES = ('/api/notes', '/api/library/', '/api/maintenance')


def _is_test_mode_request():
    """Check whether the request originates from a ?test session.

    Playwright tests hit the server without a browser page context, so they
    send requests with neither Origin nor Referer. The ?test query parameter
    on the page load signals test mode. For direct API requests (Playwright's
    request fixture), we check for the X-Test-Mode header instead.
    """
    if request.args.get('test') is not None:
        return True
    return request.headers.get('X-Test-Mode') == '1'


def csrf_origin_check():
    """Block cross-origin state-modifying requests (CSRF protection).

    For POST/PUT/DELETE, verify that the Origin or Referer header matches
    the server's own host. This prevents malicious websites from submitting
    forms or fetch requests to the local server while a user is browsing.
    Multipart uploads are the primary concern since they bypass CORS preflight.

    Requests with neither Origin nor Referer are rejected by default for
    mutating methods. The only exception is test-mode requests (identified
    by ?test query param or X-Test-Mode header) to support Playwright tests
    which use bare API calls without browser context.
    """
    if request.method in ('POST', 'PUT', 'DELETE'):
        origin = request.headers.get('Origin')
        if not origin:
            # Fall back to Referer if Origin is absent (some browsers strip it)
            referer = request.headers.get('Referer')
            if referer:
                parsed = urlparse(referer)
                origin = f'{parsed.scheme}://{parsed.netloc}'

        if origin:
            origin_host = urlparse(origin).netloc
            server_host = request.host  # includes port
            if origin_host != server_host:
                return jsonify({'error': 'Cross-origin request blocked'}), 403
        else:
            # No Origin/Referer present -- reject unless in test mode.
            # Modern browsers always send Origin on state-modifying requests,
            # so a missing header means curl/script/test, not a real browser.
            if not _is_test_mode_request():
                return jsonify({'error': 'Missing Origin header'}), 403


def session_token_check():
    """Require session token on all PHI-bearing routes.

    The token is generated per server process and served via GET /api/session.
    The frontend fetches it at boot and includes it as X-Session-Token on all
    subsequent requests. This prevents browser CSRF and casual unauthenticated
    access without requiring user credentials (Stage 0 hardening).

    Test-mode requests (X-Test-Mode: 1) bypass the check so Playwright tests
    can exercise the API without fetching the token first.
    """
    path = request.path

    # Only check PHI routes
    needs_token = any(path.startswith(prefix) for prefix in _PHI_ROUTE_PREFIXES)
    if not needs_token:
        return

    # Bypass for test mode (Playwright)
    if _is_test_mode_request():
        return

    token = request.headers.get('X-Session-Token')
    if not token or not secrets.compare_digest(token, SESSION_TOKEN):
        return jsonify({'error': 'Unauthorized'}), 401


def set_security_headers(response):
    """Add standard security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response
