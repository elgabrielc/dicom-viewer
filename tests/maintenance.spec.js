// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');
const { test, expect, request: playwrightRequest } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');

test.use({ extraHTTPHeaders: {} });
test.setTimeout(60000);

function uniqueStudyUid() {
    return `maintenance-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameOriginHeaders(baseUrl, extra = {}) {
    return {
        Origin: baseUrl,
        ...extra,
    };
}

function resolvePythonCommand() {
    const venvPython = path.join(REPO_ROOT, 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
        return venvPython;
    }
    return process.env.PYTHON || 'python3';
}

async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : null;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

async function waitForServer(baseUrl, proc, logs, timeoutMs = 20000) {
    const api = await playwrightRequest.newContext({ extraHTTPHeaders: {} });
    const deadline = Date.now() + timeoutMs;

    try {
        while (Date.now() < deadline) {
            if (proc.exitCode !== null) {
                throw new Error(`Isolated Flask server exited early with code ${proc.exitCode}\n${logs.join('')}`);
            }

            try {
                const response = await api.get(`${baseUrl}/api/session`, { failOnStatusCode: false });
                if (response.status() === 200) {
                    return;
                }
            } catch {
                // Server still starting.
            }

            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    } finally {
        await api.dispose();
    }

    throw new Error(`Timed out waiting for isolated Flask server\n${logs.join('')}`);
}

async function stopServer(proc) {
    if (!proc || proc.exitCode !== null) {
        return;
    }

    proc.kill('SIGTERM');
    try {
        await Promise.race([
            once(proc, 'exit'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
    } catch {
        proc.kill('SIGKILL');
        await once(proc, 'exit');
    }
}

async function launchIsolatedServer() {
    const python = resolvePythonCommand();
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dicom-viewer-maintenance-'));
    const logs = [];
    const script = `
from app import app
from flask import request
from server.db import get_db

@app.before_request
def _lock_restore_connection():
    if request.path == "/api/maintenance/restore":
        get_db().execute("BEGIN IMMEDIATE")

app.run(host="127.0.0.1", port=${port})
`;

    const proc = spawn(python, ['-c', script], {
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            DICOM_VIEWER_DATA_DIR: dataDir,
            FLASK_DEBUG: 'false',
            PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (chunk) => {
        logs.push(String(chunk));
    });
    proc.stderr.on('data', (chunk) => {
        logs.push(String(chunk));
    });

    await waitForServer(baseUrl, proc, logs);
    const api = await playwrightRequest.newContext({ extraHTTPHeaders: {} });

    return { api, baseUrl, dataDir, logs, proc };
}

async function getSessionToken(api, baseUrl) {
    const response = await api.get(`${baseUrl}/api/session`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    return body.token;
}

test.describe('Maintenance restore', () => {
    test('restore closes the request-scoped DB handle before applying the backup', async () => {
        const server = await launchIsolatedServer();

        try {
            const token = await getSessionToken(server.api, server.baseUrl);

            const backupResponse = await server.api.post(`${server.baseUrl}/api/maintenance/backup`, {
                headers: sameOriginHeaders(server.baseUrl, { 'X-Session-Token': token }),
                data: {},
            });
            expect(backupResponse.status()).toBe(200);
            const backupBody = await backupResponse.json();
            const backupName = path.basename(backupBody.backup_path);

            const studyUid = uniqueStudyUid();
            const writeResponse = await server.api.put(`${server.baseUrl}/api/notes/${studyUid}/description`, {
                headers: sameOriginHeaders(server.baseUrl, { 'X-Session-Token': token }),
                data: { description: 'rolled back by restore' },
            });
            expect(writeResponse.status()).toBe(200);

            const beforeRestore = await server.api.get(`${server.baseUrl}/api/notes/?studies=${studyUid}`, {
                headers: { 'X-Session-Token': token },
            });
            expect(beforeRestore.status()).toBe(200);
            const beforeBody = await beforeRestore.json();
            expect(beforeBody.studies[studyUid].description).toBe('rolled back by restore');

            const restoreResponse = await server.api.post(`${server.baseUrl}/api/maintenance/restore`, {
                headers: sameOriginHeaders(server.baseUrl, { 'X-Session-Token': token }),
                data: { backup_name: backupName },
            });
            expect(restoreResponse.status()).toBe(200);

            const afterRestore = await server.api.get(`${server.baseUrl}/api/notes/?studies=${studyUid}`, {
                headers: { 'X-Session-Token': token },
            });
            expect(afterRestore.status()).toBe(200);
            const afterBody = await afterRestore.json();
            expect(afterBody.studies).not.toHaveProperty(studyUid);
        } finally {
            await server.api.dispose();
            await stopServer(server.proc);
            fs.rmSync(server.dataDir, { recursive: true, force: true });
        }
    });
});
