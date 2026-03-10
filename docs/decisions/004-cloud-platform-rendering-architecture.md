<!--
  ADR 004: Cloud Platform Rendering Architecture
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# ADR 004: Cloud Platform Rendering Architecture

## Status

Proposed

## Context

The cloud platform deployment mode (future app.divergent.health) needs to serve studies from server-side storage to authenticated users across devices. The key architectural question is where image rendering happens: server-side (GPU cloud renders frames, streams pixels to browser) or client-side (browser downloads pixel data and renders locally, as it does today).

This decision was prompted by benchmarking Philips Image Management 15, which uses server-side rendering (SSR) to stream pre-rendered JPEG frames from GPU cloud servers to a thin browser client. See [RESEARCH-philips-im15.md](../planning/RESEARCH-philips-im15.md) for the full analysis.

## Decision

**Cloud storage with client-side rendering.** The browser downloads DICOM pixel data from a DICOMweb API backed by cloud storage and renders locally. The existing rendering pipeline does not change -- only the data source changes (DICOMweb fetch instead of File System Access API).

Server-side compute is reserved for operations the browser genuinely cannot perform:

- **Progressive transcoding**: Server converts DICOM to HTJ2K (High Throughput JPEG 2000) for fast progressive loading -- low-res preview first, full resolution on demand.
- **AI processing**: Segmentation, findings detection, and other model inference runs server-side. Results are overlaid on client-rendered images.
- **3D fallback**: If vtk.js in the browser cannot handle a specific dataset size, a server-side rendering path can be offered as a fallback. Client-side 3D is attempted first.

## Alternatives Considered

### Full server-side rendering (Philips IM15 model)

All rendering on GPU cloud servers. Browser is a thin display client.

Rejected because:
- **Cost**: GPU compute per concurrent user is expensive. Philips charges enterprise prices to cover this. Our client-side approach makes rendering free -- the user's CPU does the work.
- **Latency regression**: Every scroll, W/L adjustment, and zoom requires a server round-trip (50-200ms). Our current viewer is instant. Going to SSR is a UX downgrade for 2D viewing.
- **No offline capability**: SSR requires constant server connection. Client-side rendering allows caching studies in the browser for offline use.
- **Solves a problem we don't have**: SSR is designed for serving hundreds of radiologists reading 4 GB breast tomo studies on shared Chromebooks. Our user base and study sizes don't require this yet.

SSR makes sense for Philips because they have enterprise infrastructure budgets, hundreds of concurrent radiologists per site, and hospital IT that mandates thin clients. Our economics and user model are different.

### Hybrid server/client split at the feature level

Client-side for 2D, server-side for 3D/MPR/MIP. Described in Philips patent US20150074181.

Not rejected outright -- the "3D fallback" in our decision is a version of this. But we start with client-side 3D (vtk.js) and only add server-side 3D if browser limits prove insufficient in practice. No premature infrastructure.

## Consequences

**Positive:**
- Minimal code change from current architecture (swap data source, add auth)
- Low infrastructure cost (storage + API server, no GPU fleet)
- Preserves instant interaction (no rendering latency)
- Studies can be cached in browser for offline use
- Privacy story: data can be encrypted at rest, decrypted client-side

**Negative:**
- Large studies (4+ GB DBT, cardiac CT) remain constrained by browser memory. Progressive loading mitigates this but doesn't fully solve it.
- Client hardware matters -- low-end devices may struggle with large studies. SSR would eliminate this concern.
- If we later need SSR for specific use cases (large institutional deployments, thin client mandates), it would be a significant addition.

**Open questions (to resolve before implementation):**
- DICOMweb implementation: build our own or use an existing server (Orthanc, DCM4CHEE, AWS HealthLake Imaging)?
- Progressive loading format: HTJ2K, progressive JPEG 2000, or tiled approach?
- Client-side caching strategy: IndexedDB, Cache API, or service worker?
- Authentication model: JWT tokens, session cookies, OAuth?
