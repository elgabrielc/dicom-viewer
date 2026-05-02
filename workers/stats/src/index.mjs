/**
 * myRadOne stats worker - ADR 008 phone-home receiver.
 *
 * Accepts anonymous usage stats POSTs from the myRadOne client, validates
 * the payload, and upserts a row into the D1 `installs` table keyed by the
 * client-generated installationId. Stale writes are rejected by comparing
 * the payload's `revision` against the stored revision.
 *
 * No authentication, no PII, fire-and-forget from the client side.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 * https://divergent.health/
 */

export const STATS_PATH = '/api/stats';
export const SCHEMA_VERSION = 1;

// Origins configured in wrangler.toml [vars]. Some Tauri desktop requests send
// no Origin and are allowed implicitly; packaged WKWebView builds can also send
// Tauri-specific origins, which are matched by pattern at request time.
const DEFAULT_ALLOWED_ORIGINS = [
    'https://myradone.com',
    'https://www.myradone.com'
];

// Fields the client is expected to send. Any field outside this set causes
// the request to be rejected with 400 so schema drift fails loud.
const ALLOWED_PAYLOAD_FIELDS = new Set([
    'version',
    'revision',
    'installationId',
    'firstSeen',
    'lastSeen',
    'sessions',
    'studiesImported'
]);

// UUID v4 shape: 8-4-4-4-12 hex, third group starts with 4, fourth group
// starts with 8/9/a/b. Lowercase only because crypto.randomUUID() emits
// lowercase in every runtime we support.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const TAURI_ORIGIN_PATTERN = /^(?:tauri:\/\/localhost(?::\d+)?|https?:\/\/tauri\.localhost(?::\d+)?)$/;

// =====================================================================
// CORS / HEADERS
// =====================================================================

export function parseAllowedOrigins(originsValue) {
    const configuredOrigins = (originsValue || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    return new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS);
}

function isOriginAllowed(origin, env) {
    // No Origin header (e.g. Tauri desktop, same-origin requests, curl) is
    // allowed. The endpoint has no credentials and no PHI, so CORS is a
    // defense-in-depth check rather than a security boundary.
    if (!origin) return true;
    if (LOCALHOST_ORIGIN_PATTERN.test(origin)) return true;
    if (TAURI_ORIGIN_PATTERN.test(origin)) return true;
    return parseAllowedOrigins(env.ALLOWED_ORIGINS).has(origin);
}

function createResponseHeaders(request, env) {
    const headers = new Headers({
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=UTF-8',
        Vary: 'Origin'
    });

    const origin = request.headers.get('Origin');
    if (origin && isOriginAllowed(origin, env)) {
        headers.set('Access-Control-Allow-Origin', origin);
    }

    return headers;
}

function jsonResponse(payload, status, headers) {
    return new Response(JSON.stringify(payload), { status, headers });
}

// =====================================================================
// RATE LIMITING
// =====================================================================

async function isRateLimited(request, env) {
    if (!env.STATS_RATE_LIMIT?.limit) {
        return false;
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.STATS_RATE_LIMIT.limit({
        key: `${STATS_PATH}:${ip}`
    });
    return !success;
}

// =====================================================================
// VALIDATION
// =====================================================================

function isNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isParseableIsoDate(value) {
    if (typeof value !== 'string' || !value) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp);
}

/**
 * Validate the incoming stats payload. Returns either
 *   { ok: true, payload: {...} } or
 *   { ok: false, error: '...', field: '...' }
 *
 * Unknown fields are rejected so schema drift is a loud failure rather than
 * silently losing telemetry.
 */
export function validateStatsPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'Payload must be a JSON object', field: null };
    }

    for (const key of Object.keys(raw)) {
        if (!ALLOWED_PAYLOAD_FIELDS.has(key)) {
            return { ok: false, error: 'Unexpected field', field: key };
        }
    }

    if (raw.version !== SCHEMA_VERSION) {
        return { ok: false, error: 'Unsupported schema version', field: 'version' };
    }

    if (typeof raw.installationId !== 'string' || !raw.installationId) {
        return { ok: false, error: 'installationId is required', field: 'installationId' };
    }
    if (!UUID_V4_PATTERN.test(raw.installationId)) {
        return { ok: false, error: 'installationId must be a UUID v4', field: 'installationId' };
    }

    if (!isNonNegativeInteger(raw.revision)) {
        return { ok: false, error: 'revision must be a non-negative integer', field: 'revision' };
    }

    if (!isNonNegativeInteger(raw.sessions)) {
        return { ok: false, error: 'sessions must be a non-negative integer', field: 'sessions' };
    }

    if (!isNonNegativeInteger(raw.studiesImported)) {
        return {
            ok: false,
            error: 'studiesImported must be a non-negative integer',
            field: 'studiesImported'
        };
    }

    if (!isParseableIsoDate(raw.firstSeen)) {
        return { ok: false, error: 'firstSeen must be an ISO-8601 timestamp', field: 'firstSeen' };
    }
    if (!isParseableIsoDate(raw.lastSeen)) {
        return { ok: false, error: 'lastSeen must be an ISO-8601 timestamp', field: 'lastSeen' };
    }

    // Normalised copy with explicit field order so the JSON we persist is
    // stable regardless of the order the client happens to serialise in.
    const payload = {
        version: raw.version,
        revision: raw.revision,
        installationId: raw.installationId,
        firstSeen: raw.firstSeen,
        lastSeen: raw.lastSeen,
        sessions: raw.sessions,
        studiesImported: raw.studiesImported
    };

    return { ok: true, payload };
}

// =====================================================================
// PERSISTENCE
// =====================================================================

/**
 * Upsert the install row. Returns a short status string used only for
 * logging (never leaked to the client).
 *
 * The WHERE clause on the ON CONFLICT target ensures that a stale write
 * (one whose revision is not strictly greater than what is already stored)
 * is silently ignored. `first_seen` is intentionally never updated on
 * conflict so the original install date is preserved.
 */
export async function upsertInstall(db, payload) {
    const statsJson = JSON.stringify(payload);

    await db
        .prepare(
            `INSERT INTO installs (install_id, revision, stats_json, first_seen, last_seen, version)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(install_id) DO UPDATE SET
                 revision = excluded.revision,
                 stats_json = excluded.stats_json,
                 last_seen = excluded.last_seen,
                 version = excluded.version,
                 updated_at = datetime('now')
             WHERE excluded.revision > installs.revision`
        )
        .bind(
            payload.installationId,
            payload.revision,
            statsJson,
            payload.firstSeen,
            payload.lastSeen,
            payload.version
        )
        .run();
}

// =====================================================================
// REQUEST HANDLER
// =====================================================================

function logResult(installId, status, extra = '') {
    // Log only the first 8 chars of the install id to keep log lines
    // non-identifying while still allowing correlation with a specific
    // request when debugging.
    const prefix = typeof installId === 'string' && installId.length >= 8 ? installId.slice(0, 8) : '????????';
    const suffix = extra ? ` ${extra}` : '';
    console.log(`stats ${prefix} status=${status}${suffix}`);
}

export async function handleStats(request, env) {
    const headers = createResponseHeaders(request, env);
    const { pathname } = new URL(request.url);

    if (pathname !== STATS_PATH) {
        return jsonResponse({ error: 'Not found' }, 404, headers);
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405, headers);
    }

    const origin = request.headers.get('Origin');
    if (!isOriginAllowed(origin, env)) {
        logResult(null, 403, 'origin-blocked');
        return jsonResponse({ error: 'Origin not allowed' }, 403, headers);
    }

    if (await isRateLimited(request, env)) {
        logResult(null, 429, 'rate-limited');
        return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429, headers);
    }

    let raw;
    try {
        raw = await request.json();
    } catch {
        logResult(null, 400, 'invalid-json');
        return jsonResponse({ error: 'Invalid JSON' }, 400, headers);
    }

    const validation = validateStatsPayload(raw);
    if (!validation.ok) {
        logResult(raw?.installationId, 400, `invalid-field=${validation.field || 'unknown'}`);
        return jsonResponse({ error: validation.error, field: validation.field }, 400, headers);
    }

    try {
        await upsertInstall(env.DB, validation.payload);
    } catch (error) {
        // Log the error server-side but never leak details (including the
        // binding name or SQL text) to the client.
        console.error('stats worker D1 upsert failed', error);
        logResult(validation.payload.installationId, 500, 'db-error');
        return jsonResponse({ error: 'Server error' }, 500, headers);
    }

    logResult(validation.payload.installationId, 200);
    return jsonResponse({ ok: true }, 200, headers);
}

export default {
    async fetch(request, env) {
        try {
            return await handleStats(request, env);
        } catch (error) {
            console.error('stats worker failed', error);
            const headers = createResponseHeaders(request, env);
            return jsonResponse({ error: 'Server error' }, 500, headers);
        }
    }
};
