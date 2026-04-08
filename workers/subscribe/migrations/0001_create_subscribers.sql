CREATE TABLE subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
    subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
    unsubscribed_at TEXT,
    source TEXT NOT NULL DEFAULT 'landing' CHECK (source IN ('landing', 'demo', 'app')),
    consent_version TEXT NOT NULL DEFAULT 'v1'
);
