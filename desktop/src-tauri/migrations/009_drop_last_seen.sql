-- Move the desktop instrumentation table from the v0.3.2 shape to the v0.4
-- consent shape. Migration 008 is intentionally kept as the historical schema
-- that shipped with last_seen and without consent_decision_at; this migration
-- adds consent_decision_at first, then rebuilds the table without last_seen.
ALTER TABLE instrumentation ADD COLUMN consent_decision_at TEXT;

DROP TABLE IF EXISTS instrumentation_next;

CREATE TABLE IF NOT EXISTS instrumentation_next (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 0,
    installation_id TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    sessions INTEGER NOT NULL DEFAULT 0,
    studies_imported INTEGER NOT NULL DEFAULT 0,
    share_enabled INTEGER NOT NULL DEFAULT 0,
    consent_decision_at TEXT
);

INSERT OR REPLACE INTO instrumentation_next (
    id,
    version,
    revision,
    installation_id,
    first_seen,
    sessions,
    studies_imported,
    share_enabled,
    consent_decision_at
)
SELECT
    id,
    version,
    revision,
    installation_id,
    first_seen,
    sessions,
    studies_imported,
    share_enabled,
    consent_decision_at
FROM instrumentation;

DROP TABLE instrumentation;

ALTER TABLE instrumentation_next RENAME TO instrumentation;
