# Instrumentation Research: Todoist / Bitmapist Benchmarking

Benchmarking Todoist's analytics and instrumentation to inform design decisions for local-first usage tracking in the DICOM viewer / myradone desktop app.

## Summary

Todoist (by Doist) takes a notably independent approach to analytics. Instead of using commercial platforms, they built Bitmapist, an open-source Redis bitmap tool, in 2012. Their web analytics are consent-first (default denied). Their Karma system is a standout example of surfacing usage data back to users as a feature -- turning analytics into value rather than surveillance.

Key takeaway: compute stats locally, show them to the user, optionally sync anonymized aggregates later.

---

## 1. Current State of Our App

No external instrumentation exists. The codebase has:

- **`config.js`** -- a dormant `analytics` feature flag, true only for `mode === 'cloud'` (unimplemented)
- **`sources.js`** -- internal `performance.now()` timing for desktop scan operations (operational, not telemetry)
- **`import-pipeline.js`** -- similar performance timing for imports
- **`DIVERGENT_CENTRAL_GUIDE.md`** -- explicitly states "No telemetry, no analytics, no third-party tracking"

No analytics SDKs, no error tracking, no usage telemetry.

---

## 2. Todoist's Analytics Stack

### Product Analytics: Bitmapist (Custom, Open-Source)

Doist's CEO Amir Salihefendic built Bitmapist in October 2012. Mixpanel would have cost $2,000+/month at their scale, and Doist was bootstrapped. He realized Redis 2.6's bitmap operations (SETBIT, GETBIT, BITOP, BITCOUNT) were the exact primitives needed for cohort analysis.

**How it works.** Every analytics event becomes a Redis bitmap where each bit position is a user ID:

```python
mark_event('active', user_id=542)
# Sets bit 542 to 1 in key "trackist_active_2026-04-06"
```

One call creates entries at multiple granularities (day, week, month, year). A bitmap for 8 million users = 1 MB. Bitwise operations enable cohort queries:

```python
# Retention: users active in both March AND April
retained = MonthEvents('active', march) & MonthEvents('active', april)
print(len(retained))
```

AND = intersection, OR = union, NOT = complement. Queries run in milliseconds with no batch jobs or data warehouse.

**The 443x memory reduction.** By 2017, Doist's Redis instance had grown to 129.5 GB. Redis stores bitmaps as flat byte arrays -- setting bit 8,000,000 allocates 1 MB even if one bit is set. Engineer Artyom Pervukhin rewrote the backend in Go using Roaring Bitmaps, a compressed format that adapts per chunk (sparse = sorted array, dense = bitmap, sequential = run-length encoding). Result: 129.5 GB to ~300 MB. The Go server speaks Redis wire protocol, so existing Python code connects unchanged.

**Cumulative savings.** Amir claims "millions" saved over 13 years vs. commercial analytics pricing at Todoist's scale (40M+ users).

**Limitations.** Bitmapist tracks binary events only (did/didn't). It cannot track counts ("how many tasks completed"), durations, ordered funnels, event properties, or per-user timelines. It excels at exactly one thing: retention/cohort analysis at minimal cost.

### Full Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Product analytics | Bitmapist (custom) | Feature adoption, retention, cohorts |
| Web analytics | Google Analytics (consent mode) | Traffic, referrals |
| Performance | Datadog | APM, DORA metrics |
| Crash reporting | Sentry | Error tracking (all platforms) |
| Mobile crashes | Firebase Crashlytics | Mobile-specific crashes |
| Mobile analytics | Firebase Analytics | Mobile usage (Android) |
| Web performance | Request Metrics | Page load, web vitals |

### Open Source

- **github.com/Doist/bitmapist** -- 1,007 stars, Python, BSD-3, actively maintained (latest: v3.119, January 2026). Multiple Doist engineers contribute.
- **github.com/Doist/bitmapist-server** -- 123 stars, Go, MIT, latest v1.9.8 (October 2025). Roaring Bitmaps + bbolt disk storage.
- **Bitmapist4** -- next-generation refactor with class-based API and Pandas DataFrame export.

---

## 3. Opt-In / Opt-Out Approach

### Web: Consent-First (Opt-In)
- Google Consent Mode v2 with `analytics_storage` defaulting to `denied`
- More conservative than most apps (many default to granted)

### Mobile: Effectively Opt-Out
- Firebase Analytics and Sentry bundled in Android APK
- Exodus Privacy audit: 4 trackers (Firebase Analytics, Crashlytics, Play Install Referrer, Sentry)
- No documented in-app toggle

### User-Facing Data: Fully Controllable
- Karma system can be disabled entirely
- Daily/weekly goals configurable or set to 0
- Vacation mode pauses streak tracking

### Compliance
- GDPR compliant since May 2018
- SOC2 Type 2 certified December 2025
- PrivacySpy score: 8/10
- Explicit policy: customer data NOT used to train AI models

---

## 4. Privacy Policy

- **Data collected**: Account info, content (tasks/projects), usage data, device data, payment via Stripe
- **Usage**: Product improvement, support, security. No ad profiling.
- **Third-party sharing**: AWS, Google Cloud, Azure (infra); Stripe (payments); Zendesk (support); SendGrid (email). No data brokers.
- **Retention**: Data while account active, 90-day backup retention after deletion.

---

## 5. User-Facing Usage Data: The Karma System

This is the most relevant pattern for our app. Todoist turns analytics into a user feature.

### 8-Level Progression

| Level | Points |
|-------|--------|
| Beginner | 0 |
| Novice | 1 |
| Intermediate | 500 |
| Professional | 2,000 |
| Expert | 5,000 |
| Master | 10,000 |
| Grand Master | 20,000 |
| Enlightened | 50,000 |

### Mechanics
- +1 per task completed, bonuses for goals/streaks
- -1 per task overdue by 4+ days
- Daily/weekly goal targets with streak counter
- 7-day bar chart (tasks per day, color-coded by project)
- 4-week trend view
- Vacation mode, day exclusions

### Key Insight

Users willingly generate usage data because they get value back (motivation, progress tracking, gamification). The stats panel is the privacy policy -- if you can see everything that's tracked, there's nothing hidden.

---

## 6. Local vs Server-Side

Todoist computes Karma and productivity stats **server-side** because they have accounts and multi-device sync. For a local-first app without accounts, the pattern should be inverted:

| Todoist (server-first) | Our app now (local-first) | Our app future (web-first) |
|------------------------|---------------------------|----------------------------|
| Stats computed on server | Stats computed locally | Stats computed on server |
| Synced to clients read-only | Stored in app-data | Synced to clients read-only |
| Requires account | No account needed | Requires account |
| Cross-device consistency | Single-device, self-contained | Cross-device consistency |
| Aggregate analytics across users | No aggregate view | Aggregate analytics across users |

The local-first model is a stepping stone. The product roadmap is web-first: cloud platform with accounts, server-side persistence, aggregate analytics. The local module should be designed so the event taxonomy and `trackEvent` API survive the transition -- only the persistence backend changes. The user-facing stats panel persists in both models.

---

## 7. Applicability to Our App

### Patterns to Adopt

1. **Stats as a feature, not surveillance.** Surface usage data to the user in a visible panel. The user sees exactly what the app knows.
2. **Consent-first for anything that leaves the machine.** Follow the web model (default denied), not the mobile model.
3. **Separate crash reporting from usage analytics.** Different consent requirements, different tools.
4. **Local-first computation.** Compute everything locally, store in app-data.
5. **Simple over sophisticated.** A JSON counter is better than an analytics SDK at our stage.

### Patterns to Skip

1. **Gamification.** Karma-style levels make sense for productivity, less so for medical imaging.
2. **Redis bitmaps.** Overkill for single-user local app.
3. **Commercial analytics platforms.** No need for Mixpanel/Amplitude without users at scale.
4. **Firebase/Google Analytics.** Unnecessary third-party dependency.

### Minimum Viable Instrumentation

- Session count + duration
- Feature usage counters (viewer, library, measurements, notes)
- Modality breakdown (CT/MR/US/other)
- Error/decode failure counts
- All stored as JSON in app-data
- Surfaced in a "Usage Stats" panel the user can see
- No network calls, no third parties, no consent needed

---

## Sources

- [Bitmapist GitHub](https://github.com/Doist/bitmapist) (1,007 stars, BSD-3)
- [Bitmapist-server GitHub](https://github.com/Doist/bitmapist-server) (123 stars, MIT)
- [Amir Salihefendic: "bitmapist: Analytics and cohorts for Redis" (Medium, 2015)](https://medium.com/hacking-and-gonzo/bitmapist-analytics-and-cohorts-for-redis-44be43458ef6)
- [Vikram Oberoi: "Using bitmaps to run interactive retention analyses over billions of events"](https://vikramoberoi.com/posts/using-bitmaps-to-run-interactive-retention-analyses-over-billions-of-events-for-less-than-100-mo/)
- [Todoist Privacy Policy](https://todoist.com/privacy)
- [Doist Engineering Blog](https://www.doist.dev/bitmapist/)
