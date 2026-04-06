# Research: Todoist Analytics & Instrumentation Benchmarking

## Summary

Todoist (by Doist) takes a notably independent approach to analytics. Instead of using commercial analytics platforms, they built their own open-source tool (Bitmapist) in 2012. Their web analytics are consent-first (default denied), while mobile bundles standard trackers. Their Karma system is a standout example of surfacing usage data back to users as a feature. Key takeaway for a local-first app: compute stats locally, show them to the user, optionally sync anonymized aggregates later.

---

## 1. What Usage Metrics Does Todoist Collect?

### Product Analytics (via Bitmapist)
- Feature adoption and usage frequency
- Cohort analysis (new user behavior over time)
- Retention tracking (daily/weekly/monthly active users)
- Task completion patterns (used for Karma calculations)
- Streak data (consecutive days meeting daily goals)

### Performance & Error Metrics
- **Datadog**: Application performance monitoring, DORA engineering metrics
- **Sentry**: Crash reporting and error tracking (web + mobile)
- **Crashlytics**: Mobile-specific crash reporting (via Firebase)
- **Request Metrics**: Web performance monitoring

### Web Analytics
- **Google Analytics**: With Consent Mode v2, defaulting to `denied`
- Page views, referral sources, basic engagement (only with consent)

### What They Likely Track (inferred from product features)
- Tasks created, completed, rescheduled, overdue
- Feature usage: labels, filters, priorities, comments, sections, boards
- Platform/device (for cross-platform sync and priority)
- Session frequency (needed for DAU/MAU and retention)

---

## 2. Opt-In / Opt-Out Approach

### Web: Consent-First (Opt-In)
- Google Consent Mode v2 with `analytics_storage` defaulting to `denied`
- Users must explicitly grant consent before analytics cookies are set
- This is more conservative than most apps, which default to granted

### Mobile: Effectively Opt-Out
- Firebase Analytics and Sentry are bundled in the Android APK
- Exodus Privacy audit found 4 trackers: Google Firebase Analytics, Google CrashLytics, Google Play Install Referrer, Sentry
- No documented in-app toggle for analytics
- Standard mobile pattern -- most apps do this

### User-Facing Data: Fully Controllable
- Karma system can be disabled entirely
- Daily/weekly goals can be set to 0
- Vacation mode pauses streak tracking
- Specific days can be excluded from goals

### GDPR Compliance
- GDPR compliant since May 2018
- SOC2 Type 2 certified (December 2025)
- Data Processing Agreements available for business users
- Right to deletion honored with 90-day backup retention window

---

## 3. Privacy Policy Specifics

### PrivacySpy Score: 8/10
- Perfect marks for data collection clarity
- Points lost for data retention policy specifics

### Categories of Data Collected
1. **Account data**: Name, email, password hash, avatar
2. **Content data**: Tasks, projects, comments, attachments
3. **Usage data**: Feature interactions, performance metrics
4. **Device data**: OS, browser, device type, IP address
5. **Payment data**: Via Stripe (Todoist does not store card numbers)

### How Data Is Used
- Product improvement and feature development
- Customer support
- Security and fraud prevention
- Aggregated analytics (no individual profiling for ads)
- **Explicit policy: customer data is NOT used to train AI models**

### Third-Party Data Sharing
- Infrastructure: AWS, Google Cloud, Microsoft Azure
- Payments: Stripe
- Support: Zendesk
- Email: SendGrid
- No data sold to advertisers or data brokers

### Retention
- Active accounts: data retained while account exists
- Deleted accounts: removed from production, 90-day backup retention
- Logs and analytics: industry-standard retention periods (not specified precisely)

---

## 4. Analytics Stack

### The Bitmapist Story

Doist built **Bitmapist** in 2012 (open-source: github.com/Doist/bitmapist) because Mixpanel would have cost $2,000+/month at their scale. It uses Redis bitmaps for compact event storage.

**How it works:**
- Each event type gets a Redis bitmap per time period (day/week/month)
- User ID maps to bit position; bit set = event occurred
- Boolean operations across bitmaps enable cohort analysis
- Example: "users who signed up in March AND completed a task in April AND are still active in May"

**Scale achievements:**
- Custom `bitmapist-server` (Go) reduced memory from 130GB Redis to 300MB (443x reduction)
- Every team at Doist runs their own cohort queries without needing a data team
- Estimated savings: $100K+ per year vs commercial analytics

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

---

## 5. User-Facing Usage Data

### Karma System (Gamification)

8-level progression system:

| Level | Points Required |
|-------|----------------|
| Beginner | 0 |
| Novice | 1 |
| Intermediate | 500 |
| Professional | 2,000 |
| Expert | 5,000 |
| Master | 10,000 |
| Grand Master | 20,000 |
| Enlightened | 50,000 |

**Points earned for:**
- Completing a task: +1
- Completing a recurring task: +1
- Using advanced features (labels, reminders, etc.)
- Reaching daily goal: bonus
- Reaching weekly goal: bonus
- Maintaining streaks: multiplier

**Points lost for:**
- Tasks overdue by 4+ days: -1 per task per day

### Productivity Visualizations
- **Daily goal**: Configurable target (default: 5 tasks/day)
- **Weekly goal**: Configurable target (default: 25 tasks/week)
- **Streak counter**: Consecutive days/weeks meeting goals
- **7-day bar chart**: Tasks completed per day, color-coded by project
- **4-week trend**: Weekly completion history
- **Vacation mode**: Pause streak tracking without penalty
- **Day exclusions**: Skip specific weekdays from goals

### Key Design Insight
Karma turns analytics into a feature. Users willingly generate usage data because they get value back (motivation, progress tracking, gamification). This is the opposite of surveillance-model analytics.

---

## 6. Local vs Server-Side

### Offline Support
- Full offline capability with local SQLite database
- Changes queued locally with indefinite retention
- Sync on reconnection via incremental token-based protocol

### Sync Protocol
- 28+ resource types synced (tasks, projects, labels, filters, etc.)
- Token-based incremental sync (only changes since last sync)
- Timestamp-based conflict resolution
- Real-time updates via WebSocket when online

### What's Computed Where
| Data | Location | Rationale |
|------|----------|-----------|
| Task CRUD | Local first, sync to server | Offline support |
| Karma score | Server-side | Consistency across devices |
| Productivity stats | Server-side | Cross-device aggregation |
| Daily/weekly goals | Server-side (config synced) | Consistency |
| Streak tracking | Server-side | Can't trust client clocks |

### Key Insight for Local-First Apps
Todoist computes stats server-side because they have accounts and multi-device sync. For a local-first app without accounts, the pattern should be inverted:
- Compute all stats locally
- Store in app-data (SQLite or JSON)
- Surface in the app as a user-visible feature
- Future: optional anonymous aggregate sync with explicit consent

---

## Applicability to Medical Imaging App

### Patterns to Adopt
1. **Stats as a feature, not surveillance** -- like Karma, show users their own viewing stats (studies reviewed, time spent, modalities used)
2. **Consent-first for anything that leaves the machine** -- follow the web model (default denied), not the mobile model
3. **Separate crash reporting from usage analytics** -- different consent requirements, different tools
4. **Local-first computation** -- invert Todoist's server model; compute everything locally
5. **Custom over commercial** -- for a small app, a simple JSON counter is better than Mixpanel SDK overhead

### Patterns to Skip
1. **Gamification** -- Karma makes sense for a productivity app, less so for medical imaging
2. **Redis bitmaps** -- overkill for single-user local app; simple counters suffice
3. **28-resource sync protocol** -- no multi-device sync needed yet
4. **Firebase/Google Analytics** -- unnecessary third-party dependency for a local app

### Suggested Minimum Viable Instrumentation
- Session count + duration (stored locally)
- Feature usage counters (viewer, library, measurements, notes)
- Modality breakdown (CT/MR/other)
- Error/decode failure counts
- All stored as a JSON blob in app-data
- Surfaced in a "Usage Stats" panel the user can view
- No network calls, no third parties, no consent needed
