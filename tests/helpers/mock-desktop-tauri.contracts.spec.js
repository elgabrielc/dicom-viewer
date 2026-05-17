// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');
const { READY_PROMISE_NAMES, gotoMockDesktopPage, installMockDesktopTauri } = require('./mock-desktop-tauri');

test.describe('mock desktop Tauri contract', () => {
    test('unknown invoke commands fail loudly with the command name', async ({ page }) => {
        await installMockDesktopTauri(page);
        await gotoMockDesktopPage(page);

        const message = await page.evaluate(async () => {
            try {
                await window.__TAURI__.core.invoke('unknown_desktop_command', { example: true });
                return null;
            } catch (error) {
                return String(error?.message || error);
            }
        });

        expect(message).toContain('unknown_desktop_command');
    });

    test('filesystem defaults match non-forgiving Tauri-like behavior', async ({ page }) => {
        await installMockDesktopTauri(page);
        await gotoMockDesktopPage(page);

        const result = await page.evaluate(async () => {
            const missingPath = '/mock/appdata/missing.pdf';
            const exists = await window.__TAURI__.fs.exists(missingPath);
            let readError = null;
            let readIsError = null;
            let statError = null;
            let statIsError = null;
            try {
                await window.__TAURI__.fs.readFile(missingPath);
            } catch (error) {
                readError = String(error?.message || error);
                readIsError = error instanceof Error;
            }
            try {
                await window.__TAURI__.fs.stat(missingPath);
            } catch (error) {
                statError = String(error?.message || error);
                statIsError = error instanceof Error;
            }
            return { exists, readError, readIsError, statError, statIsError };
        });

        expect(result.exists).toBe(false);
        expect(result.readError).toContain('No such file or directory');
        expect(result.readIsError).toBe(false);
        expect(result.statError).toContain('No such file or directory');
        expect(result.statIsError).toBe(false);
    });

    test('chaos-test write/remove failures throw bare strings (not Error instances)', async ({ page }) => {
        await installMockDesktopTauri(page, {
            fs: {
                files: { '/mock/appdata/seed.txt': [0x00] },
                failWritePatterns: ['will-fail'],
                failRemovePatterns: ['will-fail'],
            },
        });
        await gotoMockDesktopPage(page);

        const result = await page.evaluate(async () => {
            let writeError = null;
            let writeIsError = null;
            try {
                await window.__TAURI__.fs.writeFile('/mock/appdata/will-fail.txt', new Uint8Array([0x01]));
            } catch (error) {
                writeError = String(error?.message || error);
                writeIsError = error instanceof Error;
            }

            let removeError = null;
            let removeIsError = null;
            try {
                await window.__TAURI__.fs.remove('/mock/appdata/will-fail.txt');
            } catch (error) {
                removeError = String(error?.message || error);
                removeIsError = error instanceof Error;
            }

            return { writeError, writeIsError, removeError, removeIsError };
        });

        expect(result.writeError).toContain('Mock write failure');
        expect(result.writeIsError).toBe(false);
        expect(result.removeError).toContain('Mock remove failure');
        expect(result.removeIsError).toBe(false);
    });

    test('mkdir accepts and records Tauri options', async ({ page }) => {
        await installMockDesktopTauri(page);
        await gotoMockDesktopPage(page);

        const result = await page.evaluate(async () => {
            await window.__TAURI__.fs.mkdir('/mock/appdata/reports/study-1', { recursive: true });
            return {
                exists: await window.__TAURI__.fs.exists('/mock/appdata/reports/study-1'),
                mkdirCalls: window.__mockDesktopTauriState.mkdirCalls,
            };
        });

        expect(result.exists).toBe(true);
        expect(result.mkdirCalls).toEqual([
            {
                dirPath: '/mock/appdata/reports/study-1',
                options: { recursive: true },
            },
        ]);
    });

    test('fs.files seeded with Uint8Array values round-trips through Playwright serialization', async ({ page }) => {
        // Regression: Uint8Array doesn't survive addInitScript's JSON serialization —
        // it arrives in the browser as a plain object with numeric-string keys, no .length.
        // The harness's serializeBytes must reconstruct the byte sequence from those keys
        // or the seeded file silently becomes empty.
        const payload = new TextEncoder().encode('hello world');

        await installMockDesktopTauri(page, {
            fs: {
                files: { '/mock/appdata/seed.bin': payload },
            },
        });
        await gotoMockDesktopPage(page);

        const result = await page.evaluate(async () => {
            const bytes = await window.__TAURI__.fs.readFile('/mock/appdata/seed.bin');
            return Array.from(bytes);
        });

        expect(result).toEqual(Array.from(payload));
    });

    test('ready promises resolve to the installed runtime', async ({ page }) => {
        await installMockDesktopTauri(page);
        await gotoMockDesktopPage(page);

        const result = await page.evaluate(async (readyPromiseNames) => {
            const runtimes = await Promise.all(readyPromiseNames.map((name) => window[name]));
            return runtimes.map((runtime) => ({
                hasInvoke: typeof runtime?.core?.invoke === 'function',
                hasSql: typeof runtime?.sql?.load === 'function',
            }));
        }, READY_PROMISE_NAMES);

        expect(result).toEqual(
            READY_PROMISE_NAMES.map(() => ({
                hasInvoke: true,
                hasSql: true,
            })),
        );
    });
});
