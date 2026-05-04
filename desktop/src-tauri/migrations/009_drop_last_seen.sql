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
    NULL
FROM instrumentation;

DROP TABLE instrumentation;

ALTER TABLE instrumentation_next RENAME TO instrumentation;
