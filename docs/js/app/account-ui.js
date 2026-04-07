/**
 * Account UI - Login/signup modal and token lifecycle management
 *
 * Handles user authentication for cloud mode:
 *   - Login / signup forms with toggle
 *   - JWT token storage and refresh
 *   - Device registration on first login
 *   - Session restore on page load
 *   - Logout with sync engine teardown
 *
 * Only active when CONFIG.features.userAccounts is true.
 *
 * Depends on:
 *   window.CONFIG (config.js)
 *   window._SyncOutbox (sync.js) - for device_id storage
 *   window._SyncEngine (sync-engine.js) - started after login
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */
(() => {
    const app = window.DicomViewerApp || {};
    window.DicomViewerApp = app;
    const config = window.CONFIG;

    // Browser-storage keys used for web sessions and as a migration source
    // into desktop secure storage.
    const ACCESS_TOKEN_KEY = 'dicom-viewer-access-token';
    const REFRESH_TOKEN_KEY = 'dicom-viewer-refresh-token';
    const USER_EMAIL_KEY = 'dicom-viewer-user-email';
    const USER_NAME_KEY = 'dicom-viewer-user-name';

    // Cached DOM references (resolved lazily after DOMContentLoaded)
    let modalEl = null;
    let modalTitleEl = null;
    let formEl = null;
    let emailInput = null;
    let passwordInput = null;
    let nameInput = null;
    let submitBtn = null;
    let toggleTextEl = null;
    let toggleLinkEl = null;
    let errorEl = null;
    let statusEl = null;

    // UI state
    let isSignupMode = false;
    let syncEngineInstance = null;

    // ---- Token Storage ----

    function isDesktopSecureStoreMode() {
        return config?.deploymentMode === 'desktop' && typeof window.__TAURI__?.core?.invoke === 'function';
    }

    function readBrowserSession() {
        return {
            accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
            refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
            userEmail: localStorage.getItem(USER_EMAIL_KEY),
            userName: localStorage.getItem(USER_NAME_KEY),
        };
    }

    function writeBrowserSession(session) {
        if (session.accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
        else localStorage.removeItem(ACCESS_TOKEN_KEY);

        if (session.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
        else localStorage.removeItem(REFRESH_TOKEN_KEY);

        if (session.userEmail) localStorage.setItem(USER_EMAIL_KEY, session.userEmail);
        else localStorage.removeItem(USER_EMAIL_KEY);

        if (session.userName) localStorage.setItem(USER_NAME_KEY, session.userName);
        else localStorage.removeItem(USER_NAME_KEY);
    }

    function clearBrowserSession() {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(USER_EMAIL_KEY);
        localStorage.removeItem(USER_NAME_KEY);
    }

    const authStore = (() => {
        const cache = {
            accessToken: null,
            refreshToken: null,
            userEmail: null,
            userName: null,
        };
        let hydratePromise = null;

        function snapshot() {
            return {
                accessToken: cache.accessToken || null,
                refreshToken: cache.refreshToken || null,
                userEmail: cache.userEmail || null,
                userName: cache.userName || null,
            };
        }

        function assign(session = {}) {
            cache.accessToken = session.accessToken || null;
            cache.refreshToken = session.refreshToken || null;
            cache.userEmail = session.userEmail || null;
            cache.userName = session.userName || null;
            return snapshot();
        }

        async function persistDesktop(session) {
            const invoke = window.__TAURI__?.core?.invoke;
            await invoke('store_secure_auth_state', {
                state: {
                    access_token: session.accessToken || null,
                    refresh_token: session.refreshToken || null,
                    user_email: session.userEmail || null,
                    user_name: session.userName || null,
                },
            });
            clearBrowserSession();
        }

        async function hydrate() {
            if (hydratePromise) return hydratePromise;

            hydratePromise = (async () => {
                if (!isDesktopSecureStoreMode()) {
                    return assign(readBrowserSession());
                }

                const invoke = window.__TAURI__?.core?.invoke;
                const legacy = readBrowserSession();
                let secure = null;

                try {
                    secure = await invoke('load_secure_auth_state');
                } catch (error) {
                    console.warn('AccountUI: failed to load secure auth state:', error);
                }

                const session = {
                    accessToken: secure?.access_token || legacy.accessToken || null,
                    refreshToken: secure?.refresh_token || legacy.refreshToken || null,
                    userEmail: secure?.user_email || legacy.userEmail || null,
                    userName: secure?.user_name || legacy.userName || null,
                };

                assign(session);

                if (legacy.accessToken || legacy.refreshToken || legacy.userEmail || legacy.userName) {
                    try {
                        await persistDesktop(session);
                    } catch (error) {
                        console.warn('AccountUI: failed to migrate legacy desktop auth state:', error);
                    }
                }

                return snapshot();
            })().finally(() => {
                hydratePromise = null;
            });

            return hydratePromise;
        }

        async function save(partialSession = {}) {
            const session = assign({
                ...snapshot(),
                ...partialSession,
            });

            if (isDesktopSecureStoreMode()) {
                await persistDesktop(session);
            } else {
                writeBrowserSession(session);
            }
            return snapshot();
        }

        async function clear() {
            assign({});
            if (isDesktopSecureStoreMode()) {
                try {
                    await window.__TAURI__?.core?.invoke('clear_secure_auth_state');
                } catch (error) {
                    console.warn('AccountUI: failed to clear secure auth state:', error);
                }
            }
            clearBrowserSession();
        }

        return {
            hydrate,
            save,
            clear,
            getAccessToken: () => cache.accessToken,
            getRefreshToken: () => cache.refreshToken,
            getUserEmail: () => cache.userEmail,
            getUserName: () => cache.userName,
            _snapshot: snapshot,
        };
    })();

    function getAccessToken() {
        return authStore.getAccessToken();
    }

    function getRefreshToken() {
        return authStore.getRefreshToken();
    }

    async function storeTokens(accessToken, refreshToken) {
        await authStore.save({
            accessToken,
            refreshToken: refreshToken || authStore.getRefreshToken(),
            userEmail: authStore.getUserEmail(),
            userName: authStore.getUserName(),
        });
    }

    async function clearTokens() {
        await authStore.clear();
    }

    async function storeUserInfo(email, name) {
        await authStore.save({
            accessToken: authStore.getAccessToken(),
            refreshToken: authStore.getRefreshToken(),
            userEmail: email || null,
            userName: name || null,
        });
    }

    function getUserEmail() {
        return authStore.getUserEmail();
    }

    function getUserName() {
        return authStore.getUserName();
    }

    // ---- JWT Decode (payload only, no verification) ----

    /**
     * Decode the payload portion of a JWT without verifying the signature.
     * Returns null if the token is malformed.
     * @param {string} token
     * @returns {Object|null}
     */
    function decodeJwtPayload(token) {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        try {
            // Base64url decode
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = atob(base64);
            return JSON.parse(json);
        } catch {
            return null;
        }
    }

    /**
     * Check whether an access token is expired (or will expire within a buffer).
     * @param {string} token - JWT access token
     * @param {number} bufferSeconds - Pre-expiry buffer (default 60s)
     * @returns {boolean} true if expired or within buffer
     */
    function isTokenExpired(token, bufferSeconds = 60) {
        const payload = decodeJwtPayload(token);
        if (!payload || typeof payload.exp !== 'number') {
            // No exp claim -- treat as expired to force refresh
            return true;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        return payload.exp <= nowSeconds + bufferSeconds;
    }

    // ---- Token Refresh ----

    // Guard against concurrent refresh attempts
    let refreshPromise = null;

    function createTransientRefreshError(message) {
        const error = new Error(message);
        error.transient = true;
        return error;
    }

    /**
     * Refresh the access token using the stored refresh token.
     * Returns the new access token on success, null on failure.
     * Concurrent callers share the same in-flight request.
     * @returns {Promise<string|null>}
     */
    async function refreshAccessToken() {
        if (refreshPromise) return refreshPromise;

        refreshPromise = (async () => {
            const refreshToken = getRefreshToken();
            if (!refreshToken) return null;

            try {
                const res = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken }),
                });

                if (!res.ok) {
                    if (res.status === 401 || res.status === 403) {
                        // Refresh token rejected -- clear stale tokens to prevent
                        // infinite retry loops on next page load
                        await clearTokens();
                        return null;
                    }
                    throw createTransientRefreshError(`Token refresh failed: ${res.status}`);
                }

                const data = await res.json();
                await storeTokens(data.access_token, data.refresh_token || null);
                return data.access_token;
            } catch (e) {
                if (e?.transient) {
                    throw e;
                }
                console.warn('AccountUI: token refresh failed:', e);
                throw createTransientRefreshError(`Token refresh failed: ${e?.message || 'network error'}`);
            }
        })();

        try {
            return await refreshPromise;
        } finally {
            refreshPromise = null;
        }
    }

    /**
     * Get a valid access token, refreshing if necessary.
     * This is the function passed to SyncEngine as getAccessToken.
     * @returns {Promise<string|null>}
     */
    async function getValidAccessToken() {
        const token = getAccessToken();
        if (!token) return null;

        if (!isTokenExpired(token)) {
            return token;
        }

        // Token expired or about to expire -- attempt refresh
        const newToken = await refreshAccessToken();
        if (!newToken) {
            // Refresh failed -- trigger re-auth
            showLoginModal();
            return null;
        }
        return newToken;
    }

    // ---- Device Registration ----

    /**
     * Register this device with the server if no device_id is stored.
     * @param {string} accessToken - Valid JWT access token
     * @returns {Promise<string|null>} device_id on success
     */
    async function ensureDeviceRegistered(accessToken) {
        const outbox = window._SyncOutbox;
        if (!outbox) return null;

        if (typeof outbox.hydrateFromSqlite === 'function') {
            await outbox.hydrateFromSqlite();
        }

        const existingDeviceId = outbox.getDeviceId();
        if (existingDeviceId) return existingDeviceId;

        try {
            const platform = detectPlatformName();
            const res = await fetch('/api/auth/devices', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    device_name: `${platform} Browser`,
                    platform: platform,
                }),
            });

            if (!res.ok) {
                console.warn('AccountUI: device registration failed:', res.status);
                return null;
            }

            const data = await res.json();
            outbox.setDeviceId(data.device_id);
            return data.device_id;
        } catch (e) {
            console.warn('AccountUI: device registration error:', e);
            return null;
        }
    }

    /**
     * Detect a human-readable platform name for device registration.
     * @returns {string}
     */
    function detectPlatformName() {
        const ua = navigator.userAgent || '';
        if (ua.includes('Mac')) return 'macOS';
        if (ua.includes('Windows')) return 'Windows';
        if (ua.includes('Linux')) return 'Linux';
        if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
        if (ua.includes('Android')) return 'Android';
        return 'Web';
    }

    // ---- Sync Engine Lifecycle ----

    /**
     * Create and start the sync engine after successful authentication.
     * @param {string} accessToken - initial valid token (used only for device registration)
     */
    async function startSyncEngine(accessToken) {
        // Ensure device is registered before starting sync
        await ensureDeviceRegistered(accessToken);

        if (syncEngineInstance) {
            syncEngineInstance.stop();
        }

        const SyncEngineClass = window._SyncEngine?.SyncEngine;
        if (!SyncEngineClass) {
            console.warn('AccountUI: SyncEngine class not available');
            return;
        }

        syncEngineInstance = new SyncEngineClass({
            getAccessToken: getValidAccessToken,
            onAuthRequired: () => {
                window.dispatchEvent(new CustomEvent('sync:auth-required'));
            },
        });

        // Expose instance for other modules (e.g., dispatcher integration).
        // window.syncEngine is the canonical reference used by main.js and
        // external callers; app.syncEngine is the module-scoped alias.
        app.syncEngine = syncEngineInstance;
        window.syncEngine = syncEngineInstance;

        syncEngineInstance.start();
    }

    function stopSyncEngine() {
        if (syncEngineInstance) {
            syncEngineInstance.stop();
            syncEngineInstance = null;
            app.syncEngine = null;
            window.syncEngine = null;
        }
    }

    // ---- DOM Helpers ----

    function resolveDom() {
        const $ = (id) => document.getElementById(id);
        modalEl = $('accountModal');
        modalTitleEl = $('accountModalTitle');
        formEl = $('loginForm');
        emailInput = $('accountEmail');
        passwordInput = $('accountPassword');
        nameInput = $('accountName');
        submitBtn = $('accountSubmit');
        toggleTextEl = $('accountToggleText');
        toggleLinkEl = $('accountToggleLink');
        errorEl = $('accountError');
        statusEl = $('accountStatus');
    }

    function showError(message) {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }

    function hideError() {
        if (!errorEl) return;
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }

    function setSubmitLoading(loading) {
        if (!submitBtn) return;
        submitBtn.disabled = loading;
        submitBtn.textContent = loading
            ? isSignupMode
                ? 'Creating Account...'
                : 'Signing In...'
            : isSignupMode
              ? 'Sign Up'
              : 'Sign In';
    }

    // ---- Modal Control ----

    function showLoginModal() {
        if (!modalEl) resolveDom();
        if (!modalEl) return;

        hideError();
        setSignupMode(false);
        modalEl.style.display = 'flex';

        // Focus the email field after display
        requestAnimationFrame(() => {
            if (emailInput) emailInput.focus();
        });
    }

    function hideLoginModal() {
        if (!modalEl) return;
        modalEl.style.display = 'none';

        // Clear form
        if (formEl) formEl.reset();
        hideError();
    }

    function setSignupMode(signup) {
        isSignupMode = signup;
        if (modalTitleEl) modalTitleEl.textContent = signup ? 'Create Account' : 'Sign In';
        if (nameInput) nameInput.style.display = signup ? 'block' : 'none';
        if (nameInput) nameInput.required = signup;
        if (submitBtn) submitBtn.textContent = signup ? 'Sign Up' : 'Sign In';
        if (toggleTextEl) toggleTextEl.textContent = signup ? 'Already have an account?' : "Don't have an account?";
        if (toggleLinkEl) toggleLinkEl.textContent = signup ? 'Sign In' : 'Sign Up';
        hideError();
    }

    // ---- Account Status Indicator ----

    function updateAccountStatus() {
        if (!statusEl) return;

        const email = getUserEmail();
        if (email) {
            statusEl.textContent = email;
            statusEl.style.display = 'inline';
            statusEl.classList.add('signed-in');
            statusEl.title = 'Click to sign out';
        } else {
            statusEl.textContent = 'Sign In';
            statusEl.style.display = 'inline';
            statusEl.classList.remove('signed-in');
            statusEl.title = 'Click to sign in';
        }
    }

    // ---- Auth Flows ----

    /**
     * Submit login credentials to the server.
     * @param {string} email
     * @param {string} password
     */
    async function doLogin(email, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || body.message || `Login failed (${res.status})`);
        }

        return await res.json();
    }

    /**
     * Submit signup credentials to the server.
     * @param {string} email
     * @param {string} password
     * @param {string} name
     */
    async function doSignup(email, password, name) {
        const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || body.message || `Signup failed (${res.status})`);
        }

        return await res.json();
    }

    /**
     * Handle form submission for both login and signup flows.
     * @param {Event} event
     */
    async function handleFormSubmit(event) {
        event.preventDefault();
        hideError();

        const email = emailInput?.value?.trim();
        const password = passwordInput?.value;
        const name = nameInput?.value?.trim();

        if (!email || !password) {
            showError('Email and password are required.');
            return;
        }

        if (isSignupMode && !name) {
            showError('Name is required.');
            return;
        }

        setSubmitLoading(true);

        try {
            let authResponse;

            if (isSignupMode) {
                // Signup then auto-login
                await doSignup(email, password, name);
                authResponse = await doLogin(email, password);
            } else {
                authResponse = await doLogin(email, password);
            }

            // Store tokens and user info
            await storeTokens(authResponse.access_token, authResponse.refresh_token);
            await storeUserInfo(email, name || authStore.getUserName() || '');

            // Update UI
            hideLoginModal();
            updateAccountStatus();

            // Register device and start sync
            await startSyncEngine(authResponse.access_token);
        } catch (e) {
            showError(e.message || 'Authentication failed. Please try again.');
        } finally {
            setSubmitLoading(false);
        }
    }

    /**
     * Sign out: clear tokens, stop sync, reset UI.
     */
    async function logout() {
        stopSyncEngine();
        await clearTokens();

        // Clear device_id so next login re-registers
        const outbox = window._SyncOutbox;
        if (outbox) {
            outbox.setDeviceId(null);
        }

        updateAccountStatus();
        showLoginModal();
    }

    // ---- Session Restore ----

    /**
     * On page load, check for stored tokens and restore the session
     * if possible. If the access token is expired, attempt a refresh.
     */
    async function restoreSession() {
        await authStore.hydrate();

        const accessToken = getAccessToken();
        if (!accessToken) {
            // No stored session -- show sign-in status but do not show modal
            // (user might not want to sign in right away)
            updateAccountStatus();
            return;
        }

        // Try to get a valid token
        let validToken = null;
        try {
            validToken = await getValidAccessToken();
        } catch (error) {
            if (error?.transient) {
                console.warn('AccountUI: restoreSession deferred due to transient auth error:', error);
                updateAccountStatus();
                return;
            }
            throw error;
        }
        if (!validToken) {
            // Refresh failed -- clear stale tokens, show sign-in option
            await clearTokens();
            updateAccountStatus();
            return;
        }

        // Session restored successfully
        await storeUserInfo(getUserEmail(), getUserName());
        updateAccountStatus();

        // Start sync engine with restored session
        await startSyncEngine(validToken);
    }

    // ---- Event Binding ----

    function bindEvents() {
        if (!formEl) return;

        formEl.addEventListener('submit', handleFormSubmit);

        if (toggleLinkEl) {
            toggleLinkEl.addEventListener('click', (e) => {
                e.preventDefault();
                setSignupMode(!isSignupMode);
            });
        }

        if (statusEl) {
            statusEl.addEventListener('click', () => {
                const email = getUserEmail();
                if (email) {
                    // Already signed in -- confirm logout
                    if (confirm('Sign out?')) {
                        void logout();
                    }
                } else {
                    showLoginModal();
                }
            });
        }

        // Close modal when clicking the backdrop (outside the content box)
        if (modalEl) {
            modalEl.addEventListener('click', (e) => {
                if (e.target === modalEl) {
                    hideLoginModal();
                }
            });
        }

        // Escape key closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modalEl && modalEl.style.display !== 'none') {
                hideLoginModal();
            }
        });

        // Listen for sync:auth-required from sync engine
        window.addEventListener('sync:auth-required', () => {
            showLoginModal();
        });
    }

    // ---- Initialization ----

    /**
     * Initialize the account UI. No-op if userAccounts feature is disabled.
     */
    function init() {
        if (!config?.features?.userAccounts) {
            return;
        }

        resolveDom();

        if (!modalEl) {
            console.warn('AccountUI: modal element not found in DOM');
            return;
        }

        bindEvents();
        restoreSession();
    }

    // ---- Public API ----

    app.accountUi = {
        init,
        showLoginModal,
        hideLoginModal,
        logout,
        getValidAccessToken,
        isTokenExpired,
        // Exposed for testing
        _authStore: authStore,
        _decodeJwtPayload: decodeJwtPayload,
        _storeTokens: storeTokens,
        _clearTokens: clearTokens,
    };

    // Self-initialize: the script loads after the DOM elements it references
    // are already in the HTML (script tag is at the bottom of <body>).
    // DOMContentLoaded may have already fired by the time this runs if the
    // browser parsed the preceding HTML synchronously, so check readyState.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
