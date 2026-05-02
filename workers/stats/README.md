# myRadOne Stats Worker

Cloudflare Worker + D1 that receives anonymous instrumentation stats from the
myRadOne app. This is the server side of the ADR 008 local-first
instrumentation phone-home path.

See [`docs/decisions/008-local-first-instrumentation.md`](../../docs/decisions/008-local-first-instrumentation.md)
for the decision record and [`docs/js/instrumentation.js`](../../docs/js/instrumentation.js)
for the client that calls this endpoint.

## Endpoint

When deployed, the worker is reachable at:

```
POST https://api.myradone.com/api/stats
```

The client (`docs/js/instrumentation.js`) POSTs fire-and-forget, debounced
by 5 seconds, only when the user has opted in via the "Share anonymous
usage stats" checkbox in the Help panel.

## Payload schema

```json
{
  "version": 1,
  "revision": 42,
  "installationId": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  "firstSeen": "2026-04-08T12:00:00.000Z",
  "lastSeen": "2026-04-09T09:30:00.000Z",
  "sessions": 12,
  "studiesImported": 5
}
```

All fields are required. Unknown fields are rejected with 400 so schema
drift is a loud failure. Note that `shareEnabled` is client-only state and
is deliberately NOT part of the wire payload.

Rules:

- `version` must be exactly `1`
- `installationId` must be a lowercase UUID v4
- `revision`, `sessions`, `studiesImported` must be non-negative integers
- `firstSeen`, `lastSeen` must be ISO-8601 timestamp strings

## Data model

D1 table (see `migrations/0001_create_installs.sql`):

```sql
CREATE TABLE IF NOT EXISTS installs (
    install_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_installs_last_seen ON installs(last_seen);
```

One row per installation, keyed by the client-generated UUID. The full
payload is stored as JSON in `stats_json` for future schema flexibility,
and the frequently-queried fields (`revision`, `first_seen`, `last_seen`,
`version`) are extracted into columns so common queries do not have to
parse JSON.

### Upsert semantics

```sql
INSERT INTO installs (install_id, revision, stats_json, first_seen, last_seen, version)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(install_id) DO UPDATE SET
    revision = excluded.revision,
    stats_json = excluded.stats_json,
    last_seen = excluded.last_seen,
    version = excluded.version,
    updated_at = datetime('now')
WHERE excluded.revision > installs.revision;
```

The `WHERE excluded.revision > installs.revision` clause causes stale writes
to be silently ignored. `first_seen` is never updated on conflict, so the
original install date is preserved even if the client ever reports a
different value.

## CORS

CORS is a defense-in-depth check only -- the payload has no PHI, no
credentials, and no authentication. The worker allows:

- Requests with **no Origin** header (curl, same-origin, some Tauri builds)
- Packaged Tauri desktop origins: `tauri://localhost`,
  `http://tauri.localhost`, and `https://tauri.localhost`
- `http://localhost:*` and `http://127.0.0.1:*` (pattern matched)
- Origins in `ALLOWED_ORIGINS` (from `wrangler.toml [vars]`), currently
  `https://myradone.com` and `https://www.myradone.com`

The GitHub Pages demo origin (`https://elgabrielc.github.io`) is
deliberately NOT listed: demo mode has instrumentation disabled at the
client level, so it should never reach this endpoint.

## Rate limiting

Per-IP rate limit of 60 requests per minute, configured via the
`STATS_RATE_LIMIT` binding in `wrangler.toml`. Generous enough to allow
repeated debounced flushes from legitimate clients, strict enough to block
trivial abuse.

## Production setup

1. `cd workers/stats`

2. Create the D1 database:

   ```bash
   npx wrangler d1 create myradone-stats
   ```

   Save the returned `database_id`.

3. Edit `wrangler.toml` and replace the `TBD_RUN_WRANGLER_D1_CREATE`
   placeholder in `[[d1_databases]].database_id` with the UUID from step 2.

4. Apply the migration to the remote D1:

   ```bash
   npx wrangler d1 execute myradone-stats --remote --file=migrations/0001_create_installs.sql
   ```

5. Create a rate-limit namespace (via the Cloudflare dashboard, or let
   `wrangler deploy` provision it on first run) and replace the
   `TBD_CREATE_RATELIMIT_NAMESPACE` placeholder in `wrangler.toml`.

6. Deploy the Worker:

   ```bash
   npx wrangler deploy
   ```

7. The route is config-managed per
   [`docs/decisions/013-worker-routing-as-code.md`](../../docs/decisions/013-worker-routing-as-code.md)
   and is applied on `wrangler deploy`. Do not add or edit the
   `api.myradone.com/api/stats` route manually in the Cloudflare dashboard
   unless you are making an emergency override that will be reconciled in a PR.

## Verification

Once deployed, exercise the endpoint with a sample payload:

```bash
curl -i -X POST https://api.myradone.com/api/stats \
  -H 'Content-Type: application/json' \
  -d '{
    "version": 1,
    "revision": 1,
    "installationId": "11111111-2222-4333-8444-555555555555",
    "firstSeen": "2026-04-08T12:00:00.000Z",
    "lastSeen": "2026-04-08T12:00:00.000Z",
    "sessions": 1,
    "studiesImported": 0
  }'
```

Expected response: `200 OK` with body `{"ok":true}`.

Inspect the most recent rows in D1:

```bash
npx wrangler d1 execute myradone-stats --remote --command \
  "SELECT install_id, revision, stats_json, first_seen, last_seen FROM installs ORDER BY updated_at DESC LIMIT 10;"
```

Replay the same request with a lower `revision` and confirm the row is
**not** updated -- that proves the stale-write guard is working.

## Local testing

```bash
cd workers/stats
npx wrangler dev
```

Wrangler will spin up a local D1 instance. You can apply the migration to
the local database with:

```bash
npx wrangler d1 execute myradone-stats --local --file=migrations/0001_create_installs.sql
```

Then POST to the local worker URL printed by `wrangler dev`.

## Privacy / logging

The worker intentionally does **not** log the full payload. Each request
produces a single log line of the form:

```
stats <first-8-chars-of-install-id> status=<code> <extra>
```

This allows correlating a specific request when debugging without storing
repeated copies of the anonymous install id or the stats blob in logs.
