# Research Thinking Process

## Approach

Three parallel research agents were deployed to maximize coverage:

1. **Architecture agent** -- focused on SSR rendering pipeline, Vue PACS predecessor, zero-footprint technology, large dataset handling
2. **AI and cloud agent** -- focused on AI integration, HealthSuite platform, reporting module, RadConnect research
3. **Competitive agent** -- focused on market positioning, KLAS scores, standards compliance, patent filings, job posting analysis

## Key Research Challenges

### Limited Technical Disclosure

Philips, like all enterprise medical device companies, treats architecture as proprietary. The product launched November 2025 to "select customers" with no published conformance statement, no technical whitepapers, and no developer documentation. This means much of the architecture had to be inferred from:

- FDA filings (K240822 confirmed manufacturing location and predicate device)
- Patent analysis (US20150074181 from the Carestream/Algotec lineage)
- Job postings (C++, C#, WPF, XAML, OpenGL for rendering engine team)
- AWS documentation (HealthLake Imaging, HTJ2K, GPU instances)
- Predecessor Vue PACS documentation (VA OIT assessment, conformance statements, load balancer guides)
- Comparable vendor documentation (Visage 7 is architecturally similar and more forthcoming)
- Press releases and RSNA coverage (marketing language parsed for technical signals)

### Inference vs. Confirmed

The report clearly distinguishes between confirmed facts (from primary sources) and inferences (from industry patterns, patent analysis, and comparable systems). Key inferences:

- **Streaming protocol**: JPEG over WebSocket is inferred from industry standard practice; could be H.264 or proprietary
- **Hybrid rendering**: The patent describes client-side 2D + server-side 3D; whether IM15 uses this is unknown
- **GPU hardware**: NVIDIA T4/L4 GPUs inferred from AWS G4/G6 instances; Philips may use custom configurations
- **Frontend framework**: Completely unknown; could be React, Angular, Vue, or custom

### Product Lineage Discovery

A critical finding was tracing the product lineage: Algotec (Israel) -> Kodak -> Carestream -> Philips. This explains:
- Why the R&D center is in Raanana, Israel
- Why the FDA predicate is a Carestream product
- Why the old architecture was .NET/Java/IIS (Carestream era technology choices)
- Why the patent (US20150074181) is assigned to the Carestream entity

### Strategic Context

The KLAS data was the most revealing strategic signal. Philips' 63.9 score (lowest ranked vendor, dropping 6.9 points) with the explicit 2026 KLAS comment "clients are replacing the system" explains why IM15 exists. This is not an innovation play -- it is a survival play. Philips is losing customers to Sectra (91.0/93.0) and Visage ($520M in new contracts).

### RadConnect Analysis

The RadConnect research papers were found via PubMed (PMID: 37914652 and 38955962). The clinical evaluation showed genuinely promising results (53% reduction in synchronous consults, 77% drop in phone volume) but the product was never commercialized. The most likely explanation is strategic absorption -- the prioritized-worklist concept from RadConnect maps directly onto the "Agentic AI for workflow orchestration" that Philips is now developing.

## What We Could Not Determine

Despite extensive searching:
- **Exact streaming protocol** (JPEG vs H.264 vs WebRTC)
- **Client-side rendering capabilities** (any WebGL/WASM use?)
- **Frontend framework** (React? Angular? Custom?)
- **Specific GPU hardware** in their rendering farm
- **Bandwidth per concurrent user**
- **Latency specifications** for interactive operations
- **Frame rate** during rapid scroll
- **Concurrent user capacity**
- **Pricing model** (per-seat? per-study? enterprise license?)

These are all proprietary details that Philips does not disclose. Even Visage, which is more transparent, does not publish specific latency or frame rate numbers.

## Comparison Framework

The comparison to our viewer was structured around architectural tradeoffs rather than feature checklists. The fundamental insight is that SSR and client-side rendering are not "better or worse" -- they are optimized for different constraints:

- **SSR optimizes for**: large datasets, compute-heavy operations, device agnosticism, centralized control
- **Client-side optimizes for**: latency, offline use, privacy, cost, simplicity

The ideal architecture (and what the patent describes) is hybrid: client-side for responsive 2D interaction, server-side for compute-heavy 3D operations. This aligns with our planned vtk.js integration -- though we are doing client-side 3D rather than server-side, which trades compute power for latency and privacy.
