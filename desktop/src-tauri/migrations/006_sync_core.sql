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

INSERT OR IGNORE INTO sync_state (key, value, updated_at)
VALUES ('device_id', lower(hex(randomblob(16))), strftime('%s','now') * 1000);
