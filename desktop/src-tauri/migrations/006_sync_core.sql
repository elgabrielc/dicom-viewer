-- NOTE: The comments.record_uuid column (added in migration 003) is nullable
-- because SQLite does not support ALTER TABLE ... SET NOT NULL on existing
-- columns. The backfill in 003 populates it for all existing rows, and the
-- app layer + server-side validation ensure it is never null for new rows.

CREATE TABLE IF NOT EXISTS sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_uuid TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_key TEXT NOT NULL,
    operation TEXT NOT NULL,
    base_sync_version INTEGER,
    created_at INTEGER NOT NULL,
    synced_at INTEGER,
    attempts INTEGER DEFAULT 0,
    last_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_operation_uuid
    ON sync_outbox(operation_uuid);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON sync_outbox(synced_at) WHERE synced_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
);

-- Generate device_id as RFC 4122 v4 UUID (same format as migration 003)
INSERT OR IGNORE INTO sync_state (key, value, updated_at)
VALUES ('device_id',
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || '4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
    strftime('%s','now') * 1000);
