# Philips Image Management 15 -- Deep Technical Architecture Benchmark

**Date**: 2026-03-10
**Classification**: Competitive Intelligence
**Subject**: Philips Image Management 15 (Web Diagnostic Viewer)

---

## Executive Summary

Philips Image Management 15 (IM15) is a ground-up rebuild of Philips' PACS viewer, launched November 2025 at RSNA as the successor to Vue PACS. It represents Philips' attempt to modernize after years of declining customer satisfaction (KLAS score dropped to 63.9, lowest among ranked vendors). The product uses **server-side rendering (SSR)** architecture -- images are rendered on GPU-accelerated cloud servers and streamed as compressed frames to the browser. This is a fundamentally different architecture from client-side rendering approaches like ours.

**Key architectural insight**: IM15 is not a "better web viewer" -- it is a **thin-client terminal** where the browser displays pre-rendered pixels and captures user input. The heavy lifting (DICOM parsing, decompression, window/level, 3D reconstruction) all happens server-side. This is the opposite of our approach where the browser does everything.

**Strategic context**: IM15 is a defensive product. Philips is hemorrhaging PACS customers to Sectra (#1 KLAS for 13 consecutive years) and Visage/Pro Medicus (winning the largest US contracts). Philips' bet is that their **integrated ecosystem** (viewer + reporting + AI orchestration + workflow automation + cloud) will differentiate them even if the viewer itself is years behind Visage and Sectra.

---

## 1. Product Lineage

The chain of custody explains the technical debt IM15 inherits:

1. **Algotec Systems** (Israeli company, ~1990s) -- built the original PACS platform
2. **Kodak** acquired Algotec ~2003 as their 5th-generation PACS
3. **Carestream Health** inherited it when Onex bought Kodak's Health Group (~2007)
4. Carestream developed **Vue PACS** on this foundation
5. **Philips** acquired Carestream's Healthcare Information Systems business in 2019, including the Algotec R&D center in **Raanana, Israel**
6. Philips rebranded as **Philips Image Management Vue PACS**
7. **Image Management 15** launched November 2025 -- the first major Philips-built generation

**FDA filing**: K240822 (cleared March 2024) lists "Image Management V15" manufactured by Philips Medical Systems Technologies Ltd., Raanana, Israel. Predicate device: CARESTREAM PACS (K110919).

---

## 2. Predecessor: Vue PACS Architecture

Understanding what IM15 replaces:

### Client Technology (Thick Client)
- UI based on Microsoft **.NET Framework**
- **Java Runtime Environment (JRE)** required
- **Visual C++ Redistributable** required
- Microsoft **IIS** for web services
- Windows-only (VA OIT assessment: "not portable as it runs only Windows platforms")
- Required local client installation on diagnostic workstations
- DICOM data had to be routed/pre-fetched to each workstation before reading

### Server Technology
- 64-bit Intel Xeon servers on Windows
- **Oracle Database** for metadata/HL7/orders
- DICOM on port 2104, HL7 on ports 10010/4001/4003/4005, Oracle on port 1521
- Network minimum: 100 Mb/s, recommended 1 Gb/s for large studies

### Viewer Components
- **Vue PACS Client** -- thick diagnostic viewer (installed on workstations)
- **Vue Motion** -- zero-footprint HTML5 web viewer for enterprise access (NOT diagnostic quality)
- **PowerViewer** -- advanced volumetric 3D viewer with real-time matching

### Key Limitation
The thick client required DICOM data to be routed/pre-fetched to each workstation. This is the fundamental architectural problem IM15 solves.

---

## 3. IM15 Server-Side Rendering Architecture

### How It Works

IM15 uses server-side rendering where images are processed on a central server and streamed to the browser. The browser is a thin client.

**Rendering pipeline:**

```
User interaction (scroll, W/L, pan)
        |
        v
Browser sends lightweight message to server
        |
        v
Server loads DICOM pixel data (stays on server)
        |
        v
GPU-accelerated rendering engine applies:
  - Window/level transformation
  - Rescale slope/intercept
  - Lookup tables
  - Spatial filtering
  - MPR/MIP/3D reconstruction (for volumetric)
        |
        v
Rendered frame compressed (JPEG or H.264)
        |
        v
Compressed frame streamed to browser
        |
        v
Browser displays the rendered pixels
```

**What runs on the server:**
- DICOM parsing and decompression
- All pixel manipulation (W/L, filters, transforms)
- 3D/MPR/MIP volume reconstruction (GPU arrays, OpenGL)
- Pre-caching of adjacent slices
- Application state management (XML documents per client session)

**What runs in the browser:**
- Display of rendered frames
- Capture of user input (mouse, keyboard, touch)
- Lightweight UI chrome (toolbars, panels, menus)
- Possibly some 2D rendering for simple operations (see hybrid patent below)

### Communication Protocol (Inferred)

Philips has not disclosed the specific streaming protocol. Based on industry analysis and patent research:

- **WebSocket** or persistent connection for real-time interactive streaming
- Rendered frames delivered as **JPEG** (industry standard for SSR viewers) or **H.264/WebRTC** video for continuous interactions (cine playback, rapid scroll)
- **XHR/HTTP** for initial data and state management
- The Carestream/Algotec lineage used proprietary streaming; a related patent (US20150074181) describes ZeroMQ/RabbitMQ message buses

### Latency Handling

- Server **pre-renders and caches adjacent slices** (predictive prefetch)
- During rapid interaction (fast scroll), likely uses **lower-resolution frames** that upgrade to full resolution when motion stops
- The "zero latency" marketing claim refers to eliminating the latency of transferring multi-GB DICOM datasets -- there is still round-trip latency for each interaction
- Network requirement: consumer-grade broadband (6 Mbps+, based on Visage benchmarks for comparable SSR)

### Hybrid Rendering Patent (US20150074181)

A patent from the Carestream/Algotec lineage reveals a hybrid approach:

- **Client-side rendering** for 2D images: pixel data sent as Haar wavelets, rendered via WebGL using ArrayBuffer/TypedArray
- **Server-side rendering** for 3D/MIP/MPR: too computationally intensive for the browser, rendered on GPU arrays and sent as images
- Server renders at fixed size, client scales to viewport

Whether IM15 actually uses this hybrid approach is unknown. The marketing describes pure SSR.

---

## 4. Zero-Footprint Viewer Technology

### Browser Requirements
- Standard modern browser (Chrome, Edge, Safari)
- HTML5-based
- No plugins, no Java, no ActiveX, no local installation
- Browser-based updates delivered instantly to all users

### What "Zero Footprint" Really Means

- No software installation on the client machine
- All image processing happens server-side
- The browser is a display terminal + input device
- DICOM data never leaves the server (security and compliance benefit)
- Client hardware requirements are minimal (any device with a modern browser)

### Diagnostic Quality Without Plugins

- The server handles all image processing at full bit depth (16-bit, 32-bit)
- Rendered images sent at full diagnostic resolution
- Quality depends on server-side processing and JPEG compression quality, not client capability
- Monitor calibration (GSDF conformance) is the remaining client-side concern -- this is handled by the display hardware/driver, not the application

### Frontend Tech Stack (Unknown)

- No public evidence of specific framework (React, Angular, Vue.js, etc.)
- Job postings for the imaging team list C++, C#, WPF, XAML, OpenGL -- this is the server-side rendering engine team
- The web frontend is likely a relatively thin streaming client rather than a heavy client-side rendering framework
- Philips' GitHub (github.com/philips-software) has 112 repos focused on infrastructure tooling -- no medical imaging repos are public

---

## 5. Large Dataset Handling

### Why SSR Excels for Large Studies

| Dataset Type | Typical Size | SSR Advantage |
|-------------|-------------|---------------|
| DBT (Digital Breast Tomosynthesis) | 1-4 GB | Only rendered viewport (~100-200 KB/frame) is sent, not the full dataset |
| Cardiac CT (4D) | 2-8 GB | Temporal navigation handled server-side; client receives rendered frames |
| Whole-body PET/CT | 1-3 GB | Fused rendering done on server GPU |

### How It Works
- Study is loaded into server GPU memory (12+ GB GPU RAM on rendering servers)
- Only the viewport pixels are compressed and streamed (~100-200 KB per JPEG frame)
- The server's GPU can render and stream frames faster than the network can transfer the source data
- For rapid navigation, lower-resolution frames are sent during interaction, upgrading to full resolution when motion stops

### AWS Infrastructure Supporting Large Studies
- **Amazon HealthLake Imaging** stores images as **HTJ2K (High Throughput JPEG 2000)** -- order of magnitude faster than JPEG 2000, at least 2x faster than all other DICOM transfer syntaxes
- Supports **progressive resolution decoding** using tile-level markers (TLM) -- thumbnails first, then full resolution
- **EC2 G4 instances** (NVIDIA T4 GPUs) and **G6 instances** (NVIDIA L4 GPUs) for GPU-accelerated processing
- GPU acceleration achieves 5-12x speedup over CPU for image decoding

### Benchmark Reference (Visage 7 on Comparable Architecture)
- 6 GB 3D mammography: displayed and fully navigable in 2-3 seconds over 6 Mbps broadband
- NVIDIA Quadro K6000 GPU with 12 GB memory on rendering servers

---

## 6. AI Integration Architecture

### Generative AI for Display Protocol Normalization

**The problem**: Display protocols (hanging protocols) define how images are arranged on screen. DICOM metadata for imaging sequences is not standardized across scanners, sites, or vendors. The same MRI sequence might be labeled differently by different manufacturers, causing hanging protocols to break.

**The solution**: AI automatically standardizes and normalizes DICOM metadata so display protocols trigger correctly regardless of scanner labeling. Conceptually similar to Enlitic's ENDEX product (body-part detection, sequence classification, standard lexicon mapping).

**Status**: Announced at RSNA 2025 as "work in progress" -- not yet available for distribution. Likely built on Amazon Bedrock foundation models.

### Agentic AI for Anatomy-Aware Study Prioritization

Multi-agent AI system for autonomous pre- and post-interpretive workflow:

- **Anatomy-aware routing**: AI identifies anatomy and routes to appropriate subspecialty radiologist
- **Dynamic prioritization**: Studies ordered by clinical urgency, patient status, AI-detected findings
- **Workflow orchestration**: Agents handle case preparation, prior study retrieval, protocol selection, post-reading follow-up

**Status**: Future vision, not deployed. Per PMC literature, agentic AI in radiology is "not yet broadly used in daily clinical radiology practice."

### AI Manager Platform

Single integration point connecting **140+ contracted AI apps from 55+ partner vendors** to the PACS workflow.

| Partner | Domain |
|---------|--------|
| NVIDIA | MRI foundation models (VISTA-3D, MAISI) |
| 4DMedical | Pulmonary ventilation assessment |
| Quibim | Prostate AI |
| Cortechs.ai | Brain volumetrics, lesion quantification |
| Blackford Analysis | AI marketplace (140+ apps) |

### AI Infrastructure
- **Amazon Bedrock** for foundation models (conversational reporting, workflow automation)
- **Amazon SageMaker** for model training
- **NVIDIA GPUs** (CUDA framework) for inference
- NLP pipeline that structures dictated text, feeds back for retraining, and redeploys

---

## 7. HealthSuite Cloud Platform

### AWS Architecture

Philips HealthSuite Platform (HSP) is a PaaS built on AWS with six managed service families:

| Service | Purpose | AWS Underpinning |
|---------|---------|------------------|
| Analyze | Big data, ETL, analytics | Amazon Redshift, data lake |
| Authorize | Identity, consent, privacy | AWS IAM, MFA |
| Connect | IoT device management | AWS IoT Core |
| Host | Compute, infrastructure | Amazon EC2, Lambda, API Gateway |
| Share | Interoperability | FHIR, HL7, IHE standards |
| Store | Clinical data repositories | Amazon S3, RDS, DynamoDB |

### Imaging-Specific Services
- **Amazon S3** -- object storage for DICOM/non-DICOM images
- **Amazon HealthLake Imaging** -- purpose-built DICOM storage with HTJ2K encoding, metadata normalization, progressive retrieval, DICOMweb APIs
- **EC2 G4/G6 GPU instances** -- rendering servers

### Scale
- **15 PB** of patient data
- **390 million** imaging studies stored
- Growth rate: ~1 PB/month
- **150+ sites** migrated across North America and Latin America

### Deployment Models
1. **Full Cloud**: all services on AWS, multi-tenant
2. **Hybrid Cloud**: on-premises Cloud Connect device for local caching + AWS sync
3. **On-Premises**: available for organizations requiring local infrastructure

### Security and Compliance
- Encryption at rest and in transit, plus AWS Nitro for in-use protection
- Zero Trust architecture
- HIPAA, NIST 800-53, ISO 27001, ISO 27018 compliance
- IHE ATNA-compliant audit logs
- 143+ security certifications (through AWS)
- 99.99% uptime SLA

---

## 8. Interactive Reporting Module

### Architecture

Reporting is **natively integrated** into the IM15 web viewer -- radiologists review images and generate reports in a single workspace without switching applications. This eliminates separate dictation systems.

### Capabilities
- **Embedded voice recognition**: built-in speech-to-text that improves with usage (initial training wizard, accuracy improves after first few hours)
- **Structured reporting**: user-defined templates with embedded patient metadata fields
- **Multimedia embedding**: key images, charts, graphs, hyperlinks to prior studies/bookmarked findings
- **Dictation in structured fields**: language-specific guidelines for measurements, dates, numbers, radiology syntax
- **Report lifecycle**: draft, review, edit, sign workflow
- **Advanced Visualization integration**: results from 70+ clinical applications embedded directly in reports

### Generative AI for Reporting (In Development)
Using Amazon Bedrock:
- Conversational/ambient reporting: clinician speaks naturally, AI generates structured report
- Real-time report construction and revision
- Automatic diagnostic impression integration
- Inconsistency flagging
- Estimated 15-20% efficiency increase

---

## 9. Workflow Automation

### Radiology Workflow Orchestrator

AI-powered case routing matching studies to radiologists based on:
- Area of expertise
- Availability and current workload
- Organizational goals (turnaround time, subspecialty reads)

**Real-world results** at Campus Bio-Medico Hospital:
- 50%+ productivity increase
- 40% reduction in average reporting time (10 days to 6 days)
- 92% decrease in customer complaints about reporting time

### RIS/HIS Integration
- HL7 messaging for patient demographics and clinical data
- DMWL (DICOM Modality Worklist) on port 3320
- IntelliBridge Enterprise provides HL7/FHIR bridging
- Integration with RIS, HIS, voice dictation systems, EHRs

---

## 10. Standards Compliance

### DICOM (Vue PACS 12.2.8 Conformance Statement)
- C-STORE SCP and SCU
- C-FIND SCP and SCU (Query)
- C-MOVE SCP and SCU (Retrieve)
- Storage Commitment
- Verification
- DICOM 3.0 compliant
- Full conformance statement: 155 pages (document HA1667)

### IHE Profiles (Carestream Heritage)
- SWF (Scheduled Workflow)
- PIR (Patient Information Reconciliation)
- CPI (Consistent Presentation of Images)
- KIN (Key Image Note)
- SINR (Simple Image and Numeric Report)
- XDS-I.b (Cross-enterprise Document Sharing for Imaging)

### DICOMweb
No published IM15-specific conformance statement confirming WADO-RS, STOW-RS, or QIDO-RS. Expected given limited release status. The Carestream VNA heritage supports WADO.

### HL7/FHIR
- Vue PACS 12.2.8: 32-page HL7 Interface Specification (document HA1669)
- HealthSuite Platform natively supports FHIR, HL7, DICOM, XDS, XDW

### IM15-specific conformance documentation has not been published yet.

---

## 11. Competitive Positioning

### KLAS Scores (2025)

| Vendor | Large PACS | Small PACS | Trend |
|--------|-----------|-----------|-------|
| Sectra | 91.0 | 93.0 | +2.0/+2.4 |
| Agfa | 87.2 | 90.3 | +11.6 |
| Infinitt | N/A | 88.8 | +9.5 |
| Fujifilm | 84.9 | 83.8 | +9.1 |
| Merge (Merative) | 82.8 | 83.3 | +2.5 |
| Optum/Change HC | 72.6 | 71.2 | -2.2/-8.2 |
| GE Centricity | 63.1 | 70.8 | +6.6 |
| **Philips Vue PACS** | **Unranked** | **63.9** | **-6.9** |
| Intelerad | 58.7 | N/A | -1.8 |

**2026 KLAS**: "Lack of support & product development lead Philips clients to replace the system."

### vs. Visage 7 (Pro Medicus) -- Most Direct Competitor

Visage is the SSR pioneer and category leader:
- **Patented adaptive streaming** from GPU Render Servers
- Performance independent of client hardware, RAM, disk, display count
- Works over 6 Mbps broadband, even through VPN/Citrix
- $520M in new contracts FY2025 ($330M Trinity Health, $170M UCHealth)
- ~8% US market share but winning the largest deals

**Philips differentiator vs. Visage**: Integrated ecosystem. IM15 includes natively connected reporting, AI Manager (140+ apps), Workflow Orchestrator, and Advanced Visualization. Visage is focused on the viewer/archive and relies on third-party reporting.

### vs. Sectra -- Market Leader

- KLAS #1 for 13 consecutive years
- Server-side rendering for 3D/MPR via 3D Core
- RapidConnect technology for fast delivery over poor networks
- UniView zero-footprint universal viewer
- 100% of users would buy again

### vs. GE, Optum, Intelerad

All are declining in KLAS alongside Philips. GE (63.1), Optum (72.6/71.2 declining), Intelerad (58.7) all face similar modernization challenges. IM15 attempts to leapfrog these peers.

### Philips' Unique Position

Philips is the only vendor attempting to deliver a **complete integrated workflow** in a single zero-footprint browser session: diagnostic viewing + interactive reporting + AI orchestration (140+ apps) + workflow prioritization + advanced visualization. Competitors are stronger in individual components but lack this integration breadth.

---

## 12. RadConnect Research

### What It Was

A web-based asynchronous communication prototype developed by Philips (Eindhoven) with Leiden University Medical Center (LUMC). Designed to replace disruptive phone calls between radiologists and technologists.

### How It Worked

1. Technologist creates a **ticket** with pre-determined question category and requested response time
2. Ticket sent to a **radiology section account** (role-based, not person-based)
3. Tickets appear in a **prioritized worklist** ordered by patient status and due time
4. Radiologist accepts ticket, **chat channel** opens

### Research Results

**Design Study** (Current Problems in Diagnostic Radiology, 2024, PMID: 37914652):
- 17 participants from three European academic institutions
- 65% would use frequently; 53% predicted >80% phone call reduction

**Clinical Evaluation** (2024, PMID: 38955962):
- Before-after study at LUMC (40 days pre vs. 40 days post)
- **53% reduction** in synchronous consult requests (6.1/day to 2.9/day, P<0.001)
- **77% decrease** in telephone volume to neuro/thorax beepers

### Why Not Commercialized

1. Narrow scope -- solved only technologist-radiologist communication
2. Overlap with existing Vue PACS collaboration features
3. Strategic pivot to agentic AI (which subsumes the prioritized-worklist concept)
4. Limited validation (single center, 40-day windows)
5. Integration complexity as a standalone tool

---

## 13. Performance Claims

Philips publishes **no specific benchmarks**. All claims are qualitative:
- "Loads studies quickly and runs smoothly, even with large datasets" (Pieter Hoste, AZ West)
- "Seamless performance, even with large, complex datasets such as DBT or cardiac CT"
- Processing "optimized between client and server"
- Advanced Visualization Workspace 16: "reducing reading times by up to 44% in key applications"

No published frame rates, load times in seconds, or concurrent user numbers.

For reference, the industry does not publish specific benchmarks either. Visage and Sectra also use qualitative performance claims.

---

## 14. Comparison to Our Viewer

### Architectural Differences

| Aspect | Philips IM15 | Our Viewer |
|--------|-------------|------------|
| **Rendering** | Server-side (GPU cloud) | Client-side (browser) |
| **DICOM processing** | Server | Browser (JavaScript) |
| **Data transfer** | Rendered pixels (~100-200 KB/frame) | Full DICOM pixel data |
| **Client requirements** | Any modern browser | Chrome/Edge 86+ (File System Access API) |
| **Server requirements** | GPU cloud infrastructure | Flask static server (or none for GitHub Pages) |
| **Offline capability** | None (requires server) | Full (all processing in browser) |
| **Large datasets** | Handled well (server has GPU + RAM) | Limited by browser memory |
| **Privacy** | Data on server (cloud or on-prem) | Data never leaves browser |
| **Cost to operate** | High (GPU cloud per-user) | Near zero (static hosting) |
| **Deployment** | SaaS or on-prem server farm | Static files + optional Flask |
| **3D rendering** | Server GPU (OpenGL) | Planned (vtk.js, client-side) |

### Where SSR Wins
- **Large datasets**: 4 GB DBT studies are trivial when only streaming rendered pixels
- **Compute-heavy operations**: 3D volume rendering, MPR, MIP on server GPUs
- **Device agnostic**: Works on tablets, Chromebooks, any screen
- **Consistent performance**: Independent of client hardware
- **Security**: DICOM data never reaches the client

### Where Client-Side Wins
- **Latency**: No round-trip for every interaction (instant W/L, scroll, zoom)
- **Offline**: Works without network after initial load
- **Privacy**: Data stays in the browser, never on a server
- **Cost**: No GPU cloud infrastructure needed
- **Simplicity**: No server-side rendering farm to manage
- **Independence**: No vendor lock-in, no SaaS subscription

### What We Can Learn

1. **Hybrid rendering is likely optimal**: Use client-side for 2D (fast, responsive) and server-side for compute-heavy 3D (when we get there). The Philips patent (US20150074181) describes exactly this split.

2. **Progressive loading**: Amazon HealthLake Imaging's HTJ2K with progressive resolution decoding is worth understanding -- it solves the "show something fast, refine later" problem.

3. **Integrated reporting**: Having reporting built into the viewer (not a separate tool) is a major workflow improvement. Worth considering for our roadmap.

4. **AI for hanging protocols**: The display protocol normalization problem (inconsistent DICOM metadata across scanners) is real and affects every viewer. Even a rule-based approach would help.

5. **Prefetch strategy**: Server-side prefetching of adjacent slices is something we can do client-side -- preload and decode nearby slices in a Web Worker before the user scrolls to them.

---

## Sources

### Primary Sources
- [Philips IM15 Press Release (Nov 2025)](https://www.usa.philips.com/a-w/about/news/archive/standard/news/press/2025/philips-launches-next-generation-web-based-diagnostic-viewer-for-fast-secure-imaging-data-access-anywhere.html)
- [Philips Web Diagnostic Viewer Product Page](https://www.usa.philips.com/healthcare/technology/web-diagnostic-viewer)
- [Philips RSNA 2025 Showcase](https://www.philips.com/a-w/about/news/archive/standard/news/articles/2025/philips-showcases-advanced-visualization-and-ai-partnerships-at-rsna-2025.html)
- [FDA 510(k) K240822](https://www.accessdata.fda.gov/cdrh_docs/pdf24/K240822.pdf)

### Cloud and AI
- [Philips + AWS Partnership (2023)](https://www.usa.philips.com/a-w/about/news/archive/standard/news/press/2023/20230417-philips-joins-forces-with-aws-to-bring-philips-healthsuite-imaging-pacs-to-the-cloud-and-advance-ai-enabled-tools-in-support-of-clinicians.html)
- [Philips + AWS Expanded Collaboration (2024)](https://www.usa.philips.com/a-w/about/news/archive/standard/news/press/2024/philips-and-aws-expand-strategic-collaboration-to-advance-healthsuite-cloud-services-and-power-generative-ai-workflows.html)
- [HealthSuite Imaging Cloud PACS](https://www.usa.philips.com/healthcare/services/healthsuite-imaging-cloud-pacs)
- [AWS HealthImaging HTJ2K Reference](https://docs.aws.amazon.com/healthimaging/latest/devguide/reference-htj2k.html)
- [Philips AI Manager](https://www.usa.philips.com/healthcare/product/839051/ai-manager)

### Technical Reference
- [Vue PACS DICOM Conformance Statement (155pp)](https://www.documents.philips.com/assets/Conformance%20Statements/20240227/2487af8d70ea49e4853cb12300b0e290.pdf)
- [Vue PACS HL7 Interface Specification (32pp)](https://www.documents.philips.com/assets/Conformance%20Statements/20240409/8941f89d89aa4983aab7b14d00db578c.pdf)
- [US Patent US20150074181 -- Hybrid Server/Client Rendering](https://patents.google.com/patent/US20150074181)
- [VA OIT Vue PACS Assessment](https://www.oit.va.gov/Services/TRM/ToolPage.aspx?tid=9705)
- [Loadbalancer.org Vue PACS Deployment Guide](https://www.loadbalancer.org/applications/philips-vue-pacs/)

### Competitive and Market
- [KLAS 2025 Enterprise PACS Comparison](https://intuitionlabs.ai/articles/enterprise-pacs-klas-comparison)
- [2026 Best in KLAS Coverage](https://radiologybusiness.com/topics/health-it/enterprise-imaging/sectra-agfa-infinitt-and-other-notable-radiology-names-among-2026-best-klas)
- [Visage 7 on AWS Case Study](https://aws.amazon.com/solutions/case-studies/visage-imaging-case-study/)
- [PACS Market Sizing ($3.76B 2025, projected $5.21B 2032)](https://www.towardshealthcare.com/insights/specialty-pacs-market-sizing)

### RadConnect Research
- [Design Study (PMID: 37914652)](https://pubmed.ncbi.nlm.nih.gov/37914652/)
- [Clinical Evaluation (PMID: 38955962)](https://pubmed.ncbi.nlm.nih.gov/38955962/)

### Media Coverage
- [ITN Online -- Philips Web Viewer](https://www.itnonline.com/content/philips-rolls-out-next-gen-web-based-diagnostic-viewer)
- [HIT Consultant -- IM15 Launch](https://hitconsultant.net/2025/11/24/philips-launches-image-management-15-zero-footprint-web-viewer-transforms-radiology-workflows/)
- [ITN -- Will Web-Based PACS Take Over](https://www.itnonline.com/article/will-web-based-pacs-take-over)
- [Philips HealthSuite Security Whitepaper](https://www.usa.philips.com/healthcare/white-paper/delivering-secure-cloud-computing)
