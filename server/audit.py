"""
HIPAA audit logging: cross-cutting after_request hook for PHI-bearing routes.

Logs who accessed what, when -- without storing request/response bodies
(which would make the audit log itself a PHI store).

Copyright (c) 2026 Divergent Health Technologies
"""

import hashlib
import logging
import re
import time

from flask import g, request

from server.db import get_db


logger = logging.getLogger(__name__)

# Route prefixes that carry PHI and must be audit-logged.
_AUDIT_PREFIXES = (
    '/api/notes/',
    '/api/library/',
    '/api/sync',
    '/api/auth/',
)

# Regex to extract study UIDs from known URL patterns.
# Matches DICOM UIDs: sequences of digits and dots (e.g., 1.2.840.113619.2.55.3).
_STUDY_UID_PATTERN = re.compile(
    r'/api/notes/([0-9][0-9.]+)'
)


def _should_audit(path):
    """Return True if this request path is PHI-bearing and should be logged."""
    return any(path.startswith(prefix) for prefix in _AUDIT_PREFIXES)


def _extract_study_uid(path):
    """Best-effort extraction of study UID from the URL path.

    Returns the UID string or None. This is intentionally lenient --
    it only needs to support known route patterns, not be a full parser.
    """
    match = _STUDY_UID_PATTERN.search(path)
    if match:
        return match.group(1)
    return None


def _hash_session_token():
    """SHA-256 hash of the session token for correlation without storing the raw value."""
    token = request.headers.get('X-Session-Token')
    if not token:
        return None
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _extract_device_id():
    """Extract device_id from the request context or body.

    Prefers g.device_id (set by JWT auth middleware) over parsing the body,
    since the body may not be JSON or may already be consumed.
    """
    # JWT auth middleware sets this
    device_id = getattr(g, 'device_id', None)
    if device_id:
        return device_id

    # For sync requests, device_id is in the JSON body. But reading the body
    # in an after_request hook is unreliable (it may be consumed). We only
    # use what's already available on g.
    return None


def audit_after_request(response):
    """Log the request to the audit_log table if it targets a PHI-bearing route.

    Registered as an after_request hook so it captures the response status code.
    Uses a direct INSERT with no explicit transaction -- SQLite WAL mode handles
    concurrent writes efficiently.
    """
    path = request.path

    if not _should_audit(path):
        return response

    timestamp_ms = int(time.time() * 1000)
    user_id = getattr(g, 'user_id', None)
    device_id = _extract_device_id()
    session_token_hash = _hash_session_token()
    method = request.method
    status_code = response.status_code
    study_uid = _extract_study_uid(path)
    ip_address = request.remote_addr
    user_agent = (request.headers.get('User-Agent') or '')[:200]

    try:
        db = get_db()
        db.execute(
            """
            INSERT INTO audit_log (
                timestamp, user_id, device_id, session_token_hash,
                method, path, status_code, study_uid,
                ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                timestamp_ms,
                str(user_id) if user_id is not None else None,
                device_id,
                session_token_hash,
                method,
                path,
                status_code,
                study_uid,
                ip_address,
                user_agent,
            ),
        )
        db.commit()
    except Exception:
        # Audit logging must never break the request. Log and continue.
        logger.exception("Failed to write audit log entry")

    return response


def cleanup_audit_log(days=90):
    """Delete audit log entries older than the specified number of days.

    Can be called on server startup or via a maintenance route.
    Returns the number of rows deleted.
    """
    cutoff_ms = int((time.time() - days * 86400) * 1000)
    try:
        db = get_db()
        cursor = db.execute(
            "DELETE FROM audit_log WHERE timestamp < ?",
            (cutoff_ms,),
        )
        db.commit()
        deleted = cursor.rowcount
        if deleted > 0:
            logger.info("Audit log cleanup: deleted %d entries older than %d days", deleted, days)
        return deleted
    except Exception:
        logger.exception("Failed to clean up audit log")
        return 0
