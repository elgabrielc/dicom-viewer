# ADR 008: Local-First Instrumentation

## Status
Proposed

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

### What to track (telemetry stream only)

**Session metrics:**
- Session count (app opens)
- Cumulative usage duration (hours)
- First use date, last use date

**Feature usage counters:**
- Studies loaded
- Series viewed
- Measurement tool used
- Notes created/edited
- Reports generated
- Window/level adjusted
- Zoom/pan used

**Content metrics:**
- Modality breakdown (CT, MR, US, CR/DX, other)
- Total slices rendered
- Studies imported (desktop)

**Error metrics:**
- Decode failures by type (unsupported transfer syntax, corrupt file, etc.)
- Unsupported format encounters

### What NOT to track (enforced by architecture, not just policy)

- Patient data, DICOM UIDs, or any PHI
- File paths or folder names
- Specific study content or metadata
- Timestamps of individual actions (only aggregated counters)
- Device fingerprints or hardware details
- Anything that could identify a specific patient or imaging session
- Behavioral signals (frustration detection, sentiment analysis -- per Claude benchmark cautionary finding)

### Storage

- Desktop: JSON file in Tauri app-data directory (alongside existing persistence)
- Web (personal mode): localStorage
- Demo mode: disabled (stateless, no persistence)
- Cloud mode (future): server-side collection with local cache

### User-facing panel

A "Usage Stats" view accessible from settings or about, showing:
- Total sessions and hours used
- Feature usage breakdown
- Modality distribution
- Member-since date

This is not gamification (no levels, no points, no streaks). It is a transparent accounting of what the app knows about how it has been used. Framing should be positive and identity-affirming (Spotify's lesson): "You've reviewed 847 studies across 5 modalities" rather than raw counter tables.

The stats panel serves a dual purpose:
1. **For the user**: transparency about what is tracked, a personal portrait of their workflow
2. **For the company**: when users can see exactly what is collected, there is no hidden surveillance to explain. The panel is the privacy policy.

### Future: server-side instrumentation (web-first)

The local-first model is a stepping stone, not the long-term architecture. The product roadmap is web-first: cloud platform with accounts, server-side persistence, cross-device sync. When that transition happens, instrumentation moves server-side with the full benefits of aggregate analytics:

- Server-side event collection (not just synced counters)
- Cohort/retention analysis across the user base (Todoist's Bitmapist pattern)
- Funnel analysis (onboarding drop-off, feature adoption)
- Real-time dashboards for product decisions
- Admin analytics (Claude's model: active users, feature adoption, spend by tier)

The `trackEvent(category, action)` API stays the same; only the persistence layer changes. The event taxonomy and categories designed now must survive this transition.

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

A single `instrumentation.js` module with:
- `trackEvent(category, action)` -- increment a counter
- `trackSessionStart()` / `trackSessionEnd()` -- manage session timing
- `getStats()` -- return the full stats object for the UI panel
- `resetStats()` -- clear all counters (user-initiated only)

The module must enforce the two-stream boundary: it accepts only predefined event categories (feature counters, modality tags, error types) and rejects any attempt to pass PHI or free-text content.

### Persistence

Stats object is a flat JSON blob:

```json
{
  "version": 1,
  "firstSeen": "2026-04-06",
  "lastSeen": "2026-04-06",
  "sessions": 42,
  "totalMinutes": 1260,
  "features": {
    "studiesLoaded": 150,
    "seriesViewed": 430,
    "measurementUsed": 25,
    "notesCreated": 12,
    "reportsGenerated": 3,
    "windowLevelAdjusted": 890,
    "zoomPanUsed": 340
  },
  "modalities": {
    "CT": 80,
    "MR": 55,
    "US": 10,
    "other": 5
  },
  "errors": {
    "decodeFailed": 3,
    "unsupportedFormat": 7
  }
}
```

### Integration points

Instrumentation calls are added at existing code paths -- no new UI flows or user interactions required for collection. The only new UI is the stats panel.

### Deployment mode behavior

| Mode | Collection | Storage | User panel |
|------|-----------|---------|------------|
| Demo | Disabled | None | Hidden |
| Personal | Enabled | localStorage | Visible |
| Desktop | Enabled | App-data JSON | Visible |
| Cloud (future) | Enabled | Server-side + local cache | Visible |

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
