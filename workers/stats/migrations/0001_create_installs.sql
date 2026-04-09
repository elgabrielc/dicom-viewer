-- ADR 008 phone-home receiver.
--
-- One row per installation. The primary key is the client-generated
-- installationId (UUID v4). Upserts in the worker use the `revision`
-- column to ignore stale writes.
CREATE TABLE IF NOT EXISTS installs (
    install_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_installs_last_seen ON installs(last_seen);
