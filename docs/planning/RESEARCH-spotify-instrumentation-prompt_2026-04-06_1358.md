# Research: Spotify Analytics & Instrumentation Benchmarking

## Summary

Spotify is the gold standard for turning data collection into a beloved user feature. They track 1,800+ event types processing 1 trillion+ events/day (70 TB compressed/day), yet users voluntarily share their Wrapped results because the data functions as identity expression. The critical design insight: Wrapped didn't go viral until 2018 when they added shareable card graphics for Instagram Stories -- same data, different presentation. In 2025, LLM-generated personalized narratives took it further (1.4B reports for 350M users). The core lesson: extensive data collection becomes beloved when you give it back in a delightful format.

---

## 1. What Does Spotify Track?

### Scale
- **1,800+ event types** across the platform
- **1 trillion+ events per day**
- **70 TB compressed data per day**
- **100+ PB** total stored data
- Events use Apache Avro schemas with semantic annotations

### The EndSong Event (Core)

Every play generates an EndSong event capturing:
- Track ID, artist ID, album ID
- Milliseconds played
- Whether the track was skipped (and at what point)
- Shuffle state, repeat state
- Start reason (e.g., clicked play, autoplay, playlist) and end reason (e.g., skipped, track ended, app closed)
- Offline status (was this played offline?)
- Device type, device name
- Platform (desktop, mobile, web, smart speaker, car)
- IP address
- Timestamp (millisecond precision)
- Audio quality setting

### Other Event Categories
- **Search**: Every query, results shown, result clicked
- **Navigation**: Screens visited, time on screen, scroll depth
- **Playlist**: Creates, edits, adds, removes, reorders, follows
- **Social**: Shares, collaborative playlist actions, Blend interactions
- **Discovery**: Discover Weekly engagement, Release Radar, algorithmic playlist interactions
- **Podcast**: Play, pause, skip, speed changes, chapter navigation
- **Ads**: Impressions, clicks, skip attempts, completion
- **Device**: Volume changes, equalizer settings, Connect handoffs between devices
- **Session**: App open, app close, background/foreground transitions, duration

### Offline Event Handling
Events generated during offline listening are queued locally with timestamps and transmitted when connectivity returns. The timestamps reflect when the event actually occurred, not when it was sent.

---

## 2. How Spotify Surfaces Data Back to Users

### Spotify Wrapped (Annual)

**Evolution:**
- **2015**: "Year in Music" -- basic web page with top artists/songs. Minimal virality.
- **2016**: Renamed to "Wrapped." Still a web experience. Modest engagement.
- **2017**: Improved design, more data categories. Growing awareness.
- **2018**: The inflection point. Added **shareable card graphics optimized for Instagram Stories**. Same data, radically different presentation. Wrapped went viral.
- **2019**: Moved to in-app Stories format (vertical, tappable, animated). Cemented the format.
- **2020-2024**: Added audio aura, listening personality types, podcast stats, social comparisons, artist thank-you messages.
- **2025**: **LLM-generated personalized narratives.** 1.4 billion reports for 350 million users, generated over 4 continuous days of compute. AI turned data into stories.

**Data categories in Wrapped:**
- Total minutes listened
- Top 5 artists, songs, genres, podcasts
- Listening personality type (based on diversity/loyalty patterns)
- Top listening month/day/time
- "Top X%" listener for favorite artists
- Genre breakdown
- Discovery stats (new artists found)
- Podcast hours

**Data cutoff:** January 1 through late October/early November (exact date varies). December is excluded to allow computation time.

**Infrastructure:** Pre-computed over weeks. Personalized data for 350M+ users served simultaneously on launch day. The 2025 LLM narratives required 4 continuous days of generation.

### Year-Round Features

- **Recently Played**: Last 50 items, visible in app
- **Top Artists / Top Songs**: Time-range toggles (4 weeks, 6 months, all time)
- **Listening Stats** (launched ~2024): Weekly and monthly recaps, mini-Wrapped experiences throughout the year
- **Daylist**: AI-generated playlist that changes throughout the day based on listening patterns and time
- **Only You**: Personalized insights about unique listening combinations
- **Blend**: Merged taste profiles between two users with a shared playlist
- **Artist fan ranking**: "You're in the top 0.5% of listeners for [artist]"

### The Psychology: Why Users Love It

1. **Identity expression.** "Top 0.5% listener of [artist]" is a statement about who you are. Users share Wrapped not for the information but for the identity.
2. **Social currency.** Wrapped screenshots function as conversation starters. "What was your top artist?" becomes a social ritual.
3. **FOMO.** Not having Wrapped (e.g., Apple Music users) creates exclusion. This drives both engagement and acquisition.
4. **Reframing the value exchange.** "We collect your data, but look at this delightful thing we made with it." Instead of feeling surveilled, users feel seen.
5. **Shareable by design.** The card format is literally optimized for Instagram Stories dimensions. Sharing is zero-friction.
6. **No sensitive content exposed.** Wrapped shows aggregates (top genre, minutes listened), never raw event logs. The abstraction level is safe and flattering.

---

## 3. Privacy Policy and Data Practices

### Privacy Policy

Spotify is headquartered in Stockholm, Sweden (EU). Subject to GDPR natively, not as an accommodation.

**Data collected:**
- Account data (name, email, DOB, gender, country)
- Listening history (every play, full history)
- Search and browsing history
- Playlists (created and followed)
- Device information, IP addresses, connection type
- Location data (GPS on mobile if permitted, IP-derived otherwise)
- Voice data (voice search, "Hey Spotify")
- Payment data (via processor)
- Inferred interests and segments for ad targeting

**How data is used:**
- Personalization (recommendations, Discover Weekly, Wrapped)
- Ad targeting (free tier)
- Royalty calculations (labels/artists paid per stream)
- A/B testing and product improvement
- Fraud detection
- Aggregated analytics shared with labels and artists ("Spotify for Artists" dashboard)

**Third-party sharing:**
- Advertisers: identifiers, browsing activity, inferred demographics, location
- Labels and rights holders: aggregated streaming data (for royalties and analytics)
- Social platforms: if user connects Facebook/Instagram
- Measurement partners: ad campaign effectiveness
- Service providers: cloud infrastructure (GCP)

### GDPR Data Export

A full GDPR export contains **111+ JSON files** across three tiers:

**Tier 1 (instant):** Account data, playlists, search history, streaming history (last 12 months, simplified)

**Tier 2 (days to weeks):** Extended streaming history (every play ever, full detail including ms_played, skipped, offline, IP, start/end reason, device)

**Tier 3 (on request):** Inferences.json (ad-targeting segments and inferred interests), technical data

The extended streaming history is remarkably detailed. Each entry includes:
```json
{
  "ts": "2026-03-15T14:32:10Z",
  "ms_played": 187432,
  "master_metadata_track_name": "Song Title",
  "master_metadata_album_artist_name": "Artist",
  "master_metadata_album_album_name": "Album",
  "spotify_track_uri": "spotify:track:...",
  "reason_start": "trackdone",
  "reason_end": "trackdone",
  "shuffle": false,
  "skipped": null,
  "offline": false,
  "offline_timestamp": null,
  "incognito_mode": false,
  "ip_addr": "xxx.xxx.xxx.xxx",
  "platform": "OS X 14.1.1 [x86-64]"
}
```

### Incognito Mode (Private Session)

Spotify offers "Private Session" mode that:
- Excludes listening from public activity feed
- Excludes from social features
- Does NOT exclude from Spotify's internal analytics or Wrapped
- Does NOT exclude from GDPR export
- Primarily a social privacy feature, not a data collection opt-out

---

## 4. Data Infrastructure

### Cloud Platform
- **$450M GCP commitment** (multi-year)
- Migrated from on-premises Kafka/Hadoop (2016-2018) to GCP
- Primary services: Cloud Pub/Sub, BigQuery, Dataflow, Dataproc, GCS

### Event Delivery
- **~2,500 VMs** for event delivery
- Events published to Cloud Pub/Sub topics
- Dataflow pipelines process, enrich, and route events
- Final storage in BigQuery and GCS (Parquet)
- **38,000+ active data pipelines**

### Key Internal Tools
- **Luigi** (open-sourced 2012): Workflow scheduler for batch pipelines. Being replaced by **Flyte**.
- **Backstage** (open-sourced 2020): Developer portal managing 2,000+ internal services. Now a CNCF project.
- **Confidence**: Internal A/B testing platform. 300+ teams run tens of thousands of experiments annually.
- **Event Delivery System**: Custom pipeline for ingesting, validating, and routing all client events.

### Schema Management
- Events defined in Apache Avro schemas
- Schemas include **semantic annotations** that automatically trigger:
  - PII detection and anonymization
  - Retention policy enforcement
  - Access control classification
  - GDPR right-to-deletion propagation
- Schema registry ensures backward/forward compatibility

### A/B Testing
- Central to product development -- "virtually everything is A/B tested"
- Confidence platform provides statistical rigor (sequential testing, always-valid confidence intervals)
- 300+ teams, tens of thousands of experiments per year
- Results feed back into event taxonomy (new events added for new features)

---

## 5. The Wrapped Model: Design Lessons

### Why Wrapped Works (Design Principles)

1. **Aggregation, not raw data.** Wrapped shows "your top artist" and "minutes listened," never a timestamped log of every play. The abstraction level is safe, flattering, and digestible.

2. **Annual cadence creates anticipation.** By limiting the full experience to once per year, Wrapped becomes an event rather than a feature. Scarcity drives excitement.

3. **Shareable format is the product.** The Instagram Story-sized cards aren't a sharing feature added to Wrapped -- they ARE Wrapped. The viral loop is the core design, not an afterthought.

4. **Identity over information.** "Top 0.5% listener" feels like a badge. "You listened to 47,832 minutes" feels like an achievement. The data tells you something about yourself, not just about your usage.

5. **Positive framing only.** Wrapped never says "you wasted 800 hours" or "you skipped 60% of Discover Weekly." The narrative is always celebratory.

6. **Progressive disclosure.** The Stories format reveals one stat at a time, building narrative tension. This is more engaging than a dashboard showing everything at once.

### Evolution Timeline

| Year | Key Innovation | Impact |
|------|---------------|--------|
| 2015 | "Year in Music" web page | Baseline |
| 2016 | Renamed "Wrapped" | Brand identity |
| 2018 | Instagram Story-sized shareable cards | Viral inflection point |
| 2019 | In-app Stories format | Format cemented |
| 2020 | Audio Aura, listening personality | Personalization deepened |
| 2023 | AI DJ integration | Narrative voice |
| 2025 | LLM-generated personalized narratives | 1.4B reports, AI storytelling |

---

## 6. Desktop App Specifics

### Architecture
- **Chromium Embedded Framework (CEF)**, not Electron (since 2011, predating Electron)
- TypeScript + React UI
- Platform API abstraction layer: identical analytics interface across desktop, mobile, web
- Native shell handles audio playback, system integration, offline storage

### Desktop-Specific Tracking
- Same event taxonomy as mobile/web (Platform API ensures consistency)
- Platform field in events identifies desktop specifically
- Offline events queued with original timestamps, transmitted on reconnect
- Local cache stores recently played, playlists, and offline-available tracks
- Connect protocol tracks device handoffs (e.g., phone to desktop)

### Desktop vs Mobile Differences
- Mobile adds: GPS location (if permitted), cellular/WiFi status, battery state
- Desktop adds: audio output device, system audio settings
- Both: identical core event taxonomy (EndSong, search, navigation, etc.)

---

## 7. Applicability to Our App

### The Core Lesson

Spotify proves that data collection becomes beloved when you return it to users in a format that feels like a gift rather than a receipt. The key ingredients:

1. **Aggregate, don't enumerate.** Show "150 CT studies reviewed" not a timestamped log.
2. **Positive framing.** "You've spent 42 hours with your imaging library" not "usage data collected."
3. **Identity-affirming.** Even without social sharing, personal stats should feel like a portrait of the user's workflow.
4. **Multiple cadences.** Real-time counters (session), periodic summaries (weekly/monthly), and annual wrap-up.

### What Transfers to Medical Imaging

| Spotify Concept | Medical Imaging Equivalent |
|-----------------|---------------------------|
| Minutes listened | Hours viewing studies |
| Top genres | Modality breakdown (CT, MR, US) |
| Top artists | Most-viewed body regions or study types |
| Songs played | Slices rendered, studies opened |
| Wrapped annual summary | "Year in Review" for your imaging library |
| Listening personality | Workflow profile (power user, casual reviewer, focused specialist) |

### What Doesn't Transfer

- **Social sharing.** Medical imaging stats are not social currency. No Instagram Stories.
- **Ad targeting.** No advertisers, no inferred segments.
- **Scale infrastructure.** We don't need BigQuery for one user's local counters.
- **Incognito mode.** No need -- everything is already local and private.

### Design Recommendation

The stats panel in ADR 008 should take one page from Spotify: frame the data positively and make it feel like a portrait of the user's work, not a surveillance log. "You've reviewed 847 studies across 5 modalities this year" is a Wrapped-inspired sentence. A simple bar chart of modalities-over-time is a mini-Wrapped visualization. The data is the same; the framing makes it a feature.

---

## Sources

- [Spotify Privacy Policy](https://www.spotify.com/privacy)
- [Spotify Engineering Blog](https://engineering.atspotify.com/)
- [Spotify Event Delivery (Engineering Blog)](https://engineering.atspotify.com/2016/02/spotifys-event-delivery/)
- [Spotify Backstage](https://backstage.io/)
- [Spotify Confidence A/B Testing](https://engineering.atspotify.com/2023/02/the-magic-behind-spotifys-confidence-platform/)
- [Spotify GCP Partnership](https://cloud.google.com/customers/spotify)
- [Spotify Wrapped 2025 LLM Narratives](https://engineering.atspotify.com/)
- [Spotify GDPR Data Export Guide](https://support.spotify.com/account_payment_help/privacy/understanding-my-data/)
- [Wrapped History and Evolution (Various Press Coverage)](https://newsroom.spotify.com/)
