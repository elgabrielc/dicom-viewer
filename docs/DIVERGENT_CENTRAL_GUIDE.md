<!--
  Divergent Central Guide
  The canonical document for Divergent Health Technologies.
  Product vision, architecture, history, and roadmap.

  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Divergent Central Guide

This is the central reference document for Divergent Health Technologies and its product, the DICOM Medical Imaging Viewer. It ties together product vision, technical architecture, history, and roadmap. Everything else -- ADRs, research docs, planning files -- branches off from here.

For navigating project documentation, see [INDEX.md](INDEX.md).
For architecture decision records, see [docs/decisions/](decisions/).

---

## What We're Building

A medical imaging viewer that works like a photo library. Users collect their imaging -- CT scans, MRIs, X-rays -- from hospitals, CDs, downloads, wherever it comes from, into one place. View it, annotate it, keep it. Eventually, sync it across devices and access it from anywhere.

The library draws from **Google Photos** and **Apple Photos**: warm, welcoming, organized around the user. The viewer draws from **Darkroom**, **Lightroom**, and **Photos edit mode**: consumer-accessible on the outside, seriously precise on the inside. A consumer product with real technical depth where it matters.

The product starts as a desktop app and grows into a cloud platform.

### Who It's For

myradone is a consumer product -- built for individuals on their own devices. It is not a PACS, not a hospital IT deployment, not an enterprise clinical workflow tool. Enterprise clinical use is a separate future motion that does not drive current product direction.

Today: individuals who want to view and organize their own medical imaging. Patients who get CDs from hospitals. Physicians reviewing outside studies on personal devices. Researchers working with DICOM datasets.

Tomorrow: the same people, plus teams who need to share and collaborate on imaging. The cloud platform enables this.

### What Makes It Different

- **Your imaging, your account.** Your imaging belongs to you and travels with you across devices -- not tied to any hospital, vendor, or single machine. Today it lives on your desktop; in the cloud-primary era it lives in your account.
- **Online or offline.** Studies stream responsively when you're connected. Pin what you need for full offline viewing.
- **A library, not just a viewer.** Import once. Organized by study and series. Notes and reports attached.

---

## Market Position

**The space is occupied but not won.**

There are at least four active direct-to-consumer DICOM cloud services where individuals can sign up independently, upload their own imaging, and store it in a personal cloud account:

| Product | Pricing | Differentiator |
|---------|---------|----------------|
| **MyMedicalImages.com** | $29.95/yr unlimited | Cleanest pure-DTC match. Founded 2017. Browser-based, family folders, CVS Pharmacy partnership. Small scale. |
| **3DICOM Patient** (Singular Health, ASX:SHG) | $29.95/yr | **Most direct competitor.** Public-company backing, 3D rendering as headline, mobile apps, FDA-cleared MD sibling. Founded 2017. |
| **DicomShare** | $90/yr (10 GB) | Browser-side anonymization, share-link focused with persistent personal storage. |
| **Falcon Mx + Falcon Cloud** | $70+/yr | Mobile-first iOS, FDA-cleared sibling (Falcon MD), 4.5★ App Store. |

The largest player adjacent to the category, **PocketHealth** (2M+ patients, 900+ hospitals), reached scale primarily through B2B2C hospital partnerships. Patient self-upload was added in 2022 as a secondary path. Several other platforms (PostDICOM, Purview Image, Ambra, CarePassport, LifeImage / Intelerad) are technically self-signupable but priced as B2B clinic products or require hospital onboarding.

**No pure direct-to-consumer DICOM cloud has broken through at mass-consumer scale.**

### Why the category hasn't been won

1. **No category in consumer minds.** "Where do I keep my medical imaging?" is not a question patients ask themselves.
2. **Low usage frequency.** Most users have imaging once or twice a year.
3. **Pricing-to-frequency mismatch.** $30-50/year feels expensive for a once-a-year service.
4. **Sharing is the killer feature, but recipient acceptance is uneven.** Doctors do not always accept third-party share links.
5. **B2B2C is structurally easier.** PocketHealth's growth proves this -- direct consumer awareness is hard to manufacture.
6. **Trust gap.** Patient-facing medical data startups historically struggle to build mass trust.
7. **Existing products are utility-grade.** All competitors are functional but uninspired -- no consumer-product-quality entrant has emerged.

### myradone's wedge

The competitive position is not "first mover" -- the category has been occupied for nearly a decade (MyMedicalImages and 3DICOM Patient both founded 2017). It is **"quality mover": be the one that actually delivers what the category promises.**

What myradone bets on:

- **Viewer craft** (Darkroom / Lightroom lineage) -- competitors are utility-grade
- **Library design** (Google Photos lineage) -- competitors feel like vendor portals
- **Modern web architecture** (DICOMweb + HTJ2K + browser-native client-side rendering, per [ADR 004](decisions/004-cloud-platform-rendering-architecture.md))
- **Onboarding and brand quality** -- open territory at the consumer-quality top
- **Genuinely good free tier with no surprise charges** -- PocketHealth's billing-and-cancellation complaints are instructive
- **3D reconstruction (later)** -- 3DICOM has a 2D-to-3D feature but no consumer scale or brand. The 3D space is contestable, not owned.
- **Retail and consumer-channel distribution** -- MyMedicalImages's CVS partnership is a starting point, not a moat. The total addressable consumer market is enormous relative to anything any of these competitors has captured.

No competitor has reached the scale or brand recognition required to "own" any feature, channel, or market. Every dimension is contestable. Quality and execution decide the winner.

### Full research

- [RESEARCH-direct-to-consumer-medical-imaging](planning/RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) -- whether the space is fresh or a graveyard
- [RESEARCH-mymedicalimages-equivalents](planning/RESEARCH-mymedicalimages-equivalents-prompt_2026-05-01_0934.md) -- exhaustive search for products like MyMedicalImages
- [Companies Researched](planning/COMPANIES-RESEARCHED.md) -- running roster of every company we have benchmarked or cited, organized by category

---

## Primary Competitive Benchmarks

These are the products myradone compares against and builds to surpass. This is a primary strategic priority -- not background research. The Tier 1 list defines the build sequence.

### Tier 1 -- compare against, build to surpass

**1. MyMedicalImages.com -- the #1 competitor.**
Closest analog to myradone's plan. **Reach feature parity ASAP, then surpass.** The near-term build sequence anchors here: web-native onboarding, browser DICOM upload from CD or local folder, family folders, sharing, simple consumer pricing, no surprise charges. Every milestone should ask: "Are we at parity yet? Where are we already better?"

**2. 3DICOM Patient (Singular Health, ASX:SHG).**
Strongest direct competitor by funding and engineering depth. Same $29.95/yr price point. Public-company backing. Mobile apps. FDA-cleared MD sibling. Benchmark for **breadth of feature surface** and the eventual **3D reconstruction roadmap** (which myradone will pursue and surpass on; not avoid).

**3. Falcon Mx (with Falcon Cloud).**
Mobile-first iOS competitor with FDA-cleared sibling product (Falcon MD) and 4.5★ App Store ratings. Benchmark for **mobile UX quality** once myradone extends to mobile.

### Tier 2 -- peripheral reference

**DicomShare.**
Share-tool framing rather than library-first. Useful for benchmarking the **sharing flow specifically**, not the overall product.

### Build sequence implied by the benchmarks

1. **Match MyMedicalImages first** on consumer-library fundamentals: web onboarding, upload, organize, view, share, simple pricing, no surprise charges.
2. **Surpass on the wedge:** viewer craft (Darkroom/Lightroom lineage), library design (Google Photos lineage), brand quality, modern web architecture (DICOMweb + HTJ2K + browser-native, per [ADR 004](decisions/004-cloud-platform-rendering-architecture.md)).
3. **Expand into 3DICOM/Falcon dimensions:** 3D reconstruction, mobile-first iOS. None of these are owned by anyone.
4. **Pursue retail and consumer distribution** in parallel. MyMedicalImages's CVS partnership is a starting point, not a moat. The total addressable market dwarfs anything any current player has captured.

### Discipline

- Every milestone review should ask: where are we behind MyMedicalImages, where are we already past them, and what's between us and surpass?
- New features should be evaluated against the Tier 1 list: what would MyMedicalImages, 3DICOM Patient, and Falcon Mx need to do to match this? Are we leading or following on this dimension?
- Tier 2 (DicomShare) is reference-only; do not over-invest in beating peripheral competitors.

---

## Product Philosophy

### Two Data Domains

The system has two fundamentally different data domains. They share infrastructure where convenient, but they are not the same thing and must not be coupled.

**Imaging** -- DICOM files, pixel data, study/series/slice organization, transfer syntaxes, decoders, rendering. Large, immutable binary objects. Read-heavy, write-once. The core viewer pipeline.

**Annotations** -- notes, comments, reports, measurements, labels. Lightweight, mutable, user-generated metadata layered on top of imaging. Keyed by DICOM UIDs but with their own lifecycle (created, edited, deleted, synced).

These domains have different storage characteristics, different sync requirements, different performance profiles, and different compliance implications. In a company context, they would be owned by different engineering teams. Design decisions, APIs, persistence layers, and sync protocols should respect this boundary.

When in doubt, ask: "Is this about the imaging pipeline or the annotation layer?" and keep the answer in its own lane.

### Architecture Trajectory

myradone is on a deliberate trajectory from local-first (today) to cloud-primary (end state). Three phases:

**Today (bootstrap).** The desktop app is the primary surface. Local SQLite is the source of truth. Cloud does not exist yet. All writes go to local storage first; the UI reads from local storage. The app is fully functional offline.

**Bridge.** A sync engine ([ADR 006](decisions/006-cloud-sync-storage-architecture.md)) replicates local annotations to the cloud without breaking offline. Local remains authoritative on the desktop during this phase. Changes queue locally when offline and sync when connectivity returns.

**End state (cloud-primary).** Files live in the cloud. All clients -- web, mobile, desktop -- stream on demand with thin ephemeral working-set caches. The web app at app.divergent.health is the primary surface. Desktop becomes an optional convenience client with the same cloud-backed state. Persistent offline availability is an opt-in "pin this study" action, not the default. This matches the Google Photos / Drive / Dropbox model: files belong to your account in the cloud, not to any single device.

The local-first architecture is scaffolding, not the destination. Engineering effort should go into building the bridge (sync engine, auth, identity, DICOMweb transport) that gets the consumer product to the cloud-primary end state -- not into making "local-first forever" more robust.

### Copy-on-Import

When a user drops a folder of DICOM files, the app copies them into a managed library folder (not reference-in-place). The managed folder is self-contained: everything the app needs is in one location. No external path dependencies, no offline drive problems, no scattered source folders.

This model was chosen because:
- It eliminates complexity around multi-source path management, offline drives, and path canonicalization.
- The managed folder becomes a local cache of the cloud state. On a new device, it starts empty and fills as studies are pulled. The sync engine only talks to one well-known location.
- Selective sync is natural: each device materializes only what it needs.
- It matches proven patterns (Horos, Google Photos).

See [ADR 007](decisions/007-multi-source-library.md) for the full decision record.

### Privacy by Default

Medical imaging is sensitive data. The architecture reflects this:
- **Medical images stay on the device.** Pixel data is decoded in the browser/app, not on a server. No images or pixel data ever leave the machine. This is our biggest compliance asset.
- No third-party analytics SDKs, no external telemetry, no data brokers.
- **Local-only usage counters** are tracked in the desktop and personal modes -- currently sessions (app opens) and studies imported. They are stored locally and surfaced to the user in the help modal, so the user can see exactly what the app knows about them. The stats panel is the privacy policy. ([ADR 008](decisions/008-local-first-instrumentation.md))
- **Sharing is off by default.** If the user opts in via the toggle in the help modal, only those counters plus a per-installation anonymous ID are sent to Divergent Health. No patient data, file paths, study contents, DICOM UIDs, or medical images are ever included. Turning the toggle off stops all network traffic.
- PHI and usage telemetry are architecturally separate. The telemetry stream cannot carry PHI because it accepts only predefined numeric counters -- there is no free-form event API.
- Demo site is stateless -- no data persists between visits, and instrumentation is disabled.
- Cloud platform (future) will require explicit account creation and consent. SOC 2 Type II and HIPAA BAA availability are the compliance targets.

---

## Architecture

### Stack

- **Frontend**: Vanilla JavaScript, single-page application
- **Desktop shell**: Tauri (Rust) for native macOS packaging, filesystem access, SQLite persistence
- **Backend**: Flask (Python) for local development server and test APIs
- **Rendering**: Canvas 2D, with vtk.js planned for 3D volume rendering
- **Decoders**: DICOM parser (JS), JPEG Lossless (JS), OpenJPEG WASM (JPEG 2000)
- **Persistence**: SQLite (desktop, via Tauri), localStorage (browser fallback)

### Shared Web Core

All web assets live in `docs/`. This single source of truth serves every deployment mode:
- GitHub Pages serves `docs/` for the demo site
- Flask serves `docs/` for local development
- Tauri loads `docs/` for the desktop app
- Cloud platform will serve `docs/` with additional server-side APIs

### Deployment Modes

The same codebase adapts to four contexts:

| Mode | Context | Persistence | Audience |
|------|---------|-------------|----------|
| **Demo** | GitHub Pages | None (stateless) | Public visitors trying it out |
| **Personal** | localhost Flask | Flask API + localStorage | Individual users |
| **Desktop** | Tauri shell | SQLite + managed library folder | Individual users (today's primary surface) |
| **Cloud** | app.divergent.health (future) | Server-side of record; clients hold ephemeral caches | Logged-in users (end-state primary surface) |

Detection is via Tauri first, then hostname. Feature flags route through `CONFIG.deploymentMode`.

### Distribution Strategy

Desktop apps are distributed as direct-download signed installers (`.dmg` for macOS, `.msi` for Windows) from divergent.health. Curated app stores -- Microsoft Store, Mac App Store -- are not the canonical channel.

Users discover and engage with the product through the web app first. When they want the desktop client, they download it from the site. Code signing + auto-update (Tauri updater + GitHub Releases) is the full distribution story.

**Why not the curated app stores:**
Consumer-app precedent points toward the Microsoft Store or Mac App Store for discovery (e.g. OpenAI's Codex chose the Microsoft Store for Windows). That reasoning doesn't transfer:
- The web app is the discovery surface -- users arrive at the desktop installer already engaged, so store-driven discovery is not load-bearing
- Tauri has no native MSIX support, so a store path doubles the packaging pipeline
- Hours-to-days Store review lag conflicts with a ship-on-demand release cadence

**Implications:**
- Code signing is non-negotiable on both platforms (Apple Developer ID; Microsoft Trusted Signing or EV certificate on Windows)
- Auto-update is built into the app (Tauri updater + GitHub Releases), not delegated to a store
- Installers run in user-space without admin escalation where possible
- Enterprise clinical distribution is a separate motion in the Future roadmap with its own packaging, compliance, and procurement requirements -- out of scope for current planning

### Reference Architecture

The cloud-primary end state has five architectural layers. Each has a representative benchmark we are modeling against, so planning discussions reference concrete implementations instead of abstract patterns.

| Layer | Approach | Benchmark |
|-------|----------|-----------|
| **Product framing** | Files live in the cloud, clients stream on demand | Google Photos |
| **Transport** | DICOMweb (WADO-RS / QIDO-RS / STOW-RS) + progressive HTJ2K | Google Healthcare Imaging API |
| **Rendering** | Client-side in the browser, GPU-accelerated | OHIF (Cornerstone3D) |
| **Local state** | Ephemeral working-set during active session, not persistent files | Netflix |
| **Opt-in sync** | "Pin this study for offline" as a power-user action | Spotify |

The two-domain split (imaging vs annotations) maps onto this stack distinctly. **Imaging** flows through Transport + Rendering + Local State. **Annotations** flow through a parallel CRDT-style sync layer (Figma/Linear model), formalized in [ADR 006](decisions/006-cloud-sync-storage-architecture.md). Both domains live in the same cloud-hosted account.

Connections to existing decisions:
- [ADR 004](decisions/004-cloud-platform-rendering-architecture.md) commits to client-side rendering (the Rendering layer)
- [ADR 006](decisions/006-cloud-sync-storage-architecture.md) designs the sync engine (the bridge from today's local-first desktop to the end state)
- [ADR 010](decisions/010-patient-provider-image-sharing.md) commits to in-house STOW-RS for patient-to-provider sharing (pre-commits the DICOMweb Transport)

Today's desktop app (local-first SQLite + managed library folder) is the bootstrap phase. The five-layer model is what ships at app.divergent.health; Windows, Linux, and mobile users eventually get the end-state product for free through the web client.

### Storage Architecture

**Desktop (current):**
```
~/Library/Application Support/com.divergent.health.dicom-viewer/
  library/                    # Managed DICOM files (copy-on-import)
    <StudyInstanceUID>/
      <SeriesInstanceUID>/
        <SOPInstanceUID>.dcm
  database.sqlite             # SQLite: notes, reports, config, scan cache
  reports/                    # Attached report files (PDFs, images)
```

**Cloud (end state):**
Cloud is the source of truth for both imaging and annotations. Imaging is served via a DICOMweb server; clients stream on demand via WADO-RS with progressive HTJ2K. Annotations sync through outbox-based replication ([ADR 006](decisions/006-cloud-sync-storage-architecture.md)).

By default, clients hold only an ephemeral working-set cache during active viewing sessions -- files do not live on the device. Users can opt into persistent offline availability per study via an explicit "pin" action. When pinning is enabled on desktop, the managed library folder acts as the local cache (see the [managed folder principle](planning/PRINCIPLE-managed-folder-as-local-cache.md)). This matches the Google Drive "Stream" (default) vs "Mirror" (opt-in) distinction.

---

## History and Key Decisions

The product started as a browser-based DICOM viewer and evolved into a desktop application with a path to cloud.

**January 2026 -- Browser viewer.**
Initial release. Web-based DICOM viewer with drag-and-drop folder loading, slice navigation, and basic windowing. Chose vanilla JS over React/Vue for simplicity. Client-side processing for privacy. Dark theme for low-light viewing. Added sample CT and MRI scans, viewing tools (W/L, Pan, Zoom), measurement tool, and automated Playwright test suite.

**February 2026 -- Persistent library.**
Added persistent local DICOM library so users don't re-import on every visit. Flask backend scans a configured folder on startup and serves results via API. Introduced `DicomFolderSource` abstraction. ([ADR 002](decisions/002-persistent-local-library.md))

**March 2026 -- Desktop app.**
Moved to Tauri desktop shell. The shared web core stays in `docs/`, but Tauri provides native macOS packaging, filesystem access, menus, and SQLite persistence. This was the shift from "web viewer" to "desktop application." ([ADR 003](decisions/003-tauri-desktop-shell-with-shared-web-core.md))

**March 2026 -- Native persistence.**
SQLite database in Tauri app data for notes, reports, library config, and scan cache. Replaced localStorage with a durable, queryable store. Rust IPC bridge for database operations. ([ADR 005](decisions/005-native-desktop-persistence.md))

**March 2026 -- Cloud sync design.**
Designed the sync protocol for notes, comments, and reports. Local-first with outbox-based replication. Server-issued delta cursors, tombstones for deletions, content hashing for dedup. DICOM file sync deferred to later. ([ADR 006](decisions/006-cloud-sync-storage-architecture.md))

**March 2026 -- Copy-on-import library.**
Pivoted from reference-in-place to copy-on-import after exploring multi-folder references and discovering compounding complexity (offline drives, path canonicalization, cross-source merge safety). The managed library folder is the single source of truth locally and the natural upload source for cloud sync. Benchmarked against Horos and Google Photos. ([ADR 007](decisions/007-multi-source-library.md))

**April 2026 -- Instrumentation design.**
Benchmarked Todoist (custom Bitmapist analytics), Sublime Text (near-zero telemetry), Claude/Anthropic (two-stream architecture), and Spotify (Wrapped as data-as-feature). Decided on local-first usage counters with a user-visible stats panel. Two-stream separation: product data (DICOM/PHI) and telemetry (usage counters) are architecturally separate. PHI never touches the telemetry stream. ([ADR 008](decisions/008-local-first-instrumentation.md))

**April 2026 -- Patient-to-provider sharing design.**
Researched HIPAA/FTC compliance, DICOMweb standards, Epic/Ambra integration, and itemized compliance costs. Decided to build DICOMweb (STOW-RS) in-house rather than depend on Ambra's per-study fees. Three-stream data model (telemetry, audit logs, product data). Phased rollout from local DICOM export through SOC 2, HIPAA, and eventually Epic integration. ([ADR 010](decisions/010-patient-provider-image-sharing.md))

**Other key decisions:**
- Client-side rendering for the cloud platform, not server-side ([ADR 004](decisions/004-cloud-platform-rendering-architecture.md))
- macOS launch.command for double-click startup ([ADR 001](decisions/001-launch-command.md))
- vtk.js for 3D volume rendering (industry standard, Kitware-backed)

---

## Roadmap

The roadmap is anchored by the [Primary Competitive Benchmarks](#primary-competitive-benchmarks) above. The near-term build sequence is: match MyMedicalImages first, then surpass on the wedge, then expand into 3DICOM/Falcon dimensions.

### Now: Desktop App (Local-First)

The desktop app is the current focus. It must be a complete, polished, standalone product before cloud work begins.

**Completed:**
- DICOM viewing (CT, MRI, multi-modality)
- Multiple compression formats (Uncompressed, JPEG Lossless, JPEG Baseline/Extended, JPEG 2000)
- Persistent library with study/series organization
- Notes and reports system
- Measurement tool
- Native macOS desktop shell (Tauri)
- SQLite persistence

**In progress / next:**
- Copy-on-import library (ADR 007) -- additive folder drop, managed library folder
- 3D volume rendering (vtk.js) -- volume rendering, MIP, transfer functions
- Signed and notarized macOS release
- Local-first instrumentation -- usage counters with user-visible stats panel ([ADR 008](decisions/008-local-first-instrumentation.md))
- Local DICOM export (USB/folder, DICOMDIR-compliant) -- zero compliance cost, ships in any mode

### Next: Cloud Sync + Compliance Prep

Sync notes, comments, and reports across devices. Begin SOC 2 preparation (6-12 month lead time). The desktop app remains fully functional offline. Cloud is additive.

- User accounts and authentication
- Sync engine: outbox-based replication, delta cursors, tombstones
- Server infrastructure (Flask or separate service, TBD)
- SOC 2 Type II kickoff: compliance platform, policies, security tooling
- DICOM file sync deferred to after annotation sync is stable

See [ADR 006](decisions/006-cloud-sync-storage-architecture.md) and [Sync Contract v1](planning/SYNC-CONTRACT-V1.md).

### Later: Cloud Platform + Patient-to-Provider Sharing

The full hosted service at app.divergent.health, plus the ability for patients to share imaging with their medical providers.

- DICOM file sync (managed folder as upload source, selective sync per device)
- DICOMweb (STOW-RS) integration for patient-to-provider image sharing -- built in-house, no exchange network dependency ([ADR 010](decisions/010-patient-provider-image-sharing.md))
- SOC 2 Type II certification
- Three-stream data model: telemetry (no PHI), audit logs (PHI references, 6-year retention), product data (DICOM in transit)
- Published privacy policy (modeled on Panic's approach)
- Server-side search and organization
- Multi-platform access via the web client -- Windows, Linux, ChromeOS, tablets, and mobile are covered by app.divergent.health without native ports
- Sharing and collaboration

### Future: Advanced Imaging

Consumer viewing features that build on the cloud platform once it is stable.

- 3D volume rendering with medical presets (CT soft tissue, bone, lung; MRI brain, spine)
- Multi-planar reconstruction (MPR)
- Hanging protocols
- AI-assisted analysis (integration points, not building our own models)

### Future: Enterprise (Separate Motion)

Enterprise clinical deployment is a separate motion with its own packaging, compliance, and go-to-market concerns. It does not drive current product direction and is noted here only for completeness. If and when it becomes relevant, it will be planned as a distinct product motion -- not retrofitted onto the consumer product.

- HIPAA business associate status + provider contracts
- Epic integration via SMART on FHIR (when revenue justifies $300K+ investment)
- HITRUST certification (when enterprise payer customers require it)
- Enterprise distribution packaging (MSI + ADMX templates, Intune/SCCM/Jamf deployment guides)

---

## Where to Find Things

| What | Where |
|------|-------|
| Full documentation index | [INDEX.md](INDEX.md) |
| Architecture decisions | [docs/decisions/](decisions/) |
| Research and benchmarks | [docs/planning/RESEARCH-*.md](planning/) |
| Implementation plans | [docs/planning/PLANS.md](planning/PLANS.md) |
| Bug tracking | [BUGS.md](BUGS.md) |
| Code review findings | [CODE_REVIEWS.md](CODE_REVIEWS.md) |
| Test documentation | [TESTING.md](TESTING.md) |
| AI agent instructions | [CLAUDE.md](../CLAUDE.md) (not for humans -- see this guide instead) |

---

*Divergent Health Technologies -- divergent.health*
*Last updated: 2026-04-06*
