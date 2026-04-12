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
- Browser login exchanges that token for a same-site `HttpOnly` session cookie
  via `POST /api/session`, so the full dashboard flow does not depend on
  `sessionStorage` or `document.write`.
- The session cookie stores a derived verifier rather than the raw shared
  secret, and expires after 12 hours.
- Rate limiting runs before auth and applies to the entire worker.
- Every response is `Cache-Control: no-store`.
- The worker sets CSP, frame, referrer, and content-type hardening headers.
  HTML responses use script hashes instead of `script-src 'unsafe-inline'`.
- D1 access is read-only by convention, not by enforced binding mode. This
  worker only issues `SELECT` queries.

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

## Local Development

Wrangler uses a local D1 database during `wrangler dev`, so seed local rows if
you want meaningful dashboard output.

1. Create `workers/dashboard/.dev.vars`:

   ```dotenv
   DASHBOARD_TOKEN=localtest123
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
   `localtest123`.

## Verification

Automated:

```bash
node --test tests/dashboard-worker.test.mjs
```

Manual:

1. Start `wrangler dev` with seeded local data.
2. Load `http://localhost:8787/` without a token and confirm the login page is
   shown.
3. Enter the token and confirm the summary cards, recent signups, and full table
   render.
4. Exercise filters, sorting, and pagination.
5. Confirm invalid login attempts stay on the login page and valid logout returns
   you there.
6. Inspect headers with:

   ```bash
   curl -I http://localhost:8787/
   ```
