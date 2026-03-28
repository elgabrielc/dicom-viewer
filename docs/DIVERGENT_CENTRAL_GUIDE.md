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

The product starts as a desktop app and grows into a cloud platform.

### Who It's For

Today: individuals who want to view and organize their own medical imaging. Patients who get CDs from hospitals. Physicians reviewing outside studies. Researchers working with DICOM datasets.

Tomorrow: the same people, plus teams who need to share and collaborate on imaging. The cloud platform enables this.

### What Makes It Different

- **You own your data.** Imaging stays on your machine (desktop) or in your account (cloud). No vendor lock-in on the data itself.
- **It works offline.** The desktop app is fully functional without an internet connection. Cloud sync is additive, not required.
- **It's a library, not just a viewer.** Import once, always there. Organized by study and series. Notes and reports attached.

---

## Product Philosophy

### Two Data Domains

The system has two fundamentally different data domains. They share infrastructure where convenient, but they are not the same thing and must not be coupled.

**Imaging** -- DICOM files, pixel data, study/series/slice organization, transfer syntaxes, decoders, rendering. Large, immutable binary objects. Read-heavy, write-once. The core viewer pipeline.

**Annotations** -- notes, comments, reports, measurements, labels. Lightweight, mutable, user-generated metadata layered on top of imaging. Keyed by DICOM UIDs but with their own lifecycle (created, edited, deleted, synced).

These domains have different storage characteristics, different sync requirements, different performance profiles, and different compliance implications. In a company context, they would be owned by different engineering teams. Design decisions, APIs, persistence layers, and sync protocols should respect this boundary.

When in doubt, ask: "Is this about the imaging pipeline or the annotation layer?" and keep the answer in its own lane.

### Local-First, Cloud-Second

The desktop app is the primary product today. It must be fully functional without any server or internet connection. Cloud sync is a layer on top, not a dependency underneath.

This means:
- All writes go to local storage first. The UI reads from local storage.
- Cloud is a replication target, not a primary store.
- If the network disappears, the app keeps working. Changes queue locally and sync when connectivity returns.

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
- Client-side DICOM processing -- pixel data is decoded in the browser/app, not on a server.
- No telemetry, no analytics, no third-party tracking.
- Demo site is stateless -- no data persists between visits.
- Cloud platform (future) will require explicit account creation and consent.

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
| **Desktop** | Tauri shell | SQLite + managed library folder | Individual users (primary product) |
| **Cloud** | app.divergent.health (future) | Server-side + local cache | Logged-in users |

Detection is via Tauri first, then hostname. Feature flags route through `CONFIG.deploymentMode`.

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

**Cloud (future):**
The managed library folder becomes a local cache of the cloud state. The sync engine uploads from and downloads into this folder. Each device materializes only the studies it needs. See [ADR 006](decisions/006-cloud-sync-storage-architecture.md) and the [managed folder principle](planning/PRINCIPLE-managed-folder-as-local-cache.md).

---

## History and Key Decisions

The product started as a browser-based DICOM viewer and evolved into a desktop application with a path to cloud.

**January 2026 -- Browser viewer.**
Initial release. Web-based DICOM viewer with drag-and-drop folder loading, slice navigation, and basic windowing. Chose vanilla JS over React/Vue for simplicity. Client-side processing for privacy. Dark theme for radiologist viewing environment. Added sample CT and MRI scans, viewing tools (W/L, Pan, Zoom), measurement tool, and automated Playwright test suite.

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

**Other key decisions:**
- Client-side rendering for the cloud platform, not server-side ([ADR 004](decisions/004-cloud-platform-rendering-architecture.md))
- macOS launch.command for double-click startup ([ADR 001](decisions/001-launch-command.md))
- vtk.js for 3D volume rendering (industry standard, Kitware-backed)

---

## Roadmap

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

### Next: Cloud Sync (Annotations First)

Sync notes, comments, and reports across devices. The desktop app remains fully functional offline. Cloud is additive.

- User accounts and authentication
- Sync engine: outbox-based replication, delta cursors, tombstones
- Server infrastructure (Flask or separate service, TBD)
- DICOM file sync deferred to after annotation sync is stable

See [ADR 006](decisions/006-cloud-sync-storage-architecture.md) and [Sync Contract v1](planning/SYNC-CONTRACT-V1.md).

### Later: Cloud Platform

The full hosted service at app.divergent.health.

- DICOM file sync (managed folder as upload source, selective sync per device)
- Sharing and collaboration
- Server-side search and organization
- Multi-platform (Windows, Linux desktop; mobile TBD)

### Future: Advanced Imaging

- 3D volume rendering with medical presets (CT soft tissue, bone, lung; MRI brain, spine)
- Multi-planar reconstruction (MPR)
- Hanging protocols
- AI-assisted analysis (integration points, not building our own models)

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
*Last updated: 2026-03-28*
