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

test('mock desktop Tauri harness installs the baseline runtime on a blank page', async ({ page }) => {
    await installMockDesktopTauri(page, {
        appDataDir: '/mock/appdata',
        fs: {
            files: {
                '/mock/appdata/library/image.dcm': [1, 2, 3],
            },
        },
    });
    await gotoMockPage(page);

    const result = await page.evaluate(async (readyPromiseNames) => {
        const ready = await Promise.all(readyPromiseNames.map((name) => window[name]));
        return {
            hasTauri: typeof window.__TAURI__ === 'object',
            hasInvoke: typeof window.__TAURI__?.core?.invoke === 'function',
            hasSql: typeof window.__TAURI__?.sql?.load === 'function',
            readyCount: ready.length,
            fileExists: await window.__TAURI__.fs.exists('/mock/appdata/library/image.dcm'),
            bytes: Array.from(await window.__TAURI__.fs.readFile('/mock/appdata/library/image.dcm')),
            appDataDir: await window.__TAURI__.path.appDataDir(),
        };
    }, READY_PROMISE_NAMES);

    expect(result).toEqual({
        hasTauri: true,
        hasInvoke: true,
        hasSql: true,
        readyCount: READY_PROMISE_NAMES.length,
        fileExists: true,
        bytes: [1, 2, 3],
        appDataDir: '/mock/appdata',
    });
});
