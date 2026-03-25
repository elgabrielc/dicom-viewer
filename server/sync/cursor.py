"""
Opaque cursor issuance, validation, and expiry.

Cursors are random tokens mapped to a monotonic server-side position.
The client never interprets the token -- it stores it opaquely and sends
it back on the next sync request. The server resolves the token to a
position (the sync_version watermark) to compute deltas.

Copyright (c) 2026 Divergent Health Technologies
"""

import secrets
import time

# Cursors expire after 7 days (in seconds)
CURSOR_TTL_SECONDS = 7 * 24 * 60 * 60


def issue_cursor(db, user_id, device_id, position):
    """Create a new cursor token pointing at *position* and persist it.

    Returns the opaque token string the client should store.
    """
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    expires_at = now + CURSOR_TTL_SECONDS

    db.execute(
        """
        INSERT INTO sync_cursors (cursor_token, user_id, device_id, position, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (token, user_id, device_id, position, now, expires_at),
    )
    return token


def validate_cursor(db, token, user_id):
    """Resolve *token* to a position for the given user.

    Returns:
        int | None -- the position if the cursor is valid, or None.

    Raises:
        CursorExpiredError   -- token found but past its expiry.
        CursorInvalidError   -- token not found or belongs to another user.
    """
    row = db.execute(
        "SELECT position, user_id, expires_at FROM sync_cursors WHERE cursor_token = ?",
        (token,),
    ).fetchone()

    if row is None:
        raise CursorInvalidError("Cursor token not found")

    if row["user_id"] != user_id:
        raise CursorInvalidError("Cursor belongs to another user")

    now = int(time.time())
    if row["expires_at"] < now:
        # Clean up the expired row
        db.execute("DELETE FROM sync_cursors WHERE cursor_token = ?", (token,))
        raise CursorExpiredError("Cursor has expired")

    return row["position"]


def cleanup_expired_cursors(db):
    """Remove all expired cursor rows. Call periodically to keep the table tidy."""
    now = int(time.time())
    db.execute("DELETE FROM sync_cursors WHERE expires_at < ?", (now,))


class CursorExpiredError(Exception):
    """Raised when a cursor token exists but has passed its TTL."""


class CursorInvalidError(Exception):
    """Raised when a cursor token is not found or belongs to another user."""
