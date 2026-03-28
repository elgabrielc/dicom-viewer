/**
 * UpdateUI - Desktop auto-update banner
 *
 * Checks for updates on launch (after a short delay) and when triggered
 * by the "Check for Updates..." menu item. Shows a non-intrusive banner
 * at the top of the app when an update is available.
 *
 * Uses window.__TAURI__.updater (withGlobalTauri) -- no npm imports needed.
 * Waits for the Tauri runtime to be fully available before registering
 * event listeners or checking for updates.
 *
 * Feature-gated: only activates when CONFIG.features.autoUpdate is true.
 * Disabled in dev builds (non-packaged apps) to avoid hitting the updater
 * endpoint during local development.
 *
 * Depends on:
 *   window.CONFIG (config.js)
 *   window.__TAURI__.updater (tauri-plugin-updater, registered in main.rs)
 *   window.__TAURI__.process (tauri-plugin-process, for relaunch)
 *   window.__TAURI__.event (for menu event listener)
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _UpdateUI = (() => {

    // Delay before first background check (let the app finish loading)
    const INITIAL_CHECK_DELAY_MS = 3000;

    // Brief message display time for "up to date" on manual check
    const UP_TO_DATE_DISPLAY_MS = 4000;

    // Max time to wait for Tauri runtime APIs to become available
    const RUNTIME_WAIT_TIMEOUT_MS = 5000;
    const RUNTIME_POLL_INTERVAL_MS = 50;

    let initialized = false;
    let pendingUpdate = null;
    let installing = false;

    function init() {
        if (initialized) return;

        const config = window.CONFIG;
        if (!config || !config.features || !config.features.autoUpdate) {
            return;
        }

        // Skip updater in dev builds (cargo tauri dev serves from localhost)
        if (!isPackagedApp()) {
            return;
        }

        initialized = true;

        // Wire banner buttons (DOM is ready, safe to query)
        const dismissBtn = document.getElementById('updateBannerDismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', hideBanner);
        }

        const actionBtn = document.getElementById('updateBannerAction');
        if (actionBtn) {
            actionBtn.addEventListener('click', handleActionClick);
        }

        // Wait for Tauri runtime, then register listeners and check
        waitForUpdaterRuntime().then(runtime => {
            if (!runtime) return;

            // Register menu event listener
            const eventApi = runtime.event;
            if (eventApi?.listen) {
                eventApi.listen('desktop://check-for-updates', () => {
                    checkForUpdates(true);
                }).catch(err => {
                    console.warn('Failed to register update menu handler:', err);
                });
            }

            // Background check after initial delay
            setTimeout(() => checkForUpdates(false), INITIAL_CHECK_DELAY_MS);
        });
    }

    async function waitForUpdaterRuntime() {
        // Check if already available
        if (hasUpdaterApis(window.__TAURI__)) {
            return window.__TAURI__;
        }

        // Wait for the ready promise if available
        const ready = window.__DICOM_VIEWER_TAURI_READY__;
        if (ready && typeof ready.then === 'function') {
            const resolved = await ready;
            if (hasUpdaterApis(resolved)) return resolved;
        }

        // Poll for late-arriving runtime
        const deadline = performance.now() + RUNTIME_WAIT_TIMEOUT_MS;
        while (performance.now() < deadline) {
            if (hasUpdaterApis(window.__TAURI__)) {
                return window.__TAURI__;
            }
            await new Promise(resolve => setTimeout(resolve, RUNTIME_POLL_INTERVAL_MS));
        }

        return null;
    }

    function hasUpdaterApis(runtime) {
        return !!(
            runtime
            && typeof runtime.updater?.check === 'function'
            && typeof runtime.event?.listen === 'function'
        );
    }

    function isPackagedApp() {
        // Packaged Tauri apps serve from tauri: or tauri.localhost, not localhost:1420
        const protocol = window.location?.protocol || '';
        const hostname = window.location?.hostname || '';
        return protocol === 'tauri:' || hostname === 'tauri.localhost';
    }

    async function checkForUpdates(manual) {
        const updater = window.__TAURI__?.updater;
        if (!updater?.check) {
            if (manual) {
                showBanner('Auto-update is not available in this build.', null);
            }
            return;
        }

        if (manual) {
            showBanner('Checking for updates...', null);
        }

        try {
            const update = await updater.check();

            if (update) {
                pendingUpdate = update;
                showBanner(
                    'Version ' + update.version + ' is available.',
                    'Download and Install'
                );
            } else if (manual) {
                showBanner('You are on the latest version.', null);
                setTimeout(hideBanner, UP_TO_DATE_DISPLAY_MS);
            }
        } catch (err) {
            console.warn('Update check failed:', err);
            if (manual) {
                showBanner('Could not check for updates.', null);
                setTimeout(hideBanner, UP_TO_DATE_DISPLAY_MS);
            }
        }
    }

    async function handleActionClick() {
        if (installing) return;

        const actionBtn = document.getElementById('updateBannerAction');

        // If update is installed and waiting for restart
        if (actionBtn && actionBtn.dataset.state === 'restart') {
            installing = true;
            const process = window.__TAURI__?.process;
            if (process?.relaunch) {
                await process.relaunch();
            }
            return;
        }

        // Retry after failure -- get a fresh update object
        if (actionBtn && actionBtn.dataset.state === 'retry') {
            installing = false;
            await checkForUpdates(true);
            return;
        }

        // Download and install the pending update
        if (!pendingUpdate) return;

        installing = true;
        if (actionBtn) {
            actionBtn.textContent = 'Downloading...';
            actionBtn.disabled = true;
        }

        try {
            await pendingUpdate.downloadAndInstall((event) => {
                if (event.event === 'Started' && actionBtn) {
                    actionBtn.textContent = 'Downloading...';
                } else if (event.event === 'Finished' && actionBtn) {
                    actionBtn.textContent = 'Restart Now';
                }
            });

            // Download + install complete -- prompt restart
            showBanner('Update installed. Restart to apply.', 'Restart Now');
            if (actionBtn) {
                actionBtn.dataset.state = 'restart';
                actionBtn.disabled = false;
            }
            pendingUpdate = null;
            installing = false;
        } catch (err) {
            console.error('Update install failed:', err);
            // Clear stale update object -- re-check will get a fresh one
            pendingUpdate = null;
            installing = false;
            showBanner('Update failed. Try again later.', 'Retry');
            if (actionBtn) {
                actionBtn.disabled = false;
                actionBtn.dataset.state = 'retry';
            }
        }
    }

    function showBanner(text, actionLabel) {
        const banner = document.getElementById('updateBanner');
        const textEl = document.getElementById('updateBannerText');
        const actionBtn = document.getElementById('updateBannerAction');
        const dismissBtn = document.getElementById('updateBannerDismiss');

        if (!banner || !textEl) return;

        textEl.textContent = text;

        if (actionBtn) {
            if (actionLabel) {
                actionBtn.textContent = actionLabel;
                actionBtn.style.display = '';
                actionBtn.disabled = false;
                actionBtn.dataset.state = '';
            } else {
                actionBtn.style.display = 'none';
            }
        }

        if (dismissBtn) {
            dismissBtn.style.display = '';
        }

        banner.style.display = '';
    }

    function hideBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.style.display = 'none';
        }
    }

    // Self-initialize: call init() directly (not _UpdateUI.init()) because
    // the IIFE hasn't returned yet when this runs.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }

    return { init };
})();
