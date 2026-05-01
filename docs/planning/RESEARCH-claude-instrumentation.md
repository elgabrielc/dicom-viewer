# Research: Claude App Analytics & Instrumentation Benchmarking

Copyright 2026 Divergent Health Technologies

**Date**: 2026-04-06
**Context**: Benchmarking for myradone desktop app instrumentation design
**Prior benchmarks**: Todoist (cloud-first, custom analytics), Sublime Text (local-first, near-zero telemetry)

---

## Executive Summary

Anthropic runs a sophisticated, multi-layered instrumentation stack across its Claude products. The key architectural insight is the strict separation between **product data** (conversations/inputs/outputs) and **operational telemetry** (usage metrics, error reporting, feature flags). These two streams have entirely different retention policies, opt-out mechanisms, and compliance treatment.

The analytics stack uses **Segment** (web analytics), **GrowthBook** (feature flags, replacing Statsig after OpenAI's acquisition), and **Sentry** (error reporting). The web app uses standard marketing trackers (Google Analytics, Facebook Pixel, LinkedIn, Reddit, TikTok, Twitter/X). The desktop/CLI app collects identity markers, system info, and usage metrics via GrowthBook, with local caching when offline.

Enterprise customers get fundamentally different treatment: no training on data by default, zero data retention option, SOC 2 Type II, ISO 27001, and HIPAA BAA availability.

**Relevance to myradone**: Anthropic's separation of product data from telemetry, tiered retention policies, and granular opt-out controls (especially the environment variable approach in Claude Code) are directly applicable patterns for a medical imaging app.

---

## 1. What Usage Data Does Claude Collect?

### Web App (claude.ai)

**Account data**: Name, email, phone number, indirect identifiers.

**Conversation data (Inputs/Outputs)**: All text, files, prompts submitted and responses generated. Stored with user ID association.

**Automatic technical data**:
- Device type, OS, browser, IP address
- Location derived from IP
- Dates, times, frequency of access
- Features used, pages viewed
- Error logs and application state
- Cookies and similar tracking technologies

**Feedback data**: When users rate responses (thumbs up/down), the entire conversation is stored and disassociated from user ID for training purposes.

### Desktop App (Electron) / Claude Code (CLI)

The Claude Code source leak (March 31, 2026 -- accidental `.npmignore` misconfiguration shipped 512,000 lines of unobfuscated TypeScript) revealed specific telemetry data points:

**On every launch, the analytics service transmits**:
- User ID, session ID, organization UUID, account UUID
- Email address (if defined)
- App version, platform type, terminal type
- Currently enabled feature gates/flags

**Ongoing operational metrics**:
- API call payload sizes (byte length of system prompts, messages, tool schemas)
- Latency, reliability, usage patterns
- Frustration detection via regex pattern matching on user input (scans for emotional signals like "wtf", "this sucks", etc.)

**Error reporting (Sentry)**:
- Current working directory (potentially revealing project names/paths)
- Active feature gates, user ID, email, session ID, platform info
- System information and error stack traces

**Local caching**: When network is unavailable, telemetry is cached locally in `~/.claude/telemetry/` and transmitted later.

**What is explicitly NOT collected** (per official docs): Code content, file paths, or file contents are not included in Statsig/GrowthBook telemetry. However, the source leak revealed that Sentry error reporting *could* capture working directories.

### Session Quality Surveys

A separate, minimal data stream: only a numeric rating (1, 2, 3, or "dismiss") is recorded. No conversation transcripts, inputs, outputs, or session data. Cannot be used for model training. Controllable via `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`.

Sources:
- [Claude Code Data Usage Docs](https://code.claude.com/docs/en/data-usage)
- [The Register: Claude Code Source Leak](https://www.theregister.com/2026/04/01/claude_code_source_leak_privacy_nightmare/)
- [DecodetheFuture: Claude Code Hidden Controls](https://decodethefuture.org/en/claude-code-undercover-mode-killswitches-telemetry/)

---

## 2. Conversation Data vs. Analytics Data

### The Two Data Streams

Anthropic maintains a clear architectural separation:

**Stream 1: Product data (Inputs/Outputs)**
- User conversations, prompts, responses, uploaded files
- Governed by training opt-in/opt-out preference
- Retention: 5 years (training opted in) or 30 days (opted out)
- Can be individually deleted (removed from history immediately, purged from backend within 30 days)
- Subject to safety review override (flagged content used for training regardless of opt-out)
- Encrypted in transit (TLS) and at rest (AES-256)

**Stream 2: Operational telemetry**
- Usage metrics, error logs, performance data, feature flag evaluations
- Separate opt-out mechanisms (environment variables)
- Not subject to training opt-in/opt-out toggle
- Aggregated/de-identified for analysis
- Does not include conversation content

### The Feedback Bridge

Feedback creates a bridge between the two streams. When a user rates a response:
- The conversation is **disassociated from user ID**
- Then used for training and model improvement
- This happens regardless of the training opt-out setting
- `/feedback` command transcripts are retained for 5 years

### Safety Override

Even when users opt out of training: "We will use Inputs and Outputs for model improvement when: (1) your conversations are flagged for safety review to improve our ability to detect harmful content, enforce our policies, or advance AI safety research, or (2) you've explicitly reported the materials to us."

This is a critical design pattern: safety monitoring is non-negotiable, even for users who opt out of everything else.

Sources:
- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
- [Privacy Center: Data Protection](https://privacy.claude.com/en/articles/10458704-how-does-anthropic-protect-the-personal-data-of-claude-users)

---

## 3. Privacy Policy Specifics

### Data Categories Collected

The privacy policy (effective January 12, 2026) defines these categories:

| Category | Examples |
|----------|----------|
| Identity/Contact | Name, email, phone, indirect identifiers |
| Payment | Payment information for subscriptions |
| Inputs/Outputs | Prompts, responses, uploaded files |
| Feedback | Thumbs up/down (stores entire conversation) |
| Device/Connection | Device type, OS, browser, IP, ISP, mobile network |
| Usage | Dates, times, frequency, features used, pages viewed, browsing history |
| Location | Derived from IP; precise location only with consent |
| Log/Troubleshooting | Error information, application state |
| Cookies/Trackers | Cookies, scripts, device/advertising identifiers |

### How Data Is Used

1. Service provision (account management, payment processing)
2. Improvement and research (model training, behavior analysis, debugging, safety)
3. Marketing and communication (with opt-out available)
4. Legal/security (fraud prevention, law enforcement cooperation)

### Retention Periods

| Tier | Training Setting | Retention |
|------|-----------------|-----------|
| Free/Pro/Max | Opted in | 5 years |
| Free/Pro/Max | Opted out | 30 days |
| Team/Enterprise | Default | 30 days |
| Enterprise (ZDR) | Zero Data Retention | Immediate deletion after abuse check |
| `/feedback` transcripts | N/A | 5 years |
| Deleted conversations | N/A | Removed from backend within 30 days |

### Third-Party Sharing

Data shared with:
- Affiliates and related entities
- Service providers (hosting, compliance, research, auditing, data processing)
- Third-party integrations the user explicitly chooses
- Regulatory authorities and law enforcement
- Parties in corporate transactions/mergers

Explicit commitment: "Anthropic does not 'sell' your personal data."

### GDPR/CCPA Compliance

- Right to know, access, portability, deletion, correction, objection, restriction
- Right to withdraw consent
- No automated decision-making with legal effect
- Data controllers: Anthropic PBC (outside EU), Anthropic Ireland Limited (EEA/UK/Switzerland)
- International transfers via Standard Contractual Clauses and adequacy decisions
- Regional supplements for Canada, Brazil, Republic of Korea
- Contact: privacy@anthropic.com, DPO: dpo@anthropic.com

### The Opt-In to Opt-Out Shift (September 2025)

Anthropic's original policy: "We WILL NOT USE your Inputs or Outputs to train our models, unless [specific exceptions]."

Updated policy (effective September 28, 2025): "We MAY USE your Inputs and Outputs to train our models and improve our Services, UNLESS YOU OPT OUT through your account settings."

Users had until October 8, 2025 to make their choice. This generated significant controversy on Hacker News and tech media, with critics noting the shift from opt-in to opt-out as the default.

### Privacy Watchdog Score

Independent review by terms.law: **65/100 (Grade B-)**. Highest among AI services reviewed, but flagged three concerns: feedback training loop, Trust & Safety retention override, and API vs consumer disparity.

Sources:
- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [Updates to Consumer Terms](https://www.anthropic.com/news/updates-to-our-consumer-terms)
- [Privacy Watchdog Review](https://terms.law/Privacy-Watchdog/ai-services/anthropic/)
- [HN: Anthropic Changes Training Data Policy](https://news.ycombinator.com/item?id=45054160)
- [HN: Updates to Consumer Terms](https://news.ycombinator.com/item?id=45062683)
- [Bitdefender: Anthropic Shifts Privacy Stance](https://www.bitdefender.com/en-us/blog/hotforsecurity/anthropic-shifts-privacy-stance-lets-users-share-data-for-ai-training)

---

## 4. Analytics Stack

### Confirmed Third-Party Services

**Web analytics (claude.ai / anthropic.com)**:

| Service | Category | Cookie Prefix | Purpose |
|---------|----------|--------------|---------|
| **Segment** | Analytics | `ajs_anonymous_id`, `ajs_user_id` | Performance and analytics tracking (1-year cookies) |
| **Google Analytics** | Analytics | Multiple | Traffic analysis, conversion tracking |
| **Intercom** | Support/Necessary | `intercom-*` | Customer support chat widget |
| **Stripe** | Payments/Necessary | `__stripe_mid` | Payment processing security |
| **Cloudflare** | Infrastructure/Necessary | `__cf_bm`, `cf_clearance` | Bot protection, CDN |

**Marketing trackers on anthropic.com/claude.ai**:

| Service | Cookie | Duration | Purpose |
|---------|--------|----------|---------|
| Facebook | `_fbc`, `_fbp` | 90 days - 2 years | Pixel marketing |
| Reddit | `_rdt_uuid`, `_rdt_cid` | 1 year | Audience targeting |
| TikTok | `_ttclid` | 90 days | Campaign measurement |
| Twitter/X | `guest_id`, `personalization_id`, etc. | 348-400 days | Marketing identifiers |
| LinkedIn | `li_giant`, `oribili_user_guid` | 1 day - 1 year | Conversion analytics |
| YouTube | `__Secure-YEC`, `VISITOR_INFO1_LIVE`, etc. | Session - 6 months | Video embed tracking |

**Desktop/CLI telemetry**:

| Service | Purpose | Opt-Out |
|---------|---------|---------|
| **GrowthBook** (replaced Statsig Sept 2025) | Feature flags, A/B testing, usage metrics | `DISABLE_TELEMETRY=1` |
| **Sentry** | Error reporting, crash analytics | `DISABLE_ERROR_REPORTING=1` |

**Infrastructure subprocessors** (from Trust Center):
- Google Cloud Platform (TPUs, infrastructure)
- Amazon Web Services (Trainium, infrastructure)
- Microsoft Azure (cloud infrastructure, added 2026)
- Boldr (user support, Canada)
- Nutun (user support, South Africa)

### Remote Feature Flags and Remote Management

GrowthBook manages feature flags with a `tengu_` prefix (Claude Code's internal codename). At least 6 remote killswitches are documented. A remote settings endpoint is polled every 60 minutes, returning a `policySettings` object that can override local settings, activate/deactivate features, or force application shutdown.

### Analytics Team Structure

Anthropic's job postings reveal the analytics engineering team is embedded across Product pillars (Consumer, Claude Code, Enterprise & Verticals, Growth, Platform Product). They build "raw product event logs into canonical datasets and insightful data marts." Core tools: SQL, Python, dbt. The Analytics Data Engineering Manager role pays $370K-$450K, indicating this is a senior function. The team also uses Spark, Airflow, Dagster, dbt, Snowflake, BigQuery among others for data warehousing.

### Default Telemetry Behavior by API Provider

| Service | Claude API | Vertex API | Bedrock API |
|---------|-----------|-----------|-------------|
| GrowthBook (Metrics) | Default ON | Default OFF | Default OFF |
| Sentry (Errors) | Default ON | Default OFF | Default OFF |
| Feedback reports | Default ON | Default OFF | Default OFF |
| Session surveys | Default ON | Default ON | Default ON |

This is a notable pattern: telemetry is disabled by default for third-party cloud providers (Vertex, Bedrock), reflecting that those customers have their own analytics and compliance requirements.

Sources:
- [Anthropic Cookie Policy](https://privacy.claude.com/en/articles/10023541-what-cookies-does-anthropic-use)
- [Claude Code Data Usage](https://code.claude.com/docs/en/data-usage)
- [Analytics Data Engineering Manager Job](https://job-boards.greenhouse.io/anthropic/jobs/5125387008)
- [Alex Kim: Claude Code Source Leak](https://alex000kim.com/posts/2026-03-31-claude-code-source-leak/)
- [HN: Anthropic Subprocessor Changes](https://news.ycombinator.com/item?id=47536110)

---

## 5. User-Facing Data and Controls

### Privacy Settings (All Users)

Available at `claude.ai/settings/data-privacy-controls`:
- **"Help improve Claude" toggle**: Controls whether conversations are used for model training
- **Cookie preferences**: "Privacy Choices" on anthropic.com, "Your privacy choices" on claude.ai
- Can be changed at any time; changes apply prospectively

### Data Export

**Individual users (Free/Pro/Max)**:
- Settings > Privacy > Export Data
- Download link sent via email, valid for 24 hours
- Includes conversation data

**Organization admins (Team/Enterprise)**:
- Organization settings > Data and Privacy > Export Data
- Only Primary Owners can export
- Includes conversation data and user account data
- Deleted messages/files/projects are excluded from exports
- Download link expires in 24 hours

**Spend data export (Team/Enterprise)**:
- CSV format with: Date, Org UUID, user email, Account UUID, Product type, Model family, request count, prompt tokens, completion tokens, net/gross spend
- Date ranges: MTD, last month, last 90 days, or custom (up to 90 days)

### Account Deletion

- Settings > Account > Delete Account
- Pro subscribers must cancel subscription first and wait for period to end
- Permanent -- all saved chats lost
- Anthropic recommends exporting data before deletion
- Deleted account data excluded from future model training

### Conversation Management

- Individual conversations can be deleted (removed from history immediately, backend within 30 days)
- Deleted conversations excluded from future training
- No undo for deletion

### Usage Analytics Visible to Admins (Team/Enterprise)

| Metric | Scope |
|--------|-------|
| Weekly/daily/monthly active users | Organization |
| Utilization rates | Organization |
| Chats per day, % users with chats | Claude.ai product |
| Projects created daily | Claude.ai product |
| Artifacts created daily | Claude.ai product |
| Lines of code accepted | Claude Code |
| Suggestion accept rate | Claude Code |
| Top 10 users by spend | Leaderboard |
| Total spend (MTD/quarterly/yearly) | Organization |
| Spend by model | Organization |

**Analytics API** (Enterprise only): Programmatic access to the same metrics for integration into internal dashboards.

### What Individual Users Cannot See

- No usage statistics dashboard for Free/Pro/Max individuals
- No "how many messages did I send" counter
- No token usage breakdown for non-API users
- No session duration or frequency stats exposed to end users

Sources:
- [Privacy Settings & Controls](https://privacy.claude.com/en/collections/10672568-privacy-settings-controls)
- [Deleting Claude Accounts](https://privacy.claude.com/en/articles/10023660-deleting-claude-accounts)
- [Export Organization Data](https://privacy.claude.com/en/articles/13346720-export-your-organization-s-data)
- [View Usage Analytics](https://support.claude.com/en/articles/12883420-view-usage-analytics-for-team-and-enterprise-plans)

---

## 6. Enterprise and Sensitive Data Handling

### Compliance Certifications

| Certification | Status |
|--------------|--------|
| SOC 2 Type I & Type II | Current |
| ISO 27001:2022 | Current |
| ISO/IEC 42001:2023 (AI Management Systems) | Current |
| HIPAA-ready configuration | Available with BAA |

Compliance artifacts available at [trust.anthropic.com](https://trust.anthropic.com/).

### HIPAA BAA Coverage

**Covered products**:
- Claude Enterprise: Core features (Chat, Projects, Artifacts, Voice, Web Search, Research, Skills). File creation/code execution covered excluding network access.
- Claude Code CLI: Only with Zero Data Retention enabled
- Claude Platform (1P API): Messages API, Token Counting, Models, Org Management, Compliance APIs

**Explicitly NOT covered**:
- Claude Free, Pro, Max, or Team plans
- Workbench and Console
- Claude Code (web, desktop, review, security variants)
- Batch API, Files API, Skills API, Computer Use, Web Fetch
- Beta features (Cowork, Claude for Office)
- Third-party data flows from integrations/MCPs

### Zero Data Retention (ZDR)

- Available for Enterprise API customers, subject to Anthropic approval
- Inputs and outputs not stored after processing, except for real-time abuse detection
- Abuse detection results are retained (non-negotiable)
- Enabled per organization; each new org must have ZDR enabled separately
- Available for Claude Code on Enterprise when enabled by account team

### Data Isolation by Tier

| Feature | Free/Pro/Max | Team | Enterprise |
|---------|-------------|------|-----------|
| Data used for training | Default ON (opt-out available) | No (commercial terms) | No (commercial terms) |
| Retention | 30 days or 5 years | 30 days | 30 days or ZDR |
| Employee access to conversations | Only Trust & Safety, need-to-know | Only Trust & Safety | Only Trust & Safety |
| Admin analytics dashboard | No | Yes | Yes + API |
| Data export | Individual only | Primary Owner | Primary Owner |
| SSO/SCIM | No | No | Yes |
| HIPAA BAA | No | No | Yes (with config) |
| SOC 2 coverage | No | No | Yes |

### Security Architecture

- Encryption in transit: TLS 1.2+
- Encryption at rest: AES-256
- Employee access: Default denied; only Trust & Safety on need-to-know basis
- Continuous security monitoring and vulnerability assessments
- Multi-factor authentication for remote access
- Network segmentation
- Least privilege access principles
- Annual mandatory security and privacy training
- Security incident notification within 48 hours
- BYOK (Bring Your Own Key) planned for H1 2026

### Data Processing Agreement

- 15-day notice for new subprocessors, with customer objection rights
- Subprocessor obligations must be "substantively no less protective" than Anthropic's
- Customer data deletion within 30 days of agreement termination
- Annual third-party audits (SOC 2); customers can request audit reports

Sources:
- [BAA for Commercial Customers](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers)
- [Zero Data Retention](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)
- [Certifications](https://privacy.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained)
- [Trust Center](https://trust.anthropic.com/)

---

## Design Patterns Relevant to myradone

### Pattern 1: Separate Product Data from Telemetry

Anthropic's cleanest design decision: conversations and usage metrics are architecturally separate streams. For myradone, this maps to:
- **Product data**: DICOM files, annotations, reports, study metadata
- **Telemetry**: Feature usage, performance, errors, session metrics

These should have different storage, different retention, different opt-out controls, and different compliance treatment.

### Pattern 2: Tiered Retention by User Choice

The 30-day vs 5-year split based on user opt-in is elegant. For myradone:
- Users who opt into analytics could have longer metric retention
- Users who opt out get minimal retention (or none, since we're local-first)
- Safety/compliance logging (e.g., PHI access audit trails) is non-negotiable regardless of preference

### Pattern 3: Environment Variable Opt-Out for Developer/Power Users

Claude Code's approach is excellent for a desktop app:
```
DISABLE_TELEMETRY=1
DISABLE_ERROR_REPORTING=1
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```
This gives IT administrators and power users fine-grained control without requiring UI interaction.

### Pattern 4: Offline-First Telemetry with Local Cache

Claude Code caches telemetry in `~/.claude/telemetry/` when offline and transmits later. For a local-first medical imaging app, this is essential -- users may work offline frequently.

### Pattern 5: Third-Party Telemetry Off by Default for Enterprise

Claude Code disables Statsig/GrowthBook and Sentry by default for Bedrock/Vertex customers. For myradone, any institutional deployment should have external telemetry disabled by default, with opt-in only.

### Pattern 6: Feature Flags with Remote Management

GrowthBook provides remote feature flag management, polled every 60 minutes. This enables gradual rollouts, A/B testing, and emergency killswitches without app updates. For a desktop medical imaging app, this is powerful but must be implemented with extreme care around the "dangerous setting" pattern -- Anthropic's approach of requiring acceptance (or quitting) is heavy-handed but prevents silent behavior changes.

### Pattern 7: What NOT to Do

- The opt-in to opt-out policy shift generated significant backlash. Start with opt-in and keep it there.
- Frustration detection via regex is creative but invasive. Don't scan user input for emotional signals.
- Marketing trackers (Facebook, TikTok, Reddit pixels) on a medical app would be unacceptable.
- The "undercover mode" that hides AI attribution raises ethical questions. Be transparent about all tooling.

### Pattern 8: Minimal User-Facing Analytics

Anthropic shows almost no usage stats to individual users (only admins see dashboards). For myradone, we should surface useful stats to users (images viewed, studies loaded, time in app) -- this is a differentiator, not a liability.

---

## Comparison: Anthropic vs Todoist vs Sublime Text

| Dimension | Sublime Text | Anthropic (Claude) | Todoist |
|-----------|-------------|-------------------|---------|
| Telemetry philosophy | Near zero | Comprehensive with granular opt-out | Server-side analytics, no client telemetry visible |
| Privacy policy | None published | Detailed, multi-document | Standard SaaS |
| Error reporting | None visible | Sentry (opt-out available) | Not publicly documented |
| Feature flags | None visible | GrowthBook (remote management) | Server-side |
| Analytics tools | None visible | Segment, Google Analytics, GrowthBook | Bitmapist (custom), server-side |
| Marketing trackers | None | Facebook, Reddit, TikTok, LinkedIn, Twitter/X, Google | Google Analytics, limited |
| User analytics dashboard | None | Admins only (Team/Enterprise) | Karma system, productivity stats |
| Data export | N/A (local files) | JSON via email (24hr link) | JSON/CSV via API |
| Enterprise tier | License keys only | ZDR, HIPAA BAA, SOC 2, SSO/SCIM | Business plan, limited |
| HIPAA | N/A | BAA available (Enterprise only) | No |
| Offline telemetry | N/A | Local cache, transmit later | N/A (cloud-first) |
| Open source | No | Source leaked (unintentional) | No |

---

## Key Takeaways for myradone Instrumentation Design

1. **Two-stream architecture is the standard**: Product data (DICOM, annotations) and telemetry (usage, errors) must be architecturally separate with independent controls.

2. **Medical data demands HIPAA-grade isolation**: Even Anthropic, which handles general conversations, offers ZDR and BAA. myradone handles actual PHI -- our baseline must exceed Anthropic's Enterprise tier.

3. **Opt-in only**: Anthropic's opt-out switch generated backlash. For medical software, opt-in is the only acceptable default.

4. **Environment variables for institutional control**: Claude Code's `DISABLE_TELEMETRY` pattern is the right model for a desktop app deployed in hospital environments.

5. **Offline-first telemetry**: Local caching with deferred transmission is essential for a local-first app.

6. **No marketing trackers**: Anthropic's use of Facebook/TikTok/Reddit pixels on their marketing site is acceptable for a consumer SaaS but disqualifying for medical software. Zero third-party marketing trackers.

7. **Error reporting is the most valuable telemetry**: Sentry-style crash reporting (with appropriate PII stripping) provides the highest ROI for product quality. Make this the first thing to implement.

8. **Feature flags enable safe rollouts**: Remote feature management is powerful for desktop apps that can't be instantly updated. But must be transparent about what can be remotely changed.

9. **Admin dashboards beat individual dashboards (commercially)**: Team/Enterprise analytics are a revenue driver. But for a consumer medical app, user-facing stats (images viewed, studies loaded) are a differentiator.

10. **Safety logging is non-negotiable**: Even Anthropic's most privacy-respecting tier retains safety classifier results. For medical software, PHI access audit trails serve the same non-negotiable role.
