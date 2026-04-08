export const SUBSCRIBE_PATH = '/subscribe';

const DEFAULT_ALLOWED_ORIGINS = [
    'https://myradone.com',
    'https://www.myradone.com',
    'https://divergent.health',
    'https://www.divergent.health'
];

const VALID_SOURCES = new Set(['landing', 'demo', 'app']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAllowedOrigins(originsValue) {
    const configuredOrigins = (originsValue || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    return new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS);
}

export function normalizeEmail(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

export function isValidEmail(email) {
    return email.length > 3 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function normalizeSource(value) {
    if (typeof value !== 'string') return 'landing';
    const normalized = value.trim().toLowerCase();
    return VALID_SOURCES.has(normalized) ? normalized : 'landing';
}

export function normalizeConsentVersion(value) {
    if (typeof value !== 'string') return 'v1';
    const normalized = value.trim().toLowerCase();
    return normalized || 'v1';
}

function jsonResponse(payload, status, headers) {
    return new Response(JSON.stringify(payload), { status, headers });
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
    if (origin && parseAllowedOrigins(env.ALLOWED_ORIGINS).has(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
    }

    return headers;
}

function isOriginAllowed(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    return parseAllowedOrigins(env.ALLOWED_ORIGINS).has(origin);
}

export async function verifyTurnstileToken(token, request, env, fetchImpl = fetch) {
    if (typeof token !== 'string' || !token.trim()) {
        return { ok: false, code: 'missing-token' };
    }

    if (!env.TURNSTILE_SECRET_KEY) {
        throw new Error('TURNSTILE_SECRET_KEY is not configured');
    }

    const formData = new FormData();
    formData.set('secret', env.TURNSTILE_SECRET_KEY);
    formData.set('response', token.trim());

    const connectingIp = request.headers.get('CF-Connecting-IP');
    if (connectingIp) {
        formData.set('remoteip', connectingIp);
    }

    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        return { ok: false, code: 'verification-unavailable' };
    }

    const payload = await response.json();
    return {
        ok: Boolean(payload.success),
        code: payload.success ? 'ok' : 'verification-failed',
        errors: Array.isArray(payload['error-codes']) ? payload['error-codes'] : []
    };
}

export async function saveSubscriber(db, { email, source, consentVersion }) {
    const existing = await db
        .prepare('SELECT status FROM subscribers WHERE email = ? LIMIT 1')
        .bind(email)
        .first();

    if (!existing) {
        await db
            .prepare('INSERT INTO subscribers (email, source, consent_version) VALUES (?, ?, ?)')
            .bind(email, source, consentVersion)
            .run();

        return 'created';
    }

    if (existing.status === 'active') {
        return 'already';
    }

    await db
        .prepare(
            "UPDATE subscribers SET status = 'active', unsubscribed_at = NULL, subscribed_at = datetime('now'), source = ?, consent_version = ? WHERE email = ?"
        )
        .bind(source, consentVersion, email)
        .run();

    return 'reactivated';
}

export async function handleSubscribe(request, env, fetchImpl = fetch) {
    const headers = createResponseHeaders(request, env);
    const { pathname } = new URL(request.url);

    if (pathname !== SUBSCRIBE_PATH) {
        return jsonResponse({ error: 'Not found' }, 404, headers);
    }

    if (!isOriginAllowed(request, env)) {
        return jsonResponse({ error: 'Origin not allowed' }, 403, headers);
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405, headers);
    }

    let payload;
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, headers);
    }

    const email = normalizeEmail(payload?.email);
    if (!isValidEmail(email)) {
        return jsonResponse({ error: 'Please enter a valid email address.' }, 400, headers);
    }

    if (payload?.consentAccepted !== true) {
        return jsonResponse({ error: 'Consent is required.' }, 400, headers);
    }

    const verification = await verifyTurnstileToken(payload?.turnstileToken, request, env, fetchImpl);
    if (!verification.ok) {
        return jsonResponse({ error: 'Security check failed. Please try again.' }, 403, headers);
    }

    const result = await saveSubscriber(env.DB, {
        email,
        source: normalizeSource(payload?.source),
        consentVersion: normalizeConsentVersion(payload?.consentVersion)
    });

    return jsonResponse(
        {
            ok: true,
            already: result === 'already',
            reactivated: result === 'reactivated'
        },
        200,
        headers
    );
}

export default {
    async fetch(request, env) {
        try {
            return await handleSubscribe(request, env);
        } catch (error) {
            console.error('subscribe worker failed', error);
            const headers = createResponseHeaders(request, env);
            return jsonResponse({ error: 'Server error' }, 500, headers);
        }
    }
};
