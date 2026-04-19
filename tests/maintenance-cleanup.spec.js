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

function runPythonJson(script, dataDir) {
    const output = execFileSync(resolvePythonCommand(), ['-c', script, REPO_ROOT, dataDir], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
    });
    return JSON.parse(output.toString('utf8'));
}

test.describe('Maintenance cleanup', () => {
    test('purge_tombstones(syncing=True) retains unsynced tombstones and purges synced ones', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicom-viewer-maintenance-purge-'));

        try {
            const result = runPythonJson(
                `
import json
import os
import sqlite3
import sys
import time

repo_root = sys.argv[1]
data_dir = sys.argv[2]

os.environ["DICOM_VIEWER_DATA_DIR"] = data_dir
sys.path.insert(0, repo_root)

from server import db as db_module
from server import maintenance

db_module.configure(repo_root)
db_module.init_db()

now_ms = int(time.time() * 1000)
old_ms = now_ms - (40 * 86400 * 1000)

conn = sqlite3.connect(db_module.DB_PATH)
conn.executemany(
    """
    INSERT INTO comments (
        study_uid,
        series_uid,
        text,
        time,
        record_uuid,
        created_at,
        updated_at,
        deleted_at,
        sync_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    [
        ("study-a", None, "unsynced tombstone", old_ms - 3, "comment-unsynced", old_ms - 3, old_ms - 2, old_ms, 0),
        ("study-a", None, "synced tombstone", old_ms - 2, "comment-synced", old_ms - 2, old_ms - 1, old_ms, 5),
        ("study-a", None, "live comment", now_ms, "comment-live", now_ms, now_ms, None, 9),
    ],
)
conn.executemany(
    """
    INSERT INTO reports (
        id,
        study_uid,
        name,
        type,
        size,
        file_path,
        added_at,
        updated_at,
        deleted_at,
        sync_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    [
        ("report-unsynced", "study-a", "Unsynced", "pdf", 10, None, old_ms - 3, old_ms - 2, old_ms, 0),
        ("report-synced", "study-a", "Synced", "pdf", 20, None, old_ms - 2, old_ms - 1, old_ms, 7),
        ("report-live", "study-a", "Live", "pdf", 30, None, now_ms, now_ms, None, 11),
    ],
)
conn.commit()
conn.close()

counts = maintenance.purge_tombstones(days=30, syncing=True)

conn = sqlite3.connect(db_module.DB_PATH)
comment_rows = conn.execute(
    "SELECT record_uuid, sync_version, deleted_at FROM comments ORDER BY record_uuid"
).fetchall()
report_rows = conn.execute(
    "SELECT id, sync_version, deleted_at FROM reports ORDER BY id"
).fetchall()
conn.close()

print(
    json.dumps(
        {
            "counts": counts,
            "comments": [list(row) for row in comment_rows],
            "reports": [list(row) for row in report_rows],
        }
    )
)
                `,
                dataDir,
            );

            expect(result.counts).toEqual({ comments: 1, reports: 1 });
            expect(result.comments).toEqual([
                ['comment-live', 9, null],
                ['comment-unsynced', 0, expect.any(Number)],
            ]);
            expect(result.reports).toEqual([
                ['report-live', 11, null],
                ['report-unsynced', 0, expect.any(Number)],
            ]);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    test('gc_report_blobs preserves live and recent tombstones while deleting orphaned files', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicom-viewer-maintenance-gc-'));

        try {
            const result = runPythonJson(
                `
import json
import os
import sqlite3
import sys
import time

repo_root = sys.argv[1]
data_dir = sys.argv[2]

os.environ["DICOM_VIEWER_DATA_DIR"] = data_dir
sys.path.insert(0, repo_root)

from server import db as db_module
from server import maintenance

db_module.configure(repo_root)
db_module.init_db()

now_ms = int(time.time() * 1000)
recent_ms = now_ms - (5 * 86400 * 1000)
old_ms = now_ms - (45 * 86400 * 1000)

files = {
    "live.pdf": b"live-data",
    "recent.pdf": b"recent-data",
    "old.pdf": b"old-data",
    "orphan.pdf": b"orphan-data",
    "upload.tmp": b"temp-data",
}

for name, contents in files.items():
    with open(os.path.join(db_module.REPORTS_DIR, name), "wb") as handle:
        handle.write(contents)

conn = sqlite3.connect(db_module.DB_PATH)
conn.executemany(
    """
    INSERT INTO reports (
        id,
        study_uid,
        name,
        type,
        size,
        file_path,
        added_at,
        updated_at,
        deleted_at,
        sync_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
    [
        ("report-live", "study-a", "Live", "pdf", len(files["live.pdf"]), os.path.join(db_module.REPORTS_DIR, "live.pdf"), now_ms, now_ms, None, 1),
        ("report-recent", "study-a", "Recent", "pdf", len(files["recent.pdf"]), os.path.join(db_module.REPORTS_DIR, "recent.pdf"), recent_ms, recent_ms, recent_ms, 2),
        ("report-old", "study-a", "Old", "pdf", len(files["old.pdf"]), os.path.join(db_module.REPORTS_DIR, "old.pdf"), old_ms, old_ms, old_ms, 3),
    ],
)
conn.commit()
conn.close()

gc_result = maintenance.gc_report_blobs(purge_days=30)
remaining_files = sorted(os.listdir(db_module.REPORTS_DIR))

print(
    json.dumps(
        {
            "gc_result": gc_result,
            "remaining_files": remaining_files,
        }
    )
)
                `,
                dataDir,
            );

            expect(result.gc_result).toEqual({
                deleted_count: 2,
                bytes_reclaimed: 'old-data'.length + 'orphan-data'.length,
            });
            expect(result.remaining_files).toEqual(['live.pdf', 'recent.pdf', 'upload.tmp']);
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});
