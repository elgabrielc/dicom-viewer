export const DASHBOARD_PATH = '/';
export const CONFIG_PATH = '/api/config';
export const SESSION_PATH = '/api/session';
export const SUMMARY_PATH = '/api/summary';
export const SUBSCRIBERS_PATH = '/api/subscribers';

const DASHBOARD_SESSION_COOKIE = 'myradone_dashboard_token';
const DASHBOARD_MISCONFIG_ERROR = 'Dashboard misconfigured';
const DASHBOARD_TOKEN_MIN_LENGTH = 32;
const VALID_STATUSES = new Set(['active', 'unsubscribed']);
const VALID_SOURCES = new Set(['landing', 'demo', 'app']);
const VALID_ORDERS = new Set(['asc', 'desc']);
const SORT_COLUMNS = new Map([
    ['subscribed_at', 'subscribed_at'],
    ['email', 'email'],
    ['source', 'source'],
    ['status', 'status']
]);
const SOURCE_ORDER = ['landing', 'demo', 'app'];
const SOURCE_ORDER_SQL = "CASE source WHEN 'landing' THEN 0 WHEN 'demo' THEN 1 WHEN 'app' THEN 2 ELSE 3 END";
const STATUS_ORDER_SQL = "CASE status WHEN 'active' THEN 0 ELSE 1 END";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const UNAUTHORIZED_WWW_AUTHENTICATE = 'Bearer realm="myradone-dashboard"';
const textEncoder = new TextEncoder();
const signingKeyCache = new Map();
const inlineScriptCspCache = new Map();
const JSON_RESPONSE_CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const STATIC_HTML_CSP =
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; object-src 'none'; style-src 'unsafe-inline'";
// Cloudflare Workers isolates reset this naturally on cold start.
let misconfigWarningLogged = false;
const LOGIN_PAGE_SCRIPT = `(function () {
  const form = document.getElementById('loginForm');
  const tokenInput = document.getElementById('tokenInput');
  const submitButton = document.getElementById('submitButton');
  const errorMessage = document.getElementById('errorMessage');

  async function createSession(token) {
    return fetch('${SESSION_PATH}', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token
      },
      cache: 'no-store',
      credentials: 'same-origin'
    });
  }

  async function submitToken(token) {
    submitButton.disabled = true;
    errorMessage.textContent = '';

    try {
      const response = await createSession(token);

      if (response.status === 401) {
        throw new Error('Invalid dashboard token.');
      }

      if (response.status === 429) {
        throw new Error('Too many requests. Please try again shortly.');
      }

      if (response.status === 503) {
        const body = await response.json().catch(function () {
          return {};
        });
        throw new Error(body.reason ? 'Server misconfigured: ' + body.reason : 'Server misconfigured.');
      }

      if (!response.ok) {
        throw new Error('Dashboard request failed.');
      }

      window.location.replace('/');
    } catch (error) {
      errorMessage.textContent = error.message || 'Dashboard request failed.';
    } finally {
      submitButton.disabled = false;
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      errorMessage.textContent = 'Dashboard token is required.';
      return;
    }
    submitToken(token);
  });
}());`;
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function createHeaders(contentType, csp, extraHeaders = {}) {
    const headers = new Headers({
        'Cache-Control': 'no-store',
        'Content-Security-Policy': csp,
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Referrer-Policy': 'no-referrer',
        Vary: 'Authorization, Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });

    if (contentType) {
        headers.set('Content-Type', contentType);
    }

    for (const [name, value] of Object.entries(extraHeaders)) {
        headers.set(name, value);
    }

    return headers;
}

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: createHeaders('application/json; charset=UTF-8', JSON_RESPONSE_CSP, extraHeaders)
    });
}

export function htmlResponse(html, status = 200, csp = JSON_RESPONSE_CSP, extraHeaders = {}) {
    return new Response(html, {
        status,
        headers: createHeaders('text/html; charset=UTF-8', csp, extraHeaders)
    });
}

function emptyResponse(status = 204, extraHeaders = {}) {
    return new Response(null, {
        status,
        headers: createHeaders(null, JSON_RESPONSE_CSP, extraHeaders)
    });
}

function timingSafeEqual(left, right) {
    const leftBytes = textEncoder.encode(left || '');
    const rightBytes = textEncoder.encode(right || '');
    const length = Math.max(leftBytes.length, rightBytes.length);
    let mismatch = leftBytes.length ^ rightBytes.length;

    for (let index = 0; index < length; index += 1) {
        mismatch |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
    }

    return mismatch === 0;
}

function getBearerToken(request) {
    const header = request.headers.get('Authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function tokenFingerprint(token) {
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
    return bytesToHex(new Uint8Array(digest)).slice(0, 12);
}

function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function extractInlineScript(html) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('Expected an inline dashboard script');
    }
    return match[1];
}

async function getSigningKey(secret) {
    if (signingKeyCache.has(secret)) {
        return signingKeyCache.get(secret);
    }

    const signingKeyPromise = crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    signingKeyCache.set(secret, signingKeyPromise);
    return signingKeyPromise;
}

async function signSessionPayload(secret, payload) {
    const signingKey = await getSigningKey(secret);
    const signature = await crypto.subtle.sign('HMAC', signingKey, textEncoder.encode(payload));
    return bytesToHex(new Uint8Array(signature));
}

async function buildInlineScriptCsp(html) {
    const script = extractInlineScript(html);

    if (inlineScriptCspCache.has(script)) {
        return inlineScriptCspCache.get(script);
    }

    const cspPromise = crypto.subtle.digest('SHA-256', textEncoder.encode(script)).then((digest) => {
        const hash = bytesToBase64(new Uint8Array(digest));
        return `default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'`;
    });

    inlineScriptCspCache.set(script, cspPromise);
    return cspPromise;
}

function buildSessionPayload(expiresAtMs) {
    return `v1:${expiresAtMs}`;
}

export async function createSignedSessionValue(secret, nowMs = Date.now()) {
    const expiresAtMs = nowMs + SESSION_MAX_AGE_SECONDS * 1000;
    const payload = buildSessionPayload(expiresAtMs);
    const signature = await signSessionPayload(secret, payload);
    return `v1.${expiresAtMs}.${signature}`;
}

export async function verifySignedSessionValue(value, secret, nowMs = Date.now()) {
    if (typeof value !== 'string' || !value) {
        return false;
    }

    const [version, expiresAtRaw, signature] = value.split('.');
    if (version !== 'v1' || !expiresAtRaw || !signature) {
        return false;
    }

    if (!/^\d+$/.test(expiresAtRaw) || !/^[0-9a-f]{64}$/.test(signature)) {
        return false;
    }

    const expiresAtMs = Number.parseInt(expiresAtRaw, 10);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        return false;
    }

    const expectedSignature = await signSessionPayload(secret, buildSessionPayload(expiresAtMs));
    return timingSafeEqual(signature, expectedSignature);
}

function getCookieToken(request) {
    const cookieHeader = request.headers.get('Cookie') || '';

    for (const fragment of cookieHeader.split(';')) {
        const [name, ...rest] = fragment.trim().split('=');
        if (name !== DASHBOARD_SESSION_COOKIE) continue;
        return decodeURIComponent(rest.join('='));
    }

    return '';
}

async function buildSessionCookie(request, token) {
    const nowMs = Date.now();
    const expiresAtMs = nowMs + SESSION_MAX_AGE_SECONDS * 1000;
    const attributes = [
        'HttpOnly',
        `Expires=${new Date(expiresAtMs).toUTCString()}`,
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        'Path=/',
        'SameSite=Strict'
    ];
    if (new URL(request.url).protocol === 'https:') {
        attributes.push('Secure');
    }

    const signedValue = await createSignedSessionValue(token, nowMs);
    return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(signedValue)}; ${attributes.join('; ')}`;
}

function buildClearSessionCookie(request) {
    const attributes = [
        'HttpOnly',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Max-Age=0',
        'Path=/',
        'SameSite=Strict'
    ];
    if (new URL(request.url).protocol === 'https:') {
        attributes.push('Secure');
    }

    return `${DASHBOARD_SESSION_COOKIE}=; ${attributes.join('; ')}`;
}

export function validateConfig(env) {
    const rawToken = env?.DASHBOARD_TOKEN;
    if (typeof rawToken !== 'string') {
        return { ok: false, reason: 'DASHBOARD_TOKEN is unset' };
    }

    const token = rawToken.trim();
    if (!token) {
        return { ok: false, reason: 'DASHBOARD_TOKEN is empty' };
    }

    if (token.length < DASHBOARD_TOKEN_MIN_LENGTH) {
        return { ok: false, reason: `DASHBOARD_TOKEN is too short (length < ${DASHBOARD_TOKEN_MIN_LENGTH})` };
    }

    return { ok: true, token };
}

async function authenticateToken(request, token) {
    const bearerToken = getBearerToken(request);
    const cookieToken = getCookieToken(request);

    if (bearerToken) {
        return timingSafeEqual(bearerToken, token);
    }

    if (!cookieToken) {
        return false;
    }

    return verifySignedSessionValue(cookieToken, token);
}

export async function authenticate(request, env) {
    const config = validateConfig(env);
    if (!config.ok) {
        return false;
    }

    return authenticateToken(request, config.token);
}

async function isRateLimited(request, env) {
    if (!env.DASHBOARD_RATE_LIMIT?.limit) {
        return false;
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.DASHBOARD_RATE_LIMIT.limit({
        key: `dashboard:${ip}`
    });

    return !success;
}

function createAuthPageStyles() {
    return `<style>
    :root {
      --bg: #fff8f3;
      --text: #3d3a36;
      --text-muted: #a09b8f;
      --accent: #f08c00;
      --accent-strong: #d67d00;
      --border: #e5e0d4;
      --surface: #ffffff;
      --shadow: 0 20px 50px rgba(30, 28, 26, 0.08);
      --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at top left, rgba(240, 140, 0, 0.1), transparent 40%),
        linear-gradient(180deg, #fffdfb 0%, var(--bg) 100%);
      color: var(--text);
      font-family: var(--sans);
    }
    .card {
      width: min(100%, 420px);
      padding: 28px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .eyebrow {
      margin: 0 0 12px;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 1.9rem;
      line-height: 1.1;
    }
    p {
      margin: 14px 0 0;
      color: var(--text-muted);
      line-height: 1.5;
    }
    form {
      display: grid;
      gap: 14px;
      margin-top: 24px;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 0.92rem;
      font-weight: 600;
    }
    input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      font: inherit;
      background: #fffdfa;
      color: var(--text);
    }
    button {
      padding: 12px 16px;
      border: 0;
      border-radius: 12px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--accent-strong); }
    button:disabled { opacity: 0.7; cursor: wait; }
    .error {
      min-height: 1.3rem;
      margin-top: 14px;
      color: #b64519;
      font-size: 0.92rem;
      font-weight: 600;
    }
    .notice {
      margin-top: 24px;
      padding: 16px 18px;
      border: 1px solid rgba(182, 69, 25, 0.2);
      border-radius: 14px;
      background: rgba(182, 69, 25, 0.06);
    }
    .notice p {
      margin: 0;
      color: #7a3a20;
    }
    .notice p + p {
      margin-top: 12px;
    }
  </style>`;
}

function createLoginHtml(errorMessage = '') {
    const safeError = escapeHtml(errorMessage);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>myRadOne Subscriber Dashboard Login</title>
  ${createAuthPageStyles()}
</head>
<body>
  <main class="card">
    <p class="eyebrow">Internal</p>
    <h1>myRadOne Subscribers</h1>
    <p>Enter the dashboard token to load the protected subscriber analytics view.</p>
    <form id="loginForm">
      <label>
        Dashboard token
        <input id="tokenInput" type="password" autocomplete="current-password" required>
      </label>
      <button id="submitButton" type="submit">Open dashboard</button>
    </form>
    <div id="errorMessage" class="error" role="alert">${safeError}</div>
  </main>
  <script>${LOGIN_PAGE_SCRIPT}</script>
</body>
</html>`;
}

function createMisconfigHtml(reason) {
    const safeReason = escapeHtml(reason);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>myRadOne Subscriber Dashboard Misconfigured</title>
  ${createAuthPageStyles()}
</head>
<body>
  <main class="card">
    <p class="eyebrow">Configuration Error</p>
    <h1>Dashboard unavailable</h1>
    <p>The dashboard worker is misconfigured and cannot authenticate requests.</p>
    <div class="notice" role="alert">
      <p>${safeReason}</p>
      <p>Use <code>${CONFIG_PATH}</code> to verify the deployed token configuration after updating the secret.</p>
    </div>
  </main>
</body>
</html>`;
}

function badRequest(message) {
    throw new HttpError(400, message);
}

function methodNotAllowed() {
    throw new HttpError(405, 'Method not allowed');
}

function requireGet(request) {
    if (request.method !== 'GET') {
        methodNotAllowed();
    }
}

function parseIntegerParam(rawValue, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (rawValue == null || rawValue === '') {
        return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || String(parsed) !== String(rawValue).trim()) {
        badRequest('Invalid integer parameter');
    }

    if (parsed < min || parsed > max) {
        badRequest('Integer parameter out of range');
    }

    return parsed;
}

function parseSubscribersQuery(request) {
    const url = new URL(request.url);
    const page = parseIntegerParam(url.searchParams.get('page'), 1, { min: 1 });
    const perPage = parseIntegerParam(url.searchParams.get('per_page'), 50, { min: 1, max: 100 });
    const status = url.searchParams.get('status') || '';
    const source = url.searchParams.get('source') || '';
    const sort = (url.searchParams.get('sort') || 'subscribed_at').toLowerCase();
    const order = (url.searchParams.get('order') || 'desc').toLowerCase();

    if (status && !VALID_STATUSES.has(status)) {
        badRequest('Invalid status filter');
    }

    if (source && !VALID_SOURCES.has(source)) {
        badRequest('Invalid source filter');
    }

    if (!SORT_COLUMNS.has(sort)) {
        badRequest('Invalid sort column');
    }

    if (!VALID_ORDERS.has(order)) {
        badRequest('Invalid sort order');
    }

    return {
        page,
        perPage,
        source,
        sort,
        status,
        order
    };
}

function normalizeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? count : 0;
}

function buildSubscribersWhereClause(filters) {
    const clauses = [];
    const bindings = [];

    if (filters.status) {
        clauses.push('status = ?');
        bindings.push(filters.status);
    }

    if (filters.source) {
        clauses.push('source = ?');
        bindings.push(filters.source);
    }

    return {
        whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        bindings
    };
}

function normalizeSubscriberRow(row) {
    return {
        id: Number(row.id),
        email: row.email,
        status: row.status,
        subscribed_at: row.subscribed_at,
        source: row.source,
        consent_version: row.consent_version
    };
}

function toSourceSummary(rows) {
    const grouped = new Map(SOURCE_ORDER.map((source) => [source, { source, total: 0, active: 0, unsubscribed: 0 }]));

    for (const row of rows) {
        const current = grouped.get(row.source) || {
            source: row.source,
            total: 0,
            active: 0,
            unsubscribed: 0
        };
        current.total += normalizeCount(row.count);
        current[row.status] = normalizeCount(row.count);
        grouped.set(row.source, current);
    }

    return [...grouped.values()];
}

export async function handleSummary(env) {
    const countsRow =
        (await env.SUBSCRIBERS_DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed
             FROM subscribers`
        ).first()) || {};

    const sourceRows =
        (
            await env.SUBSCRIBERS_DB.prepare(
                `SELECT source, status, COUNT(*) AS count
                 FROM subscribers
                 GROUP BY source, status
                 ORDER BY ${SOURCE_ORDER_SQL}, ${STATUS_ORDER_SQL}`
            ).all()
        ).results || [];

    const dailyRows =
        (
            await env.SUBSCRIBERS_DB.prepare(
                `WITH RECURSIVE days(day) AS (
                    SELECT date('now', '-29 days')
                    UNION ALL
                    SELECT date(day, '+1 day')
                    FROM days
                    WHERE day < date('now')
                )
                SELECT days.day AS day, COALESCE(counts.count, 0) AS count
                FROM days
                LEFT JOIN (
                    SELECT date(subscribed_at) AS day, COUNT(*) AS count
                    FROM subscribers
                    WHERE subscribed_at >= datetime('now', '-29 days')
                    GROUP BY date(subscribed_at)
                ) AS counts
                  ON counts.day = days.day
                ORDER BY days.day ASC`
            ).all()
        ).results || [];

    return {
        counts: {
            total: normalizeCount(countsRow.total),
            active: normalizeCount(countsRow.active),
            unsubscribed: normalizeCount(countsRow.unsubscribed)
        },
        sources: toSourceSummary(sourceRows).map((row) => ({
            source: row.source,
            total: row.total,
            active: row.active,
            unsubscribed: row.unsubscribed
        })),
        daily: dailyRows.map((row) => ({
            day: row.day,
            count: normalizeCount(row.count)
        }))
    };
}

export async function handleSubscribers(request, env) {
    const query = parseSubscribersQuery(request);
    const { whereSql, bindings } = buildSubscribersWhereClause(query);
    const sortColumn = SORT_COLUMNS.get(query.sort);
    const sortDirection = query.order.toUpperCase();
    const offset = (query.page - 1) * query.perPage;

    const countRow =
        (await env.SUBSCRIBERS_DB.prepare(`SELECT COUNT(*) AS total FROM subscribers ${whereSql}`)
            .bind(...bindings)
            .first()) || {};

    const rows =
        (
            await env.SUBSCRIBERS_DB.prepare(
                `SELECT id, email, status, subscribed_at, source, consent_version
                 FROM subscribers
                 ${whereSql}
                 ORDER BY ${sortColumn} ${sortDirection}, id ${sortDirection}
                 LIMIT ? OFFSET ?`
            )
                .bind(...bindings, query.perPage, offset)
                .all()
        ).results || [];

    const total = normalizeCount(countRow.total);
    const totalPages = Math.max(1, Math.ceil(total / query.perPage || 1));

    return {
        subscribers: rows.map(normalizeSubscriberRow),
        pagination: {
            page: query.page,
            per_page: query.perPage,
            total,
            total_pages: totalPages
        }
    };
}

export async function handleDashboard(request, env, dashboardHtml) {
    requireGet(request);
    const config = validateConfig(env);
    if (!config.ok) {
        logMisconfigOnce(config.reason);
        return misconfigHtmlResponse(request, config.reason);
    }

    if (!(await authenticateToken(request, config.token))) {
        const loginHtml = createLoginHtml();
        return htmlResponse(
            loginHtml,
            200,
            await buildInlineScriptCsp(loginHtml),
            { 'Set-Cookie': buildClearSessionCookie(request) }
        );
    }

    return htmlResponse(dashboardHtml, 200, await buildInlineScriptCsp(dashboardHtml));
}

export async function handleSession(request, env) {
    if (request.method === 'DELETE') {
        return emptyResponse(204, {
            'Set-Cookie': buildClearSessionCookie(request)
        });
    }

    if (request.method !== 'POST') {
        methodNotAllowed();
    }

    const config = validateConfig(env);
    if (!config.ok) {
        logMisconfigOnce(config.reason);
        return misconfigJsonResponse(request, config.reason);
    }

    if (!(await authenticateToken(request, config.token))) {
        return jsonResponse(
            { error: 'Unauthorized' },
            401,
            {
                'Set-Cookie': buildClearSessionCookie(request),
                'WWW-Authenticate': UNAUTHORIZED_WWW_AUTHENTICATE
            }
        );
    }

    return emptyResponse(204, {
        'Set-Cookie': await buildSessionCookie(request, config.token)
    });
}

function logMisconfigOnce(reason) {
    if (misconfigWarningLogged) {
        return;
    }

    misconfigWarningLogged = true;
    console.error('dashboard worker misconfigured:', reason);
}

function misconfigJsonResponse(request, reason, payload = null) {
    return jsonResponse(payload || { error: DASHBOARD_MISCONFIG_ERROR, reason }, 503, {
        'Set-Cookie': buildClearSessionCookie(request)
    });
}

function misconfigHtmlResponse(request, reason) {
    return htmlResponse(createMisconfigHtml(reason), 503, STATIC_HTML_CSP, {
        'Set-Cookie': buildClearSessionCookie(request)
    });
}

async function createUnauthorizedResponse(pathname, request) {
    const headers = {
        'Set-Cookie': buildClearSessionCookie(request),
        'WWW-Authenticate': UNAUTHORIZED_WWW_AUTHENTICATE
    };

    if (pathname === DASHBOARD_PATH) {
        const loginHtml = createLoginHtml();
        return htmlResponse(loginHtml, 200, await buildInlineScriptCsp(loginHtml), headers);
    }

    return jsonResponse({ error: 'Unauthorized' }, 401, headers);
}

async function createRateLimitResponse(pathname) {
    if (pathname === DASHBOARD_PATH) {
        const loginHtml = createLoginHtml('Too many requests. Please try again shortly.');
        return htmlResponse(loginHtml, 429, await buildInlineScriptCsp(loginHtml));
    }

    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429);
}

async function handleConfig(request, env) {
    requireGet(request);
    const config = validateConfig(env);
    if (!config.ok) {
        logMisconfigOnce(config.reason);
        return jsonResponse({ error: DASHBOARD_MISCONFIG_ERROR, reason: config.reason }, 503);
    }

    return jsonResponse({
        status: 'ok',
        token_configured: true,
        token_length: config.token.length,
        token_fingerprint_sha256_prefix: await tokenFingerprint(config.token)
    });
}

export async function dispatchRequest(request, env, dashboardHtml) {
    const { pathname } = new URL(request.url);

    if (pathname === CONFIG_PATH) {
        return handleConfig(request, env);
    }

    if (pathname === SESSION_PATH && request.method === 'DELETE') {
        return handleSession(request, env);
    }

    if (await isRateLimited(request, env)) {
        return await createRateLimitResponse(pathname);
    }

    const config = validateConfig(env);
    if (!config.ok) {
        logMisconfigOnce(config.reason);
        return pathname === DASHBOARD_PATH
            ? misconfigHtmlResponse(request, config.reason)
            : misconfigJsonResponse(request, config.reason);
    }

    if (pathname === SESSION_PATH) {
        return handleSession(request, env);
    }

    if (pathname === DASHBOARD_PATH) {
        return handleDashboard(request, env, dashboardHtml);
    }

    if (pathname === SUMMARY_PATH) {
        requireGet(request);
        if (!(await authenticate(request, env))) {
            return await createUnauthorizedResponse(pathname, request);
        }
        return jsonResponse(await handleSummary(env));
    }

    if (pathname === SUBSCRIBERS_PATH) {
        requireGet(request);
        if (!(await authenticate(request, env))) {
            return await createUnauthorizedResponse(pathname, request);
        }
        return jsonResponse(await handleSubscribers(request, env));
    }

    return jsonResponse({ error: 'Not found' }, 404);
}

export async function createErrorResponse(request, error) {
    const pathname = new URL(request.url).pathname;

    if (error instanceof HttpError) {
        if (pathname === DASHBOARD_PATH) {
            const loginHtml = createLoginHtml(error.message);
            return htmlResponse(loginHtml, error.status, await buildInlineScriptCsp(loginHtml));
        }
        return jsonResponse({ error: error.message }, error.status);
    }

    console.error('dashboard worker failed', error);
    if (pathname === DASHBOARD_PATH) {
        const loginHtml = createLoginHtml('Server error.');
        return htmlResponse(loginHtml, 500, await buildInlineScriptCsp(loginHtml));
    }
    return jsonResponse({ error: 'Server error' }, 500);
}
