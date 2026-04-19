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

const INIT_DB_MIGRATION_SCRIPT = `
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
    CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        study_uid TEXT NOT NULL,
        series_uid TEXT,
        text TEXT NOT NULL,
        time INTEGER NOT NULL,
        record_uuid TEXT
    )
    """
)
conn.executemany(
    "INSERT INTO comments (study_uid, series_uid, text, time, record_uuid) VALUES (?, ?, ?, ?, ?)",
    [
        ("study-a", None, "first", 101, "11111111-2222-4333-8444-555555555555"),
        ("study-b", None, "second", 202, "11111111-2222-4333-8444-555555555555"),
        ("study-c", None, "third", 303, None),
    ],
)
conn.commit()
conn.close()

db_module.init_db()

conn = sqlite3.connect(db_module.DB_PATH)
conn.row_factory = sqlite3.Row
rows = [
    {
        "id": row["id"],
        "time": row["time"],
        "record_uuid": row["record_uuid"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    for row in conn.execute(
        "SELECT id, time, record_uuid, created_at, updated_at FROM comments ORDER BY id ASC"
    ).fetchall()
]
indexes = [
    {
        "name": row["name"],
        "unique": row["unique"],
        "partial": row["partial"],
    }
    for row in conn.execute("PRAGMA index_list('comments')").fetchall()
]

duplicate_insert_blocked = False
try:
    conn.execute(
        """
        INSERT INTO comments (
            study_uid,
            series_uid,
            text,
            time,
            record_uuid,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        ("study-d", None, "should fail", 404, rows[0]["record_uuid"], 404, 404),
    )
    conn.commit()
except sqlite3.IntegrityError:
    duplicate_insert_blocked = True

print(
    json.dumps(
        {
            "rows": rows,
            "indexes": indexes,
            "duplicate_insert_blocked": duplicate_insert_blocked,
        }
    )
)
`;

test.describe('Comment record_uuid migration', () => {
    test('init_db dedupes existing UUID collisions before creating the unique index', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicom-viewer-comment-uuid-'));

        try {
            const output = execFileSync(resolvePythonCommand(), ['-c', INIT_DB_MIGRATION_SCRIPT, REPO_ROOT, dataDir], {
                cwd: REPO_ROOT,
                stdio: 'pipe',
            });
            const result = JSON.parse(output.toString('utf8'));
            const uuids = result.rows.map((row) => row.record_uuid);

            expect(result.indexes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'idx_comments_record_uuid',
                        unique: 1,
                    }),
                ]),
            );
            expect(result.rows).toHaveLength(3);
            expect(uuids.every(Boolean)).toBe(true);
            expect(new Set(uuids).size).toBe(uuids.length);
            expect(result.rows[2]).toMatchObject({
                time: 303,
                created_at: 303,
                updated_at: 303,
            });
            expect(result.duplicate_insert_blocked).toBe(true);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});
