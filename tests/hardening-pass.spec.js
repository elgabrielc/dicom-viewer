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
    test('Flask responses include a CSP without inline script execution', async ({ request }) => {
        const response = await request.get(HOME_URL);
        expect(response.status()).toBe(200);

        const headers = response.headers();
        const csp = headers['content-security-policy'] || '';
        expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
        expect(csp).toContain("'unsafe-eval'");
        expect(csp).toContain("worker-src 'self' blob: 'wasm-unsafe-eval'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).not.toContain("script-src 'unsafe-inline'");
        expect(headers['referrer-policy']).toBe('no-referrer');
        expect(headers['permissions-policy']).toContain('camera=()');
    });

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

    test('network-exposed library config requires an allowed root', async () => {
        const result = runPythonJson(`
import json
import os
import sys
import tempfile

sys.path.insert(0, sys.argv[1])

import server.routes.library as library_module

original_host = os.environ.get('FLASK_HOST')
original_roots = os.environ.get(library_module.LIBRARY_ALLOWED_ROOTS_ENV)

def restore_env():
    if original_host is None:
        os.environ.pop('FLASK_HOST', None)
    else:
        os.environ['FLASK_HOST'] = original_host
    if original_roots is None:
        os.environ.pop(library_module.LIBRARY_ALLOWED_ROOTS_ENV, None)
    else:
        os.environ[library_module.LIBRARY_ALLOWED_ROOTS_ENV] = original_roots

def validate(path):
    allowed, error, status = library_module._validate_library_config_path(path, path)
    return {'allowed': allowed, 'error': error, 'status': status}

try:
    allowed_root = tempfile.mkdtemp(prefix='dicom allowed root ')
    allowed_child = os.path.join(allowed_root, 'incoming')
    second_allowed_root = tempfile.mkdtemp(prefix='dicom second allowed root ')
    second_allowed_child = os.path.join(second_allowed_root, 'incoming')
    semicolon_allowed_root = tempfile.mkdtemp(prefix='dicom semicolon allowed root ')
    semicolon_allowed_child = os.path.join(semicolon_allowed_root, 'incoming')
    flanked_allowed_root = tempfile.mkdtemp(prefix='dicom flanked allowed root ')
    outside_root = tempfile.mkdtemp(prefix='dicom-outside-root-')

    os.environ['FLASK_HOST'] = '127.0.0.1'
    os.environ.pop(library_module.LIBRARY_ALLOWED_ROOTS_ENV, None)
    loopback = validate(outside_root)

    os.environ['FLASK_HOST'] = '0.0.0.0'
    os.environ.pop(library_module.LIBRARY_ALLOWED_ROOTS_ENV, None)
    exposed_without_roots = validate(allowed_child)

    os.environ[library_module.LIBRARY_ALLOWED_ROOTS_ENV] = (
        f'{allowed_root}{os.pathsep}{second_allowed_root};{semicolon_allowed_root}'
    )
    exposed_allowed = validate(allowed_child)
    exposed_second_allowed = validate(second_allowed_child)
    exposed_semicolon_allowed = validate(semicolon_allowed_child)
    exposed_outside = validate(outside_root)
    parsed_flanked_roots = library_module._parse_library_allowed_roots(
        f'{outside_root},{flanked_allowed_root},{semicolon_allowed_root}'
    )
finally:
    restore_env()

print(json.dumps({
    'loopback': loopback,
    'exposed_without_roots': exposed_without_roots,
    'exposed_allowed': exposed_allowed,
    'exposed_second_allowed': exposed_second_allowed,
    'exposed_semicolon_allowed': exposed_semicolon_allowed,
    'exposed_outside': exposed_outside,
    'parsed_flanked_roots': parsed_flanked_roots,
    'flanked_allowed_root': flanked_allowed_root,
}))
        `);

        expect(result.loopback).toEqual({ allowed: true, error: null, status: null });
        expect(result.exposed_without_roots).toMatchObject({
            allowed: false,
            status: 403,
        });
        expect(result.exposed_without_roots.error).toContain('DICOM_LIBRARY_ALLOWED_ROOTS');
        expect(result.exposed_allowed).toEqual({ allowed: true, error: null, status: null });
        expect(result.exposed_second_allowed).toEqual({ allowed: true, error: null, status: null });
        expect(result.exposed_semicolon_allowed).toEqual({ allowed: true, error: null, status: null });
        expect(result.parsed_flanked_roots).toHaveLength(3);
        expect(result.parsed_flanked_roots[1]).toBe(result.flanked_allowed_root);
        expect(result.exposed_outside).toMatchObject({
            allowed: false,
            status: 403,
        });
        expect(result.exposed_outside.error).toContain('outside allowed roots');
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
