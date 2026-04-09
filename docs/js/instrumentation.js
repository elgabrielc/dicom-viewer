/**
 * Instrumentation - Minimal usage tracking (ADR 008)
 *
 * Copyright (c) 2026 Divergent Health Technologies
 * https://divergent.health/
 */

const Instrumentation = (() => {
    // =====================================================================
    // CONSTANTS
    // =====================================================================

    const STORAGE_KEY = 'dicom-viewer-instrumentation-v1';
    const FLUSH_INTERVAL_MS = 30_000;
    const PHONE_HOME_DEBOUNCE_MS = 5_000;
    const PHONE_HOME_URL = 'https://api.myradone.com/api/stats';
    const SCHEMA_VERSION = 1;

    // Desktop SQL table and DB
    const DESKTOP_DB_URL = 'sqlite:viewer.db';
    const DESKTOP_TABLE = 'instrumentation';

    // =====================================================================
    // STATE
    // =====================================================================

    let stats = null;
    let dirty = false;
    let flushTimer = null;
    let phoneHomeTimer = null;
    let desktopDbPromise = null;
    let useDesktopSql = false;
    // initPromise is assigned at the bottom of the IIFE once init() is invoked.
    // Declared up here so the track* functions can await it regardless of
    // call order during the startup race between module load and the first
    // caller in main.js.
    let initPromise = null;

    // =====================================================================
    // SCHEMA
    // =====================================================================

    function createDefaultStats() {
        return {
            version: SCHEMA_VERSION,
            revision: 0,
            installationId: crypto.randomUUID(),
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            sessions: 0,
            studiesImported: 0,
            shareEnabled: false,
        };
    }

    /**
     * Migrate a loaded stats blob to the current schema.
     * Adds missing fields with sensible defaults. Never removes fields.
     */
    function migrateStats(blob) {
        if (!blob || typeof blob !== 'object') {
            return createDefaultStats();
        }

        const now = new Date().toISOString();
        const migrated = { ...blob };

        // Ensure all required fields exist
        if (typeof migrated.version !== 'number') migrated.version = SCHEMA_VERSION;
        if (typeof migrated.revision !== 'number') migrated.revision = 0;
        if (typeof migrated.installationId !== 'string' || !migrated.installationId) {
            migrated.installationId = crypto.randomUUID();
        }
        if (typeof migrated.firstSeen !== 'string' || !migrated.firstSeen) {
            migrated.firstSeen = now;
        }
        if (typeof migrated.lastSeen !== 'string' || !migrated.lastSeen) {
            migrated.lastSeen = now;
        }
        if (typeof migrated.sessions !== 'number' || !Number.isFinite(migrated.sessions)) {
            migrated.sessions = 0;
        }
        if (typeof migrated.studiesImported !== 'number' || !Number.isFinite(migrated.studiesImported)) {
            migrated.studiesImported = 0;
        }
        if (typeof migrated.shareEnabled !== 'boolean') {
            migrated.shareEnabled = false;
        }

        migrated.version = SCHEMA_VERSION;
        return migrated;
    }

    // =====================================================================
    // STORE: localStorage
    // =====================================================================

    function loadFromLocalStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (error) {
            console.warn('Instrumentation: failed to load from localStorage:', error);
            return null;
        }
    }

    function saveToLocalStorage(blob) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
        } catch (error) {
            console.warn('Instrumentation: failed to save to localStorage:', error);
        }
    }

    // =====================================================================
    // STORE: Desktop SQL (Tauri)
    // =====================================================================

    function isDesktopRuntime() {
        if (typeof window === 'undefined') return false;
        if (window.__TAURI__) return true;
        const protocol = window.location?.protocol || '';
        const hostname = window.location?.hostname || '';
        return protocol === 'tauri:' || hostname === 'tauri.localhost';
    }

    async function getDesktopDb() {
        if (!window.__TAURI__?.sql?.load) {
            throw new Error('Desktop SQL runtime not available');
        }
        if (!desktopDbPromise) {
            desktopDbPromise = window.__TAURI__.sql.load(DESKTOP_DB_URL).catch((error) => {
                desktopDbPromise = null;
                throw error;
            });
        }
        return desktopDbPromise;
    }

    async function ensureDesktopDb() {
        // The instrumentation table is created by Rust migration 008
        // (desktop/src-tauri/migrations/008_instrumentation.sql), which is
        // the canonical schema. We only need to confirm the DB handle loads.
        await getDesktopDb();
    }

    async function loadFromDesktopSql() {
        try {
            const db = await getDesktopDb();
            const rows = await db.select(`SELECT * FROM ${DESKTOP_TABLE} WHERE id = 1 LIMIT 1`);
            if (!rows || !rows.length) return null;
            const row = rows[0];
            return {
                version: row.version,
                revision: row.revision,
                installationId: row.installation_id,
                firstSeen: row.first_seen,
                lastSeen: row.last_seen,
                sessions: row.sessions,
                studiesImported: row.studies_imported,
                shareEnabled: row.share_enabled === 1,
            };
        } catch (error) {
            console.warn('Instrumentation: failed to load from desktop SQL:', error);
            return null;
        }
    }

    async function saveToDesktopSql(blob) {
        try {
            const db = await getDesktopDb();
            await db.execute(
                `INSERT INTO ${DESKTOP_TABLE} (id, version, revision, installation_id, first_seen, last_seen, sessions, studies_imported, share_enabled)
                 VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                     version = excluded.version,
                     revision = excluded.revision,
                     installation_id = excluded.installation_id,
                     first_seen = excluded.first_seen,
                     last_seen = excluded.last_seen,
                     sessions = excluded.sessions,
                     studies_imported = excluded.studies_imported,
                     share_enabled = excluded.share_enabled`,
                [
                    blob.version,
                    blob.revision,
                    blob.installationId,
                    blob.firstSeen,
                    blob.lastSeen,
                    blob.sessions,
                    blob.studiesImported,
                    blob.shareEnabled ? 1 : 0,
                ],
            );
        } catch (error) {
            console.warn('Instrumentation: failed to save to desktop SQL:', error);
        }
    }

    // =====================================================================
    // STORE: Unified load/save
    // =====================================================================

    async function loadStats() {
        let blob = null;

        if (useDesktopSql) {
            blob = await loadFromDesktopSql();
        }

        // Fall back to localStorage if desktop SQL returned nothing
        if (!blob) {
            blob = loadFromLocalStorage();
        }

        return migrateStats(blob);
    }

    async function saveStats() {
        if (!stats) return;

        stats.revision += 1;

        if (useDesktopSql) {
            await saveToDesktopSql(stats);
        } else {
            saveToLocalStorage(stats);
        }

        dirty = false;
        schedulePhoneHome();
    }

    // =====================================================================
    // TRANSPORT: Phone home (fire-and-forget POST)
    // =====================================================================

    function buildPayload() {
        if (!stats) return null;
        return {
            version: stats.version,
            revision: stats.revision,
            installationId: stats.installationId,
            firstSeen: stats.firstSeen,
            lastSeen: stats.lastSeen,
            sessions: stats.sessions,
            studiesImported: stats.studiesImported,
        };
    }

    function sendPhoneHome() {
        if (!stats?.shareEnabled) return;

        const payload = buildPayload();
        if (!payload) return;

        try {
            fetch(PHONE_HOME_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).catch(() => {
                // Fire-and-forget: silent on failure
            });
        } catch {
            // Fire-and-forget: silent on failure
        }
    }

    function schedulePhoneHome() {
        if (!stats?.shareEnabled) return;

        if (phoneHomeTimer) {
            clearTimeout(phoneHomeTimer);
        }

        phoneHomeTimer = setTimeout(() => {
            phoneHomeTimer = null;
            sendPhoneHome();
        }, PHONE_HOME_DEBOUNCE_MS);
    }

    // =====================================================================
    // REDUCE: Event handlers
    // =====================================================================

    /**
     * Track an app-open session.
     *
     * Awaits init() before reading stats. Without this wait, a caller that
     * runs synchronously during module load (e.g. main.js at line 659) would
     * observe stats === null and silently drop the first session on every
     * fresh start.
     */
    async function trackAppOpen() {
        // Wait for init() to finish loading stats from storage before mutating.
        if (initPromise) {
            try {
                await initPromise;
            } catch {
                // init() never throws, but be defensive.
            }
        }

        // stats is null when instrumentation is disabled (demo mode); skip silently.
        if (!stats) return;

        stats.sessions += 1;
        stats.lastSeen = new Date().toISOString();
        dirty = true;

        // Flush immediately on app open so the session count persists
        await flush();
    }

    /**
     * Track imported studies. Await init before reading stats for the same
     * reason as trackAppOpen -- the caller fires this synchronously from
     * drop handlers that may race with the init promise on fresh starts.
     *
     * Flushes immediately after incrementing (matching trackAppOpen) so the
     * counter persists promptly instead of waiting up to 30s for the periodic
     * flush. Drop imports are user-visible events; the cost of one extra
     * localStorage/SQLite write per import is negligible compared to the
     * surprise of a stats panel that lags by half a minute.
     */
    async function trackStudiesImported(count) {
        if (initPromise) {
            try {
                await initPromise;
            } catch {
                // init() never throws, but be defensive.
            }
        }

        if (!stats) return;
        if (!Number.isInteger(count) || count <= 0) return;

        stats.studiesImported += count;
        stats.lastSeen = new Date().toISOString();
        dirty = true;
        await flush();
    }

    function getStats() {
        if (!stats) return null;
        // Return a defensive copy
        return { ...stats };
    }

    function resetStats() {
        if (!stats) return;

        // Preserve installationId and shareEnabled across reset
        const preservedId = stats.installationId;
        const preservedShare = stats.shareEnabled;

        const fresh = createDefaultStats();
        fresh.installationId = preservedId;
        fresh.shareEnabled = preservedShare;

        stats = fresh;
        dirty = true;
        void flush();
    }

    function setShareEnabled(enabled) {
        if (!stats) return;

        const value = !!enabled;
        const wasEnabled = stats.shareEnabled;
        stats.shareEnabled = value;
        dirty = true;
        void flush();

        // Enabling sharing sends one immediate POST of current persisted state
        if (value && !wasEnabled) {
            // Clear any pending debounced POST and send immediately
            if (phoneHomeTimer) {
                clearTimeout(phoneHomeTimer);
                phoneHomeTimer = null;
            }
            // Wait a tick for flush to complete, then send
            setTimeout(() => sendPhoneHome(), 100);
        }
    }

    function isShareEnabled() {
        return stats?.shareEnabled === true;
    }

    // =====================================================================
    // LIFECYCLE
    // =====================================================================

    async function flush() {
        if (!dirty || !stats) return;
        await saveStats();
    }

    async function init() {
        const config = window.CONFIG;
        if (!config?.features?.instrumentation) return;

        // Detect desktop SQL availability
        if (isDesktopRuntime()) {
            try {
                await ensureDesktopDb();
                useDesktopSql = true;
            } catch (error) {
                console.warn('Instrumentation: desktop SQL not available, falling back to localStorage:', error);
                useDesktopSql = false;
            }
        }

        stats = await loadStats();

        // Start periodic flush
        flushTimer = setInterval(() => {
            if (dirty) {
                void flush();
            }
        }, FLUSH_INTERVAL_MS);

        // Best-effort flush on page unload.
        //
        // Desktop mode intentionally skips the beforeunload write: SQLite
        // writes are async and cannot be reliably awaited during unload, and
        // writing to localStorage here would create a stale second source of
        // truth that later desktop launches would silently ignore (SQLite is
        // read first). Accept up to FLUSH_INTERVAL_MS (30s) of data loss on
        // crash/close in exchange for a single consistent store.
        //
        // Browser/personal mode can safely use synchronous localStorage here.
        window.addEventListener('beforeunload', () => {
            if (!dirty || !stats) return;
            if (useDesktopSql) return;
            stats.revision += 1;
            saveToLocalStorage(stats);
            dirty = false;
        });
    }

    // =====================================================================
    // HELP MODAL: Stats panel rendering
    // =====================================================================

    function formatDate(isoString) {
        if (!isoString) return 'Unknown';
        try {
            const date = new Date(isoString);
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
        } catch {
            return isoString;
        }
    }

    function renderStatsPanel(container) {
        if (!container || !stats) {
            if (container) {
                container.textContent = 'Usage stats are not available.';
            }
            return;
        }

        // Build the panel via DOM construction + textContent rather than
        // innerHTML interpolation. stats.firstSeen and stats.lastSeen come
        // from persistent storage (localStorage or SQLite) and formatDate
        // falls back to the raw ISO string if parsing fails -- any process
        // with write access to app storage could otherwise inject HTML.
        container.textContent = '';

        const table = document.createElement('table');
        table.className = 'help-stats-table';
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        container.appendChild(table);

        const addRow = (label, value) => {
            const tr = document.createElement('tr');
            const th = document.createElement('td');
            th.textContent = label;
            const td = document.createElement('td');
            td.textContent = String(value);
            tr.appendChild(th);
            tr.appendChild(td);
            tbody.appendChild(tr);
        };

        addRow('Using since', formatDate(stats.firstSeen));
        addRow('Last opened', formatDate(stats.lastSeen));
        addRow('Sessions', stats.sessions);
        addRow('Studies imported', stats.studiesImported);

        const label = document.createElement('label');
        label.className = 'help-stats-share-label';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.id = 'statsShareToggle';
        toggle.checked = !!stats.shareEnabled;
        toggle.addEventListener('change', () => {
            setShareEnabled(toggle.checked);
        });
        label.appendChild(toggle);
        label.appendChild(document.createTextNode(' Share anonymous usage stats'));
        container.appendChild(label);

        const disclosure = document.createElement('p');
        disclosure.className = 'help-stats-disclosure';
        disclosure.textContent =
            'Anonymous usage stats (app opens and studies imported) are shared with ' +
            'Divergent Health to help improve the app. No medical images, patient data, ' +
            'file paths, or study contents are ever included. Uncheck to stop sharing.';
        container.appendChild(disclosure);
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    // Initialize immediately (non-blocking). initPromise is assigned to the
    // outer `let` declared at the top of the IIFE so the track* functions
    // can reference it during the startup race window.
    initPromise = init();

    return {
        trackAppOpen,
        trackStudiesImported,
        getStats,
        resetStats,
        setShareEnabled,
        isShareEnabled,
        renderStatsPanel,
        ready: initPromise,
    };
})();

if (typeof window !== 'undefined') {
    window.Instrumentation = Instrumentation;
}
