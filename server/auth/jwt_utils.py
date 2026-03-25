"""
JWT token generation, validation, and refresh utilities.

Access tokens are short-lived (15 minutes) and carry user_id + device_id.
Refresh tokens are long-lived (30 days) and carry user_id only.

Copyright (c) 2026 Divergent Health Technologies
"""

import os
import secrets
import time

import jwt


# Server secret for signing JWTs. Use environment variable in production,
# fall back to a per-process random secret for development.
JWT_SECRET = os.environ.get('JWT_SECRET', secrets.token_urlsafe(64))

# Algorithm for JWT signing
JWT_ALGORITHM = 'HS256'

# Token lifetimes in seconds
ACCESS_TOKEN_LIFETIME = 15 * 60       # 15 minutes
REFRESH_TOKEN_LIFETIME = 30 * 24 * 3600  # 30 days


def create_access_token(user_id, device_id=None):
    """Create a short-lived access token.

    Args:
        user_id: The authenticated user's database ID.
        device_id: Optional device UUID. Included when the client has
                   registered a device.

    Returns:
        Encoded JWT string.
    """
    now = int(time.time())
    payload = {
        'sub': user_id,
        'type': 'access',
        'iat': now,
        'exp': now + ACCESS_TOKEN_LIFETIME,
    }
    if device_id is not None:
        payload['device_id'] = device_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id):
    """Create a long-lived refresh token (user_id only, no device_id).

    Args:
        user_id: The authenticated user's database ID.

    Returns:
        Encoded JWT string.
    """
    now = int(time.time())
    payload = {
        'sub': user_id,
        'type': 'refresh',
        'iat': now,
        'exp': now + REFRESH_TOKEN_LIFETIME,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token):
    """Decode and validate an access token.

    Args:
        token: Encoded JWT string.

    Returns:
        Decoded payload dict on success.

    Raises:
        jwt.ExpiredSignatureError: Token has expired.
        jwt.InvalidTokenError: Token is malformed or has wrong type.
    """
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    if payload.get('type') != 'access':
        raise jwt.InvalidTokenError('Not an access token')
    return payload


def decode_refresh_token(token):
    """Decode and validate a refresh token.

    Args:
        token: Encoded JWT string.

    Returns:
        Decoded payload dict on success.

    Raises:
        jwt.ExpiredSignatureError: Token has expired.
        jwt.InvalidTokenError: Token is malformed or has wrong type.
    """
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    if payload.get('type') != 'refresh':
        raise jwt.InvalidTokenError('Not a refresh token')
    return payload
