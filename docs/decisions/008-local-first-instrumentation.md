# ADR 008: Local-First Instrumentation

## Status
Accepted (Stage 1 implemented)

## Context

The app has no usage instrumentation. We have no way to assess whether the product is useful, which features matter, or how much time people spend with it. As we approach early users, we need basic product signal.

The existing product philosophy (DIVERGENT_CENTRAL_GUIDE.md) states "No telemetry, no analytics, no third-party tracking." This was the right default before users existed, but it leaves us blind to product-market fit. We need to update this stance without abandoning the privacy-first principle that makes it valuable for medical imaging.

### Benchmarking

Four products were benchmarked across the instrumentation spectrum, from near-zero telemetry to massive-scale collection:

**Sublime Text** -- near-zero telemetry. Proves a profitable desktop business ($2.6M revenue, 25M users, 3-5 person team) can run with almost no analytics. License revocation check is the only phone-home. Telemetry existed briefly in 2013 dev builds, community killed it, never returned. Package Control install data serves as an indirect proxy for usage analytics. Notable gap: no published privacy policy despite excellent behavior. See [RESEARCH-sublime-instrumentation](../planning/RESEARCH-sublime-instrumentation-prompt_2026-04-06_1333.md).

**Todoist** -- custom analytics. Doist built Bitmapist (open-source Redis bitmap tool) in 2012 to avoid $2K+/month Mixpanel costs. Web analytics are consent-first (default denied). The Karma system turns usage data into a user-facing feature -- 8 levels, streaks, productivity stats. Users willingly generate data because they get value back. See [RESEARCH-instrumentation](../planning/RESEARCH-instrumentation.md).

**Claude (Anthropic)** -- two-stream architecture. Separates product data (conversations) from telemetry (usage metrics) with different retention, opt-out mechanisms, and purposes. Individual users see no usage statistics -- all analytics surfaces are admin-only. The September 2025 shift from opt-in to opt-out for training data generated significant backlash. Enterprise tier offers SOC2 Type II, ISO 27001, HIPAA BAA, and zero data retention. See [RESEARCH-claude-instrumentation](../planning/RESEARCH-claude-instrumentation-prompt_2026-04-06_1345.md).

**Spotify** -- data as beloved feature. Tracks 1,800+ event types processing 1 trillion+ events/day. Yet Wrapped is a cultural phenomenon because it reframes data collection as identity expression. The 2018 inflection came not from new data but from shareable Instagram Story-sized cards -- same data, different presentation. In 2025, LLM-generated narratives (1.4B reports for 350M users). The core lesson: extensive data collection becomes beloved when you give it back in a delightful format. See [RESEARCH-spotify-instrumentation](../planning/RESEARCH-spotify-instrumentation-prompt_2026-04-06_1358.md).

### Where we land on the spectrum

| Dimension | Sublime | Our App | Claude | Todoist | Spotify |
|-----------|---------|---------|--------|---------|---------|
| Telemetry | None | Local counters | Server-side | Custom (Bitmapist) | Massive-scale |
| User sees own data | No | Yes (stats panel) | No (admin-only) | Yes (Karma) | Yes (Wrapped) |
| Third-party analytics | None | None | Segment, Sentry, GA | None (custom) | GCP, custom |
| Privacy policy | None | Needed | Detailed | Detailed | Detailed |
| PHI/sensitive data | N/A | Never in telemetry | Safety overrides | N/A | N/A |

### Anchoring principles

These five principles emerged from the benchmarking and guide this decision:

1. **Build the two-stream separation (product data vs telemetry) from day one.** DICOM files and patient metadata are product data. Usage counters and feature stats are telemetry. These are architecturally separate with different storage, different controls, and different futures. Claude's architecture validates this pattern.

2. **Pick the right privacy default at launch and don't change it.** Anthropic's September 2025 flip from opt-in to opt-out damaged trust. For medical imaging, the right default is "collect nothing that leaves the machine." We set this now and honor it.

3. **User-visible stats is a differentiator.** Claude shows analytics only to admins. Todoist shows Karma to users. Spotify shows Wrapped to everyone. We show the stats panel to the user -- full transparency about what the app knows. The stats panel is the privacy policy. This empowers users and gives complete transparency about what the company can see.

4. **PHI must never touch the telemetry stream.** No patient data, DICOM UIDs, file paths, study metadata, or anything that could identify a patient or imaging session. The telemetry stream tracks only aggregate counters of app behavior.

5. **When we add cloud/enterprise, the compliance bar is SOC2 + HIPAA BAA.** This is table stakes for medical SaaS. The local-first instrumentation built now must be designed so the event taxonomy survives the transition to server-side collection under these compliance frameworks.

### Relevant constraints

- No user accounts yet (local-first, single-device)
- Medical imaging data carries heightened privacy expectations
- Desktop app (Tauri) + web app (browser) must both be covered
- No server infrastructure for analytics collection yet
- Cloud platform (future) will need richer instrumentation
- A published privacy policy is needed -- Panic (Nova) provides the best template for this category (explicit retention periods, named vendors, clear opt-out, explicit list of what is NOT collected)

## Decision

Implement local-only usage counters that are stored in app-data and surfaced to the user in a visible "Usage Stats" panel. No data leaves the machine. The user sees exactly what the app tracks -- the stats panel is the privacy policy.

### Two-stream architecture

**Product data stream** (DICOM/PHI):
- DICOM files, pixel data, patient metadata, study/series organization
- Never collected as telemetry, never aggregated, never leaves the device (in local mode)
- Subject to HIPAA requirements when cloud mode is added
- The user's medical data -- not ours to analyze

**Telemetry stream** (usage counters):
- Aggregate counters of app behavior (sessions, features used, modalities seen, errors)
- No PHI, no patient identifiers, no file paths, no study content
- Stored locally, surfaced to user, optionally synced in cloud mode
- The app's operational data -- safe to collect and display

These streams share no storage, no API, and no persistence layer. The separation is architectural, not just policy.

### What to track (Stage 1)

Stage 1 ships with a deliberately minimal counter set. The event taxonomy will grow in later stages, but the storage schema, transport, and privacy boundary are fixed now.

**Identity and timing:**
- `installationId` -- per-installation UUID via `crypto.randomUUID()`. Survives `resetStats()` so a reset does not invalidate the cloud mapping. Will later be mapped to account IDs in cloud mode.
- `firstSeen` -- ISO timestamp of the first app open (members-since date).
- `lastSeen` -- ISO timestamp of the most recent mutation.

**Usage counters:**
- `sessions` -- incremented once per app open (`trackAppOpen()`).
- `studiesImported` -- incremented by user-initiated imports only (`trackStudiesImported(count)`). This counter does NOT increase for viewer opens, refreshes, rescans, auto-loads, or sample-data loads.

**Schema bookkeeping:**
- `version` -- schema version (currently 1). `migrateStats()` runs on every read and adds missing fields with zero defaults; fields are never removed.
- `revision` -- monotonic integer incremented on every `saveStats()` call. The server will upsert only if `incoming.revision > stored.revision`, preventing stale writes from overwriting newer local state.
- `shareEnabled` -- boolean toggle for phone-home. Stored locally; not included in phone-home payloads.

Additional counters (feature usage, modality breakdown, errors) are deferred to a later stage. The sealed API means new counters are added via new helpers, not by opening a generic `trackEvent(category, action)` surface.

### What NOT to track (enforced by architecture, not just policy)

- Patient data, DICOM UIDs, or any PHI
- File paths or folder names
- Specific study content or metadata
- Timestamps of individual actions (only aggregated counters)
- Device fingerprints or hardware details
- Anything that could identify a specific patient or imaging session
- Behavioral signals (frustration detection, sentiment analysis -- per Claude benchmark cautionary finding)

### Storage

- Desktop: SQLite `instrumentation` table (single row enforced by `CHECK (id = 1)`), created by migration `008_instrumentation.sql`. Shares the existing `viewer.db` database.
- Personal (localhost Flask): `localStorage` under the key `dicom-viewer-instrumentation-v1`.
- Demo (GitHub Pages): disabled. No storage writes, no network requests, no stats section in the help modal.
- Preview (Vercel PR previews): disabled. Same behavior as demo so preview builds don't touch production state.
- Cloud (future): server-side collection with local cache (the cloud API will upsert by `installationId` using `revision` as the conflict resolver).

Feature gating is driven by `CONFIG.features.instrumentation`, which is enabled only in `desktop` and `personal` modes. The older `CONFIG.features.analytics` flag is unrelated and remains reserved for future cloud analytics; both flags coexist in `config.js`.

### User-facing panel

The stats panel is a section in the existing help modal (opened via the `?` button on the library view), not a standalone settings page. `help-viewer.js` filters out the `usage-stats` section when `CONFIG.features.instrumentation` is false, so the panel is invisible in demo and preview modes.

Stage 1 shows:
- **Using since** -- formatted `firstSeen` date
- **Last opened** -- formatted `lastSeen` date
- **Sessions** -- the `sessions` counter
- **Studies imported** -- the `studiesImported` counter
- **Share anonymous usage stats** -- checkbox bound to `setShareEnabled()`; off by default
- A short disclosure paragraph explaining exactly what is and is not shared

This is not gamification (no levels, no points, no streaks). It is a transparent accounting of what the app knows about how it has been used. As counters are added in later stages, the panel grows inline -- the goal is a positive, identity-affirming portrait of the user's workflow rather than raw counter tables.

The stats panel serves a dual purpose:
1. **For the user**: transparency about what is tracked, a personal portrait of their workflow.
2. **For the company**: when users can see exactly what is collected, there is no hidden surveillance to explain. The panel is the privacy policy.

### Future: server-side instrumentation (web-first)

The local-first model is a stepping stone, not the long-term architecture. The product roadmap is web-first: cloud platform with accounts, server-side persistence, cross-device sync. When that transition happens, instrumentation moves server-side with the full benefits of aggregate analytics:

- Server-side event collection (not just synced counters)
- Cohort/retention analysis across the user base (Todoist's Bitmapist pattern)
- Funnel analysis (onboarding drop-off, feature adoption)
- Real-time dashboards for product decisions
- Admin analytics (Claude's model: active users, feature adoption, spend by tier)

The sealed per-counter API (`trackAppOpen`, `trackStudiesImported`, and any helpers added in later stages) stays the same; only the persistence layer changes. The schema is versioned via the `version` field and guarded by `migrateStats()`, so new counters can ship without breaking existing installs.

The `installationId` is the stable key the cloud API will use to reconcile local state with a user account. On the first cloud sign-in, the server upserts by `installationId` and maps it to the account ID; subsequent writes use `revision` to drop stale updates.

The user-facing stats panel survives the transition. It becomes a view into the user's own slice of server-side data, preserving the transparency principle regardless of where computation happens.

### Future: compliance for cloud mode

When cloud mode launches, the instrumentation system must operate under:

- **SOC2 Type II** -- audited security controls over sustained period
- **HIPAA BAA** -- for customers handling protected health information
- **Published privacy policy** -- modeled on Panic's approach (explicit retention periods, named subprocessors, clear opt-out, explicit list of what is NOT collected)

The two-stream separation built now makes compliance tractable later: the telemetry stream contains no PHI by design, so it can be collected, aggregated, and analyzed without HIPAA constraints. The product data stream (DICOM files in cloud storage) gets full HIPAA treatment.

## Alternatives Considered

### 1. Third-party analytics SDK (Mixpanel, Amplitude, PostHog)

**Rejected.** Adds a third-party dependency to a medical imaging app. Data leaves the machine by default. Requires consent management, privacy policy updates, and ongoing SDK maintenance. Overkill for pre-product-market-fit stage. Doist's experience validates that custom/simple analytics outperform commercial platforms for focused products.

### 2. No instrumentation (status quo / Sublime Text model)

**Rejected.** Sublime Text proves this can work for a profitable desktop business, but it works because: the product is opinionated (one person's taste drives decisions), the team is tiny (3-5), and the plugin ecosystem provides proxy metrics. A medical imaging app has more feature surface than a text editor -- understanding which modalities, tools, and workflows matter directly shapes what to build. We need more signal than Sublime has.

### 3. Server-side analytics only (defer to cloud mode)

**Rejected.** Cloud mode is not implemented. Desktop users may never use cloud mode. Local instrumentation works today with zero infrastructure. The local-first module becomes the foundation for server-side collection later.

### 4. Gamification (Todoist Karma-style)

**Deferred.** Karma-style progression makes sense for productivity apps where task completion is the core loop. Medical imaging viewing is a different workflow -- sessions are longer, the "score" metaphor doesn't map well. Spotify's Wrapped model (periodic summaries, positive framing) is more applicable than Todoist's daily gamification, but both are deferred until we have users to validate with.

### 5. Wrapped-style annual summary

**Deferred.** Spotify's Wrapped is the gold standard for data-as-feature, but it requires a critical mass of usage data and is most powerful with social sharing (which doesn't apply to medical imaging). The stats panel is the v1 version. A "Year in Review" summary could be added later if users find the stats panel valuable.

## Design Details

### Module structure

A single `docs/js/instrumentation.js` module, organized in three internal layers inside one IIFE (see the section banners in the file):

- **reduce** -- the event handlers that mutate stats in memory: `trackAppOpen`, `trackStudiesImported`, `getStats`, `resetStats`, `setShareEnabled`, `isShareEnabled`.
- **store** -- load and save helpers for the active backend: `loadFromLocalStorage` / `saveToLocalStorage` or `loadFromDesktopSql` / `saveToDesktopSql`, unified behind `loadStats()` / `saveStats()`.
- **transport** -- the fire-and-forget phone-home POST: `buildPayload`, `sendPhoneHome`, `schedulePhoneHome`.

The module deliberately does NOT expose a free-form `trackEvent(category, action)` surface. Every counter has a dedicated, sealed helper so the schema stays reviewable and the PHI boundary cannot be widened by a caller passing arbitrary strings. Adding a counter means adding a new helper plus a schema migration, not passing a new string.

**Public API:**

| Function | Notes |
|---|---|
| `trackAppOpen()` | Async. Awaits `initPromise`, increments `sessions`, updates `lastSeen`, flushes immediately so the session count persists before the next page navigation. |
| `trackStudiesImported(count)` | Async. Awaits `initPromise`, validates `count` is a positive integer, increments `studiesImported`, updates `lastSeen`, flushes immediately. |
| `getStats()` | Returns a defensive copy of the stats object, or `null` if instrumentation is disabled. |
| `resetStats()` | Resets counters but preserves `installationId` and `shareEnabled`. |
| `setShareEnabled(bool)` / `isShareEnabled()` | Phone-home toggle. Enabling (false to true) triggers one immediate POST after the flush settles. |
| `renderStatsPanel(container)` | Renders the stats table, share toggle, and disclosure paragraph into the help modal section. |
| `ready` | Promise that resolves when `init()` has loaded stats from storage. Exposed for tests and for any caller that needs deterministic startup ordering. |

`trackAppOpen()` and `trackStudiesImported()` both await `initPromise` internally. This closes a startup race where `main.js` fires them synchronously during module load: without the await, the first session on a fresh install would be dropped.

### Persistence schema

```json
{
  "version": 1,
  "revision": 42,
  "installationId": "e54ce9f8-2d2e-4c6b-9a7b-5a1c3b8b8c7a",
  "firstSeen": "2026-04-06T14:30:00.000Z",
  "lastSeen": "2026-04-08T09:17:22.341Z",
  "sessions": 17,
  "studiesImported": 6,
  "shareEnabled": false
}
```

`migrateStats(blob)` runs on every read. Missing fields are added with zero/default values. Fields are never removed so old installs never lose data. The `version` field is rewritten to the current schema version on every load.

**Desktop SQLite schema** (migration `desktop/src-tauri/migrations/008_instrumentation.sql`):

```sql
CREATE TABLE IF NOT EXISTS instrumentation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 0,
    installation_id TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    sessions INTEGER NOT NULL DEFAULT 0,
    studies_imported INTEGER NOT NULL DEFAULT 0,
    share_enabled INTEGER NOT NULL DEFAULT 0
);
```

The `CHECK (id = 1)` guarantees a single row; writes use `INSERT ... ON CONFLICT(id) DO UPDATE`.

### Write debouncing and flush lifecycle

Mutations are buffered in memory and flushed on a periodic timer:

- `setInterval(flush, 30_000)` runs a periodic write when the in-memory `dirty` flag is set.
- `trackAppOpen()` and `trackStudiesImported()` each trigger an immediate flush after incrementing, so user-visible counters are persisted without waiting up to 30 seconds.
- `beforeunload` runs a best-effort synchronous write, but **only in browser/personal mode**. Desktop mode intentionally skips the unload write because SQLite writes are async and cannot be awaited during unload, and writing to localStorage here would create a stale second source of truth that the next desktop launch would silently ignore (SQLite is read first). The tradeoff is up to 30 seconds of data loss on a desktop crash in exchange for a single consistent store.

Every `saveStats()` call increments `revision` before writing. The server-side upsert (when cloud mode ships) will only accept writes where `incoming.revision > stored.revision`, which prevents stale writes from overwriting newer local state during races or replays.

### Managed-library import delta

On desktop, `runImport()` does not trust `result.studies` as the new-import count. `result.studies` only reflects files touched by the current import, which overcounts when new files are added to a study that already exists (the whole study would be counted again). Instead, the import pipeline computes a `before`/`after` `StudyInstanceUID` set difference by rescanning the library folder after the import completes, and passes the delta to `trackStudiesImported()`. Failures during the diff are best-effort -- they log and return without breaking the import.

Personal mode uses the raw new-study count from the drop handler, which is already a per-import snapshot without the managed-library double-count problem.

### Phone-home transport

Phone-home is off by default. Enabling the toggle in the stats panel (`setShareEnabled(true)`):

1. Persists `shareEnabled = true` via a normal flush.
2. Sends one immediate POST of the current persisted state.
3. From then on, every subsequent `saveStats()` schedules a debounced POST 5 seconds later (debounced so a burst of saves produces a single network request).

The endpoint is `https://api.myradone.com/api/stats` (allowlisted in Tauri CSP `connect-src`). Requests are fire-and-forget: failures are silent and never surface to the UI. The payload is:

```json
{
  "version": 1,
  "revision": 42,
  "installationId": "e54ce9f8-...",
  "firstSeen": "2026-04-06T14:30:00.000Z",
  "lastSeen": "2026-04-08T09:17:22.341Z",
  "sessions": 17,
  "studiesImported": 6
}
```

`shareEnabled` is deliberately NOT in the payload. It is a local UI preference; the server does not need to know whether the client has the checkbox checked, only that a request arrived.

### Integration points

Stage 1 integration is minimal:
- `main.js` calls `trackAppOpen()` on startup.
- Personal-mode drop handlers call `trackStudiesImported(newStudyCount)` after `loadDroppedStudies` populates `state.studies`.
- Desktop `runImport()` calls `trackStudiesImported(delta)` using the rescanned-library diff described above.
- `help-viewer.js` filters the `usage-stats` section when `CONFIG.features.instrumentation` is false, and calls `renderStatsPanel()` when the modal is opened.

### Deployment mode behavior

| Mode | Collection | Storage | User panel |
|---|---|---|---|
| Demo (GitHub Pages) | Disabled | None | Hidden (filtered out of help modal) |
| Preview (Vercel) | Disabled | None | Hidden (filtered out of help modal) |
| Personal (localhost Flask) | Enabled | `localStorage` key `dicom-viewer-instrumentation-v1` | Visible in help modal |
| Desktop (Tauri) | Enabled | SQLite `instrumentation` table in `viewer.db` | Visible in help modal |
| Cloud (future) | Enabled | Server-side, keyed by `installationId`, with local cache | Visible |

## Consequences

**Positive:**
- Product signal without privacy compromise
- User transparency builds trust -- the stats panel is the privacy policy
- User-visible stats is a differentiator (Claude doesn't do this, Sublime can't do this)
- Two-stream architecture is the foundation for HIPAA-compliant cloud mode
- Zero infrastructure cost for v1
- Event taxonomy survives transition to server-side collection
- Privacy default is set correctly from day one (no painful retroactive changes)

**Negative:**
- Local-only means no aggregate view across users (until cloud mode)
- Manual review required if we want to see stats (no dashboard)
- Counter-only model cannot answer "why" questions (no event sequences, no funnels)
- Small ongoing maintenance cost to add tracking to new features

**Acceptable tradeoffs:**
- Counter granularity is coarse but sufficient for early product signal
- No cross-device aggregation until cloud mode -- acceptable since most users will be single-device initially
- No social/shareable stats (Spotify's Wrapped model doesn't map to medical imaging)

## Appendix: HIPAA / Compliance Research (from Claude/Anthropic Benchmark)

Deep research into Anthropic's enterprise compliance tier revealed the practical shape of HIPAA compliance for a cloud-backed medical app. These findings inform the "Future: compliance for cloud mode" section above.

### Implications for our architecture

1. **Client-side DICOM processing is our biggest compliance asset.** Pixel data never leaves the browser for viewing. If we use the Claude API for annotations/reports (text only), the PHI surface area is small and well-bounded.

2. **API-only BAA is sufficient.** We don't need Claude's Enterprise chat product. Contact Anthropic sales, sign a BAA, get a HIPAA-enabled org, use the Messages API. This is a lighter-weight path than a full enterprise contract.

3. **CORS is not supported under Zero Data Retention.** If we ever use ZDR, we cannot call the Anthropic API directly from browser JavaScript -- must proxy through the backend. Under HIPAA readiness (non-ZDR), this restriction may not apply but should be verified. Directly relevant to our browser-first architecture.

4. **Separate Anthropic orgs required.** Demo site and cloud platform would use different Anthropic organizations. HIPAA-enabled orgs automatically block non-eligible API features with HTTP 400 errors -- you can't accidentally send PHI through a non-compliant path.

5. **The compliance bar:** SOC 2 Type II + HIPAA BAA availability is table stakes for medical SaaS. ISO/IEC 42001 (AI management systems) would be a differentiator but is not required. Anthropic achieved ISO 42001 in January 2025 as the first frontier AI lab.

### Anthropic compliance stack (reference)

| Certification | Status | Notes |
|---|---|---|
| SOC 2 Type I & II | Certified (Schellman) | Covers commercial products and API |
| ISO 27001:2022 | Certified | Information security management |
| ISO/IEC 42001:2023 | Certified (Jan 2025) | AI governance -- first frontier lab |
| NIST 800-171 | Third-party assessed | Controlled Unclassified Information |
| HIPAA BAA | Available | Enterprise plan and first-party API only |

### Key policy findings

- **ZDR no longer required for HIPAA** on the API as of April 2, 2026. HIPAA readiness provides encryption, access controls, and audit logging for data that may be briefly retained. ZDR and HIPAA are now alternative arrangements, not stacked.
- **PHI rules for API:** PHI can appear in message content, attached files, and file names. PHI must NOT appear in JSON schema definitions (cached separately without PHI protections).
- **Safety override on training opt-out:** Even with opt-out, content flagged by safety systems may be used for safety training. This is a precedent to be aware of when choosing AI vendors.
- **Subprocessors:** GCP, AWS, Azure for infrastructure. 15-day advance notice for subprocessor changes. Full list at trust.anthropic.com.

### Comparison to OpenAI

Roughly at parity on core compliance. Anthropic leads on ISO 42001 and automatic feature-level HIPAA enforcement (non-eligible features return 400 errors). OpenAI leads on data residency (10 regions vs ~2) and has ISO 27701 (privacy management). Both offer SOC 2 Type II, ISO 27001, HIPAA BAA, ZDR.

## Related Research

- [RESEARCH-instrumentation.md](../planning/RESEARCH-instrumentation.md) -- Todoist/Bitmapist benchmarking
- [RESEARCH-sublime-instrumentation](../planning/RESEARCH-sublime-instrumentation-prompt_2026-04-06_1333.md) -- Sublime Text benchmarking
- [RESEARCH-claude-instrumentation](../planning/RESEARCH-claude-instrumentation-prompt_2026-04-06_1345.md) -- Claude/Anthropic benchmarking
- [RESEARCH-spotify-instrumentation](../planning/RESEARCH-spotify-instrumentation-prompt_2026-04-06_1358.md) -- Spotify/Wrapped benchmarking
