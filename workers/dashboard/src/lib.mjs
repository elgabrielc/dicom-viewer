export const DASHBOARD_PATH = '/';
export const SUMMARY_PATH = '/api/summary';
export const SUBSCRIBERS_PATH = '/api/subscribers';

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
const textEncoder = new TextEncoder();

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

function createHeaders(contentType) {
    return new Headers({
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
            "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        'Content-Type': contentType,
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });
}

export function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: createHeaders('application/json; charset=UTF-8')
    });
}

export function htmlResponse(html, status = 200) {
    return new Response(html, {
        status,
        headers: createHeaders('text/html; charset=UTF-8')
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

export function authenticate(request, env) {
    const providedToken = getBearerToken(request);
    const expectedToken = typeof env.DASHBOARD_TOKEN === 'string' ? env.DASHBOARD_TOKEN.trim() : '';

    if (!providedToken || !expectedToken) {
        return false;
    }

    return timingSafeEqual(providedToken, expectedToken);
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

function createLoginHtml(errorMessage = '') {
    const safeError = escapeHtml(errorMessage);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>myRadOne Subscriber Dashboard Login</title>
  <style>
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
  </style>
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
  <script>
    (function () {
      const form = document.getElementById('loginForm');
      const tokenInput = document.getElementById('tokenInput');
      const submitButton = document.getElementById('submitButton');
      const errorMessage = document.getElementById('errorMessage');

      async function loadDashboardShell(token) {
        const response = await fetch(window.location.pathname, {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store'
        });

        const html = await response.text();
        if (!response.ok || !html.includes('data-dashboard-shell="true"')) {
          throw new Error(response.status === 429 ? 'Too many requests. Please try again shortly.' : 'Invalid dashboard token.');
        }

        document.open();
        document.write(html);
        document.close();
      }

      async function verifyToken(token) {
        const response = await fetch('/api/summary', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + token
          },
          cache: 'no-store'
        });

        if (response.status === 401) {
          throw new Error('Invalid dashboard token.');
        }

        if (response.status === 429) {
          throw new Error('Too many requests. Please try again shortly.');
        }

        if (!response.ok) {
          throw new Error('Dashboard request failed.');
        }
      }

      async function submitToken(token) {
        submitButton.disabled = true;
        errorMessage.textContent = '';

        try {
          await verifyToken(token);
          sessionStorage.setItem('dashboardToken', token);
          await loadDashboardShell(token);
        } catch (error) {
          sessionStorage.removeItem('dashboardToken');
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

      const storedToken = sessionStorage.getItem('dashboardToken');
      if (storedToken) {
        tokenInput.value = storedToken;
        submitToken(storedToken);
      }
    }());
  </script>
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
        badRequest(`Invalid integer parameter: ${rawValue}`);
    }

    if (parsed < min || parsed > max) {
        badRequest(`Integer parameter out of range: ${rawValue}`);
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

    if (!authenticate(request, env)) {
        return htmlResponse(createLoginHtml(), 200);
    }

    return htmlResponse(dashboardHtml, 200);
}

function createUnauthorizedResponse(pathname) {
    if (pathname === DASHBOARD_PATH) {
        return htmlResponse(createLoginHtml(), 200);
    }

    return jsonResponse({ error: 'Unauthorized' }, 401);
}

function createRateLimitResponse(pathname) {
    if (pathname === DASHBOARD_PATH) {
        return htmlResponse(createLoginHtml('Too many requests. Please try again shortly.'), 429);
    }

    return jsonResponse({ error: 'Too many requests. Please try again later.' }, 429);
}

export async function dispatchRequest(request, env, dashboardHtml) {
    const { pathname } = new URL(request.url);

    if (await isRateLimited(request, env)) {
        return createRateLimitResponse(pathname);
    }

    if (pathname === DASHBOARD_PATH) {
        return handleDashboard(request, env, dashboardHtml);
    }

    if (pathname === SUMMARY_PATH) {
        requireGet(request);
        if (!authenticate(request, env)) {
            return createUnauthorizedResponse(pathname);
        }
        return jsonResponse(await handleSummary(env));
    }

    if (pathname === SUBSCRIBERS_PATH) {
        requireGet(request);
        if (!authenticate(request, env)) {
            return createUnauthorizedResponse(pathname);
        }
        return jsonResponse(await handleSubscribers(request, env));
    }

    return jsonResponse({ error: 'Not found' }, 404);
}

export function createErrorResponse(request, error) {
    const pathname = new URL(request.url).pathname;

    if (error instanceof HttpError) {
        return pathname === DASHBOARD_PATH
            ? htmlResponse(createLoginHtml(error.message), error.status)
            : jsonResponse({ error: error.message }, error.status);
    }

    console.error('dashboard worker failed', error);
    return pathname === DASHBOARD_PATH
        ? htmlResponse(createLoginHtml('Server error.'), 500)
        : jsonResponse({ error: 'Server error' }, 500);
}
