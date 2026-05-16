// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DESKTOP_DIR = path.join(ROOT_DIR, 'desktop');
const DIAGNOSTICS_DIR = process.env.DICOM_REAL_TAURI_DIAGNOSTICS_DIR || path.join(__dirname, 'diagnostics');
const STARTUP_TIMEOUT_MS = 120_000;
const DEV_IDENTIFIER = 'health.divergent.dicomviewer.dev';
const DEV_PORT = process.env.DICOM_REAL_TAURI_PORT || '15320';

function resetDiagnostics() {
    fs.rmSync(DIAGNOSTICS_DIR, { recursive: true, force: true });
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIAGNOSTICS_DIR, '.gitkeep'), '');
}

function writeDiagnostic(name, text) {
    fs.writeFileSync(path.join(DIAGNOSTICS_DIR, name), `${text.replace(/\s+$/u, '')}\n`);
}

function appendDiagnostic(name, text) {
    fs.appendFileSync(path.join(DIAGNOSTICS_DIR, name), text);
}

function runVersionCommand(command, args = [], cwd = ROOT_DIR) {
    try {
        return execFileSync(command, args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    } catch (error) {
        return `unavailable: ${error.message}`;
    }
}

function recordVersions() {
    writeDiagnostic(
        'versions.txt',
        [
            `node=${process.version}`,
            `platform=${process.platform}`,
            `arch=${process.arch}`,
            `macos=${runVersionCommand('sw_vers', ['-productVersion'])}`,
            `rustc=${runVersionCommand('rustc', ['--version'])}`,
            `cargo=${runVersionCommand('cargo', ['--version'])}`,
            `tauri=${runVersionCommand('npm', ['run', 'tauri', '--', '--version'], DESKTOP_DIR)}`,
        ].join('\n'),
    );
}

function captureScreenshot(name) {
    if (process.platform !== 'darwin') return;

    try {
        execFileSync('screencapture', ['-x', path.join(DIAGNOSTICS_DIR, name)], {
            stdio: ['ignore', 'ignore', 'ignore'],
        });
    } catch (error) {
        writeDiagnostic(`${name}.txt`, `screencapture unavailable: ${error.message}`);
    }
}

function terminateProcessTree(child) {
    if (!child.pid || child.exitCode !== null) return;

    try {
        process.kill(-child.pid, 'SIGTERM');
    } catch (_error) {
        try {
            child.kill('SIGTERM');
        } catch {}
    }
}

async function waitForStartup(child, getCombinedOutput) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
        const output = getCombinedOutput();
        if (
            output.includes(`[startup] bundle identifier: ${DEV_IDENTIFIER}`) &&
            output.includes('[startup] app data dir:') &&
            output.includes(DEV_IDENTIFIER)
        ) {
            return output;
        }

        if (child.exitCode !== null) {
            throw new Error(`desktop launcher exited early with code ${child.exitCode}\n${output}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`timed out waiting for desktop startup logs\n${getCombinedOutput()}`);
}

test.describe('real Tauri desktop launch smoke', () => {
    test.skip(process.platform !== 'darwin', 'real Tauri smoke currently targets the active macOS desktop surface');

    test('launches the dev desktop binary with isolated app identity and serves sample data', async () => {
        test.setTimeout(STARTUP_TIMEOUT_MS + 30_000);
        resetDiagnostics();
        recordVersions();

        const env = {
            ...process.env,
            DICOM_DESKTOP_DEV_HOST: '127.0.0.1',
            DICOM_DESKTOP_DEV_PORT: DEV_PORT,
            FORCE_COLOR: '0',
            NO_COLOR: '1',
            RUST_BACKTRACE: '1',
        };
        const child = spawn('npm', ['run', 'dev:desktop'], {
            cwd: DESKTOP_DIR,
            detached: true,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            stdout += text;
            appendDiagnostic('app-stdout.log', text);
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            appendDiagnostic('app-stderr.log', text);
        });

        captureScreenshot('startup.png');

        try {
            const startupOutput = await waitForStartup(child, () => `${stdout}\n${stderr}`);
            expect(startupOutput).toContain(`[startup] bundle identifier: ${DEV_IDENTIFIER}`);
            expect(startupOutput).toContain(`Application Support/${DEV_IDENTIFIER}`);

            const manifestUrl = `http://127.0.0.1:${DEV_PORT}/sample/manifest.json`;
            const response = await fetch(manifestUrl);
            expect(response.ok).toBe(true);
            const manifest = await response.json();
            expect(Array.isArray(manifest)).toBe(true);
            expect(manifest.length).toBeGreaterThan(0);
            expect(manifest[0]).toMatch(/\.dcm$/u);
        } catch (error) {
            captureScreenshot('failure.png');
            throw error;
        } finally {
            terminateProcessTree(child);
        }
    });
});
