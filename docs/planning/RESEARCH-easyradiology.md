# Deep Research: EasyRadiology AG

## Company Overview

**Company**: easyRadiology AG
**Headquarters**: Gleueler Str. 245-249, 50935 Cologne, Germany
**Founded**: ~2019 (incorporated) / 2022 (product launch per company website)
**Employees**: 25+
**Markets**: Germany (35% market share claimed), 5+ countries
**Balance Sheet**: ~2M EUR (2023, +14.5% YoY)
**Investor**: WCap (Hamburg)
**Website**: easyradiology.de (corporate), easyradiology.net (viewer/sharing portal)

### Leadership

| Role | Name | Background |
|------|------|------------|
| CEO | Claudia Muhrer | Corporate strategy, organizational scaling |
| CMO / Founder | PD Dr. Martin Weihrauch | Hematologist/oncologist, 20+ years clinical experience |
| COO | Dr. Michael Herbrik | Radiologist, clinical workflow optimization |
| CRO | Peter Lucks | International business development |

### Founding Story

Dr. Weihrauch, a hematologist/oncologist, founded easyRadiology after repeatedly experiencing treatment delays at tumor boards because radiological images and findings were missing. The existing process -- burning CDs, physically transporting them, reading them at the destination -- was slow, error-prone, and produced plastic waste. He built a digital alternative that lets images flow instantly via links and QR codes.

This is a **clinician-founded company**, not a technology startup. The founder's background explains the product's emphasis on workflow simplicity over technical depth.

---

## Product Architecture

### What EasyRadiology Is (and Is Not)

EasyRadiology is **not a PACS** and **not a diagnostic viewer**. It is an **image sharing and workflow platform** that sits between the radiology department's existing PACS and the people who need to see the images (referring physicians, patients, tumor boards).

The product solves the "last mile" problem: how do you get images from the radiology department to everyone else without CDs, USB sticks, or complex VPN setups?

### Product Suite

| Product | Function |
|---------|----------|
| **Patient & Referrer Portal** | Secure web access to images and findings for patients and referring physicians. Vendor-agnostic -- works with any existing RIS/PACS/KIS |
| **easy2PACS** | One-click import of external images (from QR codes, USB sticks, CDs) into the local PACS. Replaces manual 12-minute-per-patient import workflow |
| **easy2Wallet** | Integrates patient access codes into Apple Wallet / Google Wallet. No app download required. Biometric-protected (fingerprint/FaceID) |
| **easy2BI** | Cross-location KPI analytics. Consolidates data from all modalities regardless of manufacturer |
| **eLearning Portal** | Training and continuing education (partners with DocCheck and Amboss) |

### Sharing Workflow

1. Patient visits radiology for imaging
2. Radiology department uploads images to easyRadiology (integrates with existing PACS)
3. Patient receives a **View Code** (via QR code, email link, or Wallet pass)
4. Patient or referring physician accesses images via `easyradiology.net/[customer-slug]` or `portal.easyradiology.net/[customer-slug]`
5. Access requires View Code + date of birth verification
6. Viewer displays images immediately in browser -- no download, no software install
7. **Lifetime code**: once issued, the code accumulates all future exams for that patient automatically

The key insight is the **lifetime code** model. Rather than generating a new sharing link per exam, easyRadiology creates a persistent patient identity (the code) that aggregates all their radiology exams over time. This creates a portable "digital radiology file" that follows the patient across providers.

### Multi-Tenant Portal Architecture

Each customer (radiology practice/hospital) gets a branded portal URL:
- `easyradiology.net/die-radiologie` (DIE RADIOLOGIE Munich)
- `easyradiology.net/radiologis` (Radiologis)
- `easyradiology.net/mvzdiagnostikum` (Evidia Berlin)
- `easyradiology.net/radiologie-coesfeld` (Radiologische Praxis Coesfeld)

This is a SaaS multi-tenant model where the platform serves many radiology practices from a single codebase.

---

## Technical Architecture

### Viewer Technology

Based on source analysis of `easyradiology.net`:

| Component | Technology |
|-----------|-----------|
| **Frontend framework** | jQuery + Bootstrap (modal dialogs) |
| **Analytics** | Matomo (self-hosted analytics) |
| **State management** | localStorage for user settings, dismiss tokens |
| **Rendering** | Likely **server-side rendering** (images pre-rendered to JPEG/PNG on server, streamed to browser) |
| **Medical frameworks** | None detected (no Cornerstone, OHIF, vtk.js, dcmjs, or dicomParser) |

**Key observation**: The absence of any client-side DICOM parsing library strongly suggests server-side rendering. The DICOM files are processed on the server, converted to web-friendly formats (JPEG/PNG), and served to a lightweight jQuery viewer. This is consistent with the "bandwidth efficient" and "blazingly fast" claims -- pre-rendered JPEGs load much faster than client-side DICOM parsing.

The viewer URL structure uses opaque IDs: `/view/{exam-id}#{section-id}`, with no DICOMweb or WADO endpoints visible.

### What This Means Architecturally

```
Radiology Practice                    easyRadiology Cloud                    End User

PACS/RIS ──upload──> Ingestion ──> DICOM Processing ──> Image Store
                                   (server-side)       (pre-rendered)
                                                            │
                                        Portal Server ──────┘
                                        (jQuery/Bootstrap)
                                             │
                                     ────────┤────────
                                     │               │
                              Physician          Patient
                              (browser)          (browser/Wallet)
```

This is fundamentally different from both enterprise PACS viewers (which do server-side rendering of full DICOM) and our viewer (which does client-side DICOM parsing). EasyRadiology's approach is simpler: convert DICOM to web images on ingest, serve pre-rendered content.

### No DICOMweb, No Standards-Based Viewer

There is no evidence of DICOMweb (WADO-RS, STOW-RS, QIDO-RS) or any DICOM-standard API. The platform appears to use a **proprietary upload/download API** for getting images in and out. This makes sense for their use case -- they don't need standards-based interoperability for viewing because they control the entire pipeline from upload to display.

### Anonymization Model

Recipients see only:
- Gender
- Age
- Examination date

They do **not** see patient name or date of birth. Personal data is encrypted with "military grade encryption" and encryption keys are sent via email then erased from servers. This is a privacy-first approach suitable for the German/EU regulatory environment.

---

## Security and Compliance

### Certifications

| Standard | Scope | Date |
|----------|-------|------|
| **ISO/IEC 27001** | Information security management | August 2025 |
| **ISO 27017** | Cloud security controls | August 2025 |
| **ISO 27018** | Protection of PII in cloud | August 2025 |
| **Quality management for medical devices** | Unspecified standard (likely ISO 13485) | Not disclosed |

### Data Sovereignty

- German company, likely German/EU data centers (not confirmed but implied by GDPR emphasis)
- GDPR compliant since inception
- Medical device quality management certified (suggests CE marking process, though specific MDR class not publicly disclosed)

### Medical Device Classification

Not publicly disclosed. Given that easyRadiology is a **sharing/workflow tool** rather than a primary diagnostic viewer, it may be classified as a lower-risk device (Class I or IIa under MDR) or may not require classification at all if positioned as a communication tool rather than a diagnostic device.

---

## Business Model

### Pricing

| Tier | Cost | Limits |
|------|------|--------|
| **Patient (free)** | Free | 2 GB storage, 3-month retention |
| **Clinics/Hospitals** | Custom (contact sales) | Not publicly disclosed |

Pricing for healthcare providers is negotiated individually, which is standard for B2B medical software in Europe. No per-study or per-user pricing is publicly available.

### Target Market

**Primary**: German radiology practices needing to share images with referring physicians and patients. The product replaces the CD/DVD workflow that is still standard in Germany.

**Secondary**: Study centers, pharmaceutical companies (clinical trials), medical education (DocCheck, Amboss partnerships).

**Not targeting**: Primary diagnostic reading, enterprise PACS replacement, teleradiology workstations.

### Market Position

EasyRadiology occupies a **different segment** from enterprise PACS vendors (Sectra, Philips, Visage) and even from cloud PACS solutions (PostDICOM, Medicai). It is specifically a **sharing layer** that complements existing PACS installations rather than replacing them.

Closest competitors:
- **PostDICOM** (cloud PACS + sharing, $79.99/mo starting)
- **Medicai** (cloud imaging platform)
- **Ambra Health** (now owned by Intelerad, enterprise image sharing)
- **Life Image** (image exchange network)
- **DICOM Director** (imaging workflow platform)

EasyRadiology's differentiation is:
1. **Simplicity**: QR codes, Wallet passes, lifetime codes -- designed for non-technical users
2. **German market focus**: GDPR-first, German-language, ISO 27001/27017/27018
3. **Workflow integration**: easy2PACS handles the hard part (importing external images into local PACS)
4. **No app required**: Browser-only viewing, Apple/Google Wallet for access codes

---

## Comparison to Our Viewer

### Architectural Differences

| Dimension | EasyRadiology | Our Viewer |
|-----------|---------------|------------|
| **Primary purpose** | Image sharing and workflow | Diagnostic viewing |
| **Rendering** | Server-side (pre-rendered JPEG/PNG) | Client-side (DICOM in browser) |
| **DICOM handling** | Server processes DICOM, serves web images | Client parses DICOM directly |
| **Technology** | jQuery + Bootstrap | Vanilla JS + WASM decoders |
| **Viewer features** | Basic (view, scroll) | Full (W/L, pan, zoom, measure) |
| **Standards** | Proprietary API | File System Access API, planning DICOMweb |
| **Target user** | Referring physician, patient | Radiologist, physician with DICOM expertise |
| **Data flow** | Upload to cloud, share via link | Local files, no upload |
| **Medical device** | Likely Class I/IIa (sharing tool) | Not classified (personal tool) |

### What We Can Learn

**1. The Lifetime Code Pattern**
EasyRadiology's most interesting innovation is the lifetime patient code that accumulates all exams. For our cloud platform, this suggests a patient-centric data model where a single access token aggregates all imaging for a patient, rather than per-study sharing links.

**2. Wallet Integration**
Storing access credentials in Apple/Google Wallet (no app download, biometric protection) is a clever distribution mechanism. For our cloud platform, this could replace traditional login for patient-facing access.

**3. QR Code Workflow**
QR codes printed at the radiology front desk are a zero-friction sharing mechanism. Simple, works offline, requires no patient email or phone number. Relevant for our sharing features.

**4. Anonymization for Sharing**
Showing gender/age/date but not name/DOB is a practical anonymization approach for sharing with non-treating providers. This balances clinical utility (need to know what they're looking at) with privacy (don't expose full patient identity).

**5. Multi-Tenant Portal**
The `easyradiology.net/[customer-slug]` URL pattern is clean and effective for white-labeling. Each practice gets a branded portal from the same platform. Relevant for our cloud platform if we serve multiple organizations.

**6. Complementary, Not Competitive**
EasyRadiology deliberately does **not** compete with PACS viewers on diagnostic features. It wins by being the simplest possible sharing layer. This validates our ADR 004 decision to build a full-featured viewer (client-side rendering) rather than a thin sharing tool -- we're solving a different problem.

### What We Do Better

- **Diagnostic capability**: Full W/L, measurements, multi-modality support
- **Client-side privacy**: DICOM never leaves the browser in our current architecture
- **Transfer syntax support**: JPEG Lossless, JPEG 2000, baseline -- easyRadiology likely only serves pre-rendered images
- **No cloud dependency**: Our viewer works fully offline with local files
- **3D rendering planned**: Volume rendering, MIP -- beyond easyRadiology's scope

### What They Do Better

- **Sharing simplicity**: One QR code or link replaces the entire CD workflow
- **Patient experience**: Wallet passes, lifetime codes, no app needed
- **PACS integration**: easy2PACS handles importing external images back into local PACS
- **Multi-organization**: Built for cross-practice image exchange from day one
- **Certifications**: ISO 27001/27017/27018 for enterprise sales

---

## Strategic Implications for Our Cloud Platform

EasyRadiology validates a market for **simple cloud-based image sharing** separate from enterprise PACS. Their 35% German market share (claimed) shows demand for this layer.

For our cloud platform (ADR 004), the lessons are:

1. **Sharing is a feature, not the product**: EasyRadiology's entire product is sharing. For us, sharing would be one feature within a full-featured viewer. We should make sharing as simple as they do (links, QR codes) but within a more capable diagnostic context.

2. **Patient-facing access needs different UX**: Patients don't need W/L controls or measurement tools. They need to see their images quickly on their phone. Our cloud platform may need a "patient view" mode that strips complexity.

3. **The CD replacement market is real**: In Germany especially, the shift from physical media to digital sharing is ongoing. Any cloud platform entering this market needs to solve the CD import problem (like easy2PACS does).

4. **ISO 27001 is table stakes for European healthcare**: EasyRadiology's triple ISO certification (27001/27017/27018) is the minimum for selling to European hospitals. Our cloud platform will need the same.

5. **Server-side image conversion is viable for sharing**: For non-diagnostic viewing (patients, referring docs), pre-rendering DICOM to JPEG on the server is simpler and faster than client-side DICOM parsing. Our cloud platform could use this approach for sharing links while keeping full client-side rendering for diagnostic users.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|-----------|-------|
| Company details | High | From official website, GHA, Northdata |
| Product features | High | From official website and portal inspection |
| Technical architecture | Medium | Inferred from source analysis (jQuery/Bootstrap, no DICOM libraries). No official technical docs |
| Rendering approach | Medium | Strong inference (no client-side DICOM libs = server-side rendering) but not confirmed |
| Pricing | Low | Only patient tier (free) is public. B2B pricing undisclosed |
| Market share | Low | 35% Germany claim is self-reported, unverified |
| Certifications | High | ISO certifications listed on official site with dates |
| Revenue/financials | Low | Only balance sheet total (~2M EUR) from Northdata |
| Medical device classification | Low | Not publicly disclosed |

---

*Research conducted: 2026-03-14*
*Sources: easyradiology.de, easyradiology.net, portal.easyradiology.net, GHA (German Health Alliance), Northdata, Crunchbase, web search*
