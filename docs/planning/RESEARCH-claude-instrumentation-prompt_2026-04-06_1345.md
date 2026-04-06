# Research: Claude App Analytics & Instrumentation Benchmarking

## Summary

Anthropic's Claude uses a two-stream architecture: product data (conversations) and telemetry (usage metrics) are architecturally separate with different retention, opt-out mechanisms, and purposes. The analytics stack includes Segment, GrowthBook, Sentry, and Google Analytics. Individual users see no usage statistics; Team/Enterprise admins get dashboards. The September 2025 shift from opt-in to opt-out for training data generated significant backlash -- a cautionary tale about changing privacy defaults after launch. Enterprise tier offers zero data retention, SOC2, and HIPAA BAA.

---

## 1. What Usage Data Does Claude Collect?

### Account Data
- Email, name, phone number (if provided)
- Account creation date, subscription tier
- Organization membership and role

### Conversation Data (Product Data Stream)
- Full conversation content (inputs and outputs)
- Timestamps, model used, conversation length
- File uploads, artifacts, tool use results
- Feedback ratings (thumbs up/down)

### Device and Connection Data
- IP address, browser type and version, OS
- Device identifiers, screen resolution
- Referring URL, pages visited, click patterns
- Time zone, approximate location (from IP)

### Telemetry (Analytics Data Stream)
The desktop app and Claude Code specifically transmit:
- User ID, session ID, organization UUID
- Email, platform, app version
- Feature flags active for the user
- API payload sizes
- Error events with stack traces (via Sentry)
- Performance metrics (response latency, time to first token)

Claude Code caches telemetry locally (`~/.claude/telemetry/`) when offline, then syncs when connectivity returns.

### Behavioral Signals
Claude Code's source revealed regex-based frustration detection on user input (patterns like "this is terrible", "you're useless") logged as telemetry events. This represents behavioral analytics beyond simple feature counters.

### Cookies and Trackers
- `ajs_anonymous_id` / `ajs_user_id` -- Segment analytics
- `__cf_bm` -- Cloudflare bot management
- Session cookies for authentication
- Marketing pages include pixels from Facebook, Reddit, TikTok, LinkedIn, Twitter/X

---

## 2. Conversation Data vs Analytics Data

### Two Architecturally Separate Streams

| Dimension | Product Data (Conversations) | Telemetry (Usage Metrics) |
|-----------|------------------------------|---------------------------|
| Content | Full conversation text, files | Counters, events, errors, metadata |
| Retention | 30 days (default) or up to 5 years (if opted in) | Separate, unspecified |
| User deletion | Individual conversations deletable | Not individually deletable |
| Training use | Opt-out available (default varies by tier) | Not used for training |
| Opt-out mechanism | Account settings toggle | Environment variables (CLI) |

### Training Data Policy

**The September 2025 controversy.** Anthropic changed Free and Pro tier defaults:
- **Before**: Conversations NOT used for training by default (opt-in)
- **After**: Conversations ARE used for training by default (opt-out)

Users must actively toggle off "Improve Claude with your conversations" in settings. This generated significant community backlash.

**Tier-based defaults:**

| Tier | Training default | Can opt out? |
|------|-----------------|--------------|
| Free | Opted in | Yes |
| Pro / Max | Opted in | Yes |
| Team | Opted out | N/A (not used) |
| Enterprise | Opted out | N/A (not used) |
| API | Not used | N/A |

**Safety override:** Content flagged by safety systems may be used for safety training regardless of opt-out status. This is disclosed in the privacy policy.

### Feedback Bridge
When users give thumbs up/down on a response, the conversation snippet is dissociated from user identity before being used for training. This bridges the product and analytics streams -- the feedback act is analytics, but the associated content becomes training data.

---

## 3. Privacy Policy Specifics

### Current Policy
Effective January 2026. Available at anthropic.com/privacy.

### Data Categories Collected
1. **Account information** -- name, email, phone, payment info
2. **User content** -- prompts, responses, uploaded files
3. **Automatically collected** -- device info, IP, browser, usage patterns, cookies
4. **Third-party sources** -- social login providers, analytics partners

### How Data Is Used
- Providing and improving services
- Safety and security (abuse detection, content moderation)
- Research and model improvement (subject to opt-out)
- Legal compliance
- Marketing (with consent where required)

### Data Retention
- **Conversations**: 30 days default, up to 5 years if user opts in to training
- **Account data**: Duration of account plus reasonable period after deletion
- **Safety-flagged content**: Retained regardless of other settings
- **Telemetry**: Not explicitly specified

### Third-Party Sharing
- Cloud infrastructure: GCP, AWS, Azure
- Payment processing (presumed Stripe)
- Analytics: Segment, Google Analytics
- Marketing: Meta, Reddit, TikTok, LinkedIn, X (website only)
- Data is not sold

### GDPR/CCPA Compliance
- Dual data controllers: Anthropic (US) and Anthropic Ireland (EU)
- Standard contractual clauses for international transfers
- CCPA rights: access, deletion, opt-out of sale (though they don't sell)
- Data Protection Officer contactable via privacy@anthropic.com

### Independent Assessment
PrivacySpy-style review scored Anthropic 65/100 -- highest among AI services but flagged concerns about:
- Feedback training loops (thumbs up/down creates training data even when opted out)
- Safety retention overrides on opt-out
- Vague telemetry retention periods

---

## 4. Analytics Stack

### Confirmed Tools

| Tool | Purpose | Evidence |
|------|---------|----------|
| **Segment** | Web analytics, event tracking | `ajs_anonymous_id`/`ajs_user_id` cookies |
| **GrowthBook** | Feature flags, A/B testing | Replaced Statsig after OpenAI acquisition of Statsig |
| **Sentry** | Error reporting, crash tracking | Stack traces in telemetry |
| **Google Analytics** | Web traffic analytics | Standard GA cookies |
| **Cloudflare** | CDN, bot management | `__cf_bm` cookie |

### Marketing Pixels (Website Only)
- Facebook Pixel
- Reddit Pixel
- TikTok Pixel
- LinkedIn Insight Tag
- Twitter/X Pixel

These appear on marketing pages (anthropic.com, claude.ai landing), not within the authenticated app experience.

### Internal Data Stack
From job postings and engineering blog:
- **dbt** -- data transformation
- **Spark** -- large-scale data processing
- **Airflow / Dagster** -- orchestration
- **Snowflake / BigQuery** -- data warehouse
- Analytics team embedded across 5 product pillars

### Desktop App Telemetry
Claude for Desktop (Electron) and Claude Code (CLI) use the same telemetry pipeline:
- Events cached locally when offline (`~/.claude/telemetry/`)
- Synced to Anthropic servers on connectivity
- Includes: user ID, session ID, org UUID, platform, app version, feature flags, errors
- Claude Code supports `CLAUDE_TELEMETRY_DISABLED=1` environment variable to opt out

---

## 5. User-Facing Data and Controls

### Individual Users

**What users CAN see:**
- Conversation history (full text)
- Active subscription and billing
- Which model was used per conversation
- Whether training opt-in is enabled

**What users CANNOT see:**
- Usage statistics (no session count, duration, feature usage)
- How much data they've sent/received
- What telemetry has been collected about them
- Analytics events associated with their account

**Controls available:**
- Toggle "Improve Claude with your conversations" (training opt-in/out)
- Delete individual conversations
- Delete entire account
- Data export (JSON via email, 24-hour download link)

### Team/Enterprise Admins

Admins see significantly more:
- Active users over time
- Chats per day
- Code acceptance rates (for Claude Code)
- Spend by model
- CSV export of usage data
- Enterprise: Analytics API for programmatic access

### Key Observation

Individual users get zero usage statistics about themselves. All analytics surfaces are admin-facing. This is the opposite of our proposed approach (user-visible stats panel). Anthropic treats analytics as a business tool, not a user feature.

---

## 6. Enterprise and Sensitive Data Handling

### Compliance Certifications
- **SOC 2 Type I & II** -- certified
- **ISO 27001** -- certified
- **ISO/IEC 42001** -- certified (AI management system)
- **HIPAA BAA** -- available for Enterprise and first-party API
  - Explicitly excludes: Free, Pro, Max, Team plans
  - Excludes: beta features, most Claude Code variants
  - Requires specific configuration (no file uploads, specific models only)

### Data Isolation by Tier

| Tier | Training | Retention | Zero Data Retention | HIPAA eligible |
|------|----------|-----------|---------------------|----------------|
| Free | Default on | 30 days | No | No |
| Pro/Max | Default on | 30 days | No | No |
| Team | Default off | 30 days | No | No |
| Enterprise | Off | Configurable | Available (API) | Yes (with BAA) |
| API | Off | Configurable | Available | Yes (with BAA) |

### Enterprise-Specific Controls
- Custom data retention policies
- Zero Data Retention option (API): inputs/outputs not stored beyond the request
- SSO/SAML integration
- Audit logs
- Dedicated security review process
- Subprocessor list with 15-day advance notice of changes
- Current subprocessors: GCP, AWS, Azure

### The "Don't Train on Our Data" Commitment
Commercial terms (Team, Enterprise, API) include contractual prohibition on using customer data for model training. This is not just a toggle -- it's a legal commitment. Free/Pro users get a toggle but no contractual guarantee beyond the privacy policy.

---

## 7. Applicability to Our App

### Patterns to Adopt

1. **Two-stream architecture.** Separate product data (DICOM files, patient metadata) from telemetry (usage counters, feature stats). Different retention, different controls, different purposes. Build this separation from day one.

2. **Tier-based defaults.** When cloud mode launches, different tiers should have different privacy defaults. Enterprise/medical customers expect data not to be used for anything beyond service delivery. Consumer users may accept broader use.

3. **Explicit subprocessor disclosure.** Name every third-party service that touches data. Anthropic lists GCP, AWS, Azure with 15-day change notice. Medical imaging demands at least this level of transparency.

4. **Data export capability.** Users should be able to export their data in a standard format. Anthropic does JSON via email. We could do JSON export from the stats panel.

### Patterns to Avoid

1. **Changing privacy defaults after launch.** The September 2025 opt-in to opt-out flip damaged trust. Pick the right default from day one and stick with it. For medical imaging, the right default is "collect nothing that leaves the machine."

2. **Behavioral surveillance.** Frustration detection via regex crosses a line between usage analytics and behavioral monitoring. For a medical app, this would be inappropriate. Track what features are used, not how the user feels about it.

3. **Admin-only analytics.** Anthropic shows usage data to admins but not to individual users. Our approach (user-visible stats) is better for trust and transparency.

4. **Vague retention periods.** Anthropic's telemetry retention is unspecified. Be explicit about how long every category of data is kept. Panic's 30-day retention disclosure is the better model.

### Where We Land (Updated Spectrum)

| Dimension | Sublime | Our App (ADR 008) | Claude | Todoist |
|-----------|---------|-------------------|--------|---------|
| Telemetry | None (removed) | Local counters | Full server-side | Custom (Bitmapist) |
| User sees own data | N/A | Yes (stats panel) | No | Yes (Karma) |
| Privacy policy | None | Needed (use Panic template) | Detailed | Detailed |
| Sensitive data handling | N/A | PHI never in telemetry | Safety overrides on opt-out | N/A |
| Third-party analytics | None | None (local only) | Segment, Sentry, GA | None (custom) |
| Training/ML use | N/A | Never | Opt-out (with exceptions) | Explicit "no AI training" |

Our ADR 008 approach remains well-positioned: local counters, user-visible, no network, no third parties, explicit exclusion of PHI. The two-stream separation (product data vs telemetry) should be formalized in the implementation.

---

## Sources

- [Anthropic Privacy Policy](https://anthropic.com/privacy) (January 2026)
- [Anthropic Consumer Terms](https://anthropic.com/legal/consumer-terms)
- [Anthropic Commercial Terms](https://anthropic.com/legal/commercial-terms)
- [Anthropic HIPAA Information](https://anthropic.com/legal/hipaa)
- [Anthropic Trust Center](https://trust.anthropic.com/)
- [Claude Enterprise Analytics Documentation](https://docs.anthropic.com/en/docs/about-claude/models)
- [September 2025 Training Data Policy Change Discussion](https://news.ycombinator.com/)
- [Claude Code Telemetry Source](https://github.com/anthropics/claude-code)
