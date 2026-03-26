/**
 * SyncStatusUI - Visual sync status indicator for cloud mode
 *
 * Listens for sync lifecycle events dispatched by the sync engine wireup
 * and updates a small status indicator in the header. Also manages a
 * dismissible conflict banner when sync rejects local changes.
 *
 * States:
 *   synced   - green dot, last sync succeeded, no pending changes
 *   syncing  - animated green dot, sync in progress
 *   pending  - yellow dot, local changes waiting to sync
 *   offline  - gray dot, network unavailable
 *   error    - red dot, sync failed (will retry)
 *
 * Feature-gated: only activates when CONFIG.features.cloudSync is true.
 *
 * Depends on:
 *   window.CONFIG (config.js)
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const _SyncStatusUI = (() => {

    // Auto-dismiss conflict banner after this many milliseconds
    const CONFLICT_BANNER_TIMEOUT_MS = 10000;

    // Refresh "last synced" relative time every 30 seconds
    const RELATIVE_TIME_REFRESH_MS = 30000;

    // Human-readable labels for each state
    const STATE_LABELS = {
        synced:  'Synced',
        syncing: 'Syncing...',
        pending: 'Pending',
        offline: 'Offline',
        error:   'Sync error'
    };

    let currentStatus = 'synced';
    let lastSyncTimestamp = null;
    let relativeTimeTimer = null;
    let conflictDismissTimer = null;
    let initialized = false;

    /**
     * Initialize the sync status UI.
     * Attaches event listeners and starts relative time updates.
     * No-op if cloudSync feature is disabled or already initialized.
     */
    function init() {
        if (initialized) return;

        const config = window.CONFIG;
        if (!config || !config.features || !config.features.cloudSync) {
            return;
        }

        initialized = true;

        // Show the status indicator
        const statusEl = document.getElementById('syncStatus');
        if (statusEl) {
            statusEl.style.display = '';
        }

        // Set initial state
        setStatus('synced');

        // Listen for sync lifecycle events
        window.addEventListener('sync:started', handleSyncStarted);
        window.addEventListener('sync:completed', handleSyncCompleted);
        window.addEventListener('sync:error', handleSyncError);
        window.addEventListener('sync:auth-required', handleAuthRequired);
        window.addEventListener('sync:pending', handleSyncPending);

        // Listen for browser online/offline events
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Conflict banner dismiss button
        const dismissBtn = document.getElementById('syncConflictDismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', hideConflictBanner);
        }

        // Start periodic relative time updates
        relativeTimeTimer = setInterval(updateRelativeTime, RELATIVE_TIME_REFRESH_MS);
    }

    /**
     * Tear down listeners and timers. Useful for testing.
     */
    function destroy() {
        if (!initialized) return;
        initialized = false;

        window.removeEventListener('sync:started', handleSyncStarted);
        window.removeEventListener('sync:completed', handleSyncCompleted);
        window.removeEventListener('sync:error', handleSyncError);
        window.removeEventListener('sync:auth-required', handleAuthRequired);
        window.removeEventListener('sync:pending', handleSyncPending);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);

        if (relativeTimeTimer !== null) {
            clearInterval(relativeTimeTimer);
            relativeTimeTimer = null;
        }

        if (conflictDismissTimer !== null) {
            clearTimeout(conflictDismissTimer);
            conflictDismissTimer = null;
        }
    }

    // ---- Event handlers ----

    function handleSyncStarted() {
        setStatus('syncing');
    }

    function handleSyncCompleted(event) {
        const detail = event.detail || {};
        const rejected = detail.rejected;

        if (Array.isArray(rejected) && rejected.length > 0) {
            const count = rejected.length;
            const noun = count === 1 ? 'change' : 'changes';
            showConflictBanner(
                `${count} ${noun} had conflicts and were resolved by the server.`
            );
        }

        lastSyncTimestamp = Date.now();
        setStatus('synced');
        updateRelativeTime();
    }

    function handleSyncError() {
        setStatus('error');
    }

    function handleAuthRequired() {
        // Treat auth-required as offline from the sync perspective
        setStatus('offline');
    }

    function handleSyncPending() {
        // Only show pending if we are not currently syncing
        if (currentStatus !== 'syncing') {
            setStatus('pending');
        }
    }

    function handleOnline() {
        // When coming back online, revert to synced (engine will trigger sync)
        if (currentStatus === 'offline') {
            setStatus('synced');
        }
    }

    function handleOffline() {
        setStatus('offline');
    }

    // ---- UI updates ----

    /**
     * Set the current sync status and update DOM elements.
     * @param {'synced'|'syncing'|'pending'|'offline'|'error'} status
     */
    function setStatus(status) {
        currentStatus = status;

        const iconEl = document.getElementById('syncStatusIcon');
        const textEl = document.getElementById('syncStatusText');
        const statusEl = document.getElementById('syncStatus');

        if (!iconEl || !textEl || !statusEl) return;

        // Update the CSS class for color/animation
        statusEl.className = 'sync-status sync-status--' + status;

        // Update the label
        textEl.textContent = STATE_LABELS[status] || status;

        // Build tooltip with relative time for synced state
        if (status === 'synced' && lastSyncTimestamp) {
            statusEl.title = 'Last synced: ' + formatRelativeTime(lastSyncTimestamp);
        } else if (status === 'error') {
            statusEl.title = 'Sync failed. Will retry automatically.';
        } else if (status === 'offline') {
            statusEl.title = 'No network connection. Changes will sync when back online.';
        } else {
            statusEl.title = '';
        }
    }

    /**
     * Show the conflict banner with a message.
     * Auto-dismisses after CONFLICT_BANNER_TIMEOUT_MS.
     * @param {string} message
     */
    function showConflictBanner(message) {
        const bannerEl = document.getElementById('syncConflictBanner');
        const textEl = document.getElementById('syncConflictText');

        if (!bannerEl || !textEl) return;

        textEl.textContent = message;
        bannerEl.style.display = '';

        // Clear any previous auto-dismiss timer
        if (conflictDismissTimer !== null) {
            clearTimeout(conflictDismissTimer);
        }

        conflictDismissTimer = setTimeout(hideConflictBanner, CONFLICT_BANNER_TIMEOUT_MS);
    }

    /**
     * Hide the conflict banner.
     */
    function hideConflictBanner() {
        const bannerEl = document.getElementById('syncConflictBanner');
        if (bannerEl) {
            bannerEl.style.display = 'none';
        }

        if (conflictDismissTimer !== null) {
            clearTimeout(conflictDismissTimer);
            conflictDismissTimer = null;
        }
    }

    /**
     * Update the tooltip with the current relative time since last sync.
     */
    function updateRelativeTime() {
        if (currentStatus !== 'synced' || !lastSyncTimestamp) return;

        const statusEl = document.getElementById('syncStatus');
        if (statusEl) {
            statusEl.title = 'Last synced: ' + formatRelativeTime(lastSyncTimestamp);
        }
    }

    /**
     * Format a timestamp as a human-readable relative time string.
     * @param {number} timestamp - Unix timestamp in milliseconds
     * @returns {string}
     */
    function formatRelativeTime(timestamp) {
        const deltaMs = Date.now() - timestamp;
        const deltaSec = Math.floor(deltaMs / 1000);

        if (deltaSec < 10) return 'just now';
        if (deltaSec < 60) return deltaSec + ' seconds ago';

        const deltaMin = Math.floor(deltaSec / 60);
        if (deltaMin === 1) return '1 minute ago';
        if (deltaMin < 60) return deltaMin + ' minutes ago';

        const deltaHour = Math.floor(deltaMin / 60);
        if (deltaHour === 1) return '1 hour ago';
        return deltaHour + ' hours ago';
    }

    /**
     * Get the current status (for testing).
     * @returns {string}
     */
    function getStatus() {
        return currentStatus;
    }

    /**
     * Get the last sync timestamp (for testing).
     * @returns {number|null}
     */
    function getLastSyncTimestamp() {
        return lastSyncTimestamp;
    }

    return {
        init,
        destroy,
        setStatus,
        getStatus,
        getLastSyncTimestamp,
        showConflictBanner,
        hideConflictBanner,
        formatRelativeTime
    };
})();

if (typeof window !== 'undefined') {
    window._SyncStatusUI = _SyncStatusUI;

    // Self-initialize: same pattern as account-ui.js.
    // init() already gates on CONFIG.features.cloudSync.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _SyncStatusUI.init());
    } else {
        _SyncStatusUI.init();
    }
}
