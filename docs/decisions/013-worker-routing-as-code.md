# ADR 013: Cloudflare Worker Routes As Code

## Status

Accepted

## Context

Divergent Health runs four Cloudflare Workers in production: `myradone-subscribe` (email signups), `myradone-stats` (local-first telemetry receiver), `myradone-download` (DMG redirect), and `myradone-dashboard` (internal subscriber admin). Each Worker is reached at a custom domain on `myradone.com` or `api.myradone.com`.

Cloudflare supports two ways to manage the route → Worker binding:

1. **Dashboard-managed** -- the route is added through the Cloudflare UI and `wrangler.toml` omits any `routes` declaration. `wrangler deploy` touches the Worker code but leaves routes alone.
2. **Repo-managed** -- the route is declared in `wrangler.toml` (`[[routes]]` table-array). `wrangler deploy` reconciles the declared routes against production.

Until this decision the four Workers drifted between modes: `workers/download/wrangler.toml` declared its route; `workers/subscribe/`, `workers/stats/`, and `workers/dashboard/` did not. The dashboard worker's `dashboard.myradone.com/*` route was in particular added via the Cloudflare UI during its initial deploy and was never captured in the tracked config. That drift was invisible to code review and would not be rebuildable from a fresh checkout.

## Decision

All Cloudflare Worker routes for this project are declared in the Worker's `wrangler.toml` using the `[[routes]]` table-array form.

```toml
[[routes]]
pattern = "dashboard.myradone.com/*"
zone_name = "myradone.com"
```

The Cloudflare dashboard is not the source of truth for routing. Route changes flow through `wrangler.toml` edits and PR review, then take effect on the next `wrangler deploy`.

## Alternatives Considered

### Dashboard-managed routes, `wrangler.toml` route-agnostic

Rejected. Works in isolation, but:

- A fresh environment (staging, disaster recovery, new region) cannot be stood up from the repo without someone clicking through the dashboard.
- Route changes leave no authored, reviewed, revertable record. `git revert` is not available.
- The two-mode repo we had was confusing -- `download` looked like one thing, `subscribe`/`stats`/`dashboard` looked like another, and neither pattern was documented.
- SOC 2 / HIPAA compliance work planned under [ADR 006](006-cloud-sync-storage-architecture.md) and [ADR 010](010-patient-provider-image-sharing.md) will require auditable change history for production infrastructure. Starting with infra-as-code is cheaper than retrofitting it.

### Inline-table form (`routes = [{ ... }]`)

Rejected. Cloudflare's official Wrangler configuration docs use the `[[routes]]` table-array form. The inline form parses correctly today, but standardizing on the documented style keeps the config readable and avoids a future rewrite when the form changes or a linter enforces one style.

### Terraform or Pulumi for Cloudflare infra

Deferred, not rejected. Terraform is the natural next step when managing zones, DNS records, rate-limit namespaces, and Workers together becomes enough work to justify a dedicated stack. For four Workers on a single zone, `wrangler.toml` is sufficient. Revisit if we grow to ~10 Workers or add multi-account deploys.

## Design Details

- Each Worker's `wrangler.toml` declares its own routes. No shared config file.
- Custom domains and zone configuration (DNS records, SSL modes, WAF rules) remain in the Cloudflare dashboard. This ADR covers Worker → route bindings only, not the broader zone.
- Rate-limit namespaces (`[[ratelimits]]`) and D1 database IDs remain in `wrangler.toml` alongside routes -- same policy, same file, same review path.
- Secrets (`wrangler secret put`) stay out of `wrangler.toml`. That is an orthogonal policy and does not change here.

## Consequences

Positive:

- Single source of truth for route configuration per Worker.
- Route changes are reviewable, revertable, and auditable.
- A fresh clone + `wrangler deploy` reproduces production routing.
- Consistency across the four Workers eliminates the previous two-mode repo confusion.

Tradeoffs:

- Route changes now require a PR rather than a dashboard click. For emergency routing changes (e.g., cutting a compromised Worker off its domain), the dashboard remains available as an override; the expectation is that a reconciling PR follows immediately.
- Any Cloudflare user with dashboard access can still change routes directly. We rely on convention, not enforcement, to keep the repo authoritative. If that becomes a problem, Cloudflare Terraform provider adds locking; see the deferred alternative above.

## Migration

- `workers/dashboard/wrangler.toml` declares `dashboard.myradone.com/*` (PR #90).
- `workers/download/wrangler.toml` declares `myradone.com/download` using the ADR 013 `[[routes]]` table-array form.
- `workers/subscribe/wrangler.toml` declares `api.myradone.com/subscribe`.
- `workers/stats/wrangler.toml` declares `api.myradone.com/api/stats`.
- Follow-up completion is tracked in the PR that applies those route declarations and README updates.
