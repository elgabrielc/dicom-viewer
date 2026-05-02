<!--
  Companies Researched
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Companies Researched

A running, durable index of every company, product, or platform that has been researched, benchmarked, or cited as a reference in this project. Maintained as a single quick-glance answer to "have we looked at X?" and "show me all the consumer-app benchmarks we've used."

**Source of truth:** This file. Other docs (Central Guide, ADRs, individual research files) cite specific companies in their own context, but this is the canonical roster.

**Maintenance rule:** When new research adds a company, add a row here in the appropriate category. When a company moves up or down in strategic relevance (e.g. a new direct competitor), update its category. Do not delete entries -- companies that fall out of relevance get marked `[archived]` so the institutional memory survives.

---

## Strategic Priority Anchors

Cross-reference: see [DIVERGENT_CENTRAL_GUIDE.md → Primary Competitive Benchmarks](../DIVERGENT_CENTRAL_GUIDE.md#primary-competitive-benchmarks) for the canonical Tier 1 / Tier 2 ranking. The list below is the broader competitive and reference universe; the Central Guide names which of these are operationally load-bearing.

---

## 1. Direct-to-Consumer DICOM Cloud (the category myradone competes in)

| Company / Product | Role | Tier | Primary Research |
|-------------------|------|------|------------------|
| **MyMedicalImages.com** | #1 direct competitor; closest analog to myradone's plan; reach parity ASAP then surpass | T1 | [Round 2: equivalents](RESEARCH-mymedicalimages-equivalents-prompt_2026-05-01_0934.md) |
| **3DICOM Patient** (Singular Health, ASX:SHG) | Strongest direct competitor by funding/engineering; benchmark for breadth and 3D roadmap | T1 | [Round 2: equivalents](RESEARCH-mymedicalimages-equivalents-prompt_2026-05-01_0934.md) |
| **Falcon Mx** + Falcon Cloud | Mobile-first iOS competitor; benchmark for mobile UX | T1 | [Round 2: equivalents](RESEARCH-mymedicalimages-equivalents-prompt_2026-05-01_0934.md) |
| **DicomShare** (share.dicomviewer.net) | Sharing-flow benchmark; share-link framing rather than library-first | T2 | [Round 2: equivalents](RESEARCH-mymedicalimages-equivalents-prompt_2026-05-01_0934.md) |
| **PocketHealth** | Largest adjacent player (2M+ patients) but reached scale via B2B2C hospital partnerships; instructive for billing/cancellation pitfalls to avoid | Adjacent | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **PostDICOM** | Disqualified at consumer scale ($79+/mo clinic pricing) | Disqualified | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **Purview Image** | Disqualified at consumer scale ($3000+/yr enterprise) | Disqualified | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **CarePassport** | Hospital-integrated; not pure DTC | Disqualified | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **Medicai** | Free DICOM uploader for one-shot transfer; not persistent personal storage | Adjacent | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **DICOM Library** | Educational/anonymized teaching sharing only | Adjacent | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **LifeImage** (now Intelerad Patient Connect) | Acquired into B2B enterprise stack | Adjacent | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **PicnicHealth** | Different model (record retrieval on patient's behalf, not direct upload) | Adjacent | [Round 1: DTC](RESEARCH-direct-to-consumer-medical-imaging-prompt_2026-05-01_0916.md) |
| **IDV (IMAIOS DICOM Viewer)** | Free local viewer without cloud storage | Reference | [Round 2: equivalents](RESEARCH-mymedicalimages-equivalents-prompt_2026-05-01_0934.md) |

---

## 2. Medical Imaging Vendors / PACS / Cloud Platforms

| Company / Product | Role | Primary Research |
|-------------------|------|------------------|
| **OHIF Viewer** | Open-source reference for client-side DICOM rendering (Cornerstone3D / vtk.js); benchmark for the Rendering layer in our reference architecture | [OHIF research](RESEARCH-ohif.md), [OHIF Reports](RESEARCH-ohif-reports_2026-02-02.md) |
| **Sectra** | Hybrid rendering, RapidConnect streaming, KLAS #1 enterprise PACS | [Sectra research](RESEARCH-sectra.md) |
| **Sectra UniView** | Web-based zero-footprint viewer with FDA 510(k) clearance; measurement-tool reference | [Measurement tool](RESEARCH-measurement-tool.md) |
| **Visage 7** (Pro Medicus) | Pure server-side rendering from GPU servers; patented adaptive streaming; per-study pricing | [Visage research](RESEARCH-visage.md) |
| **Philips IM15** | Server-side rendering, AWS cloud, AI integration | [Philips IM15 research](RESEARCH-philips-im15.md) |
| **Ambra Health** (now Intelerad) | Web-based zero-footprint viewer, 510(k) cleared; measurement and reports reference | [Measurement tool](RESEARCH-measurement-tool.md), [Ambra Reports](RESEARCH-ambra-reports_2026-02-02.md) |
| **NilRead** | Web-based zero-footprint diagnostic viewer; measurement reference | [Measurement tool](RESEARCH-measurement-tool.md) |
| **AWS HealthLake Imaging** | HTJ2K + DICOMweb + OIDC reference; informs cloud Transport layer ([ADR 004](../decisions/004-cloud-platform-rendering-architecture.md)) | [HealthLake Imaging](RESEARCH-aws-healthlake-imaging.md) |
| **Google Healthcare Imaging API** | DICOMweb + HTJ2K at hyperscale; Transport layer benchmark | Cited in [Central Guide → Reference Architecture](../DIVERGENT_CENTRAL_GUIDE.md#reference-architecture) |
| **EasyRadiology AG** | 35% German market share; competitor analysis | [EasyRadiology research](RESEARCH-easyradiology.md) |
| **Horos** | Mature macOS desktop DICOM viewer; library-management and update pattern reference | [Horos library](RESEARCH-horos-library-management.md), [Horos updates](RESEARCH-horos-updates.md), [Horos library model](RESEARCH-horos-library-model-prompt_2026-03-27_2021.md) |
| **OsiriX / OsiriX MD** | Commercial fork of Horos; Cocoa-based; mentioned in 3D and update research | [3D benchmarks](RESEARCH-3d-volume-rendering-benchmarks.md), [Horos updates](RESEARCH-horos-updates.md) |
| **Cornerstone3D** | Client-side DICOM rendering library powering OHIF and many web viewers | Cited in [Central Guide → Reference Architecture](../DIVERGENT_CENTRAL_GUIDE.md#reference-architecture) |
| **vtk.js / VTK** | Volume rendering library backed by Kitware (NIH-funded) | [3D benchmarks](RESEARCH-3d-volume-rendering-benchmarks.md) |
| **3D Slicer** | Open-source desktop medical imaging platform; VTK/ITK foundation | [3D benchmarks](RESEARCH-3d-volume-rendering-benchmarks.md) |

---

## 3. 3D Volume Rendering (non-medical references)

| Company / Product | Role | Primary Research |
|-------------------|------|------------------|
| **Onshape** (PTC) | Browser-first CAD; proves browser-native 3D is production-grade | [3D benchmarks](RESEARCH-3d-volume-rendering-benchmarks.md) |
| **Autodesk Fusion 360** | Desktop + Three.js web viewer; demonstrates desktop-primary 3D pattern | [3D benchmarks](RESEARCH-3d-volume-rendering-benchmarks.md) |

---

## 4. Reports, Documents, and Patient-to-Provider Sharing

| Company / Product | Role | Primary Research |
|-------------------|------|------------------|
| **MyChart** (Epic) | Patient portal with reports and imaging access; benchmark for what we are NOT (provider-mediated rather than patient-owned) | [MyChart Reports](RESEARCH-mychart-reports_2026-02-02_2148.md) |
| **Ambra Health** | Document/report handling reference | [Ambra Reports](RESEARCH-ambra-reports_2026-02-02.md) |
| **OHIF** | DICOM-wrapped document handling reference | [OHIF Reports](RESEARCH-ohif-reports_2026-02-02.md) |
| **DICOMweb / STOW-RS** (industry standard) | Patient-to-provider sharing transport ([ADR 010](../decisions/010-patient-provider-image-sharing.md)) | [DICOM Sharing Compliance](RESEARCH-dicom-sharing-compliance.md) |

---

## 5. Sync Infrastructure / Cloud-File References

| Company / Product | Role | Primary Research |
|-------------------|------|------------------|
| **Microsoft Word + OneDrive** | Sync architecture, conflict resolution; informs annotation sync design | [Word + OneDrive Sync](RESEARCH-word-onedrive-sync-prompt_2026-03-25_1124.md) |
| **Google Photos** | Reference for "files live in cloud, clients stream on demand" product framing; library-character benchmark | [Google Photos library model](RESEARCH-google-photos-library-model-prompt_2026-03-28_0849.md), cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Apple Photos** | Library-character benchmark (warm consumer lineage) | Cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Dropbox** | Cloud storage / opt-in sync model reference | Cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Google Drive** | "Stream" vs "Mirror" mode reference for opt-in offline pinning | Cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Netflix** | Ephemeral working-set state benchmark | Cited in [Central Guide → Reference Architecture](../DIVERGENT_CENTRAL_GUIDE.md#reference-architecture) |
| **Spotify** | Opt-in offline pinning UX reference | Cited in [Central Guide → Reference Architecture](../DIVERGENT_CENTRAL_GUIDE.md#reference-architecture) |
| **Figma** | Large-document streaming + CRDT-style collaborative metadata; closest cross-domain analog for our two-domain split | Cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Linear** | Local-first-with-cloud-sync product pattern reference | Cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Notion** | Web-first cloud product pattern reference | Cited in [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **WhatsApp** | Counter-example: device-authoritative E2E architecture, NOT web-at-core (history clarified during strategy work) | Cited in session strategy discussion |

---

## 6. Telemetry / Instrumentation Benchmarks

| Company / Product | Role | Primary Research |
|-------------------|------|------------------|
| **Todoist** (Bitmapist) | Custom analytics; consent-first model; Karma system | [Todoist instrumentation](RESEARCH-todoist-instrumentation.md), [Round 2 prompt](RESEARCH-instrumentation.md) |
| **Sublime Text** + Panic | Near-zero telemetry; Panic privacy policy as template ([ADR 008](../decisions/008-local-first-instrumentation.md)) | [Sublime instrumentation prompt](archive/research-exhaust/RESEARCH-sublime-instrumentation-prompt.md) |
| **Claude / Anthropic** | Two-stream architecture (PHI separation); HIPAA BAA; enterprise compliance | [Claude instrumentation](RESEARCH-claude-instrumentation.md) |
| **Spotify** (Wrapped) | Data-as-feature model; viral instrumentation pattern at scale | [Spotify instrumentation](RESEARCH-spotify-instrumentation.md) |

---

## 7. Updates / Release Engineering Benchmarks

| Company / Product | Role | Primary Research |
|-------------------|------|------------------|
| **Microsoft Word** | Update channel pattern reference | [Word updates](RESEARCH-word-updates.md) |
| **Todoist** | Update flow benchmark | [Todoist updates](RESEARCH-todoist-updates.md) |
| **Horos** | macOS app update flow (notification-only, no Sparkle) | [Horos updates](RESEARCH-horos-updates.md) |
| **OpenAI Codex** | Mac+Windows app launch sequencing reference (Feb 2 → Mar 4, 2026) | [Codex updates prompt](archive/research-exhaust/RESEARCH-codex-updates-prompt_2026-03-28_1126.md) |
| **iTerm** | macOS app update pattern | [iTerm updates prompt](archive/research-exhaust/RESEARCH-iterm-updates-prompt_2026-03-28_1206.md) |
| **WhatsApp** | Cross-platform app update reference | [WhatsApp updates prompt](archive/research-exhaust/RESEARCH-whatsapp-updates-prompt_2026-03-28_1202.md) |
| **Spotify** | Cross-platform update pattern | [Spotify updates prompt](archive/research-exhaust/RESEARCH-spotify-updates-prompt_2026-03-28_1212.md) |
| **Stik / Tauri** | Tauri-based update mechanics | [Stik Tauri updates prompt](archive/research-exhaust/RESEARCH-stik-tauri-updates-prompt_2026-03-28_1105.md) |
| **MacUpdater** | macOS-side update tool reference (uncommitted artifact) | mentioned in workspace |
| **Sparkle framework** | macOS update standard (we should aim higher than Horos's notification-only approach) | [Horos updates](RESEARCH-horos-updates.md) |

---

## 8. Design / UX / Brand Benchmarks

| Company / Product | Role | Primary Reference |
|-------------------|------|-------------------|
| **Apple Photos** | Library-character lineage (warm, welcoming, consumer-organized) | [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md), [design/principles.md](../design/principles.md) |
| **Google Photos** | Library-character lineage; product-framing benchmark for cloud-primary trajectory | [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Darkroom** (iOS photo editor) | Viewer-character lineage (image-first, dark, precise inside calm shell) | [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md), [design/surfaces/viewer.md](../design/surfaces/viewer.md) |
| **Lightroom** (Adobe) | Viewer-character lineage (professional tooling without harshness) | [design/surfaces/viewer.md](../design/surfaces/viewer.md) |
| **Photos edit mode** (Apple) | Viewer-character lineage (consumer-accessible surface with calibration) | [design/surfaces/viewer.md](../design/surfaces/viewer.md) |
| **Figma** | Annotations CRDT-style sync model reference; large-document streaming | [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Notion / Linear** | Web-first cloud-primary product positioning reference | [Central Guide](../DIVERGENT_CENTRAL_GUIDE.md) |
| **Panic** | Privacy policy template; aesthetic discipline reference | [ADR 008](../decisions/008-local-first-instrumentation.md) |

---

## 9. Compliance / Regulatory References

| Topic | Role | Primary Research |
|-------|------|------------------|
| **HIPAA / FTC classifications** | Patient-data compliance map | [DICOM Sharing Compliance](RESEARCH-dicom-sharing-compliance.md) |
| **SOC 2 Type II** | Compliance roadmap input | [Healthcare Compliance Costs](RESEARCH-healthcare-compliance-costs.md) |
| **HITRUST** | Enterprise-payer compliance reference | [Healthcare Compliance Costs](RESEARCH-healthcare-compliance-costs.md) |
| **Epic SMART on FHIR** | Future enterprise integration cost reference (~$300K) | [Healthcare Compliance Costs](RESEARCH-healthcare-compliance-costs.md) |
| **Ambra integration costs** | Per-study pricing reference (rejected in favor of in-house STOW-RS, [ADR 010](../decisions/010-patient-provider-image-sharing.md)) | [Healthcare Compliance Costs](RESEARCH-healthcare-compliance-costs.md) |

---

## How to Update This File

1. When new research adds a company or product, add a row in the appropriate category. If a category doesn't fit, add a new section (and update the table of contents above).
2. Cite the primary research doc in the row. If a company appears across multiple research docs, list the most relevant one and note "and others" if needed.
3. Strategic priority changes (e.g., a Tier 2 competitor moves to Tier 1) require updating BOTH this file and [DIVERGENT_CENTRAL_GUIDE.md → Primary Competitive Benchmarks](../DIVERGENT_CENTRAL_GUIDE.md#primary-competitive-benchmarks).
4. Do not delete entries -- mark `[archived]` if a company falls out of relevance, so institutional memory survives.
5. This file is the canonical roster. The Central Guide names which subset is operationally load-bearing.
