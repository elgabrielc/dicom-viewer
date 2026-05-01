# Research: Todoist Analytics, Telemetry, and Instrumentation

**Date**: 2026-04-06
**Purpose**: Benchmarking for medical imaging desktop app instrumentation design
**Company**: Doist (remote-first, ~100 employees, est. 2007)
**Products**: Todoist (task management), Twist (async messaging)

---

## 1. What Usage Metrics Todoist Collects

### Automatically Collected (Privacy Policy)

From the Doist privacy policy (https://doist.com/privacy):

- **Device information**: device manufacturer, model, operating system, amount of free space on device
- **Network identifiers**: IP address, device ID
- **Interaction data**: pages or content viewed, referrer information, dates and times of visits, searches conducted
- **App usage information**: interactions with services, transaction records
- **GPS location**: only when using the location reminder feature (requires consent)

### Product Analytics (Bitmapist -- Internal Tool)

Doist built and open-sourced their own analytics library called **Bitmapist** (https://github.com/Doist/bitmapist) rather than paying for commercial tools. This is the core of their product analytics.

Events are tracked via a simple Python API:
```python
from bitmapist import mark_event
mark_event('active', user_id)
mark_event('song:played', user_id)
mark_event('task:complete', user_id)
```

Bitmapist tracks events at hourly, daily, weekly, and monthly granularity using Redis bitmaps. It supports:
- **User activity status**: "Has user 123 been active this week/month?"
- **Action counts**: "How many unique users performed action X this week?"
- **Retention cohorts**: "What percentage of last month's active users remain active this month?"
- **Cross-action correlation**: "Which users performed both action A and action B?"
- **Feature adoption**: After launching Todoist's board view, Doist could immediately see how many users tried it, how many kept using it, and how it impacted long-term engagement.

Bitmapist uses bitwise operations (AND, OR, XOR, NOT) on Redis bitmaps to combine event data:
```python
last_month = MonthEvents('active', last_month.year, last_month.month)
this_month = MonthEvents('active', now.year, now.month)
active_both_months = last_month & this_month
```

### User-Facing Productivity Metrics (Karma System)

Todoist tracks and surfaces these metrics back to users:
- **Tasks completed**: daily, weekly, monthly counts with color-coded project breakdown
- **Daily/weekly goal progress**: defaults to 5 tasks/day and 25 tasks/week (user-adjustable)
- **Streaks**: consecutive days/weeks meeting goals, plus longest streak achieved
- **Karma points**: accumulated score based on task completion patterns
- **7-day and 4-week task breakdowns**: visual summaries

### Engineering Performance Metrics (DORA)

From their engineering blog (https://doist.dev/posts/decoding-dora-metrics-at-doist):
- **Deployment frequency**: 18/day (as of Sept 2023)
- **Lead time for changes**: 101 hours (PR merge to production)
- **Change failure rate**: 5.53% (7-day rolling average)
- **Time to restore service**: 32 days
- Measured via Datadog with data collected from GitHub Actions CI/CD pipeline

### Sync API Metrics

The Sync API (https://developer.todoist.com/sync/v9/) returns:
- `stats`: user productivity stats with completion counts for today and this week
- `completed_info`: number of completed items within active projects, sections, or parent items
- Activity logs with pagination support

---

## 2. Opt-In / Opt-Out Approach

### Web (Cookie Consent)

Todoist implements **Google Consent Mode v2** on their web properties:
- **Default state**: `denied` for `ad_storage`, `analytics_storage`, and `ad_personalization`
- A cookie consent banner appears before non-essential tracking activates
- Users can select their cookie preference, which is remembered
- Essential/strictly necessary cookies cannot be opted out of
- All non-essential cookies expire after maximum 2 years

This is a **consent-required (opt-in) model** for analytics on the web, consistent with GDPR requirements. Analytics does not fire until the user affirmatively consents.

### Mobile App (Android)

The Exodus Privacy audit (https://reports.exodus-privacy.eu.org/en/reports/com.todoist/latest/) found **4 trackers** in Todoist v12080 (analyzed March 2026):
1. **Facebook Login** -- identification/authentication
2. **Facebook Share** -- social sharing
3. **Google Firebase Analytics** -- usage analytics and performance monitoring
4. **Sentry** -- crash reporting and error tracking

The app requests 23 permissions including location access, contact reading, and ad services tracking. The ad services permission includes Ad ID and attribution tracking.

There is no documented in-app toggle for disabling Firebase Analytics or Sentry crash reporting. The mobile app appears to use an **opt-out model** where analytics are on by default. Users can disable ad tracking at the OS level (Android Ad ID, iOS App Tracking Transparency).

### Productivity / Karma Tracking

Karma and productivity tracking are **on by default but fully user-controllable**:
- Users can toggle Karma on or off entirely
- Daily goals can be set to 0 to disable
- Vacation mode pauses all tracking without breaking streaks
- Specific days of the week can be excluded (e.g., weekends)
- Goal celebrations can be toggled off

---

## 3. Privacy Policy Specifics

**Policy URL**: https://doist.com/privacy

### Data Categories Collected

| Category | Specific Data | Collection Method |
|----------|---------------|-------------------|
| Account info | Name, email, profile photo, job title, password | User-provided at registration |
| Payment info | Billing address, transaction info, tax ID, VAT ID | User-provided for paid plans |
| User content | Projects, tasks, sections, reminders, channels, workspace folders | Created during normal use |
| Device info | Manufacturer, model, OS, free space, device ID | Automatically collected |
| Network info | IP address | Automatically collected |
| Usage data | Pages viewed, referrer info, visit dates/times, searches, interactions | Automatically collected |
| Location | GPS coordinates | Only with consent, for location reminders |
| Contact data | Address book | Only when user imports contacts |

### How Data Is Used

- Provide and maintain services
- Process payments
- Conduct analytics ("create anonymised and aggregated data regarding your App usage")
- Send newsletters and promotional communications
- Improve services (legitimate interest basis)

**Explicit restriction**: "We do not use information we collect from you, including via artificial intelligence tools, to develop, improve, or train generalized/non-personalized artificial intelligence or machine learning models."

### Retention Periods

- **General**: kept as long as necessary for stated purposes
- **After account deletion**: encrypted backup retained for 90 days
- **Google Analytics data**: 90 days
- **Session cookies**: deleted after session ends
- **Non-essential cookies**: maximum 2 years
- **Transaction records**: retained per legal requirements
- **Suspicious behavior data**: may be retained longer under legitimate interest

### Third-Party Data Sharing

| Service | Purpose | Location |
|---------|---------|----------|
| Amazon Web Services | Cloud storage | US |
| Microsoft Azure | Cloud storage | - |
| Google Cloud | Cloud storage | - |
| Google Analytics | Website analytics | US |
| Stripe | Payment processing | US |
| Zendesk | Customer support | US |
| SendGrid | Communications | US |
| Mailgun | Communications | US |
| MailChimp | Communications | US |
| Datadog | Performance monitoring | - |

Data is also shared with legal authorities when required by law.

### GDPR Compliance

- **Compliant since**: May 25, 2018
- **SOC2 Type 2**: Certified as of December 2025
- **Data controller/processor**: Controller for personal use; processor when user is part of an organization
- **Transfer mechanism**: Standard Contractual Clauses for cross-border transfers
- **User rights**: Access (via API at developer.todoist.com), erasure, objection, portability, correction, restriction
- **Data export**: Users can export via the API in structured, machine-readable format

### Third-Party Privacy Ratings

| Source | Score | Assessment |
|--------|-------|------------|
| PrivacySpy | 8/10 | Excellent data collection clarity (10/10), good third-party access control (8/10), poor law enforcement disclosure (0/5) |
| PrivacyDefend | 7.5/10 | "Good privacy with reasonable data practices" |

---

## 4. Analytics Stack

### Primary Analytics: Bitmapist (Custom, Open-Source)

**This is the most significant finding.** Doist does not use Mixpanel, Amplitude, or similar commercial product analytics platforms. They built their own.

**Origin story**: In 2012, Doist founder Amir Salihefendic evaluated Mixpanel's cohort/retention features and found they would cost over $2,000/month. He built Bitmapist instead.

**Architecture**:
- Python library using Redis bitmaps for event storage
- Each user action stored as a bit (0/1) in time-bucketed bitmaps
- Bitwise operations (AND, OR, XOR, NOT) combine events for complex queries
- Returns cohort data in milliseconds
- Stores billions of events across millions of users

**Performance evolution**:
- Originally used Redis for bitmap storage
- Later built a custom standalone `bitmapist-server` that eliminated Redis entirely
- Memory usage dropped from 130GB to 300MB (443x reduction)
- Same dataset, same query performance

**Cost savings**: "Saved $100,000+ USD" over the years compared to commercial alternatives (the real number is likely much higher given their scale).

**Who uses it**: Product, design, engineering, customer experience, and marketing teams all run cohort queries independently without needing a data team intermediary.

**Versions**: bitmapist (original) and bitmapist4 (next generation, also on GitHub)

### Web Analytics: Google Analytics

- Google Tag Manager (GTM-KW4J5DNZ) deployed on web properties
- Google Analytics with Consent Mode v2 (default denied)
- 90-day data retention
- Users can opt out via Google's browser plugin

### Performance Monitoring: Datadog

- Web performance and user experience monitoring
- Also used for DORA engineering metrics
- Data collected from GitHub Actions CI/CD pipeline
- Session-based cookie retention

### Crash Reporting: Sentry

- Error tracking and crash reporting in mobile apps
- Detected via static analysis in the Android APK
- Also mentioned in the DORA metrics context alongside Crashlytics

### Mobile Analytics: Google Firebase Analytics

- Usage analytics and performance monitoring on Android
- Bundled with the Android app (detected by Exodus Privacy audit)

### Request Monitoring: Request Metrics

- Detected in the HTML source of the help center pages
- Token: `b9qu7hg:f6jx5yg`
- Appears to be used for web performance monitoring

### Social/Auth SDKs

- Facebook Login SDK (authentication)
- Facebook Share SDK (social sharing)

### What They Do NOT Use

No evidence of: Amplitude, Segment, Heap, PostHog, Pendo, FullStory, Hotjar, or similar commercial product analytics platforms. Their custom Bitmapist solution fills that role.

### Data Team Structure

From their Senior Data Engineer job posting:
- Data infrastructure is owned by the **Platform Engineering team** (3 people)
- Platform team owns: databases, cloud infrastructure, developer tooling, data systems
- **Finance** owns company metrics and dashboards
- **Product** owns feature metrics and experiments
- The data engineer role builds pipelines, tools, and systems that "turn raw data into actionable insights"
- Focus on enabling self-serve analytics and democratizing data tools

---

## 5. User-Facing Usage Data

### Karma System

**Introduced**: 2013

**8-Level Progression**:

| Level | Points Required |
|-------|----------------|
| Beginner | 0 - 499 |
| Novice | 500 - 2,499 |
| Intermediate | 2,500 - 4,999 |
| Professional | 5,000 - 7,499 |
| Expert | 7,500 - 9,999 |
| Master | 10,000 - 19,999 |
| Grand Master | 20,000 - 49,999 |
| Enlightened | 50,000+ (unlocks mystery theme) |

**How points are earned**:
- Complete tasks on schedule
- Add new tasks
- Use advanced features (labels, recurring dates, reminders)
- Meet daily/weekly task goals (bonus points)
- Maintain streaks (multiplier effect)
- Difficulty scales: higher karma level = harder to earn points

**How points are lost**:
- Tasks that are 4+ days overdue trigger point deductions

**Reset**: Users cannot self-reset; contacting support reverts to default score of 50 points.

### Productivity View

- **Daily progress**: pie chart in account corner showing tasks completed vs. daily goal (default: 5)
- **Weekly progress**: tasks completed this week vs. weekly goal (default: 25)
- **7-day breakdown**: color-coded bars by project, with a gray line indicating the daily goal
- **4-week breakdown**: available in weekly tab
- **Streak tracking**: current streak + longest streak ever
- **Karma trend graph**: line graph of point accumulation over the past week
- **Total completed tasks**: all-time count

### User Controls

- Disable Karma entirely (toggle off)
- Set daily/weekly goals to 0 to disable
- Enable vacation mode (pauses tracking, preserves streaks)
- Exclude specific days (e.g., weekends)
- Toggle goal celebrations on/off

### Third-Party Analytics Integrations

Todoist's integration ecosystem includes:
- **Analytics for Todoist** (Protoolio): heatmaps, moving averages, project-specific time series, completion rates, daily averages
- **Task Analytics**: productivity scores combining task count, duration, and priority
- Third-party tools access data through the Todoist API

### Gamification Impact (Reported Data)

One source reported (citing Mixpanel data, reliability uncertain):
- Session duration increased by 22% with gamification enabled
- Churn reduced by 3.7% in freemium tiers
- However, Karma-enabled users had identical task completion rates (62.3% vs 62.1%)
- 12% more duplicate entries observed (possible "point farming" behavior)
- 0.8% higher task abandonment rate

---

## 6. Local vs. Server-Side Tracking

### Offline Architecture

Todoist is designed for full offline operation:
- **Native apps** (iOS, Android, macOS, Windows) cache the full project hierarchy, task list, labels, filters, and completed tasks locally
- **Web app** achieves offline mode through browser storage (IndexedDB/localStorage)
- Changes made offline are stored locally with timestamps
- No timeout or expiration on unsynced changes -- held indefinitely until reconnection

### Sync Protocol

The Sync API uses an incremental sync protocol:
1. **Initial sync**: `sync_token='*'` retrieves all active resource data
2. **Subsequent syncs**: token-based incremental updates (only changes since last sync)
3. **Conflict resolution**: timestamp-based (most recent change wins)
4. **Rate limits**: 1,000 partial syncs / 15 min; 100 full syncs / 15 min
5. **Idempotency**: UUID-based command deduplication prevents duplicate execution

### What Syncs

28+ resource types sync through the protocol:
- Core data: projects, items (tasks), sections, labels, filters, reminders, notes
- User data: settings, notification preferences, plan limits
- Collaboration: collaborators, workspaces, workspace users
- Analytics: stats (productivity stats), completed_info (completion counts)
- View state: view_options, project_view_option_defaults

### Centralized vs. Local Data

| Data Type | Storage | Sync Behavior |
|-----------|---------|---------------|
| Tasks, projects, labels | Cloud + local cache | Bidirectional incremental sync |
| Completed task history | Cloud + local cache | Synced via activity logs |
| Karma/productivity stats | Server-computed | Read-only from server via `stats` resource |
| User preferences | Cloud + local cache | Bidirectional sync |
| Offline changes | Local only until sync | Queued and replayed on reconnection |

The productivity/karma metrics are **computed server-side** and delivered to clients as read-only data. The client does not independently calculate karma or streaks -- it receives the authoritative values from the server during sync.

---

## Key Takeaways for Medical Imaging Desktop App

### What Todoist Does Well

1. **Built their own analytics** rather than depending on commercial platforms. Bitmapist gives them full control, zero vendor lock-in, and massive cost savings. The tradeoff is engineering investment, but for a company of their size it has paid off over 14 years.

2. **Privacy-conscious web analytics**: Google Consent Mode v2 with default `denied` state. Analytics only fires after explicit user consent. This is the GDPR-correct approach.

3. **User-visible value from tracked data**: The Karma system turns analytics data into a user feature. Users see their own productivity stats, which creates a virtuous cycle -- they generate data willingly because they get value from it.

4. **Granular user controls**: Karma can be fully disabled. Goals can be zeroed out. Vacation mode exists. Day-of-week exclusions exist. Users have meaningful control over what gets tracked and displayed.

5. **Clear separation of analytics domains**: Engineering metrics (DORA via Datadog), product analytics (Bitmapist), crash reporting (Sentry), and web analytics (Google Analytics) are distinct systems with distinct purposes.

### Applicable Patterns for Medical Imaging

1. **Consent-first mobile/desktop analytics**: The web approach (consent-required) is stricter than the mobile approach (on by default with OS-level opt-out). For a medical imaging app, the stricter model is appropriate -- opt-in for all non-essential telemetry.

2. **Crash reporting as a separate concern**: Sentry for crashes is distinct from product analytics. Medical imaging apps should treat crash/error telemetry differently from usage analytics -- crashes may need to be reported without consent for safety reasons (analogous to medical device adverse event reporting), while usage analytics should always require consent.

3. **Server-computed aggregate stats**: Karma is computed server-side and delivered read-only. For a local-first medical imaging app, this pattern inverts -- compute stats locally, optionally sync anonymized aggregates to the server.

4. **Incremental sync with conflict resolution**: The sync_token mechanism is elegant for offline-first apps. Timestamps for conflict resolution is simple and works.

5. **Self-serve analytics for the team**: Bitmapist's design lets every team member run their own queries. For a small company, this eliminates the data team bottleneck.

---

## Sources

- [Doist Privacy Policy](https://doist.com/privacy)
- [Todoist Security, Privacy, and Compliance](https://www.todoist.com/help/articles/todoist-security-privacy-and-compliance-mqmhua06)
- [Bitmapist -- Doist Engineering](https://www.doist.dev/bitmapist/)
- [Bitmapist GitHub Repository](https://github.com/Doist/bitmapist)
- [Bitmapist: Analytics and Cohorts for Redis (Amir Salihefendic, Medium)](https://medium.com/hacking-and-gonzo/bitmapist-analytics-and-cohorts-for-redis-44be43458ef6)
- [Bitmapist4 GitHub Repository](https://github.com/Doist/bitmapist4)
- [Decoding DORA Metrics at Doist](https://doist.dev/posts/decoding-dora-metrics-at-doist)
- [Use the Productivity View in Todoist](https://www.todoist.com/help/articles/use-the-productivity-view-in-todoist-6S63uAa9)
- [Introduction to Karma](https://www.todoist.com/help/articles/introduction-to-karma-OgWkWy)
- [Turn On or Off Vacation Mode in Todoist](https://www.todoist.com/help/articles/turn-on-or-off-vacation-mode-in-todoist-pAQmRp)
- [Todoist Karma Page](https://www.todoist.com/karma)
- [Todoist Sync API v9 Reference](https://developer.todoist.com/sync/v9/)
- [Todoist Exodus Privacy Report](https://reports.exodus-privacy.eu.org/en/reports/com.todoist/latest/)
- [PrivacySpy: Todoist](https://privacyspy.org/product/todoist/)
- [PrivacyDefend: Is Todoist Safe?](https://privacydefend.com/pages/is-todoist-safe/)
- [Todoist Gamification Case Study (Trophy)](https://trophy.so/blog/todoist-gamification-case-study)
- [Analytics for Todoist Integration](https://www.todoist.com/integrations/apps/analytics-for-todoist)
- [Doist Senior Data Engineer Job Posting](https://doist.com/careers/0F8554BCBE-senior-data-engineer)
- [Doist Engineering Blog](https://www.doist.dev/)
