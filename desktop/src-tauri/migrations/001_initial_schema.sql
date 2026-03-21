CREATE TABLE IF NOT EXISTS study_notes (
    study_uid TEXT PRIMARY KEY,
    description TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS series_notes (
    study_uid TEXT NOT NULL,
    series_uid TEXT NOT NULL,
    description TEXT,
    updated_at INTEGER,
    PRIMARY KEY (study_uid, series_uid)
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_uid TEXT NOT NULL,
    series_uid TEXT,
    text TEXT NOT NULL,
    time INTEGER NOT NULL,
    UNIQUE(study_uid, series_uid, text, time)
);

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    study_uid TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    file_path TEXT,
    added_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_dedup
ON comments(study_uid, series_uid, text, time);
