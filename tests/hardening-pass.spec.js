// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOME_URL = 'http://127.0.0.1:5001/?nolib';

function resolvePythonCommand() {
    const venvPython = path.join(REPO_ROOT, 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
        return venvPython;
    }
    return process.env.PYTHON || 'python3';
}

function runPythonJson(script) {
    const output = execFileSync(resolvePythonCommand(), ['-c', script, REPO_ROOT], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
    });
    return JSON.parse(output.toString('utf8'));
}

test.describe('Hardening pass', () => {
    test('db migration helper validates identifiers and column definitions', async () => {
        const result = runPythonJson(`
import json
import sqlite3
import sys

sys.path.insert(0, sys.argv[1])

from server import db as db_module

conn = sqlite3.connect(':memory:')
conn.execute("CREATE TABLE safe_table (id INTEGER PRIMARY KEY)")
db_module._add_column(conn, 'safe_table', 'safe_column', 'TEXT')

errors = {}
for args in [
    ('safe_table; DROP TABLE safe_table; --', 'oops', 'TEXT'),
    ('safe_table', 'bad-column', 'TEXT'),
    ('safe_table', 'still_bad', "TEXT); DROP TABLE safe_table; --"),
]:
    try:
        db_module._add_column(conn, *args)
    except Exception as exc:
        errors['|'.join(args)] = type(exc).__name__

columns = [row[1] for row in conn.execute("PRAGMA table_info('safe_table')").fetchall()]
print(json.dumps({'columns': columns, 'errors': errors}))
        `);

        expect(result.columns).toEqual(expect.arrayContaining(['id', 'safe_column']));
        expect(result.errors).toEqual({
            'safe_table; DROP TABLE safe_table; --|oops|TEXT': 'ValueError',
            'safe_table|bad-column|TEXT': 'ValueError',
            'safe_table|still_bad|TEXT); DROP TABLE safe_table; --': 'ValueError',
        });
    });

    test('auth throttling sweeps expired buckets and does not create empty lookup buckets', async () => {
        const result = runPythonJson(`
import json
import sys
from flask import Flask

sys.path.insert(0, sys.argv[1])

import server.routes.auth as auth_module

auth_module._AUTH_FAILURES.clear()
auth_module._AUTH_LAST_SWEEP_AT = 0
now_s = int(auth_module.time.time())
auth_module._AUTH_FAILURES['login:expired:*'].extend([now_s - auth_module._AUTH_WINDOW_SECONDS - 1])
auth_module._AUTH_FAILURES['login:fresh:*'].extend([now_s])

auth_module._maybe_sweep_auth_failures(now_s)
keys_after_sweep = sorted(auth_module._AUTH_FAILURES.keys())

app = Flask(__name__)
with app.test_request_context('/api/auth/login'):
    missing_retry_after = auth_module._rate_limit_retry_after('login', 'missing@example.com')

print(json.dumps({
    'keys_after_sweep': keys_after_sweep,
    'missing_retry_after': missing_retry_after,
    'keys_after_lookup': sorted(auth_module._AUTH_FAILURES.keys()),
}))
        `);

        expect(result.keys_after_sweep).toEqual(['login:fresh:*']);
        expect(result.missing_retry_after).toBeNull();
        expect(result.keys_after_lookup).toEqual(['login:fresh:*']);
    });

    test('test-mode requests outside FLASK_ENV=test fail with an explicit error', async () => {
        const result = runPythonJson(`
import json
import os
import sys
from flask import Flask

sys.path.insert(0, sys.argv[1])
os.environ['FLASK_ENV'] = 'development'

import server.security as security_module

app = Flask(__name__)
responses = {}

with app.app_context():
    with app.test_request_context('/api/notes/?studies=abc&test=1', method='GET'):
        response, status = security_module.session_token_check()
        responses['query_param'] = {'status': status, 'body': response.get_json()}

    with app.test_request_context('/api/notes/study/comments', method='POST', headers={'X-Test-Mode': '1'}):
        response, status = security_module.session_token_check()
        responses['header'] = {'status': status, 'body': response.get_json()}

print(json.dumps(responses))
        `);

        expect(result.query_param).toEqual({
            status: 403,
            body: { error: 'Test mode is only available when FLASK_ENV=test' },
        });
        expect(result.header).toEqual({
            status: 403,
            body: { error: 'Test mode is only available when FLASK_ENV=test' },
        });
    });

    test('deployment mode only treats divergent.health suffixes as cloud', async ({ page }) => {
        await page.goto(HOME_URL);

        const modes = await page.evaluate(() => ({
            cloudApex: window.CONFIG.detectDeploymentMode({
                location: { protocol: 'https:', hostname: 'divergent.health' },
            }),
            cloudSubdomain: window.CONFIG.detectDeploymentMode({
                location: { protocol: 'https:', hostname: 'app.divergent.health' },
            }),
            attackerSuffix: window.CONFIG.detectDeploymentMode({
                location: { protocol: 'https:', hostname: 'divergent.health.evil.test' },
            }),
            attackerPrefix: window.CONFIG.detectDeploymentMode({
                location: { protocol: 'https:', hostname: 'evildivergent.health' },
            }),
        }));

        expect(modes.cloudApex).toBe('cloud');
        expect(modes.cloudSubdomain).toBe('cloud');
        expect(modes.attackerSuffix).toBe('personal');
        expect(modes.attackerPrefix).toBe('personal');
    });
});
