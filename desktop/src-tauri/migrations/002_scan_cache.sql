CREATE TABLE IF NOT EXISTS desktop_scan_cache (
    path TEXT PRIMARY KEY,
    root_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER,
    scanner_version INTEGER NOT NULL,
    renderable INTEGER NOT NULL,
    meta_json TEXT,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_scan_cache_root_path
    ON desktop_scan_cache (root_path);
