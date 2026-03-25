"""
Sync engine: cursor management, delta computation, and change processing.

This package implements the server-side sync protocol defined in
docs/planning/SYNC-CONTRACT-V1.md. The POST /api/sync endpoint delegates
to these modules for cursor validation, change application, and delta
computation.

Copyright (c) 2026 Divergent Health Technologies
"""
