# Research Thinking Process

## Approach

A single comprehensive research agent was deployed, running 85 tool calls (web searches and page fetches) across Sectra's product pages, technical documentation, conformance statements, GitHub repos, patent databases, FDA filings, KLAS reports, press releases, case studies, and job postings.

## Key Research Findings

### More Transparent Than Philips

Sectra is significantly more forthcoming about their architecture than Philips. Their product pages, conformance statements, GitHub SDK, and cloud architecture guides provided substantial technical detail. The main gaps are the same as any enterprise vendor: specific GPU hardware, rendering codecs, internal protocols, and frontend framework choices.

### The Hybrid Insight

The most important architectural finding is Sectra's hybrid rendering model. While the industry narrative (driven by Visage and now Philips) is "server-side rendering is the future," Sectra -- the market leader for 13 years -- kept a thick client for 2D rendering. This is a deliberate choice: 2D operations (scroll, W/L, zoom) happen thousands of times per reading session, and each one being instant vs. 50-200ms makes a cumulative difference in radiologist satisfaction and throughput.

This validates our ADR 004 decision to keep client-side rendering for 2D and only consider server-side for 3D.

### RapidConnect = JPEG 2000 Progressive Decoding + Smart Caching

RapidConnect sounds proprietary and magical in Sectra's marketing, but the core mechanism is straightforward: JPEG 2000's wavelet codec supports progressive resolution refinement by design. Sectra wraps this in intelligent prioritization (which slices first), dynamic data reduction (skip empty regions), and local caching. The "patent-pending" parts are likely the prioritization and caching algorithms, not the progressive streaming itself.

This is directly relevant to our cloud platform plans. HTJ2K (the faster JPEG 2000 variant that AWS HealthLake Imaging uses) has the same progressive capability. We could implement something functionally similar to RapidConnect without any of their patents.

### Pathology Tile Streaming

The pathology data was unexpectedly relevant. Sectra streams 0.5-150 GB whole-slide images by serving only 512x512 tiles for the current viewport and zoom level, with only 2-3% of data transferred per session. This is the same pattern as Google Maps / Mapbox for geographic data. It applies to any large medical image, not just pathology.

### Workflow > Technology

The KLAS data is unambiguous: Sectra wins on workflow, not rendering. Their patented Dynamic Display Protocol engine (US 7,162,623) auto-arranges studies based on modality, anatomy, procedure, monitor config, and user identity. Radiologists don't spend time arranging images -- they just read. This is the highest-leverage feature we could eventually add.

## What We Could Not Determine

- UniView's browser technology stack (WebGL? Canvas? Framework?)
- 3D Core's rendering API (OpenGL? Vulkan? CUDA?)
- Specific GPU hardware on rendering servers
- Streaming codec for 3D Core frames (JPEG? H.264?)
- Bandwidth per concurrent UniView user
- Frame rate during rapid scroll in UniView
- IDS7's specific .NET version and UI framework (WPF? WinForms?)
- Whether UniView uses any client-side rendering at all

## Confidence Assessment

- **High confidence**: Platform architecture, hybrid rendering model, JPEG 2000 internal storage, Azure cloud, SQL Server/Oracle databases, .NET client, DICOMweb support, patent portfolio
- **Medium confidence**: RapidConnect mechanism (progressive JPEG 2000 is confirmed, prioritization algorithms are inferred), 3D Core streaming approach (server-rendered images confirmed, specific codec unknown)
- **Low confidence**: UniView browser tech stack, specific GPU hardware, rendering APIs
