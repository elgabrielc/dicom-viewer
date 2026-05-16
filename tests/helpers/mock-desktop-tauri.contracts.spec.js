// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { test, expect } = require('@playwright/test');
const { READY_PROMISE_NAMES, installMockDesktopTauri } = require('./mock-desktop-tauri');

async function gotoMockPage(page) {
    await page.route('http://mock.local/blank', async (route) => {
        await route.fulfill({
            contentType: 'text/html',
            body: '<html><body>mock</body></html>',
        });
    });
    await page.goto('http://mock.local/blank');
}

test.describe('mock desktop Tauri contract', () => {
    test('unknown invoke commands fail loudly with the command name', async ({ page }) => {
        await installMockDesktopTauri(page);
        await gotoMockPage(page);

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
        await gotoMockPage(page);

        const result = await page.evaluate(async () => {
            const missingPath = '/mock/appdata/missing.pdf';
            const exists = await window.__TAURI__.fs.exists(missingPath);
            let readError = null;
            let statError = null;
            try {
                await window.__TAURI__.fs.readFile(missingPath);
            } catch (error) {
                readError = String(error?.message || error);
            }
            try {
                await window.__TAURI__.fs.stat(missingPath);
            } catch (error) {
                statError = String(error?.message || error);
            }
            return { exists, readError, statError };
        });

        expect(result.exists).toBe(false);
        expect(result.readError).toContain('No such file or directory');
        expect(result.statError).toContain('No such file or directory');
    });

    test('ready promises resolve to the installed runtime', async ({ page }) => {
        await installMockDesktopTauri(page);
        await gotoMockPage(page);

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
