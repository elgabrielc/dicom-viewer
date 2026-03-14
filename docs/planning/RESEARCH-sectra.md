# Sectra Medical Imaging IT -- Deep Technical Architecture Benchmark

**Date**: 2026-03-10
**Classification**: Competitive Intelligence
**Subject**: Sectra IDS7 / UniView / One Cloud

---

## Executive Summary

Sectra has been KLAS #1 for 13 consecutive years by obsessing over radiologist workflow efficiency rather than pure technology innovation. Their architecture is a **pragmatic hybrid**: a .NET thick client (IDS7) for fast local 2D rendering, server-side 3D via GPU rendering (3D Core), and a zero-footprint browser viewer (UniView) for enterprise access. They use **JPEG 2000 internally with progressive streaming** (RapidConnect) to make large studies feel instant even over poor networks. Their cloud runs on **Microsoft Azure**.

**Key insight for us**: Sectra's success is not about the fanciest rendering pipeline -- it's about removing friction from the radiologist's reading workflow. Display protocols that auto-arrange studies correctly, worklists that prioritize intelligently, and a single application that handles radiology + pathology + cardiology without context switching. The technology serves the workflow, not the other way around.

**Comparison to Philips IM15**: Where Philips bet on a pure server-side rendering rebuild, Sectra kept the thick client for 2D (instant response) and only uses server-side for 3D. Where Philips is rebuilding to catch up, Sectra has been iterating for 30+ years. Sectra's 93.0 KLAS vs Philips' 63.9 reflects this difference.

---

## 1. Company Background

Sectra (SECure TRAnsmission) was founded 1978 at Linkoping University, Sweden, originally for cryptography and secure data transmission. In 1989, Torbjorn Kronander (now CEO) initiated expansion into digital radiology. In 1993, Sweden's first film-free radiology department was opened using Sectra systems. The company still operates in both medical imaging IT and cybersecurity -- a unique combination rooted in the same cryptographic expertise.

**Scale**: 170 million annual imaging exams globally, 2,500+ sites, direct sales in 19 countries, publicly traded on Nasdaq Stockholm (SECT B).

Key milestones:
- **1993**: First film-free radiology department (Mjolby, Sweden)
- **1999**: First digital orthopaedic surgery planning
- **2010**: Visualization Table (multi-touch 3D display)
- **2013**: First "Best in KLAS" award
- **2015**: Digital pathology for primary diagnostics
- **2026**: Acquired Oxipit (autonomous AI -- ChestLink, first CE Class IIb autonomous AI for chest X-ray)
- **2026**: 13th consecutive year as KLAS #1

---

## 2. IDS7 Platform Architecture

IDS7 is the radiologist's primary interface -- a **thick client deployed via ClickOnce** on Windows 10/11 64-bit.

### Server Components

| Component | Role |
|-----------|------|
| **SHS** (Sectra Healthcare Server) | Core server: PACS and database functionality |
| **WISE** | Database administration (Windows or HP-UX) |
| **ImageServer/s** | Short-term image storage |
| **ImageServer/xd** | Interface to external DICOM archives |
| **SSS** (Satellite Server) | Remote/distributed location buffer |
| **IDS7** | Workstation GUI (.NET architecture) |

### Client Interface

Three main windows:
- **Information Window**: Worklists with SLA indicators, integrated reporting with speech recognition, encrypted chat, patient data navigation
- **Image Window**: Primary diagnostic viewing -- DICOM, visible light (JPEG, PNG, TIFF, GIF, BMP), PDF, MPEG-4 video, MPEG-2 audio. Supports up to 4 monitors. AI results and third-party tools embedded inline.
- **Quick Window**: Simplified single-series review for QA checks

### Integration APIs

- **COM/ActiveX** -- legacy integration (Windows-native)
- **URL Launch SDK** -- modern approach. C# (.NET LTS) with Java/PowerShell examples. Uses PKI encryption (2048-bit, SHA-256/SHA-512) or shared-secret (32-byte symmetric key, 30-second timestamp validity). "Fire and forget" pattern. [GitHub: sectra-medical/SectraUrlLaunchSdk](https://github.com/sectra-medical/SectraUrlLaunchSdk)
- **FHIRcast** -- Sectra co-developed with Epic. Context synchronization standard under HL7. Sectra built the first reference implementation.
- **Sectra Medical API** -- formal integration interface (trademarked)

---

## 3. Rendering Architecture

### The Hybrid Model

Sectra uses a three-tier rendering approach:

**Tier 1 -- IDS7 Thick Client (local 2D rendering)**
- Standard 2D viewing, window/level, measurements, scrolling
- .NET client handles DICOM image rendering locally
- Fast: no network round-trip for basic interactions
- Hardware requirement: "ordinary" PC with quality graphics card and diagnostic monitors
- This is why Sectra feels snappy -- the most common operations are local

**Tier 2 -- 3D Core (server-side 3D rendering)**
- Volume rendering, MPR, CPR, MIP, MinIP, slab reconstructions
- Rendered on server GPU farm, streamed as images to client
- No GPU requirement on workstation for 3D
- Can alternatively be installed locally per-client
- Features: manual/semi-auto bone segmentation, bookmarks, rotational stacks, key images

**Tier 3 -- UniView (server-side everything, zero-footprint)**
- HTML5 browser viewer, pure server-side rendering
- Browser receives rendered tiles/streams, not raw DICOM data
- Supports 2D, MPR, 3D, rotate/zoom/scroll, multi-image comparison
- Annotation tools: arrows, angles, distances, ROI, CTR, ellipses, histograms, spine labeling
- Content types: DICOM, whole-slide pathology, video, photography, PDF
- URL-based launch, SSO with EMR, encrypted access
- No patient data remains on device after session

**What UniView's browser tech is**: Not publicly disclosed. Given pure server-side rendering, the browser likely receives JPEG/PNG tiles and handles UI chrome only. Pathology viewing uses "Google Earth-like" tile streaming for gigapixel whole-slide images.

### Why This Hybrid Matters

The thick client gives Sectra the **best 2D responsiveness** in the market -- no SSR latency for the operations radiologists do thousands of times per day (scroll, W/L, zoom). Server-side 3D means they don't need expensive GPU workstations. UniView provides universal access without installing anything.

Philips IM15 chose pure SSR for everything, accepting the latency tradeoff. Visage chose pure SSR too. Sectra's hybrid is more complex to build but delivers better interactive performance for 2D.

---

## 4. RapidConnect Technology

RapidConnect is Sectra's patent-pending proprietary image delivery system. It is the core architectural differentiator for network performance.

### How It Works

**Progressive streaming with JPEG 2000**: Sectra stores images internally as JPEG 2000 (Transfer Syntax 1.2.840.10008.1.2.4.90). JPEG 2000's wavelet architecture is inherently suited for progressive streaming -- you can transmit low-resolution approximations first, then refine with additional wavelet coefficients. The radiologist sees a usable image immediately, with quality improving as more data arrives.

**Dynamic data reduction** (patent-pending): Omits transparent/non-diagnostic areas from transmission. Only significant pixel data is sent; non-diagnostic regions stay on the server.

**Prioritized transfer**: When the radiologist identifies relevant slices, those are transmitted at full resolution first. The system orders data delivery based on likely reading patterns.

**Local caching**: Workstations maintain a local image cache with context-related frequently-accessed data. The cache continuously synchronizes with the central database.

**Satellite servers**: For multi-site networks, satellite servers (SSS) buffer data locally for months while continuously aligning with the main archive. Reduces WAN dependency.

### Performance Claims

- Large imaging studies open in "less than a second or two" from cloud
- 3D mammography (DBT): all images from cloud in "less than three seconds"
- Works over standard broadband connections
- Network recommendation: 1 Gb/s LAN

### Relevance to Our Architecture

RapidConnect's progressive streaming is analogous to what we'd do with HTJ2K in our cloud platform (ADR 004). The key insight: **JPEG 2000 / HTJ2K's wavelet structure enables progressive refinement by design**. This is not a Sectra invention -- it's an inherent capability of the codec. Sectra's innovation is the intelligent prioritization and caching layer on top.

---

## 5. Large Dataset Handling

### Breast Tomosynthesis (DBT)

- ~500 MB per DBT study (vs ~25 MB standard mammogram, 10-20x larger)
- DICOM breast-tomosynthesis objects (Supplement 165)
- **Architecture**: DBT kept on local short-term storage until read (too large for real-time remote fetch), then archived
- Quadrant zoom, cine-loop scrolling, 2D/tomo comparison hanging protocols
- Workstation requirement: **24 GB RAM** minimum (vs 8 GB standard)
- IHE DBT and IHE MAMMO profile conformance
- Benchmark: University of Pennsylvania processed 54,244 studies (235,225 images) with average receive/extract/write time of **3.84 seconds per DBT image**

### Digital Pathology (Whole Slide Images)

- 0.5-150 GB per slide; batch scanners process 200-300 slides at a time
- **Only 2-3% of image data transmitted** for a typical viewing session (tile-on-demand)
- 512x512 pixel tiles, pyramidal multi-resolution arrays
- Majority of tile requests served within **20 milliseconds**
- 100+ simultaneous users in production, 3+ million pathology reviews per month
- DICOM WSI format (vendor-neutral)

### What This Means for Us

The pathology tile-streaming approach (load only the viewport, at the current zoom level) is directly applicable to how we'd serve large studies from cloud storage. We're already doing something similar with our slice-at-a-time loading, but could extend it to sub-slice tiling for very large images.

---

## 6. Workflow and Hanging Protocols

### Dynamic Display Protocol (DDP) -- Patent US 7,162,623

When a study loads, the DDP engine evaluates:
1. **Modality** (CT, MR, CR, MG, etc.)
2. **Anatomy** (chest, brain, knee, etc.)
3. **Procedure type** (screening, follow-up, etc.)
4. **Display configuration** (how many monitors)
5. **User identity** (radiologist-specific preferences)

Based on matching rules:
- Auto-selects layout (which images in which viewport)
- Auto-launches clinical applications (3D for CT angio, etc.)
- Provides multiple perspectives per protocol (current study, comparison with priors, 3D view)
- Adapts dynamically to monitor count (4 images on 1 monitor, 8 on 2)
- Remembers individual radiologist preferences across sessions

Three protocol types:
- **Quick protocols**: simple, fast to configure
- **Advanced protocols**: full customization
- **Smart protocols**: rule-based with access to all IDS7 navigational tools

### Workflow Orchestration

- **Priority routing**: guides radiologists to highest-priority exams based on clinical status, workload, and SLA
- **Subspecialty routing**: neuroradiology, MSK, breast, etc.
- **SLA monitoring**: alarms when compliance is at risk
- **Workload Management** (new 2025): optimizes resource allocation
- **Tech QA**: direct feedback channel from radiologist to technologist
- **Analytics dashboard**: weekly volumes by modality/site

### Why This Matters

Sectra's #1 KLAS ranking is primarily about workflow, not rendering technology. Their radiologists spend less time navigating and arranging images and more time reading. This is the insight: **the best viewer is the one that gets out of the way**. Fancy rendering matters less than smart defaults.

---

## 7. AI Integration -- Amplifier Marketplace

### Architecture

**Amplifier Connector** has two components:
1. **Gateway Connector**: secure on-premises to cloud link
2. **Proxy Connector**: on-the-fly pseudonymization of outbound traffic and re-identification of incoming results

Single gateway manages all AI app communication regardless of how many apps are active.

### Marketplace Model

- Curated storefront of validated AI apps (CE, FDA, Health Canada cleared)
- **Amplifier Partners**: apps hosted/operated in cloud through single Sectra contract
- **Amplifier Integrators**: direct vendor contracting, Sectra as matchmaker
- Categories: detection, quantification, classification, triage, resource allocation
- Specialties: radiology, breast imaging, cardiology, pathology
- 50+ pathology AI vendors integrated

### Oxipit Acquisition (March 2026)

- **ChestLink**: autonomous AI that independently identifies high-confidence normal chest X-rays and removes them from the worklist
- First CE Class IIb certified autonomous AI
- Will operate as dedicated AI development center within Sectra
- Amplifier marketplace remains open/vendor-neutral

---

## 8. Deployment and Cloud Architecture

### On-Premises

- Server OS: Windows Server (SHS, IDS7 components); WISE also supports HP-UX
- Database: **Microsoft SQL Server** (2012-2019, including Azure SQL) and **Oracle** (11g, 12c, 19c)
- VNA: storage-agnostic (any SAN/NAS), XDS registry core
- Client: Windows 10/11 64-bit, ClickOnce deployment

### Cloud -- Sectra One Cloud (Microsoft Azure)

- **Cloud provider**: Microsoft Azure (strategic partnership)
- Available on Azure Marketplace
- **Hybrid model**: local short-term storage (STS) on-premises, long-term storage (LTS) in Azure Blob Storage
- Availability zone redundancy, geo-redundant data centers
- **99.99% uptime SLA**
- Dynamic scaling, pay-per-use
- Certifications: CSA STAR Level Two, ISO 27001/27017/27018, GDPR, HIPAA

### Integration Engine -- Connectivity Hub (SCH)

- Web-based configuration interface
- Cross-platform healthcare messaging engine
- DICOM Modality Worklist SCP
- HL7 message processing
- Standards: DICOM, HL7, FHIR (via FHIRcast)

---

## 9. Standards Compliance

### DICOM

From conformance statements (v27.x):
- C-STORE SCP/SCU, C-FIND (Study Root), C-MOVE, Storage Commitment
- **DICOMweb**: WADO-RS, QIDO-RS, STOW-RS -- all media types
- Internal storage: JPEG 2000 (TS 1.2.840.10008.1.2.4.90)
- Configurable additional compression syntaxes

### IHE Profiles

- XDS / XDS-I (Cross-Enterprise Document Sharing for Imaging)
- ATNA (Audit Trail and Node Authentication)
- IHE MAMMO and IHE DBT (breast imaging)
- SWF (Scheduled Workflow)

### HL7 / FHIR

- HL7 v2 messaging via Connectivity Hub
- FHIRcast for context synchronization (Sectra co-developed the standard with Epic)
- Active Directory integration for centralized user management

---

## 10. Technology Stack (Inferred)

| Layer | Technology |
|-------|-----------|
| IDS7 Client | .NET (confirmed via FDA 510(k) and SDK) |
| Legacy Integration | COM/ActiveX |
| Modern Integration | C# (.NET LTS), Java, PowerShell |
| Server OS | Windows Server; HP-UX (WISE) |
| Database | SQL Server (2012-2019) and Oracle (11g-19c) |
| Cloud | Microsoft Azure (Blob Storage, Azure SQL) |
| Image Codec | JPEG 2000 (internal storage and streaming) |
| Client Deployment | ClickOnce (Windows) |
| 3D Rendering | Likely C++/OpenGL on server (not confirmed publicly) |

Sectra's GitHub (github.com/sectra-medical) hosts the URL Launch SDK. No viewer components are open source.

---

## 11. Patent Portfolio

22 granted US patents plus European patents. Notable:

- **US 7,162,623** (Sectra Imtec): Dynamic Display Protocol -- automatic hanging protocol matching
- Additional patents cover: image stack navigation using CAD findings with proximity-varying markers, multidimensional medical data compression using viewing parameters, electronically compressing image data
- **Patent-pending**: RapidConnect streaming, dynamic data reduction
- European: EP 2512341, EP 2854100, EP 3300001, EP 1718048

---

## 12. Why KLAS #1 for 13 Years

1. **Workflow obsession**: Every click optimized. Display protocols that just work. Worklists that prioritize intelligently.
2. **Hybrid rendering**: Thick client for fast 2D (no SSR latency), server for 3D (no expensive workstations). Best of both worlds.
3. **RapidConnect**: Progressive JPEG 2000 streaming makes large studies feel instant even on poor networks.
4. **Single application**: Radiology, pathology, cardiology, orthopaedics, ophthalmology all in IDS7. No context switching.
5. **Built-in VNA**: Storage-neutral, no vendor lock-in.
6. **Cloud-native SaaS** on Azure without performance regression.
7. **Open AI ecosystem**: Amplifier marketplace with built-in pseudonymization.
8. **Security DNA**: Founded on cryptography -- security is not an afterthought.
9. **30+ years of iteration**: 2,500+ deployments, deep domain knowledge.
10. **100% repurchase rate** in KLAS surveys.

**Weaknesses** (from KLAS commentary):
- Windows-only thick client (IDS7) -- no native macOS or Linux support
- ClickOnce deployment is aging technology
- UniView (web viewer) is not the primary diagnostic viewer -- radiologists still need the thick client
- Price: premium positioning, not for budget-conscious buyers

---

## 13. Comparison to Our Viewer

### Architectural Comparison

| Aspect | Sectra | Our Viewer |
|--------|--------|------------|
| **2D rendering** | Local (.NET thick client) | Local (browser JavaScript) |
| **3D rendering** | Server-side (3D Core GPU farm) | Planned client-side (vtk.js) |
| **Web viewer** | UniView (server-side rendered) | Primary viewer (client-side rendered) |
| **Image format** | JPEG 2000 internal storage | Raw DICOM with multiple decoders |
| **Progressive loading** | RapidConnect (JPEG 2000 wavelets) | Not yet (planned for cloud) |
| **Hanging protocols** | Patented DDP engine, 30 years refined | None (manual arrangement) |
| **Client platform** | Windows only (IDS7) | Any browser (Chrome/Edge 86+) |
| **Offline** | Local cache, satellite servers | Full offline (all client-side) |
| **Cost** | Enterprise pricing + Azure cloud | Near zero (static hosting) |
| **AI integration** | Amplifier marketplace (50+ vendors) | None |

### What We Can Learn from Sectra

1. **Workflow is the product, not rendering**: Sectra's dominance comes from display protocols and worklist intelligence, not pixel-level rendering superiority. When we add hanging protocols, that's where the real UX improvement will come from.

2. **JPEG 2000 progressive streaming is proven**: RapidConnect validates that JPEG 2000 / HTJ2K progressive loading works for medical imaging at scale. This directly supports our ADR 004 direction for the cloud platform.

3. **Tile-based loading for large images**: Sectra's pathology viewer loads only viewport tiles at the current zoom level (2-3% of data per session). This pattern applies to any large image -- DBT, high-res radiographs, pathology.

4. **Hybrid rendering is the pragmatic choice**: Sectra keeps 2D local (fast) and only offloads 3D to servers. This matches our ADR 004 decision -- client-side 2D, server-side only when the browser can't handle it.

5. **Single application for everything**: Sectra's advantage is that radiologists never leave IDS7 -- images, reports, worklists, AI results, pathology, all in one place. Context switching kills productivity.

6. **Pseudonymized AI pipeline**: The Amplifier Connector's automatic pseudonymization/re-identification is a clean architecture for integrating external AI without exposing patient data. Worth studying for our AI integration.

---

## Sources

### Product Pages
- [Sectra IDS7](https://medical.sectra.com/product/sectra-ids7/)
- [Sectra UniView](https://medical.sectra.com/product/sectra-uniview/)
- [Sectra 3D Core](https://medical.sectra.com/product/3d-core/)
- [Sectra One Cloud](https://medical.sectra.com/product/sectra-one-cloud/)
- [Sectra VNA](https://medical.sectra.com/product/sectra-vna/)
- [Sectra Amplifier Marketplace](https://medical.sectra.com/product/sectra-amplifier-marketplace/)
- [Sectra Breast Imaging PACS](https://medical.sectra.com/product/sectra-breast-imaging-pacs-ris/)

### Technical
- [Sectra DICOM Conformance Statements](https://medical.sectra.com/knowledge-center/conformance-statements/)
- [Sectra URL Launch SDK (GitHub)](https://github.com/sectra-medical/SectraUrlLaunchSdk)
- [Sectra FHIRcast Development](https://medical.sectra.com/resources/sectra-forefront-development-fhircast/)
- [FDA 510(k) K081469](https://510k.innolitics.com/device/K081469)
- [Loadbalancer.org Sectra Deployment Guide](https://www.loadbalancer.org/applications/sectra/)

### Market and Competitive
- [Sectra Best in KLAS](https://medical.sectra.com/about-sectra/sectra-pacs-best-in-klas/)
- [KLAS 2025 Enterprise PACS Comparison](https://intuitionlabs.ai/articles/enterprise-pacs-klas-comparison)
- [Sectra Oxipit Acquisition](https://www.prnewswire.com/news-releases/sectra-acquires-oxipit-advancing-autonomous-ai-capabilities-in-diagnostic-imaging-302705087.html)

### Case Studies and Whitepapers
- [RapidConnect -- Healthcare in Europe](https://healthcare-in-europe.com/en/news/pacs-reloaded-rapid-connect-brings-data-up-to-date.html)
- [Sectra Cloud Architecture Guide](https://medical.sectra.com/resources/enterprise-imaging-cloud/)
- [Breast Tomosynthesis Workflow](https://medical.sectra.com/resources/breast-tomosynthesis-and-the-pacs-the-journey-to-sustainable-workflow/)
- [Digital Pathology DICOM Standard](https://medical.sectra.com/resources/introduction-dicom-standard-digital-pathology/)
- [Workflow Orchestration Case Study](https://medical.sectra.com/case/workflow-orchestration-moving-beyond-analytics/)
- [Display Protocol Best Practices](https://medical.sectra.com/case/best-practices-for-creating-brilliant-workflows/)

### Patents
- [Sectra Patents Page](https://sectra.com/patents/)
- [US 7,162,623 -- Dynamic Display Protocol](https://patents.google.com/patent/US20070197909A1/en)

### Company
- [Sectra History](https://investor.sectra.com/this-is-sectra/sectras-history/)
- [Linkoping University Origins](https://liu.se/en/news-item/sectra-a-world-leading-company-with-roots-in-liu-research)
