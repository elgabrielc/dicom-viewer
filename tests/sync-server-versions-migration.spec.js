// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');

function resolvePythonCommand() {
    const venvPython = path.join(REPO_ROOT, 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
        return venvPython;
    }
    return process.env.PYTHON || 'python3';
}

const SYNC_SERVER_VERSIONS_MIGRATION_SCRIPT = `
import json
import os
import sqlite3
import sys

repo_root = sys.argv[1]
data_dir = sys.argv[2]

os.environ["DICOM_VIEWER_DATA_DIR"] = data_dir
sys.path.insert(0, repo_root)

from server import db as db_module

db_module.configure(repo_root)

conn = sqlite3.connect(db_module.DB_PATH)
conn.execute(
    """
    CREATE TABLE sync_server_versions (
        table_name TEXT NOT NULL,
        record_key TEXT NOT NULL,
        sync_version INTEGER NOT NULL DEFAULT 1,
        device_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (table_name, record_key)
    )
    """
)
conn.execute(
    """
    INSERT INTO sync_server_versions (
        table_name, record_key, sync_version, device_id, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    """,
    ("study_notes", "study-a", 7, "device-a", 1234),
)
conn.commit()
conn.close()

db_module.init_db()

conn = sqlite3.connect(db_module.DB_PATH)
conn.row_factory = sqlite3.Row

pk_columns = [
    row["name"]
    for row in sorted(
        conn.execute("PRAGMA table_info('sync_server_versions')").fetchall(),
        key=lambda row: row["pk"],
    )
    if row["pk"]
]

conn.execute(
    """
    INSERT INTO sync_server_versions (
        table_name, record_key, user_id, sync_version, device_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(table_name, record_key, user_id) DO UPDATE SET
        sync_version = excluded.sync_version,
        device_id = excluded.device_id,
        updated_at = excluded.updated_at
    """,
    ("study_notes", "study-a", "", 8, "device-b", 2345),
)
conn.execute(
    """
    INSERT INTO sync_server_versions (
        table_name, record_key, user_id, sync_version, device_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    """,
    ("study_notes", "study-a", "user-b", 1, "device-c", 3456),
)
conn.commit()

rows = [
    dict(row)
    for row in conn.execute(
        """
        SELECT table_name, record_key, user_id, sync_version, device_id
        FROM sync_server_versions
        ORDER BY user_id ASC
        """
    ).fetchall()
]

print(json.dumps({"pk_columns": pk_columns, "rows": rows}))
`;

test.describe('Sync server versions migration', () => {
    test('init_db rebuilds legacy non-user-scoped primary key', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicom-viewer-sync-versions-'));

        try {
            const output = execFileSync(
                resolvePythonCommand(),
                ['-c', SYNC_SERVER_VERSIONS_MIGRATION_SCRIPT, REPO_ROOT, dataDir],
                {
                    cwd: REPO_ROOT,
                    stdio: 'pipe',
                },
            );
            const result = JSON.parse(output.toString('utf8'));

            expect(result.pk_columns).toEqual(['table_name', 'record_key', 'user_id']);
            expect(result.rows).toEqual([
                expect.objectContaining({
                    user_id: '',
                    sync_version: 8,
                    device_id: 'device-b',
                }),
                expect.objectContaining({
                    user_id: 'user-b',
                    sync_version: 1,
                    device_id: 'device-c',
                }),
            ]);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});
