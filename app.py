"""
DICOM CT Viewer - Flask Server Entry Point

Divergent Health Technologies
https://divergent.health/

Thin entry point that creates the Flask app via the server package factory.
All route and configuration logic lives in server/.

Copyright (c) 2026 Divergent Health Technologies
"""

import logging
import os

from server import create_app

app = create_app()


def _find_free_port(preferred, host):
    """Try preferred port, fall back to OS-assigned port on EADDRINUSE only."""
    import errno
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, preferred))
        sock.close()
        return preferred
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            sock.close()
            raise
        sock.close()

    # Let the OS pick a free port.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((host, 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    host = '0.0.0.0' if os.environ.get('FLASK_HOST') == '0.0.0.0' else '127.0.0.1'
    explicit_port = os.environ.get('FLASK_PORT')
    preferred = int(explicit_port) if explicit_port else 5001

    if host == '0.0.0.0':
        logging.warning(
            "SECURITY: Binding to 0.0.0.0 exposes the server on all network "
            "interfaces. PHI routes require a session token, but /api/session "
            "will be reachable from the network. Set FLASK_HOST=127.0.0.1 "
            "(the default) for local-only access."
        )

    if explicit_port:
        # Explicit override: fail hard if unavailable.
        port = preferred
    else:
        # Default 5001: auto-fallback on EADDRINUSE.
        port = _find_free_port(preferred, host)
        if port != preferred:
            app.logger.warning("Port %d in use, using port %d instead", preferred, port)

    app.run(debug=debug, host=host, port=port)
