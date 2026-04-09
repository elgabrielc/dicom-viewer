CREATE TABLE IF NOT EXISTS instrumentation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 0,
    installation_id TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    sessions INTEGER NOT NULL DEFAULT 0,
    studies_imported INTEGER NOT NULL DEFAULT 0,
    share_enabled INTEGER NOT NULL DEFAULT 0
);
