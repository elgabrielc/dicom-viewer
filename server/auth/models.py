"""
User and device database helpers.

Provides functions for creating/querying users and devices in the SQLite
database. The schema is created by server.db.init_db().

Copyright (c) 2026 Divergent Health Technologies
"""

import time
import uuid

from werkzeug.security import check_password_hash, generate_password_hash

from server.db import get_db

# --- User helpers ---


def create_user(email, password, name):
    """Create a new user account.

    Args:
        email: User's email (must be unique).
        password: Plaintext password (hashed before storage).
        name: Display name.

    Returns:
        The new user's row ID.

    Raises:
        sqlite3.IntegrityError: If the email already exists.
    """
    db = get_db()
    now = int(time.time() * 1000)
    cursor = db.execute(
        """INSERT INTO users (email, password_hash, name, created_at)
           VALUES (?, ?, ?, ?)""",
        (email.lower().strip(), generate_password_hash(password), name.strip(), now),
    )
    db.commit()
    return cursor.lastrowid


def get_user_by_email(email):
    """Look up a user by email address.

    Returns:
        sqlite3.Row with id, email, password_hash, name, created_at -- or None.
    """
    db = get_db()
    return db.execute(
        'SELECT id, email, password_hash, name, created_at FROM users WHERE email = ?',
        (email.lower().strip(),),
    ).fetchone()


def get_user_by_id(user_id):
    """Look up a user by primary key.

    Returns:
        sqlite3.Row or None.
    """
    db = get_db()
    return db.execute(
        'SELECT id, email, name, created_at FROM users WHERE id = ?', (user_id,)
    ).fetchone()


def verify_password(user_row, password):
    """Check a plaintext password against the stored hash.

    Args:
        user_row: sqlite3.Row containing password_hash.
        password: Plaintext password to verify.

    Returns:
        True if the password matches.
    """
    return check_password_hash(user_row['password_hash'], password)


# --- Device helpers ---


def create_device(user_id, device_name, platform):
    """Register a new device for the given user.

    Args:
        user_id: Owning user's database ID.
        device_name: Human-readable device name (e.g. "Gabriel's MacBook").
        platform: Client platform string (e.g. "macos", "windows", "web").

    Returns:
        The server-issued device UUID string.
    """
    db = get_db()
    device_id = str(uuid.uuid4())
    now = int(time.time() * 1000)
    db.execute(
        """INSERT INTO devices (id, user_id, device_name, platform, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (device_id, user_id, device_name.strip(), platform.strip(), now),
    )
    db.commit()
    return device_id


def get_device(device_id, user_id):
    """Look up a device, scoped to the owning user.

    Returns:
        sqlite3.Row or None (None means device doesn't exist or doesn't
        belong to this user).
    """
    db = get_db()
    return db.execute(
        'SELECT id, user_id, device_name, platform, created_at FROM devices '
        'WHERE id = ? AND user_id = ?',
        (device_id, user_id),
    ).fetchone()


def list_devices(user_id):
    """List all devices registered to a user.

    Returns:
        List of sqlite3.Row objects.
    """
    db = get_db()
    return db.execute(
        'SELECT id, device_name, platform, created_at FROM devices '
        'WHERE user_id = ? ORDER BY created_at',
        (user_id,),
    ).fetchall()
