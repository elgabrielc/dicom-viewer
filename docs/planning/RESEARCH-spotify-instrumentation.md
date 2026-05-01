# Research: Spotify Analytics & Instrumentation Benchmarking

Copyright 2026 Divergent Health Technologies

## Context

Benchmarking research for myradone, a local-first desktop medical imaging application.
Spotify is the gold standard for user-facing analytics. The core insight we need: how
does Wrapped turn surveillance into a beloved feature?

Previous benchmarks: Todoist (cloud-first, Bitmapist, Karma stats), Sublime Text
(local-first, near-zero telemetry), Claude/Anthropic (two-stream architecture,
admin-only dashboards).

---

## 1. What Does Spotify Track?

### Event Taxonomy: 1,800+ Event Types

Spotify collects **over 1,800 distinct event types** representing user interactions
across all platforms. Each event type has a defined name, Avro schema, and metadata
annotations. The system processes **more than 1 trillion events per day** (up from
500 billion/day in 2021 and 100 billion/day in 2017).

In storage terms: **70 TB compressed / 350 TB uncompressed per day**.

#### Key Event Types (Known)

| Event | Trigger | Purpose |
|-------|---------|---------|
| **EndSong** | User finishes listening to a track | Royalty payments, DAU/MAU calculation, listening history |
| **UserCreate** | New account created | Account lifecycle |
| **PageView** | User views a page/screen | Navigation analytics, shared across teams |
| **UIInteraction** | User taps/clicks UI element | Feature engagement |
| **SearchQuery** | User searches | Search quality, recommendation input |
| **PlaybackSegments** | During playback | Granular playback position tracking |
| **PlaybackInitiated** | Playback starts on device | Cross-device tracking |
| **PlaybackError** | Playback fails | Reliability monitoring |
| **AppFocusState** | App gains/loses focus | Session analytics |
| **ColdStartupSequence** | App cold starts | Performance monitoring |
| **ConnectionError** | Network failure | Reliability |
| **CacheReport** | Cache state snapshot | Storage analytics |
| **AudioSessionEvent** | Audio session lifecycle | Playback quality |
| **AddToPlaylist** | User adds track to playlist | Engagement |
| **LanguageSelection** | User changes language | Localization |
| **A11yFeatureUsage** | Accessibility feature used | Accessibility telemetry |

#### EndSong Event Fields (from GDPR export)

The EndSong event (exported as `Ap_EndSong.json`) contains:

- `endTime` -- UTC timestamp when playback ended
- `msPlayed` -- milliseconds played
- `trackName`, `artistName`, `albumName` -- content identifiers
- `trackUri`, `albumUri` -- Spotify URIs
- `platform` -- device platform (iOS, Android, Windows, macOS, Web)
- `reasonStart` -- why playback started (e.g., trackdone, fwdbtn, clickrow)
- `reasonEnd` -- why playback ended (e.g., trackdone, fwdbtn, endplay, logout)
- `shuffle` -- boolean, shuffle mode active
- `skipped` -- boolean, was the track skipped
- `offline` -- boolean, was this offline playback
- `offlineTimestamp` -- when the offline event was queued
- `incognitoMode` -- boolean, private session
- `ipAddress` -- masked IP
- `country` -- country code
- `userAgent` -- client identifier

#### What Gets Tracked Per Session

- Every play event with millisecond-precision duration
- Skip behavior (what was skipped, when, after how many ms)
- Search queries (with 90-day retention in export)
- Navigation path (page views, UI interactions)
- Device details (OS, model, screen size, CPU, RAM, audio driver)
- Network state (connection type, errors)
- Offline playback with queued timestamps
- Authentication events (login success/failure, device ID)

#### Inference Data

Spotify builds user segments from behavioral data. GDPR exports reveal
`Inferences.json` containing categories like:
- `1P_Custom_Samsung_Galaxy_S10_Users` (device segmentation)
- `1P_Podcast Listeners_True Crime` (content preference)
- Market segments for ad targeting

### Schema Management

Event schemas use **Apache Avro** with backwards-compatible evolution. Schema fields
are annotated with **semantic data types** that determine:
- Whether a field contains personal data
- What anonymization pipeline to apply
- Access control policies

When a team defines a new event schema, infrastructure automatically deploys:
- A dedicated Pub/Sub topic
- Anonymization pipelines
- Streaming jobs for routing
- ETL processes with hourly partitioning

Teams can instrument new events **without depending on the central platform team**.

---

## 2. How Spotify Surfaces Data Back to Users

This is Spotify's defining innovation: turning analytics into a product feature.

### 2a. Spotify Wrapped

#### History and Evolution

| Year | Name | Key Changes |
|------|------|-------------|
| 2015 | "Year in Music" | Predecessor. Top 100 songs of the year. Basic. |
| 2016 | Wrapped | Renamed. Top 5 artists and songs. Still a website, not in-app. |
| 2017 | Wrapped | Added top genre, top 5 artists, total minutes listened. Foundations of the familiar format. |
| 2018 | Wrapped | Added astrological sign of top artists, oldest song listened to. **Key change: shareable card format designed for social media.** This is when it went viral. |
| 2019 | Wrapped | **Built into the Spotify app as Instagram-style stories.** 1.2M+ Twitter posts. Created "FOMO effect" driving competitor users to switch. |
| 2020 | Wrapped | Added podcast metrics, quizzes, personalized playlists. Digital badges for Premium. TikTok/Snapchat/Instagram integration. Won multiple Webby Awards. |
| 2021 | Wrapped | Internet slang, pop culture references. Generated memes. Major media coverage of privacy implications. |
| 2022-2024 | Wrapped | Continued iteration. Earlier November/December release. |
| 2025 | Wrapped | **LLM-generated personalized narratives.** 1.4B reports for 350M users. "Wrapped Archive" with remarkable day stories. Launched companion feature "Listening Stats" for year-round weekly/monthly recaps. |

#### Data Categories in Wrapped

- Top artists (with play counts)
- Top tracks (with play counts)
- Top genres
- Top podcasts
- Total listening minutes
- Unique artists count
- Listening dates and patterns
- Worldwide listener percentages ("You were in the top X% of listeners for this artist")
- Time-of-day patterns
- Story data (personalized narrative elements)

#### What Made It Go Viral (The 2018 Inflection Point)

Before 2018, Wrapped was a web page you visited. The critical change was designing
**shareable card graphics optimized for Instagram Stories and Twitter**. This turned
private data into social currency. Users didn't just view their data -- they
*performed* it publicly.

The 2019 move to in-app stories completed the transformation. The FOMO effect meant
non-Spotify users felt left out, driving acquisition.

#### Data Collection Period

Wrapped collects from **January 1 to October 31** each year. November-December
listening is excluded to allow time for pipeline processing and pre-computation.

#### Technical Architecture (2025)

**Pre-computation pipeline:**
1. Distributed data pipeline computes candidate "remarkable days" at user level
2. Priority-ordered heuristics surface notable moments: biggest music day, biggest
   podcast day, most discovery, most nostalgic day, most unusual listening day
3. Remarkable days and listening history stored to object storage
4. Data published to pub/sub queue for asynchronous report generation

**LLM report generation (new in 2025):**
1. Frontier model distilled into smaller production model via knowledge transfer
2. Direct Preference Optimization (DPO) powered by A/B-tested human evaluations
3. Two-layer prompting: system prompt (data-driven storytelling rules) + user prompt
   (listening logs, pre-computed stats blocks, day category, prior reports for
   consistency, user country for localization)
4. Stats pre-computed and injected into prompts because "LLMs are bad at math"
5. Generation ran for **4 continuous days** at thousands of requests/second
6. 1.4 billion reports generated for 350 million eligible users

**Quality assurance:**
- Evaluated ~165,000 random reports using larger models as judges
- Four dimensions: accuracy, safety, tone, formatting
- Discovered timezone bug causing incorrect artist counts in "Biggest Discovery Day"
- Structured logging enabled identifying, quantifying, fixing, and bulk-deleting
  affected reports

**Launch infrastructure:**
- Compute pods and database capacity pre-scaled hours before launch
- Model-provider capacity pre-coordinated
- Synthetic load testing across all geographic regions warmed connection pools and
  caches
- "Wrapped doesn't ramp, it spikes. Reactive scaling simply doesn't move fast enough."

**Storage:**
- Column-oriented key-value database
- Each remarkable day gets its own column qualifier within a dedicated column family
- Date (YYYYMMDD) as qualifier
- Eliminates race conditions without locks or coordination

### 2b. Listening Stats (Year-Round Feature, launched November 2025)

Complements the annual Wrapped with **weekly and monthly** recaps:
- Top artists for the week/month
- Top songs for the week/month
- Listening milestones
- Revisitable up to 4 weeks back
- Shareable on Instagram, WhatsApp, and other platforms
- Available to both free and premium users

This is significant: Spotify recognized that annual-only data surfacing wasn't
enough and moved to continuous, lightweight stats.

### 2c. Other Personalization Features

**Recently Played / Top Artists / Top Songs:**
- Available via the Spotify API (`/me/top/artists`, `/me/top/tracks`)
- Time ranges: short_term (4 weeks), medium_term (6 months), long_term (all time)
- Powers third-party apps like stats.fm, receiptify, etc.

**Only You (launched June 2021):**
- In-app experience similar to a mini-Wrapped
- "Audio Birth Chart" -- top artists mapped to astrology
- "Dream Dinner Party" -- pick 3 artists, get a personalized mix
- "Artist Pairs" -- unique genre combinations showing your range
- "Time of Day" -- what you listen to at different times
- Shareable cards for social media

**Blend (launched August 2021):**
- Two (later up to 10) users merge listening tastes into a shared playlist
- Updated daily based on streaming behavior
- Taste match scores comparing listening preferences
- Shareable data stories unique to each pair
- Cover art generated per Blend

**Daylist (launched 2023):**
- Playlists that change throughout the day based on time-of-day patterns
- Quirky genre labels generated from listening mood analysis
- Updates multiple times per day
- Genre/mood descriptors became a social media phenomenon

**Discover Weekly / Daily Mix / Release Radar:**
- Algorithmic playlists powered by the same event data
- Collaborative filtering + content-based filtering + NLP on lyrics
- Audio feature analysis: instrumentalness, danceability, energy, valence
- Exploitative recommendations (what you already like) balanced with explorative
  (expanding your taste)

### 2d. The Psychology: Why Users Love Seeing Their Own Data

This is the most important finding for myradone.

**Identity expression.** Wrapped functions as a digital identity card. Music taste
is deeply personal and socially meaningful. Sharing your Wrapped is sharing who you
are. Users treat listening stats "like trading cards" -- it's addicting and thrilling
to have a platform tell you information about yourself.

**Social currency.** The shareable format transforms private data into social content.
Millions of people promote Spotify on their social media accounts without being paid.
The data becomes a conversation starter, not a privacy violation.

**Self-reflection.** People enjoy seeing themselves reflected back. The annual ritual
creates a moment of introspection. "Instead of feeling under surveillance, users feel
seen." The data tells a story about your year that you didn't know you were living.

**Anticipation and ritual.** As an annual event with a known December release,
Wrapped creates anticipation. This scheduled, expected data exposure feels more
acceptable than constant monitoring.

**Gamification.** Top percentiles ("You were in the top 0.5% of listeners"),
listening minutes, discovery counts -- these create competitive, shareable metrics.
Rankings and achievements trigger the same satisfaction as game leaderboards.

**Generational normalization.** Digital natives raised on social media see data
sharing as a form of connection, not surveillance. Older generations find it less
entertaining; younger users find it "thrilling."

**The FOMO effect.** When everyone is posting their Wrapped, non-users feel excluded.
This drives both engagement (existing users) and acquisition (new signups).

**Reframing the value exchange.** Spotify collects enormous amounts of data. But by
giving a curated, entertaining view back, it reframes the exchange: "We collect your
data, but look at this delightful thing we made with it." The data collection feels
like it serves the user, not just the company. This is the core design pattern
myradone should study.

---

## 3. Privacy Policy and GDPR

### What the Privacy Policy Says

Spotify (headquartered in Stockholm, Sweden) collects:

**User Data** (at signup):
- Profile name, email, password, phone, date of birth, gender, address, country
- University/college (student verification)
- Age verification from third-party providers

**Usage Data** (during use):
- Streaming history, search queries, playlists, browsing activity
- Device IDs, network type, IP address, cookies, browser, OS, app version
- Inferences about age, interests, preferences
- General location (country/region from IP or payment currency)
- GPS position (if enabled), phone contacts, media files (if granted)

**Optional Data**:
- Voice recordings and transcripts (voice features)
- Direct messages between users
- Payment data (card type, expiry, ZIP -- never full card numbers)
- Facial photos for age verification (deleted immediately after)

**Data Usage:**
- Personalization and recommendations
- ML model training (AI DJ, AI playlists)
- A/B testing ("understand how users react to a particular new feature")
- Advertising (interest-based, excluded for users under 18)
- Fraud detection, legal compliance, business analytics

**Third-Party Sharing:**
- Advertising partners: identifiers, commercial info, browsing activity, age, gender,
  geolocation
- Payment partners: transaction data
- Podcast hosting platforms: IP address, usage data
- Academic researchers: pseudonymized data
- Law enforcement: any category when legally required
- Rightsholders: aggregated, pseudonymized listening data per licensing agreements

**Data Retention:**
- Search queries: ~90 days
- Streaming history: account lifetime (for recommendations)
- Age check data: deleted immediately after verification
- Post-account closure: limited retention for legal/fraud obligations

### GDPR Data Export Contents

Spotify offers three export packages:

**1. Account Data Package (available quickly)**

| File | Contents |
|------|----------|
| `Userdata.json` | Username, email, country, birthdate, gender, postal code, creation date, Facebook link |
| `StreamingHistory0.json` | Past 12 months: endTime, artistName, trackName, msPlayed |
| `YourLibrary.json` | Liked/disliked songs, saved podcasts, followed artists |
| `SearchQueries.json` | Last 3 months: platform, searchTime, searchQuery, interactionURIs |
| `Playlist1.json` | Playlist name, modified date, description, followers, tracks (name/artist/album) |
| `Follow.json` | Followers, following, blocked accounts |
| `Payments.json` | Account creation date, payment method details |
| `Inferences.json` | Ad targeting segments (e.g., "True Crime podcast listener") |
| `DuoNewFamily.json` | Family plan address info |

**2. Extended Streaming History (takes up to 30 days)**

Lifetime streaming records with full detail:
- `endTime`, `username`, `platform`, `msPlayed`, `country`, `ipAddress`, `userAgent`
- `trackName`, `artistName`, `albumName`, `trackUri`
- `episodeName`, `showName` (podcasts)
- `reasonStart`, `reasonEnd` (why playback began/ended)
- `shuffle`, `skipped`, `offline`, `offlineTimestamp`, `incognitoMode`

**3. Technical Log Information (takes up to 30 days)**

111 JSON files including:
- `AndroidDeviceReport.json` -- CPU, firmware, manufacturer, model, OS, RAM, screen
- `DesktopUpdateResponse.json` -- OS, device model (Windows)
- `ApAuthenticationSuccess.json` -- device ID, full IP, platform, language, client ID
- `Ap_PageView.json`, `Ap_UIInteraction.json`, `Ap_Interaction.json` -- navigation
- `AudioSettingsReport.json`, `AudioDriverInfo.json` -- audio config
- `ColdStartupSequence.json` -- app launch performance
- `AppFocusState.json` -- foreground/background state
- `RequestFailure.json`, `ConnectionError.json` -- error telemetry
- `PushAndroidDeviceSettingsV1.json` -- notification config

Data retention varies: Android data ~6 months, Windows data ~1-2 months, search
queries ~3 months.

One user's GDPR export was reportedly **250 MB** containing every interaction.

---

## 4. Data Infrastructure

### GCP Migration

Spotify committed **$450 million over 3 years** to Google Cloud Platform starting in
2016. By May 2017 traffic was fully routed to GCP. All four on-premise data centers
were retired by 2018.

**Before GCP:** Hadoop, MapReduce, Hive, home-grown dashboarding, Kafka, scp-based
file transfers, centralized Hadoop cluster.

**After GCP:** Cloud Pub/Sub, Cloud Dataflow, BigQuery, Cloud Dataproc, Compute
Engine, CloudSQL, GCS, Kubernetes.

### Current Architecture

```
Client Apps (mobile, desktop, web, backend services)
    |
    v
Event Service (validates, parses, rejects malformed)
    |
    v
Cloud Pub/Sub (1 topic per event type, 1,800+ topics)
    |
    +---> Anonymization pipelines (encrypt PII based on schema annotations)
    |
    +---> ETL clusters (1 per event type, hourly partitions)
    |
    +---> Streaming jobs (real-time routing)
    |
    v
Storage: GCS (object storage) + BigQuery (warehouse)
    |
    v
38,000+ scheduled data pipelines (Scio/Beam on Dataflow/Dataproc)
    |
    v
Downstream: Recommendations, Wrapped, A/B testing, royalty payments, dashboards
```

### Scale Numbers

| Metric | Value |
|--------|-------|
| Events per day | 1+ trillion |
| Events per second (peak) | 8 million |
| Event types | 1,800+ |
| Raw data per day | 70 TB compressed / 350 TB uncompressed |
| Active data pipelines | 38,000+ |
| Pipeline repositories | 1,000+ |
| Pipeline-owning teams | 300+ |
| Daily job executions | 20,000+ |
| Total stored data | 100+ PB |
| VMs for event delivery | ~2,500 |
| Platform engineers | 100+ |
| Online services migrated | 1,200 |

### Event Delivery Infrastructure (EDI)

~15 different microservices deployed on ~2,500 VMs across Regional Managed Instance
Groups.

**Event priority SLOs:**
- **High priority**: few-hours SLO (royalty events, DAU/MAU metrics)
- **Normal priority**: 24-hour SLO (next-day analytics)
- **Low priority**: 72-hour SLO (internal/research use)

**Liveness over lateness:** If one event type's hourly partition isn't ready,
others aren't blocked. Each event type has its own ETL process and storage location.

### Luigi, Flyte, and Backstage

**Luigi** (open-sourced by Spotify): Python workflow scheduler for batch data
pipelines. Handles dependency resolution, visualization, Hadoop integration. Used
internally for thousands of daily tasks. Being migrated to **Flyte** because:
- Luigi + Flo (Java equivalent) meant maintaining two identical systems
- Pipeline containers were "black boxes" -- no visibility into task dependencies
- Couldn't roll out fixes across 1,000+ repositories easily

**Flyte**: Open-source replacement. Treats tasks as first-class reusable objects.
Backend-side orchestration provides visibility. Multi-language support.

**Backstage** (open-sourced by Spotify): Internal developer portal. One frontend for
all infrastructure. Used by 280+ teams to manage:
- 2,000+ backend services
- 300+ websites
- 4,000+ data pipelines
- 200+ mobile features

Integrates workflow tools: scheduler, log inspector, data lineage graph, configurable
alerts.

### A/B Testing Platform

Spotify has been running experiments for 10+ years. **300+ teams** run **tens of
thousands of experiments annually**.

**Platform evolution:**
1. **ABBA (2013)**: First A/B testing system. Logged events that consumed ~25% of
   total event volume. Required manual notebook analysis.
2. **Experimentation Platform (EP)**: Added Metrics Catalog (self-service analysis)
   and coordination engine for mutually exclusive experiments.
3. **Confidence (2023)**: Current platform. Open-sourced. Company-wide experimentation
   at scale. Feature flags, rollouts, holdback groups.

**Technical details:**
- Properties defined in YAML, published via API during builds
- PlanOut scripts for user assignment, evaluated server-side
- Two exposure events: Config Assigned + Config Applied
- Automated coordination prevents experiment interference
- Sub-second query latency on metrics catalog

---

## 5. Wrapped Technical Deep-Dive

### Pre-Computation Pipeline

Wrapped is **not real-time**. It is the largest Dataflow job Spotify runs each year.

1. Data collection: January 1 -- October 31
2. Pipeline computes candidate days and aggregates per user
3. Heuristics rank hundreds of millions of listening events down to 5 standout
   days per user
4. Results stored to object storage
5. Published to messaging queue for async report generation
6. Reports pre-generated before launch day

### 2025 LLM Architecture

Knowledge distillation: frontier model --> smaller production model via DPO.
Generation ran continuously for 4 days at thousands of requests/second. 1.4 billion
reports for 350 million users (average 4 reports per user).

**Prompt structure:**
- System prompt: data-driven storytelling constraints
- User prompt: listening logs, pre-computed stats, day category, previous reports
  (for consistency), user country (localization)

**Quality:** 165,000 reports evaluated by larger models across accuracy, safety,
tone, formatting.

### Launch Day Infrastructure

"Wrapped doesn't ramp, it spikes."

- Pre-scale compute pods and database hours before launch
- Coordinate with model-provider on capacity
- Synthetic load testing across all regions
- Warm connection pools, caches, tablet assignments
- Real-time monitoring dashboards during rollout

### Known Challenges

- **December 2025 outage**: Major outage on December 15 (12 days after Wrapped
  launch). 27,000+ DownDetector reports. Users locked out of accounts. 80% reported
  app issues. Fixed within hours.
- **Timezone bug in 2025**: Upstream pipeline timezone issues caused incorrect artist
  counts in "Biggest Discovery Day" reports. Discovered via structured logging,
  affected reports bulk-deleted and regenerated.
- **Server overload at launch**: Servers become overloaded when "everyone tries to
  access it at once" -- common pattern with 300M+ users across 170+ markets.

---

## 6. Desktop App Specifics

### Framework

Spotify desktop uses **Chromium Embedded Framework (CEF)**, not Electron. CEF uses
C++ on the non-UI side for desktop integration, whereas Electron ships a full Node.js
runtime. Spotify has used CEF since 2011.

The UI was rewritten in **TypeScript + React** during modernization. One shared
codebase now serves both Web Player and Desktop.

### Architecture

```
React UI (TypeScript)
    |
    v
TypeScript Platform APIs (abstraction layer)
    |
    +---> GraphQL / Web API (cloud data)
    |
    +---> Native Desktop APIs (C++, performance-critical)
    |
    v
CEF Container (Chromium rendering + native integration)
```

The Platform APIs are exposed via React Hooks. The UI "can run on the web, and it can
run in our Desktop container, and never know, or care, if the data is coming from our
C++ stack or our web infrastructure."

### Desktop-Specific Features

- Downloading and offline playback
- Local file support
- Lyrics
- Now Playing queue
- Advanced sorting/filtering

### Telemetry

Known tracking endpoints:
- `spclient.wg.spotify.com/analytics`
- `log.spotify.com/log`

Desktop telemetry includes (from GDPR export):
- `DesktopUpdateResponse.json` -- OS version, device model
- `ColdStartupSequence.json` -- app launch performance
- `AudioDriverInfo.json` -- audio configuration
- `CacheReport.json` -- local cache state

### Offline Event Queuing

The extended streaming history export reveals the mechanism:
- `offline` field: boolean indicating offline playback
- `offlineTimestamp` field: when the event was originally generated
- Events are queued locally and transmitted when connectivity returns
- The `endTime` field in the export reflects server receipt time, while
  `offlineTimestamp` reflects actual playback time

---

## 7. Lessons for myradone

### The Core Insight: Data as Gift, Not Extraction

Spotify proved that extensive data collection becomes a **beloved feature** when:

1. **You give it back in a delightful format.** Raw data is boring. Curated stories
   about your behavior are fascinating. The user should think "oh, that's interesting
   about me" -- not "oh, they know that about me."

2. **You make it shareable.** When users voluntarily post screenshots of their data,
   they become evangelists. The sharing act normalizes the data collection.

3. **You create ritual and anticipation.** Annual (or weekly) scheduled releases
   create events that users look forward to, not dread.

4. **You make it identity-affirming.** People want to see themselves reflected back.
   "Top 0.5% listener" is a badge of honor, not a surveillance metric.

5. **You stay in the user's domain.** Music taste is personal but not sensitive in
   the way health data is. myradone must be much more careful here.

### Design Patterns to Adopt

**Tiered data surfacing:**
- Real-time: recently viewed studies, current session metrics
- Weekly: "Your Week in Imaging" -- studies reviewed, time spent, modalities explored
- Monthly: trends, comparison to previous months
- Annual: "Your Year in myradone" -- total studies, most-used features, peak days

**Local-first computation:**
- Unlike Spotify's cloud pipeline, myradone should compute all stats locally
- No data leaves the device unless the user explicitly shares
- This is actually a privacy advantage over Spotify

**Shareable moments (carefully):**
- "I reviewed 847 studies this year" is shareable and non-sensitive
- Modality distribution, tool usage patterns -- safe to share
- Never include patient data, study content, or clinical details in shareable stats

**Progressive disclosure:**
- Show simple stats by default (session count, time spent)
- Let power users drill into detailed analytics
- Never surprise users with data they didn't know was collected

### What NOT to Copy

- Spotify's ad targeting and third-party data sharing
- Inference-based segmentation
- The "always online" assumption
- Complex cloud infrastructure (myradone is local-first)
- Collecting data for purposes other than serving the user

### Relevant Scale Comparison

| Dimension | Spotify | myradone |
|-----------|---------|----------|
| Users | 640M+ | 1 (local app) |
| Events/day | 1 trillion | Hundreds to thousands |
| Storage | 100+ PB cloud | Local SQLite |
| Privacy model | Collect everything, anonymize for sharing | Collect locally, never transmit |
| Sharing | Cloud-computed, served to app | Local-computed, opt-in export |
| Compliance | GDPR (EU-based) | HIPAA-adjacent (medical data) |

---

## Sources

### Spotify Engineering Blog
- [Spotify's Event Delivery -- Life in the Cloud](https://engineering.atspotify.com/2019/11/spotifys-event-delivery-life-in-the-cloud) -- event types, volumes, GCP architecture
- [Inside the Archive: The Tech Behind Your 2025 Wrapped Highlights](https://engineering.atspotify.com/2026/3/inside-the-archive-2025-wrapped) -- LLM pipeline, pre-computation, launch infrastructure
- [Spotify's Event Delivery -- The Road to the Cloud (Part I)](https://engineering.atspotify.com/2016/02/spotifys-event-delivery-the-road-to-the-cloud-part-i) -- original event collection architecture
- [Data Platform Explained Part II](https://engineering.atspotify.com/2024/5/data-platform-explained-part-ii) -- schema management, pipeline scale
- [Building the Future of Our Desktop Apps](https://engineering.atspotify.com/2021/04/building-the-future-of-our-desktop-apps) -- CEF, TypeScript rewrite, platform APIs
- [Why We Switched Our Data Orchestration Service](https://engineering.atspotify.com/2022/03/why-we-switched-our-data-orchestration-service) -- Luigi to Flyte migration
- [How We Use Backstage at Spotify](https://engineering.atspotify.com/2020/04/how-we-use-backstage-at-spotify) -- developer portal, infrastructure management
- [Spotify's New Experimentation Platform (Part 1)](https://engineering.atspotify.com/2020/10/spotifys-new-experimentation-platform-part-1) -- A/B testing architecture
- [Coming Soon: Confidence](https://engineering.atspotify.com/2023/08/coming-soon-confidence-an-experimentation-platform-from-spotify) -- current experimentation platform

### Privacy and Data
- [Spotify Privacy Policy](https://www.spotify.com/us/legal/privacy-policy/) -- official data collection categories
- [Spotify Safety and Privacy Center](https://www.spotify.com/us/safetyandprivacy/personal-data-collected) -- personal data categories
- [Understanding Your Data (Spotify Support)](https://support.spotify.com/us/article/understanding-your-data/) -- GDPR export field listing
- [Analysis of the Spotify GDPR Data Export](https://edbro.net/posts/an-analysis-of-the-spotify-gdpr-data-export/) -- 111 JSON files in Level 2 export

### Infrastructure
- [Spotify Case Study (Google Cloud)](https://cloud.google.com/customers/spotify) -- GCP migration details
- [How Spotify Built Its Data Platform (ByteByteGo)](https://blog.bytebytego.com/p/how-spotify-built-its-data-platform) -- architecture overview
- [Spotify chooses Google Cloud Platform (Google Blog)](https://cloud.google.com/blog/products/gcp/spotify-chooses-google-cloud-platform-to-power-data-infrastructure) -- $450M commitment

### Wrapped History and Psychology
- [Spotify Wrapped (Wikipedia)](https://en.wikipedia.org/wiki/Spotify_Wrapped) -- year-by-year evolution
- [How Spotify Wrapped Makes Data Sharing Feel So Right (Northeastern)](https://news.northeastern.edu/2021/12/03/spotify-wrapped-data-sharing/) -- psychology of voluntary data sharing
- [Spotify Wrapped and New Perceptions of Privacy (Medium/SI 410)](https://medium.com/si-410-ethics-and-information-technology/what-spotify-wrapped-can-tell-us-about-new-perceptions-of-privacy-and-validation-cff53d52ce87) -- reframing surveillance as entertainment
- [Spotify Wrapped through the years (CatlinSpeak)](https://www.catlinspeak.com/speak/spotify-wrapped-through-the-years) -- feature evolution timeline

### Features
- [Spotify's Latest Feature Charts Your Week in Listening](https://newsroom.spotify.com/2025-11-06/spotify-new-feature-listening-stats/) -- Listening Stats launch
- [Celebrate Your Unique Listening Style With Only You](https://newsroom.spotify.com/2021-06-02/celebrate-your-unique-listening-style-with-spotifys-only-you-in-app-experience/) -- Only You feature
- [How Spotify Blend Creates a Connection](https://newsroom.spotify.com/2023-05-24/how-spotify-blend-creates-a-connection-between-fans-friends-and-artists/) -- Blend feature
- [Celebrate the Unique Ways You Listen With My Spotify](https://newsroom.spotify.com/2024-06-10/my-spotify-personalized-playlists-daylist-made-for-you/) -- Daylist and personalization
