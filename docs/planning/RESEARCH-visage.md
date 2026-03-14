# Visage 7 / Pro Medicus -- Deep Technical Architecture Benchmark

**Date**: 2026-03-10
**Classification**: Competitive Intelligence
**Subject**: Visage 7 Platform, Pro Medicus Limited

---

## Executive Summary

Visage 7 is the purest server-side rendering implementation in the PACS market. Built in C++/Qt by a team of German visualization researchers (originally a Zuse Institute Berlin spinoff), it renders everything on GPU servers and streams only pixels to clients. The platform is a single codebase covering viewer, archive, workflow, and AI -- no acquired/integrated components. Pro Medicus has achieved 100% customer retention since 2009, ~72% EBIT margins, and is winning the largest US health system contracts on a transactional (per-study) pricing model.

**Key architectural insight**: Visage is the opposite extreme from our viewer. We do everything client-side; Visage does everything server-side. Their advantage is handling any dataset on any device. Their cost is a GPU cloud infrastructure bill that scales with concurrent users. Their business model (per-study fees on 7-10 year contracts) funds this infrastructure.

**Comparison to Sectra**: Sectra uses a hybrid (thick client 2D + server 3D). Visage is pure SSR for everything. Sectra wins on KLAS satisfaction (workflow polish over 30 years). Visage wins on speed, cloud-native architecture, and the largest new contracts.

**Comparison to Philips IM15**: Both are SSR, but Visage has been doing it for 15+ years while Philips just launched. Visage's single codebase vs. Philips' acquired/integrated stack. Visage has 100% retention; Philips has 63.9 KLAS and customers leaving.

---

## 1. Company History

**The lineage explains the technical DNA:**

1. **~1990s**: Amira 3D visualization software developed at **Zuse Institute Berlin (ZIB)** by Hans-Christian Hege, Detlev Stalling, and Malte Westerhoff. High-performance scientific visualization research.
2. **1999**: **Indeed - Visual Concepts GmbH** founded as ZIB spinoff (Berlin) to commercialize Amira. Exhibited at CeBIT.
3. **2003**: Indeed acquired by **Mercury Computer Systems** (Massachusetts, NASDAQ). Mercury specialized in high-performance signal/image processing for defense and medical markets.
4. **2007**: Mercury forms **Visage Imaging** as wholly owned subsidiary for life sciences and medical imaging.
5. **2009**: **Pro Medicus Limited** (Melbourne, Australia) acquires Visage Imaging from Mercury. Mercury characterized it as "divesting unprofitable and non-core businesses." Visage had ~1,200 clients at acquisition.
6. **2009+**: Pro Medicus pivots Visage from advanced visualization/OEM tool to enterprise PACS platform.
7. **~2020**: All new installations become cloud-based (CloudPACS era).
8. **2024-2025**: $520M+ in new contracts. 11 of top 20 US hospitals on platform.

**Key people:**
- **Dr. Sam Hupert**: CEO and co-founder of Pro Medicus (since 1983)
- **Dr. Malte Westerhoff**: Co-founder of Indeed - Visual Concepts, Global CTO of Pro Medicus, General Manager of Visage Imaging GmbH (Berlin). PhD from Freie Universitat Berlin. The technical mind behind the rendering architecture.

**Offices**: San Diego (US HQ), Berlin (R&D and product engineering), Melbourne (Pro Medicus corporate HQ).

---

## 2. Server-Side Rendering Architecture

### Core Components

```
Visage Backend Server (virtualizable)
  |-- DICOM ingestion, storage, preprocessing
  |-- Connected to EBS (fast access) and S3 (archive)
  |
Visage Render Server(s) (GPU-accelerated)
  |-- One or multiple render servers per deployment
  |-- Commercially available NVIDIA GPUs
  |-- All rendering: 2D, MPR, MIP, volume rendering
  |-- Patented adaptive streaming to clients
  |
Thin Client (native app or HTML5 browser)
  |-- Receives rendered pixel streams only
  |-- DICOM data never leaves the server
```

### How It Works

1. DICOM data ingested and stored on the backend server
2. Cross-sectional data (CT, MR, PET/CT, DBT) is **pre-processed** at ingest -- volumes prepared for immediate MPR/MIP/VR
3. When a radiologist opens a study, the render server loads the data into GPU memory
4. GPU renders the requested viewport (2D slice, MPR plane, 3D volume, etc.)
5. Rendered pixels compressed and streamed via **patented adaptive streaming** protocol
6. Client displays the streamed frames and captures user input
7. User interactions (scroll, W/L, rotate) sent back as lightweight commands
8. Server re-renders and streams updated frames

### GPU Hardware

- Historically documented: **NVIDIA Quadro K6000** (12 GB VRAM) per the NVIDIA case study
- Current hardware: "commercially available GPUs" -- specific models not publicly disclosed
- GPUs used for both rendering and AI inference
- Architecture scales by adding more render servers

### Patented Adaptive Streaming

The streaming protocol is proprietary and described as "patented" across all Pro Medicus materials. What is publicly known:

- **Not traditional DICOM transfer** -- DICOM is processed server-side and never retransmitted
- Streams "lossless image pixels" adaptively
- **Dynamically adapts to available bandwidth** -- works down to 6 Mbps (consumer broadband)
- Works through VPN and Citrix (no special network requirements)
- "100% on-demand while using less bandwidth than legacy PACS"
- Platform-independent streaming protocol

**What is NOT disclosed**: The specific codec (JPEG? H.264? proprietary?), transport protocol (WebSocket? custom TCP?), frame rate during interaction, or adaptive quality degradation strategy. The exact patent numbers are also not publicly referenced.

### Pre-Processing Strategy

Key to Visage's speed: thin-slice volumes are pre-processed at the server upon ingest, not on-demand. This means:
- MPR/MIP/VR are **immediately available** when a radiologist opens a study
- No reconstruction delay -- the data is already prepared
- GPU memory is loaded proactively for likely-needed studies via auto-prior rules

---

## 3. Client Architecture

Visage uses a **"smart client"** model -- NOT a pure zero-footprint browser for primary diagnosis:

### Primary Diagnostic Client (Visage 7)

- **Native application** for Windows and macOS (identical functionality on both)
- One-time download with integrated auto-update
- Zero plugins, zero browser dependency
- Performance is "essentially independent of RAM, local disk speed, local disk capacity, number of displays, number of cores, CPU speed, and OS"
- The client receives rendered pixel streams, not DICOM data
- 64-bit native application

### Visage 7 Web (HTML5)

- HTML5 browser-based viewer (Chrome, Safari confirmed)
- Introduced globally at RSNA 2025 (version 7.1.20)
- Includes on-the-fly MPR
- Ultrafast enterprise imaging viewing
- Secure mobile viewing
- This is the zero-footprint option -- but the native client is primary for diagnostic reading

### Mobile (Visage Ease / Ease Pro)

- iOS/iPadOS apps for clinical (non-diagnostic) viewing

### Apple Vision Pro (Visage Ease VP)

- Spatial computing app with cinematic rendering engine
- 4K+ resolution per eye
- Eye, hand, and voice input
- Showcases the SSR advantage: the heavy rendering is server-side, so even a headset can display volumetric data

---

## 4. Single Codebase Architecture

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Primary language** | C++ (confirmed from Berlin job postings) |
| **UI framework** | Qt (confirmed from job postings) |
| **Database** | SQL Server |
| **Additional** | .NET/C# (beneficial, per job listings) |
| **R&D location** | Berlin, Germany (primary engineering center) |

### What "Single Codebase" Means

All of these are native Visage code -- not acquired, not third-party:
- Enterprise PACS viewer (diagnostic quality)
- **Open Archive** (vendor-neutral archive, S3-backed, immutable storage for ransomware protection)
- Workflow engine (native worklist management, hanging protocols, auto-prior)
- **AI Accelerator** platform
- Digital pathology viewer (since RSNA 2025)
- Mobile viewers (Ease, Ease Pro, Ease VP)
- HTML5 web viewer

"100% of Visage's advanced visualization features are native Visage code." No external or third-party code for advanced capabilities.

### Open Archive

- Built into the platform, not a separate product
- Uses **Amazon S3** for object storage
- **Immutable storage** -- archived objects cannot be modified (ransomware protection)
- Vendor-neutral: stores standard DICOM
- Highly parallel I/O streams to object-based cloud storage

---

## 5. Performance

### Published Claims

| Metric | Claim |
|--------|-------|
| Image display | Subsecond |
| vs. legacy PACS | 2-3x faster (measured in cloud deployments) |
| Image loading vs. competitors | 60-70% faster |
| Radiologist throughput | 20-25% more cases per day |
| Reading efficiency | 30-50% increase reported by customers |
| Turnaround time | 37% faster |
| 6,000-slice thin-cut CT | "In seconds" |
| 6 GB 3D mammography | 2-3 seconds (from NVIDIA case study) |
| Minimum bandwidth | 6 Mbps (consumer-grade) |
| Performance vs. local hardware | "Essentially independent" of client specs |

### How Speed Is Achieved

1. **Pre-processing at ingest**: Volumes reconstructed and cached before the radiologist ever opens the study
2. **GPU-accelerated rendering**: Everything rendered on server GPUs, not waiting for data transfer
3. **Adaptive streaming**: Only rendered pixels sent, not raw DICOM (orders of magnitude less data)
4. **Parallel I/O**: Highly parallel streams to cloud object storage
5. **Auto-prior loading**: Relevant comparison studies preloaded via rules and hanging protocols
6. **Dynamic cloud elasticity**: Resources scale with demand

### Scalability

- Supports "tens of millions of annual studies" per deployment
- Designed for "even the world's largest healthcare organizations"
- Trinity Health: 92 hospitals, 330M+ studies over 10 years
- ~65% of US customers fully cloud-based

---

## 6. AI Integration

### AI Accelerator Platform

End-to-end AI solution bridging research and diagnostic imaging on the same platform:

- **Open AI API** for third-party algorithm integration (standards-based)
- Supports all algorithm types: native Visage, third-party, co-developed, self-developed
- Python support, NIfTI format, FHIR integration
- 3D segmentation support
- Bulk data anonymization for research
- Ground truth labeling
- Semantic annotations (making annotations meaningful for AI training)
- Radiomics

### AI Features in the Viewer

- AI-inference-based workflow prioritization and orchestration
- In-viewer integrated AI-powered reporting
- Automated impression generation
- Error-checking mechanisms
- Paste-to-PowerScribe functionality
- **Visage 7 Ix**: imaging history report chat (conversational AI over patient imaging history)
- **Visage 7 AI-OS BMD**: opportunistic screening bone mineral density

### Partnerships

- **Elucid Bioimaging**: $5M investment for FFR-CT and plaque characterization AI in cardiology
- **RadPath Hub**: correlates radiology findings with pathology results for confirmed study cohorts

---

## 7. AWS Cloud Infrastructure

### AWS Partnership

- Advanced Technology Partner in AWS Partner Network (since 2022)
- Passed AWS Well-Architected Framework Foundational Technical Review
- FedRAMP clearance for Department of Defense and VA

### AWS Services Used

| Service | Purpose |
|---------|---------|
| **Amazon EC2** | Compute for render servers and backend servers |
| **Amazon EBS** | Block storage for fast-access active studies |
| **Amazon S3** | Object storage for archive (immutable, ransomware-resistant) |
| **AWS Direct Connect** | Dedicated secure connections for enterprise customers |
| **Amazon HealthLake Imaging** | Cloud-native DICOM storage adapter (petabyte scale) |

Specific EC2 GPU instance types (G4, G5, P4, etc.) are not publicly disclosed.

### Architecture Design

- Always deployed in **at least two cloud environments**
- Multiple availability zones for redundancy
- Multiple Direct Connect links for zero downtime
- Dynamic allocation of cloud resources for elasticity

### Cloud Posture

- All new installations since ~2020 are cloud-based
- ~65% of US customers fully cloud-based
- Visage explicitly **advocates against hybrid deployments** (blog post: "Embracing Full Cloud Adoption: Why Hybrid Solutions Compromise Security and Efficiency")
- Cloud-vendor "agnostic" with deployments across AWS, Azure, and Google Cloud (AWS is primary)

---

## 8. Deployment Model

### Cloud-First (Strongly Preferred)

- All new installations since ~2020 are cloud
- Visage discourages hybrid as a compromise
- Implementation: typically **11 months** vs. industry average 2-3 years (Mercy Health completed in under 6 months)

### Supported Architectures

1. **Centralized cloud** (single region) -- preferred
2. **Decentralized** (federated Visage servers across regions)
3. **Hybrid** (supported but discouraged)
4. **Coexistence** with on-premise legacy during migration

### Network Requirements

- Minimum: **6 Mbps** bandwidth (consumer-grade)
- Works over VPN and Citrix
- Recommended: multiple Direct Connect links for enterprise
- Performance "largely equivalent" on LAN, WAN, and internet connections

---

## 9. Business Model

### Transaction-Based Pricing

The pricing model is fundamental to understanding Visage's success:

- **Per-study/per-scan fee** -- revenue grows automatically with imaging volumes
- NOT a flat license fee or per-seat subscription
- Long-term contracts: typically **7-10 years**
- Guaranteed volume floors: usually ~80% of run rate at signing
- **5% one-off data migration fee**
- Higher per-transaction fees negotiated on renewal

### Major Contracts

| Customer | Value | Duration | Year |
|----------|-------|----------|------|
| Lurie Children's + Duly | $365M combined | 7-10 years | 2025 |
| Trinity Health (92 hospitals) | $330M | 10 years | 2024 |
| UCHealth | $170M | 10 years | 2025 |
| Baylor Scott & White | $140M | 10 years | 2023 |
| Mercy Health (renewal) | $98M | 8 years | 2024 |
| Duke Health | $40M | - | 2025 |

### Financial Performance (FY 2025)

| Metric | Value |
|--------|-------|
| Revenue | A$213M (up 31.9%) |
| Net profit | A$115.2M (up 39.2%) |
| EBIT margin | ~72% |
| Debt | Zero |
| Cash | A$182M+ |
| Forward contracted revenue | A$1.08B+ over 5 years |
| North America share | ~90% of revenue |
| US TAM | US$670M (~10% current penetration) |
| Customer retention | **100% since 2009** (no hospital has ever left) |

---

## 10. Standards Compliance

### DICOM

Full conformance statement published (159 pages):
- Storage-SCP: accepts DICOM objects across all standard SOP classes
- C-STORE SCP/SCU
- C-FIND (Query/Retrieve)
- C-MOVE
- Storage Commitment
- Verification service class

### DICOMweb

- WADO-RS, QIDO-RS, STOW-RS supported through Amazon HealthLake Imaging adapter

### IHE Profiles (validated at IHE Europe Connectathon 2016)

- Digital Breast Tomosynthesis (DBT): Image Manager, Image Display
- Image Object Change Management (IOCM): Image Manager, Image Display, Change Requestor
- XDS.b: Document Consumer
- IHE Digital Pathology Workflow (validated 2025)

### HL7/FHIR

- HL7 for RIS/EHR integration
- FHIR referenced in AI Accelerator platform
- Tight bi-directional Epic integration (multi-tabbed context launch, secure SSO, WADO-based retrieval)

---

## 11. Patent Portfolio

The adaptive streaming technology is repeatedly described as "patented" across all Pro Medicus materials. Dr. Malte Westerhoff is described as author/co-author of "a number of patents."

**Specific patent numbers are NOT publicly referenced** in marketing, press releases, or investor presentations. Direct USPTO searches for "Visage Imaging" and "Pro Medicus" did not surface results -- patents may be filed under individual inventor names, under "Indeed - Visual Concepts GmbH," or under Mercury Computer Systems from the pre-acquisition period. A professional patent landscape analysis would be needed to identify specific filings.

This is a notable gap in our research. Visage's patent protection is clearly important to their strategy (it's mentioned constantly) but the actual patent claims are opaque.

---

## 12. Competitive Advantages

### Why Visage Wins the Largest Deals

1. **Pure SSR = device agnostic**: Any radiologist, any location, any device, same performance. Critical for large health systems with diverse IT environments.
2. **Speed**: 60-70% faster image loading than competitors. Pre-processing at ingest means zero reconstruction delay.
3. **Cloud-native**: Built for cloud from the ground up, not migrated. All new installs are cloud.
4. **Single codebase**: Viewer + archive + AI + workflow in one platform. No integration seams.
5. **Transaction pricing**: Aligns vendor success with customer growth. No upfront capital expenditure.
6. **Implementation speed**: 11 months vs. 2-3 years industry average.
7. **100% retention**: No hospital has ever left since 2009. Enormous switching costs.
8. **FedRAMP**: Opens DoD and VA contracts.

### vs. Sectra

| Dimension | Visage | Sectra |
|-----------|--------|--------|
| Architecture | Pure SSR | Hybrid (thick client 2D + server 3D) |
| Cloud | Cloud-native, cloud-first | Azure cloud, but on-prem heritage |
| KLAS | Strong but not #1 | #1 for 13 consecutive years |
| 2D interaction latency | Server round-trip | Local (instant) |
| Market position | Winning largest new US contracts | Strongest international, broad base |
| Pricing | Per-study transactional | Traditional licensing |
| Workflow maturity | Good | Best in class (30 years of iteration) |
| Pathology | New (2025) | Established leader |

### vs. Philips IM15

| Dimension | Visage | Philips IM15 |
|-----------|--------|-------------|
| SSR maturity | 15+ years | Just launched (2025) |
| Codebase | Single, purpose-built | Acquired (Algotec/Carestream lineage) |
| Customer satisfaction | 100% retention | 63.9 KLAS, customers leaving |
| Cloud | AWS-native | AWS (HealthSuite) |
| AI | Native AI Accelerator | AI Manager (140+ third-party apps) |
| Reporting | In-viewer | Native module |
| Market momentum | $520M+ new contracts | Defensive rebuild |

---

## 13. Comparison to Our Viewer

### Architectural Contrast

| Aspect | Visage 7 | Our Viewer |
|--------|----------|------------|
| **Rendering** | Server-side (GPU cloud) | Client-side (browser JavaScript) |
| **DICOM processing** | Server (C++) | Browser (JavaScript) |
| **Client** | Native app (C++/Qt) + HTML5 web | Browser only |
| **Data transfer** | Rendered pixels only | Full DICOM pixel data |
| **3D** | Server GPU, pre-processed at ingest | Planned (vtk.js, client-side) |
| **Archive** | Built-in (S3 immutable) | None (local files) |
| **AI** | Native platform (AI Accelerator) | None |
| **Offline** | No (requires server) | Full |
| **Privacy** | Data on cloud servers | Data never leaves browser |
| **Cost to operate** | High (GPU cloud per-user) | Near zero |
| **Minimum bandwidth** | 6 Mbps | None (local files) |
| **Client hardware** | Any (rendering is server-side) | Needs browser RAM for study |

### What We Can Learn from Visage

1. **Pre-processing at ingest is powerful**: Visage pre-reconstructs volumes at ingest so they're instantly available. For our cloud platform, we could pre-transcode to HTJ2K and pre-compute common reformats at upload time rather than on-demand.

2. **Single codebase matters**: Visage's "no integration seams" philosophy means no context switching, no data translation between components. Our single index.html SPA has this same quality -- preserve it as we add features.

3. **Transaction pricing funds infrastructure**: Visage's per-study model means their GPU cloud costs are covered by usage. If we ever need server-side compute (3D, AI), a per-study fee model could fund it without upfront capital.

4. **Immutable archive for ransomware protection**: Visage's Open Archive uses S3 with immutable objects. Worth noting for our cloud platform storage design.

5. **Auto-prior loading**: Visage automatically loads relevant comparison studies before the radiologist asks. This is a workflow feature that would significantly improve our viewer's usability for follow-up reads.

6. **The native client still exists**: Even Visage, the purest SSR vendor, ships a native desktop client (C++/Qt) as the primary diagnostic tool. The HTML5 viewer is secondary. This suggests that for diagnostic-quality primary reading, native clients still have advantages over browsers -- something to consider for our Tauri desktop app.

---

## Sources

### Product and Company
- [Pro Medicus -- Visage 7](https://www.promed.com.au/visage-7/)
- [Visage 7 Functionality](https://www.promed.com.au/visage-7/functionality/)
- [Visage 7 Scalability](https://www.promed.com.au/visage-7/scalability/)
- [Visage 7 Speed](https://www.promed.com.au/visage-7/speed/)
- [Visage Imaging Platform](https://visageimaging.com/platform/)
- [Visage Open Archive](https://visageimaging.com/platform/open-archive/)
- [Visage AI Accelerator](https://visageimaging.com/platform/acceleratedai/)
- [Visage on Apple](https://visageimaging.com/platform/visage-on-apple/)
- [Visage Careers (Berlin)](https://visageimaging.com/about/careers/)

### Cloud and Technical
- [AWS Case Study -- Visage Imaging](https://aws.amazon.com/solutions/case-studies/visage-imaging-case-study/)
- [NVIDIA Quadro Case Study -- Visage](https://www.nvidia.com/content/quadro/quadro-case-studies/pdf/casestudy-visageimaging.pdf)
- [Visage Joins AWS Partner Network](https://www.prnewswire.com/news-releases/visage-joins-the-aws-partner-network-301575520.html)
- [Visage + Amazon HealthLake Imaging](https://www.prnewswire.com/news-releases/visage-announces-support-of-amazon-healthlake-imaging-301686559.html)
- [AWS Marketplace -- Visage 7 Enterprise](https://aws.amazon.com/marketplace/pp/prodview-wuuni73go67gy)
- [Visage DICOM Conformance Statement (PDF)](https://www.visageimaging.com/downloads/Visage7/Visage7_DICOMConformanceStatement.pdf)
- [Embracing Full Cloud Adoption -- Visage Blog](https://blog.visageimaging.com/blog/embracing-full-cloud-adoption)

### Press Releases
- [Visage at RSNA 2025](https://www.prnewswire.com/news-releases/visage-propels-ai-optimized-enterprise-imaging-at-rsna-2025-302620362.html)
- [Visage at HIMSS26](https://www.prnewswire.com/news-releases/visage-elevates-ai-optimized-enterprise-imaging-at-himss26-302709118.html)
- [Visage CloudPACS at RSNA 2021](https://www.prnewswire.com/news-releases/visage-speeds-ahead-with-cloudpacs-at-rsna-2021-301425929.html)
- [Visage Ease VP for Apple Vision Pro](https://www.prnewswire.com/news-releases/visage-launches-visage-ease-vp-for-apple-vision-pro-302051963.html)
- [Visage 7 Scalability Benchmark (2014)](https://www.globenewswire.com/en/news-release/2014/10/08/671684/33401/en/Visage-7-Sets-New-Benchmark-in-Scalability.html)

### History
- [Pro Medicus Acquires Visage -- ITN Online](https://www.itnonline.com/content/pro-medicus-acquires-visage-imaging)
- [Mercury Announces Sale of Visage](https://ir.mrcy.com/news-releases/news-release-details/mercury-computer-systems-announces-sale-visage-imaging-pro)
- [Amira Software -- Wikipedia](https://en.wikipedia.org/wiki/Amira_(software))
- [IHE Europe Connectathon 2016 -- Visage](https://www.prnewswire.com/news-releases/interoperability-shines-with-visage-at-ihe-europe-connectathon-2016-300285896.html)
- [Sectra History (Linkoping University)](https://liu.se/en/news-item/sectra-a-world-leading-company-with-roots-in-liu-research)

### Financial and Market
- [Pro Medicus FY2025 Results](https://www.promed.com.au/pro-medicus-limited-full-year-results-9/)
- [Pro Medicus HY2026 Slides](https://www.investing.com/news/company-news/pro-medicus-hy-2026-slides-reveal-strong-growth-despite-stock-price-drop-93CH-4501614)
- [Healthcare in Europe -- Visage 7 Efficiency](https://healthcare-in-europe.com/en/news/visage-7-true-efficiency-for-your-workflow.html)
- [Pro Medicus Business Model Analysis](https://matrixbcg.com/blogs/how-it-works/promedicus)
- [Visage 7 vs Sectra PACS Comparison](https://www.taloflow.ai/guides/comparisons/promedicusvisage7-vs-sectrapacs-medical-imaging)
