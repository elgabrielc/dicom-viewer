// @ts-check
// Copyright (c) 2026 Divergent Health Technologies

/**
 * Tests for CONFIG.detectDeploymentMode() hostname matching logic.
 *
 * These tests run in a browser context against the real config.js module
 * loaded by the Flask dev server.  They use the testable overload:
 *   CONFIG.detectDeploymentMode(runtime)
 * which accepts a fake `window`-like object, so no location mutation is needed.
 *
 * Regression coverage for cloud hostname matching:
 *
 *   CONFIG should only classify divergent.health itself and exact
 *   *.divergent.health subdomains as cloud. Hostnames that merely contain the
 *   string "divergent.health" must stay personal/preview/demo as appropriate.
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:5001/?nolib';

// ---------------------------------------------------------------------------
// Helper: call CONFIG.detectDeploymentMode with a fake runtime
// ---------------------------------------------------------------------------

/**
 * Call CONFIG.detectDeploymentMode(fakeRuntime) in the page and return the mode.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} fakeRuntime  Plain-object runtime to pass to detectDeploymentMode
 * @returns {Promise<string>}
 */
async function detectMode(page, fakeRuntime) {
    return page.evaluate((runtime) => {
        return window.CONFIG.detectDeploymentMode(runtime);
    }, fakeRuntime);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => typeof window.CONFIG?.detectDeploymentMode === 'function', null, {
        timeout: 10000,
    });
});

// ---------------------------------------------------------------------------
// Suite: Legitimate hostnames
// ---------------------------------------------------------------------------

test.describe('Config: legitimate hostname classification', () => {
    test('divergent.health is classified as cloud', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'https:', hostname: 'divergent.health' } });
        expect(mode).toBe('cloud');
    });

    test('app.divergent.health subdomain is classified as cloud', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'https:', hostname: 'app.divergent.health' } });
        expect(mode).toBe('cloud');
    });

    test('localhost is classified as personal', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'http:', hostname: 'localhost' } });
        expect(mode).toBe('personal');
    });

    test('127.0.0.1 is classified as personal', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'http:', hostname: '127.0.0.1' } });
        expect(mode).toBe('personal');
    });

    test('elgabrielc.github.io is classified as demo', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'https:', hostname: 'elgabrielc.github.io' } });
        expect(mode).toBe('demo');
    });

    test('feature-branch.vercel.app is classified as preview', async ({ page }) => {
        const mode = await detectMode(page, {
            location: { protocol: 'https:', hostname: 'feature-branch.vercel.app' },
        });
        expect(mode).toBe('preview');
    });

    test('tauri.localhost is classified as desktop', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'http:', hostname: 'tauri.localhost' } });
        expect(mode).toBe('desktop');
    });

    test('tauri: protocol is classified as desktop', async ({ page }) => {
        const mode = await detectMode(page, { location: { protocol: 'tauri:', hostname: '' } });
        expect(mode).toBe('desktop');
    });

    test('runtime with __TAURI__ is classified as desktop', async ({ page }) => {
        // __TAURI__ presence takes priority over hostname
        const mode = await detectMode(page, {
            __TAURI__: {},
            location: { protocol: 'https:', hostname: 'localhost' },
        });
        expect(mode).toBe('desktop');
    });
});

// ---------------------------------------------------------------------------
// Suite: Security - hostname substring attack regression coverage
// ---------------------------------------------------------------------------

test.describe('Config: hostname substring attack regression coverage', () => {
    test('evil-divergent.health.attacker.com is not classified as cloud', async ({ page }) => {
        // An attacker who controls attacker.com can register a subdomain that
        // includes the literal string "divergent.health" and trick the config
        // into treating their origin as the cloud platform.
        const mode = await detectMode(page, {
            location: { protocol: 'https:', hostname: 'evil-divergent.health.attacker.com' },
        });
        expect(mode).toBe('personal');
    });

    test('xdivergent.healthydomain.com is not classified as cloud', async ({ page }) => {
        // Another substring collision: "divergent.health" appears inside
        // "xdivergent.healthydomain.com".
        const mode = await detectMode(page, {
            location: { protocol: 'https:', hostname: 'xdivergent.healthydomain.com' },
        });
        expect(mode).toBe('personal');
    });

    test('divergent.healthydomain.com is not classified as cloud', async ({ page }) => {
        // "divergent.health" is a substring of "divergent.healthydomain.com".
        const mode = await detectMode(page, {
            location: { protocol: 'https:', hostname: 'divergent.healthydomain.com' },
        });
        expect(mode).toBe('personal');
    });
});
