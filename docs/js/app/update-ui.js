/**
 * UpdateUI - Desktop auto-update banner
 *
 * Checks for updates on launch (after a short delay) and when triggered
 * by the "Check for Updates..." menu item. Shows a non-intrusive banner
 * at the top of the app when an update is available.
 *
 * Uses window.__TAURI__.updater (withGlobalTauri) -- no npm imports needed.
 *
 * Feature-gated: only activates when CONFIG.features.autoUpdate is true.
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

    let initialized = false;
    let pendingUpdate = null;
    let installing = false;

    function init() {
        if (initialized) return;

        const config = window.CONFIG;
        if (!config || !config.features || !config.features.autoUpdate) {
            return;
        }

        initialized = true;

        // Listen for manual "Check for Updates..." menu event
        const eventApi = window.__TAURI__?.event;
        if (eventApi?.listen) {
            eventApi.listen('desktop://check-for-updates', () => {
                checkForUpdates(true);
            }).catch(err => {
                console.warn('Failed to register update menu handler:', err);
            });
        }

        // Wire banner buttons
        const dismissBtn = document.getElementById('updateBannerDismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', hideBanner);
        }

        const actionBtn = document.getElementById('updateBannerAction');
        if (actionBtn) {
            actionBtn.addEventListener('click', handleActionClick);
        }

        // Background check after initial delay
        setTimeout(() => checkForUpdates(false), INITIAL_CHECK_DELAY_MS);
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
