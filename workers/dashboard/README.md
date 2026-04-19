# myRadOne Subscriber Dashboard

Internal Cloudflare Worker dashboard for viewing subscriber analytics from the
`myradone-subscribers` D1 database.

## Files

- `src/index.mjs` - Worker entrypoint and Cloudflare HTML shell wrapper
- `src/lib.mjs` - Auth, rate limiting, headers, and D1 query logic
- `src/dashboard.html` - Self-contained authenticated dashboard shell
- `migrations/0001_subscriber_indexes.sql` - Indexes for dashboard query paths
- `wrangler.toml` - Worker configuration

## Endpoints

- `GET /` - Protected dashboard shell. Without a valid dashboard session cookie
  or bearer token, returns a minimal login page.
- `GET /api/config` - Unauthenticated dashboard auth-config diagnostic endpoint.
  Returns the trimmed token length plus a SHA-256 fingerprint prefix when valid,
  or a 503 with the config failure reason when invalid.
- `POST /api/session` - Validates a bearer token and mints the browser session
  cookie used by the dashboard shell.
- `DELETE /api/session` - Clears the dashboard session cookie.
- `GET /api/summary` - Aggregate subscriber counts, source mix, and 30-day daily
  signup totals.
- `GET /api/subscribers` - Paginated subscriber list with allowlisted
  filters/sorts.

`/api/subscribers` supports these optional query parameters:

- `page` - default `1`, minimum `1`
- `per_page` - default `50`, maximum `100`
- `status` - `active` or `unsubscribed`
- `source` - `landing`, `demo`, or `app`
- `sort` - `subscribed_at`, `email`, `source`, or `status`
- `order` - `asc` or `desc`

## Security Notes

- The dashboard uses a single shared bearer token from `DASHBOARD_TOKEN`.
- `DASHBOARD_TOKEN` must be at least 32 characters after trimming whitespace.
- Browser login exchanges that token for a same-site `HttpOnly` session cookie
  via `POST /api/session`, so the full dashboard flow does not depend on
  `sessionStorage` or `document.write`.
- The session cookie stores a signed, time-bound verifier rather than the raw
  shared secret, and the worker enforces the 12-hour expiry server-side.
- Rate limiting runs before auth for the main dashboard routes, but
  `/api/config` and `DELETE /api/session` intentionally bypass it so operators
  can diagnose misconfiguration and clear stale cookies.
- Every response is `Cache-Control: no-store`.
- The worker sets CSP, frame, referrer, and content-type hardening headers.
  HTML responses derive script hashes from the inline scripts they actually
  serve instead of relying on hand-maintained hash constants.
- `401` API responses include `WWW-Authenticate: Bearer realm="myradone-dashboard"`
  so CLI and browser tooling get a clearer auth signal.
- D1 access is read-only by convention, not by enforced binding mode. This
  worker only issues `SELECT` queries.

## Token Contract

- `DASHBOARD_TOKEN` must trim to at least 32 characters.
- `/api/config` computes `token_length` and
  `token_fingerprint_sha256_prefix` from the trimmed token, matching what auth
  compares.
- The config endpoint exposes a 12-character SHA-256 hex prefix, not literal
  token characters, so operators can verify deployment state without leaking
  any portion of the shared secret.

## Production Setup

1. Set the dashboard token secret:

   ```bash
   npx wrangler secret put DASHBOARD_TOKEN --config workers/dashboard/wrangler.toml
   ```

2. Apply the subscriber index migration remotely:

   ```bash
   npx wrangler d1 migrations apply myradone-subscribers --remote --config workers/dashboard/wrangler.toml
   ```

3. Deploy the worker:

   ```bash
   npx wrangler deploy --config workers/dashboard/wrangler.toml
   ```

4. Add a custom domain route in Cloudflare:

   - Worker: `myradone-dashboard`
   - Domain: `dashboard.myradone.com`

5. Verify the deployed dashboard token configuration:

   ```bash
   echo -n 'YOUR_TOKEN' | shasum -a 256 | head -c 12
   curl https://dashboard.myradone.com/api/config
   ```

   Confirm the response includes:

   - `"status":"ok"`
   - `"token_length":<trimmed token length>`
   - `"token_fingerprint_sha256_prefix":"<same 12-char SHA-256 prefix>"`

## Local Development

Wrangler uses a local D1 database during `wrangler dev`, so seed local rows if
you want meaningful dashboard output.

1. Create `workers/dashboard/.dev.vars`:

   ```dotenv
   DASHBOARD_TOKEN=localtest-localtest-localtest-1234
   ```

2. Apply the existing subscriber schema locally:

   ```bash
   npx wrangler d1 execute myradone-subscribers --local --config workers/dashboard/wrangler.toml --file workers/subscribe/migrations/0001_create_subscribers.sql
   ```

3. Apply the dashboard indexes locally:

   ```bash
   npx wrangler d1 migrations apply myradone-subscribers --local --config workers/dashboard/wrangler.toml
   ```

4. Seed test rows:

   ```bash
   npx wrangler d1 execute myradone-subscribers --local --config workers/dashboard/wrangler.toml \
     --command "INSERT INTO subscribers (email, source) VALUES ('test@example.com', 'landing'), ('demo@example.com', 'demo');"
   ```

5. Run the worker:

   ```bash
   npx wrangler dev --config workers/dashboard/wrangler.toml
   ```

6. Visit [http://localhost:8787/](http://localhost:8787/) and enter
   `localtest-localtest-localtest-1234`.

## Verification

Automated:

```bash
node --test tests/dashboard-worker.test.mjs
```

Manual:

1. Start `wrangler dev` with seeded local data.
2. Confirm the config endpoint reports the trimmed token length and fingerprint:

   ```bash
   curl http://localhost:8787/api/config
   ```

3. Load `http://localhost:8787/` without a token and confirm the login page is
   shown.
4. Enter the token and confirm the summary cards, recent signups, and full table
   render.
5. Exercise filters, sorting, and pagination.
6. Confirm invalid login attempts stay on the login page and misconfigured
   workers show a dedicated 503 page.
7. Confirm invalid `DASHBOARD_TOKEN` values fail loud:

   ```bash
   curl -i -X POST http://localhost:8787/api/session -H "Authorization: Bearer wrong"
   ```

   With an empty or too-short secret, this should return `503` and a
   `Dashboard misconfigured` JSON payload instead of `401`.
8. Confirm valid logout returns you there.
9. Inspect headers with:

   ```bash
   curl -I http://localhost:8787/
   ```

   And confirm the misconfig diagnostic endpoint clears stale cookies when the
   worker is invalid:

   ```bash
   curl -i http://localhost:8787/api/config
   ```
