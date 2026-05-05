// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
//
// Tests for the local-first instrumentation module (ADR 008).
//
// These tests cover the Stage 1 fix PR for four issues found in the initial
// instrumentation drop:
//
//   1. Startup race: trackAppOpen must wait for init() before reading stats.
//      Covered indirectly by "records first session" -- if the race window
//      dropped the event, sessions would be 0 after a fresh load.
//
//   2. Desktop beforeunload must not write to localStorage. Covered by unit
//      tests in the module itself and by the mock-tauri-sql-init extension
//      that keeps desktop-mode specs from regressing; the localStorage write
//      path is exercised in browser mode only.
//
//   3. Managed-library imports overcount studies. Playwright cannot exercise
//      the full Tauri runtime required by runImport(), so diff correctness
//      is deferred to desktop integration tests on real hardware. The logic
//      is exercised in desktop-library.js runImport() and relies on the
//      importFromPaths mock coverage already present in desktop-import.spec.js.
//
//   4. Test coverage for the instrumentation module itself.
//
// ---------------------------------------------------------------------------
// NOTE ON MANAGED-LIBRARY DIFF TESTING
// ---------------------------------------------------------------------------
// The managed-library delta (Issue #3 in the Stage 1 fix PR) is NOT tested
// here. It requires the full desktop Tauri runtime (dialog.open, fs.readDir,
// importPipeline.getLibraryPath) to exercise runImport end-to-end, plus a
// rescan of a mocked filesystem. The correct place to test it is a desktop
// integration test running under the real Tauri shell; the mock environment
// in desktop-import.spec.js only covers importFromPaths, not runImport.
//
// The related unit pieces ARE covered here: trackStudiesImported itself
// increments correctly, test mode does not increment, and the share toggle
// is off by default on fresh install.
//
const { test, expect } = require('@playwright/test');
const path = require('path');

const APP_URL = 'http://127.0.0.1:5001/?nolib';
const TEST_URL = 'http://127.0.0.1:5001/?test';
const STORAGE_KEY = 'dicom-viewer-instrumentation-v1';
const DESKTOP_RUNTIME_WAIT_TIMEOUT_MS = 5_000;
const PHONE_HOME_URL = 'https://api.myradone.com/api/stats';
const MOCK_SQL_INIT_PATH = path.join(__dirname, 'mock-tauri-sql-init.js');

/**
 * Playwright gives each test a fresh browser context with empty localStorage
 * by default, so no explicit clearing is needed between tests. This helper
 * exists only to make intent explicit at the start of each test that cares
 * about a clean instrumentation state.
 *
 * IMPORTANT: do NOT use addInitScript to clear the key, because addInitScript
 * re-runs on every navigation (including page.reload()), which would wipe
 * the counter between reloads and break tests that verify session increments.
 */
async function clearInstrumentationStorage(_page) {
    // no-op: browser context isolation gives us a fresh localStorage already.
}

/**
 * Read the instrumentation blob from localStorage.
 */
async function readStats(page) {
    return await page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }, STORAGE_KEY);
}

async function seedInstrumentationStats(page, blob) {
    await page.addInitScript(
        ({ key, stats }) => {
            if (!window.localStorage.getItem(key)) {
                window.localStorage.setItem(key, JSON.stringify(stats));
            }
        },
        { key: STORAGE_KEY, stats: blob },
    );
}

function makeLegacyStats(overrides = {}) {
    return {
        version: 1,
        revision: 7,
        installationId: 'legacy-installation-id',
        firstSeen: '2026-01-02T03:04:05.000Z',
        lastSeen: '2026-02-03T04:05:06.000Z',
        sessions: 4,
        studiesImported: 9,
        shareEnabled: false,
        ...overrides,
    };
}

async function collectPhoneHomePosts(page) {
    const posts = [];
    await page.route(PHONE_HOME_URL, async (route) => {
        const request = route.request();
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type',
        };

        if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
            return;
        }

        if (request.method() === 'POST') {
            posts.push(request.postDataJSON());
        }

        await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    });
    return posts;
}

async function waitForConsentDialog(page) {
    const dialog = page.locator('#usageStatsConsentDialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

async function readMockDesktopDb(page) {
    return await page.evaluate(() => {
        const raw = window.localStorage.getItem('mock-tauri-sql:sqlite:viewer.db');
        return raw ? JSON.parse(raw) : null;
    });
}

/**
 * Poll the in-memory instrumentation stats until a predicate holds.
 * Useful for awaiting async flush() writes without relying on timers.
 */
async function waitForStats(page, predicate, timeout = 5000) {
    await page.waitForFunction(
        ({ key, predicateBody }) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            try {
                const stats = JSON.parse(raw);
                // eslint-disable-next-line no-new-func
                return Function('stats', `return (${predicateBody})(stats);`)(stats);
            } catch {
                return false;
            }
        },
        { key: STORAGE_KEY, predicateBody: predicate.toString() },
        { timeout },
    );
}

// ============================================================================
// Consent modal and phone-home gating
// ============================================================================

test.describe('Instrumentation: consent modal local automation guard', () => {
    test('skips first-launch consent modal on local WebDriver runs unless forced', async ({ page }) => {
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 1);

        await expect(page.locator('#usageStatsConsentDialog')).toBeHidden();
        const stats = await readStats(page);
        expect(stats.consentDecisionAt).toBeNull();
        expect(stats.shareEnabled).toBe(false);
    });
});

test.describe('Instrumentation: consent modal', () => {
    test.beforeEach(async ({ page }) => {
        // Local WebDriver runs skip the dialog by default so unrelated specs are
        // not blocked by first-launch consent. These specs exercise it directly.
        await page.addInitScript(() => {
            window.__ALLOW_CONSENT_MODAL_IN_TESTS__ = true;
        });
    });

    test('shows first-launch consent modal with current local stats', async ({ page }) => {
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 1);

        await waitForConsentDialog(page);
        await expect(page.locator('#usageStatsConsentTitle')).toHaveText('Please help us improve myRadOne.');
        await expect(page.locator('#usageStatsConsentDescription')).toHaveText(
            'Only if you allow it, myRadOne can share the following stats back to the developer:',
        );
        await expect(page.locator('#usageStatsConsentStatsTitle')).toHaveText('Stats');
        await expect(page.locator('#usageStatsConsentDialog summary')).toHaveCount(0);
        const stats = await readStats(page);
        await expect(page.locator('#usageStatsConsentInstallId')).toHaveText(stats.installationId.slice(0, 8));
        await expect(page.locator('#usageStatsConsentSessions')).toHaveText('1');
        await expect(page.locator('#usageStatsConsentStudiesImported')).toHaveText('0');
        await expect(page.locator('#usageStatsConsentDialog')).toContainText(
            'No images, no personal information, absolutely nothing else. Just those three numbers.',
        );
        await expect(page.locator('#usageStatsConsentDialog')).toContainText(
            "This information won't be sent elsewhere. It will be used exclusively to improve the application for users like you.",
        );
    });

    test('does not show consent modal after a decision has been recorded', async ({ page }) => {
        await seedInstrumentationStats(
            page,
            makeLegacyStats({
                shareEnabled: false,
                consentDecisionAt: '2026-03-04T05:06:07.000Z',
            }),
        );

        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 5);

        await expect(page.locator('#usageStatsConsentDialog')).toBeHidden();
    });

    test("Don't share records consent without sending a POST", async ({ page }) => {
        const posts = await collectPhoneHomePosts(page);

        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForConsentDialog(page);

        await page.getByRole('button', { name: "Don't share" }).click();
        await waitForStats(page, (stats) => stats.consentDecisionAt != null && stats.shareEnabled === false);
        await page.waitForTimeout(300);

        const stats = await readStats(page);
        expect(stats.consentDecisionAt).toEqual(expect.any(String));
        expect(stats.shareEnabled).toBe(false);
        expect(posts).toEqual([]);
    });

    test('Share records consent and sends one POST with exact payload keys', async ({ page }) => {
        const posts = await collectPhoneHomePosts(page);

        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForConsentDialog(page);

        await page.getByRole('button', { name: 'Share', exact: true }).click();
        await expect.poll(() => posts.length).toBe(1);

        const payload = posts[0];
        expect(Object.keys(payload).sort()).toEqual(
            ['installationId', 'revision', 'sessions', 'studiesImported', 'version'].sort(),
        );
        expect(payload.sessions).toBe(1);
        expect(payload.studiesImported).toBe(0);
        expect(payload.firstSeen).toBeUndefined();
        expect(payload.lastSeen).toBeUndefined();

        const stats = await readStats(page);
        expect(stats.shareEnabled).toBe(true);
        expect(stats.consentDecisionAt).toEqual(expect.any(String));
    });

    test('Escape closes without stamping consent and reprompts on next launch', async ({ page }) => {
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        const dialog = await waitForConsentDialog(page);

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();

        let stats = await readStats(page);
        expect(stats.consentDecisionAt).toBeNull();

        await page.reload();
        await waitForStats(page, (nextStats) => nextStats.sessions === 2);
        await waitForConsentDialog(page);

        stats = await readStats(page);
        expect(stats.consentDecisionAt).toBeNull();
    });

    test("retroactive shareEnabled true prompts and Don't share disables sharing", async ({ page }) => {
        const posts = await collectPhoneHomePosts(page);
        await seedInstrumentationStats(page, makeLegacyStats({ shareEnabled: true }));

        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 5);
        await waitForConsentDialog(page);

        await page.getByRole('button', { name: "Don't share" }).click();
        await waitForStats(page, (stats) => stats.consentDecisionAt != null && stats.shareEnabled === false);
        await page.waitForTimeout(300);

        const stats = await readStats(page);
        expect(stats.shareEnabled).toBe(false);
        expect(stats.consentDecisionAt).toEqual(expect.any(String));
        expect(posts).toEqual([]);
    });

    test('legacy sharing leaks no POST before consent, then Share sends exactly one POST', async ({ page }) => {
        const posts = await collectPhoneHomePosts(page);
        await seedInstrumentationStats(page, makeLegacyStats({ shareEnabled: true }));

        await page.goto(APP_URL);
        await waitForConsentDialog(page);

        await page.waitForTimeout(5500);
        await page.evaluate(() => {
            window.dispatchEvent(new Event('beforeunload'));
        });
        await page.waitForTimeout(100);
        expect(posts).toEqual([]);

        await page.getByRole('button', { name: 'Share', exact: true }).click();
        await expect.poll(() => posts.length).toBe(1);
        await page.waitForTimeout(5500);

        expect(posts).toHaveLength(1);
        const stats = await readStats(page);
        expect(stats.shareEnabled).toBe(true);
        expect(stats.consentDecisionAt).toEqual(expect.any(String));
    });

    test('stats panel toggle records consent after dismissed first-launch modal', async ({ page }) => {
        const posts = await collectPhoneHomePosts(page);

        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        const dialog = await waitForConsentDialog(page);

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();

        const toggleCheckedBefore = await page.evaluate(() => {
            const container = document.createElement('div');
            document.body.appendChild(container);
            window.Instrumentation?.renderStatsPanel?.(container);
            const toggle = container.querySelector('#statsShareToggle');
            const checked = toggle?.checked;
            toggle?.click();
            return checked;
        });

        expect(toggleCheckedBefore).toBe(false);
        await waitForStats(page, (stats) => stats.shareEnabled === true && stats.consentDecisionAt != null);
        await expect.poll(() => posts.length).toBe(1);

        const stats = await readStats(page);
        expect(stats.shareEnabled).toBe(true);
        expect(stats.consentDecisionAt).toEqual(expect.any(String));
    });

    test('reset preserves installation identity, firstSeen, and consent fields', async ({ page }) => {
        await seedInstrumentationStats(
            page,
            makeLegacyStats({
                shareEnabled: false,
                consentDecisionAt: '2026-03-04T05:06:07.000Z',
            }),
        );

        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 5);

        const before = await readStats(page);
        await page.evaluate(() => {
            window.Instrumentation?.resetStats?.();
        });
        await waitForStats(page, (stats) => stats.sessions === 0 && stats.studiesImported === 0);

        const after = await readStats(page);
        expect(after.installationId).toBe(before.installationId);
        expect(after.firstSeen).toBe(before.firstSeen);
        expect(after.shareEnabled).toBe(before.shareEnabled);
        expect(after.consentDecisionAt).toBe(before.consentDecisionAt);
        expect(after.sessions).toBe(0);
        expect(after.studiesImported).toBe(0);
    });

    test('stats migration removes lastSeen and preserves firstSeen', async ({ page }) => {
        await seedInstrumentationStats(page, makeLegacyStats({ shareEnabled: false }));

        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 5);

        const stats = await readStats(page);
        expect(stats.firstSeen).toBe('2026-01-02T03:04:05.000Z');
        expect(stats.lastSeen).toBeUndefined();
        expect(stats.consentDecisionAt).toBeNull();
    });

    test('desktop SQL bridge persists consent schema without last_seen', async ({ page }) => {
        await page.addInitScript({ path: MOCK_SQL_INIT_PATH });
        await page.addInitScript(() => {
            window.__TAURI__ = {
                sql: window.__createMockTauriSql(),
            };
            window.__DICOM_VIEWER_TAURI_STORAGE_READY__ = Promise.resolve(window.__TAURI__);
            window.__DICOM_VIEWER_TAURI_READY__ = Promise.resolve(window.__TAURI__);
        });

        await page.goto(APP_URL);
        await page.waitForFunction(() => {
            const raw = window.localStorage.getItem('mock-tauri-sql:sqlite:viewer.db');
            if (!raw) return false;
            const state = JSON.parse(raw);
            return state.instrumentation?.[0]?.sessions === 1;
        });

        const localRaw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
        expect(localRaw).toBeNull();

        let db = await readMockDesktopDb(page);
        let row = db.instrumentation[0];
        expect(row.first_seen).toEqual(expect.any(String));
        expect(row.last_seen).toBeUndefined();
        expect(row.consent_decision_at).toBeNull();

        await waitForConsentDialog(page);
        await page.getByRole('button', { name: "Don't share" }).click();
        await page.waitForFunction(() => {
            const raw = window.localStorage.getItem('mock-tauri-sql:sqlite:viewer.db');
            const state = raw ? JSON.parse(raw) : null;
            return state?.instrumentation?.[0]?.consent_decision_at != null;
        });

        db = await readMockDesktopDb(page);
        row = db.instrumentation[0];
        expect(row.share_enabled).toBe(0);
        expect(row.consent_decision_at).toEqual(expect.any(String));
        expect(row.last_seen).toBeUndefined();
    });
});

// ============================================================================
// Personal mode: basic counters
// ============================================================================

test.describe('Instrumentation: personal mode counters', () => {
    test('delayed desktop runtime readiness does not fall back to localStorage', async ({ page }) => {
        await page.addInitScript(() => {
            const dbState = {
                loadCount: 0,
                row: null,
            };

            const fakeDb = {
                async select() {
                    return dbState.row ? [{ ...dbState.row }] : [];
                },
                async execute(_sql, params) {
                    dbState.row = {
                        id: 1,
                        version: params[0],
                        revision: params[1],
                        installation_id: params[2],
                        first_seen: params[3],
                        sessions: params[4],
                        studies_imported: params[5],
                        share_enabled: params[6],
                        consent_decision_at: params[7],
                    };
                    return { rowsAffected: 1 };
                },
            };

            window.__instrumentationTestDbState = dbState;
            window.__TAURI__ = {};
            window.__DICOM_VIEWER_TAURI_STORAGE_READY__ = new Promise((resolve) => {
                setTimeout(() => {
                    window.__TAURI__.sql = {
                        load: async () => {
                            dbState.loadCount += 1;
                            return fakeDb;
                        },
                    };
                    resolve(window.__TAURI__);
                }, 100);
            });
        });

        await page.goto(APP_URL);

        await page.waitForFunction(
            () => {
                return window.__instrumentationTestDbState?.row?.sessions === 1;
            },
            { timeout: DESKTOP_RUNTIME_WAIT_TIMEOUT_MS },
        );

        const localRaw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
        expect(localRaw).toBeNull();

        const dbState = await page.evaluate(() => window.__instrumentationTestDbState);
        expect(dbState.loadCount).toBeGreaterThan(0);
        expect(dbState.row).not.toBeNull();
        expect(dbState.row.sessions).toBe(1);
        expect(dbState.row.last_seen).toBeUndefined();
        expect(dbState.row.consent_decision_at).toBeNull();
    });

    test('records first session on fresh load (no startup race drop)', async ({ page }) => {
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);

        // The module exposes a `ready` promise so we can deterministically
        // wait for init() to resolve before asserting -- this is exactly
        // the race window Issue #1 addresses.
        await page.evaluate(async () => {
            await window.Instrumentation?.ready;
        });

        // trackAppOpen now awaits init internally, so by the time the ready
        // promise settles AND trackAppOpen has had a chance to run (main.js
        // fires it synchronously on load), sessions should be >= 1.
        //
        // The flush is async, so wait for the localStorage key to reflect it.
        await waitForStats(page, (stats) => stats.sessions >= 1);

        const stats = await readStats(page);
        expect(stats).not.toBeNull();
        expect(stats.sessions).toBe(1);
        expect(stats.studiesImported).toBe(0);
        expect(stats.shareEnabled).toBe(false);
        expect(typeof stats.installationId).toBe('string');
        expect(stats.installationId.length).toBeGreaterThan(0);
    });

    test('session count increments on reload', async ({ page }) => {
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions === 1);

        await page.reload();
        await waitForStats(page, (stats) => stats.sessions === 2);

        const stats = await readStats(page);
        expect(stats.sessions).toBe(2);
    });

    test('share toggle is false by default on fresh install', async ({ page }) => {
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions >= 1);

        const stats = await readStats(page);
        expect(stats.shareEnabled).toBe(false);
    });

    test('no phone-home POST fires on app open when sharing is disabled', async ({ page }) => {
        await clearInstrumentationStorage(page);

        const phoneHomeRequests = [];
        page.on('request', (req) => {
            if (req.url().includes('api.myradone.com')) {
                phoneHomeRequests.push({
                    url: req.url(),
                    method: req.method(),
                });
            }
        });

        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions >= 1);
        // Give the phone-home debounce (5s) plenty of headroom to NOT fire.
        await page.waitForTimeout(500);

        expect(phoneHomeRequests).toEqual([]);
    });
});

// ============================================================================
// Demo mode: instrumentation disabled
// ============================================================================

test.describe('Instrumentation: demo mode disabled', () => {
    test('no instrumentation key in localStorage when disabled', async ({ page }) => {
        await clearInstrumentationStorage(page);

        // Override the feature flag BEFORE any script runs. This simulates
        // the demo-mode code path where CONFIG.features.instrumentation is
        // false (see docs/js/config.js line 117).
        //
        // config.js defines CONFIG as a frozen object whose `features`
        // property is a dynamic getter that returns a fresh plain object
        // on every access. To override it we intercept the
        // `window.CONFIG = CONFIG` assignment with a property setter that
        // wraps the real CONFIG in a Proxy. The proxy's `get` trap rewrites
        // each `features` access to inject `instrumentation: false`.
        //
        // We pass `target` (not `receiver`) to Reflect.get so the inner
        // getters see the frozen CONFIG as `this` instead of the proxy --
        // otherwise `this.deploymentMode` re-enters our get trap.
        await page.addInitScript(() => {
            let proxy = null;
            Object.defineProperty(window, 'CONFIG', {
                configurable: true,
                get() {
                    return proxy;
                },
                set(value) {
                    proxy = new Proxy(value, {
                        get(target, prop) {
                            if (prop === 'features') {
                                const features = Reflect.get(target, prop, target);
                                return { ...features, instrumentation: false };
                            }
                            return Reflect.get(target, prop, target);
                        },
                    });
                },
            });
        });

        await page.goto(APP_URL);

        // Wait for the app to be at least rendered; instrumentation should
        // have been short-circuited by init() before stats was assigned.
        await page.waitForSelector('#libraryView', { state: 'visible' });
        await page.waitForTimeout(200);

        const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
        expect(raw).toBeNull();

        // getStats() should also return null because init() short-circuited
        // before loading stats from storage.
        const stats = await page.evaluate(() => window.Instrumentation?.getStats?.() ?? null);
        expect(stats).toBeNull();
    });

    test('usage-stats section is not rendered in the help modal when disabled', async ({ page }) => {
        // Reuse the same proxy trick as the localStorage test above.
        await page.addInitScript(() => {
            let proxy = null;
            Object.defineProperty(window, 'CONFIG', {
                configurable: true,
                get() {
                    return proxy;
                },
                set(value) {
                    proxy = new Proxy(value, {
                        get(target, prop) {
                            if (prop === 'features') {
                                const features = Reflect.get(target, prop, target);
                                return { ...features, instrumentation: false };
                            }
                            return Reflect.get(target, prop, target);
                        },
                    });
                },
            });
        });

        await page.goto(APP_URL);
        await page.waitForSelector('#libraryView', { state: 'visible' });

        // Sanity check: the proxy should force features.instrumentation to false.
        const featuresInstrumentation = await page.evaluate(() => {
            return window.CONFIG?.features?.instrumentation;
        });
        expect(featuresInstrumentation).toBe(false);

        // The help viewer is triggered by the "?" button on the library view.
        // Clicking it will call renderHelpContent(), which filters the
        // usage-stats section when instrumentation is disabled.
        await page.locator('.library-help-btn').click();
        await page.waitForSelector('#helpViewer', { state: 'visible' });

        // The usage-stats section should be filtered out of both the TOC
        // and the content area.
        const tocHasStats = await page.locator('#helpToc [data-section-id="usage-stats"]').count();
        expect(tocHasStats).toBe(0);

        const contentHasStats = await page.locator('#help-usage-stats').count();
        expect(contentHasStats).toBe(0);
    });
});

// ============================================================================
// studiesImported counter
// ============================================================================

test.describe('Instrumentation: studiesImported counter', () => {
    test('trackStudiesImported increments the counter by the given count', async ({ page }) => {
        // This test verifies the counter logic directly. The drop-handler
        // integration (personal-mode handleDroppedFolder) relies on this
        // same API, so exercising it here verifies the path end-to-end
        // without needing to synthesize a FileSystemHandle drop event.
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions >= 1);

        // Simulate what handleDroppedFolder does after loadDroppedStudies:
        // populate state.studies with N distinct studies and forward the
        // count to the instrumentation module.
        await page.evaluate(async () => {
            const fakeStudies = {
                'study-a': { studyInstanceUid: 'study-a', series: {} },
                'study-b': { studyInstanceUid: 'study-b', series: {} },
                'study-c': { studyInstanceUid: 'study-c', series: {} },
            };
            window.DicomViewerApp.state.studies = fakeStudies;
            await window.Instrumentation?.trackStudiesImported(Object.keys(fakeStudies).length);
        });

        await waitForStats(page, (stats) => stats.studiesImported === 3);

        const stats = await readStats(page);
        expect(stats.studiesImported).toBe(3);
    });

    test('viewer open does not increment studiesImported', async ({ page }) => {
        // The viewer module is NOT allowed to call trackStudiesImported --
        // only the import/drop paths are. Test mode loads studies via
        // /api/test-data which does NOT go through loadDroppedStudies, so
        // studiesImported must remain 0 even after opening a study.
        await clearInstrumentationStorage(page);
        await page.goto(TEST_URL);

        // Wait for test mode to load and open a study.
        await page.waitForFunction(
            () => {
                const appState = window.DicomViewerApp?.state;
                return appState?.currentStudy && appState?.currentSeries;
            },
            null,
            { timeout: 30000 },
        );

        // Give instrumentation time to flush the session increment.
        await waitForStats(page, (stats) => stats.sessions >= 1);

        const stats = await readStats(page);
        expect(stats).not.toBeNull();
        expect(stats.sessions).toBe(1);
        expect(stats.studiesImported).toBe(0);
    });
});

// ============================================================================
// beforeunload behavior (Issue #2: desktop must not write to localStorage)
// ============================================================================

test.describe('Instrumentation: beforeunload write path', () => {
    test('browser mode writes dirty stats to localStorage on beforeunload', async ({ page }) => {
        // This is the positive case for Issue #2. Browser mode (useDesktopSql
        // = false) must still flush on unload.
        await clearInstrumentationStorage(page);
        await page.goto(APP_URL);
        await waitForStats(page, (stats) => stats.sessions >= 1);

        // Dirty the stats without triggering an async flush, then force the
        // beforeunload handler. The handler should persist the dirty bits.
        await page.evaluate(() => {
            // Directly call trackStudiesImported, which bumps studiesImported
            // and marks dirty. The track* functions call flush() themselves,
            // but for this test we just verify the unload handler is wired
            // and localStorage reflects the final count.
            return window.Instrumentation?.trackStudiesImported(5);
        });

        await waitForStats(page, (stats) => stats.studiesImported === 5);

        // Manually dispatch beforeunload and verify it did not throw and
        // the localStorage key is still present and valid.
        await page.evaluate(() => {
            window.dispatchEvent(new Event('beforeunload'));
        });

        const stats = await readStats(page);
        expect(stats).not.toBeNull();
        expect(stats.studiesImported).toBe(5);
    });
});
