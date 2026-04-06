# Research: DICOM Sharing to Medical Providers -- Compliance & Integration

## Summary

This document analyzes the regulatory, technical, and business requirements for adding
a "share with your provider" feature to a local-first consumer DICOM viewer (myradone).
The research covers HIPAA classification, FTC obligations, interoperability standards,
specific EHR/PACS integrations, cloud platform options, and realistic startup paths.

**Key conclusions:**

1. A consumer app that facilitates patient-to-provider imaging transfer is most likely
   classified as a **vendor of personal health records (PHR)** under the FTC, not a
   HIPAA business associate -- unless it contracts with covered entities.
2. The **conduit exception does not apply** to a software platform that processes or
   temporarily stores DICOM data, even if storage is transient.
3. The fastest path to market is **integration with an existing image exchange network**
   (Ambra/Intelerad, PowerShare/Microsoft) rather than building direct hospital integrations.
4. Minimum viable compliance costs approximately **$30K-$80K** in year one (SOC 2 route)
   or **$35K-$70K** (HITRUST e1 route), plus 6-12 months of preparation.
5. Epic integration alone takes **6-18 months** and costs **$100K-$300K+** in engineering,
   making it a poor first move for a startup.

---

## 1. HIPAA & Regulatory Classification

### 1.1 What Category Does a Consumer Imaging App Fall Into?

The regulatory classification depends on **who the app contracts with** and **how data flows**:

| Scenario | Classification | Regulated By |
|----------|---------------|-------------|
| Patient stores/views their own DICOM files locally | Not regulated by HIPAA | FTC (if health data collected) |
| Patient uses app to share images with their provider | **PHR vendor** | FTC Health Breach Notification Rule |
| App contracts with hospital/provider to receive images on behalf of patient | **Business associate** | HHS/HIPAA |
| App only transmits data, never stores it (even transiently) | Potentially conduit (see 1.3) | Possibly exempt |

**For myradone's planned feature (patient-initiated sharing):**

The app is most likely a **vendor of personal health records** under FTC jurisdiction.
A PHR is defined as "an electronic record of identifiable health information on an
individual that has the technical capacity to draw information from multiple sources
and that is managed, shared, and controlled by or primarily for the individual."

A DICOM viewer that stores patient imaging locally and allows the patient to share it
with providers fits this definition precisely.

**Key distinction:** Once a patient directs their health information to a non-HIPAA app,
that information is no longer subject to HIPAA protections (per HHS guidance). However,
it IS subject to the FTC Health Breach Notification Rule and potentially state laws.

Sources:
- [HHS: Collecting, Using, or Sharing Consumer Health Information?](https://www.hhs.gov/hipaa/for-professionals/special-topics/hipaa-ftc-act/index.html)
- [HHS: The access right, health apps, & APIs](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html)
- [HHS: Business Associates FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/business-associates/index.html)

### 1.2 FTC Health Breach Notification Rule

The FTC, not HHS, regulates PHR vendors. The **Health Breach Notification Rule (HBNR)**
was substantially updated in April 2024 (effective July 2024) and now explicitly covers:

- **Vendors of personal health records** -- entities that offer or maintain a PHR
- **PHR related entities** -- entities that offer products/services through online
  services of PHR vendors, including mobile apps
- **Third party service providers** -- service providers to the above

**Obligations under the HBNR:**

1. **Breach notification to individuals** -- "without unreasonable delay and no later
   than 60 calendar days after discovery"
2. **Breach notification to FTC** -- concurrent with individual notification
3. **Media notification** -- if breach affects 500+ residents of a state
4. **Definition of breach** -- includes both security breaches AND "unauthorized
   disclosures" (e.g., sharing data with third parties without consent)

**Enforcement precedent:** The FTC has already enforced against GoodRx ($1.5M fine, 2023),
BetterHelp ($7.8M, 2023), and Easy Healthcare/Premom for violations.

**Critical implication for myradone:** Any sharing of DICOM data with analytics,
advertising, or third-party services without explicit patient consent is a breach
under the HBNR, even if it is anonymized or de-identified.

Sources:
- [FTC: Updated Health Breach Notification Rule](https://www.ftc.gov/business-guidance/blog/2024/04/updated-ftc-health-breach-notification-rule-puts-new-provisions-place-protect-users-health-apps)
- [FTC: Complying with FTC's Health Breach Notification Rule](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)
- [Federal Register: Health Breach Notification Rule Final Rule](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)

### 1.3 The Conduit Exception -- Does NOT Apply

The HIPAA conduit exception is extremely narrow. It applies **only** to entities that:

1. Transmit PHI but do **not** have persistent access to it
2. Do **not** store copies (even transiently beyond what transmission requires)
3. Function like the postal service, ISPs, or courier services

**Why myradone cannot claim the conduit exception:**

- The app loads, parses, renders, and displays DICOM data on the user's device
- Even if sharing is "pass-through," the app processes pixel data and DICOM metadata
- Cloud service providers (CSPs) that process data are explicitly NOT conduits per HHS
- Email services, fax services, and messaging services are commonly misclassified as conduits

The conduit exception protects ISPs and delivery services. A software application that
provides value-added services on top of the data (viewing, annotation, sharing workflow)
is not a conduit.

Sources:
- [HHS FAQ: Can a CSP be considered a conduit?](https://www.hhs.gov/hipaa/for-professionals/faq/2077/can-a-csp-be-considered-to-be-a-conduit-like-the-postal-service-and-therefore-not-a-business%20associate-that-must-comply-with-the-hipaa-rules/index.html)
- [HIPAA Journal: Conduit Exception Rule (2026 Update)](https://www.hipaajournal.com/hipaa-conduit-exception-rule/)

### 1.4 HITECH Act and PHR Exceptions

The HITECH Act (2009) created the FTC Health Breach Notification Rule specifically to
cover PHR vendors that fall outside HIPAA. Key points:

- **HITECH Section 13407** mandates breach notification for PHR vendors
- **HITECH Section 13424** directed FTC to create the HBNR
- The FTC has authority to impose civil penalties up to $50,120 per violation per day

**Proposed HIPRA legislation (November 2025):** Senator Bill Cassidy introduced HIPRA
to create a unified federal framework covering health apps and wearables, jointly
regulated by HHS and FTC. If enacted, this would significantly change the regulatory
landscape. As of April 2026, it has not been enacted.

Sources:
- [Sheppard Health Law: A New Era of Privacy Enforcement](https://www.sheppardhealthlaw.com/2025/09/articles/privacy-and-data-security/a-new-era-of-privacy-enforcement-lessons-for-digital-health-players/)
- [PrivaPlan: Health Information Under HIPRA](https://privaplan.com/health-information-under-hipra-how-the-new-privacy-act-will-reshape-apps-and-consumer-data/)

### 1.5 Minimum HIPAA/Compliance Program for a Startup

Even though myradone likely falls under FTC rather than HIPAA, best practice (and
hospital buyer expectations) demands a HIPAA-grade compliance program:

**Required elements:**

1. **Risk Assessment** -- Inventory all systems, data flows, vendors; identify threats;
   create risk register with remediation plans. Must be done before handling any PHI.
   Repeat annually and after major changes.

2. **Policies & Procedures** -- Minimum set:
   - Access management and least privilege
   - Data classification, retention, and secure disposal
   - Incident response and breach notification (FTC HBNR-compliant)
   - Encryption and key management
   - Device controls and remote work policy
   - Contingency planning (backups, DR, emergency ops)
   - Change management and secure SDLC

3. **Business Associate Agreements** -- Required before accessing any covered entity's
   systems. Must specify permitted uses/disclosures, safeguards, breach reporting
   timelines, subcontractor management, and termination procedures.

4. **Workforce Training** -- New-hire training before PHI access, annual refresher.
   Role-specific tracks for engineering, support, and sales. Track attendance.

5. **Technical Safeguards:**
   - TLS 1.2+ for data in transit
   - AES-256 for data at rest
   - MFA and unique user IDs
   - Audit logging with immutable storage
   - Automatic session timeouts
   - Least-privilege access controls

6. **Audit Logging** -- HIPAA requires recording and examining all activity in systems
   containing ePHI. Documentation must be retained for **at least 6 years**. Some
   states require longer.

Sources:
- [AccountableHQ: HIPAA Compliance for Healthcare Accelerator Startups](https://www.accountablehq.com/post/hipaa-compliance-for-healthcare-accelerator-startups-a-practical-guide-and-checklist)
- [HIPAA Journal: HIPAA Risk Assessment (2026)](https://www.hipaajournal.com/hipaa-risk-assessment/)
- [HIPAA Journal: HIPAA Training Requirements (2026)](https://www.hipaajournal.com/hipaa-training-requirements/)
- [Kiteworks: HIPAA Audit Logs Complete Requirements](https://www.kiteworks.com/hipaa-compliance/hipaa-audit-log-requirements/)

### 1.6 SOC 2 vs HITRUST

| Factor | SOC 2 Type II | HITRUST (e1/i1/r2) |
|--------|--------------|---------------------|
| **What it is** | Attestation report on security controls | Certification against a prescriptive framework |
| **Healthcare acceptance** | Widely accepted, often sufficient | Gold standard for large health systems |
| **Year 1 cost (startup)** | $30K-$80K all-in | e1: $20K-$70K / i1: $60K-$200K / r2: $150K-$1M+ |
| **Audit fee alone** | $12K-$20K (small) to $30K-$100K+ (large) | e1: ~$6K report credit / i1: ~$7K / r2: ~$9K |
| **Timeline to complete** | 6-12 months (includes 3-12 month observation) | e1: 1-3 months / i1: 6-9 months / r2: 12-15 months |
| **Renewal cost** | 30-50% less in year 2+ | Annual for e1/i1, biennial for r2 |
| **Who requires it** | Most hospital vendor security reviews | Epic-integrated apps, large health systems |
| **Best for startups** | Yes -- faster, cheaper, widely recognized | e1 for quick credibility, i1 when buyers demand it |

**Recommendation for myradone:** Start with **SOC 2 Type II** (or HITRUST e1 for a fast
credential). Graduate to HITRUST i1 or r2 when enterprise health system contracts require
it. Many hospitals will accept SOC 2 plus a vendor security questionnaire.

Sources:
- [Scytale: SOC 2 Compliance Cost in 2026](https://scytale.ai/center/soc-2/how-much-does-soc-2-compliance-cost/)
- [Sprinto: HITRUST Certification Cost in 2026](https://sprinto.com/blog/hitrust-certification-cost/)
- [ComplyJet: HITRUST Certification 2026](https://www.complyjet.com/blog/hitrust-certification)

### 1.7 State Laws Beyond HIPAA

| State/Law | Key Requirements | Impact on Consumer Imaging App |
|-----------|-----------------|-------------------------------|
| **Washington MHMDA** (My Health My Data Act, 2023) | Applies to ALL entities processing consumer health data, no revenue/size threshold. Requires consent before collection. Right to deletion including from backups. Private right of action. | **High impact.** No HIPAA exemption. Must get consent, honor deletion, disclose all third-party recipients. |
| **California CCPA/CPRA + CMIA** | CCPA covers businesses >$25M revenue or >100K consumers. CMIA (Confidentiality of Medical Information Act) covers medical providers. If CMIA applies, it supersedes CCPA for that data. | **Moderate.** CMIA likely does not apply to consumer apps (applies to providers/insurers). CCPA applies if thresholds met. |
| **Texas HB 300** (2012) | Extremely broad definition of "covered entity" -- any person who assembles, collects, stores, or transmits PHI. All electronic disclosures require authorization. Penalties up to $1.5M/year. | **High impact.** Broader than HIPAA. Any app handling TX resident health data is covered. Training required within 90 days. |
| **New York SHIELD Act** (amended March 2025) | Now includes medical information in definition of "private information." Requires reasonable safeguards. Breach notification mandatory. | **Moderate.** Applies to any business handling NY resident data. Medical imaging data now explicitly covered. |
| **Colorado Privacy Act** | Consumer opt-out rights for health data. | **Low impact** initially. |

**Critical takeaway:** Washington's MHMDA has no size threshold and a private right of
action. Any consumer health app available to Washington residents must comply from day one.

Sources:
- [California Lawyers Association: Washington MHMDA](https://calawyers.org/privacy-law/the-washington-my-health-my-data-act-not-just-washington-or-health/)
- [Clark Hill: Beyond HIPAA State Laws](https://www.clarkhill.com/news-events/news/beyond-hipaa-how-state-laws-are-reshaping-health-data-compliance/)
- [HIPAA Journal: Texas HB 300 (2026 Update)](https://www.hipaajournal.com/what-is-texas-hb-300/)
- [Recording Law: New York SHIELD Act (2026)](https://www.recordinglaw.com/us-laws/data-privacy-laws/new-york-data-privacy-laws/)

### 1.8 International: GDPR and Canada

**GDPR (EU/EEA):**

Health data is a "special category" under GDPR Article 9, requiring explicit consent or
another Article 9(2) basis. Key requirements:

- Explicit consent for processing health data
- Data Protection Impact Assessment (DPIA) mandatory for medical AI/imaging
- Right to erasure (including from backups, which is technically challenging for DICOM)
- Data minimization -- only collect what is necessary
- Pseudonymization/de-identification of DICOM data when possible
- Cross-border transfer restrictions (Standard Contractual Clauses or adequacy decision)
- 72-hour breach notification to supervisory authority

DICOM presents specific GDPR challenges because the format embeds patient identifiers
throughout the file structure, making true anonymization difficult.

Sources:
- [PMC: GDPR and the Radiologist](https://pmc.ncbi.nlm.nih.gov/articles/PMC5438318/)
- [Galeon: Health Data and GDPR Obligations 2026](https://www.galeon.care/blog/health-data-and-gdpr-concrete-obligations-for-healthcare-institutions-in-2026)

**Canada (PIPEDA/PHIPA):**

PIPEDA applies federally to private sector organizations. Provincial laws add
requirements:

- Ontario PHIPA specifically governs health information custodians
- 10 Fair Information Principles (accountability, consent, purpose limitation, etc.)
- Consent required before collection, use, or disclosure
- Medical imaging data explicitly included as personal health information
- Applies to interprovincial and international transfers

Sources:
- [Office of the Privacy Commissioner: PIPEDA](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/)
- [Formity: Navigating PHIPA, PIPEDA, and HIPAA in Canada](https://formity.ca/privacy-and-security/navigating-phipa-pipeda-and-hipaa-compliance-in-canada-a-comprehensive-guide/)

---

## 2. DICOM Interoperability Standards

### 2.1 DICOMweb REST APIs

DICOMweb (DICOM Part 18) defines three core RESTful services for imaging exchange:

| Service | Purpose | HTTP Method | Use Case |
|---------|---------|-------------|----------|
| **STOW-RS** (Store) | Upload DICOM instances to a remote system | POST | Patient pushes images to provider PACS |
| **WADO-RS** (Retrieve) | Download DICOM instances, series, or studies | GET | App retrieves images from provider PACS |
| **QIDO-RS** (Query) | Search for studies/series/instances by metadata | GET | Find matching studies without transferring pixels |

**STOW-RS** is the most relevant for myradone's sharing feature. It allows HTTP POST
of DICOM instances (as multipart/related with application/dicom parts) to a DICOMweb
endpoint. No Application Entity (AE) pre-registration is required -- unlike legacy
DIMSE C-STORE.

**Hospital adoption (2025-2026):** DICOMweb adoption is growing but uneven:
- Major cloud PACS vendors support it (Google, Azure, AWS, Ambra/Intelerad)
- Large academic medical centers increasingly expose DICOMweb endpoints
- Many community hospitals still rely on legacy DIMSE protocols
- Hybrid environments (DIMSE for scheduling, DICOMweb for storage/retrieval) are common
- AI application marketplace is driving DICOMweb adoption as a prerequisite

Sources:
- [Medicai: DICOMweb Explained](https://blog.medicai.io/en/what-is-dicomweb/)
- [DICOM Standard: DICOMweb](https://www.dicomstandard.org/using/dicomweb)
- [PMC: DICOMweb Background and Application](https://pmc.ncbi.nlm.nih.gov/articles/PMC5959831/)

### 2.2 IHE Profiles for Image Exchange

| Profile | Full Name | Description | Adoption Status |
|---------|-----------|-------------|-----------------|
| **XDS-I.b** | Cross-enterprise Document Sharing for Imaging | Extends XDS to share imaging manifests and DICOM references across care sites | Moderate outside US; limited inside US |
| **XCA-I** | Cross-Community Access for Imaging | Enables cross-community image retrieval using XDS-I imaging manifests | Limited |
| **MHD** | Mobile access to Health Documents | FHIR-based lightweight alternative to XDS using DocumentReference | Very limited (one vendor at Connectathon) |
| **MHD-I** | Mobile access to Health Documents for Imaging | Proposed FHIR+DICOMweb alternative to XDS-I | Proposal stage |

**Practical implication:** These IHE profiles are important for understanding the
standards landscape, but they are NOT the fastest integration path for a startup.
XDS-I.b requires infrastructure that most US hospitals don't expose to consumer apps.
MHD-I is still in proposal stage.

Sources:
- [IHE Wiki: Cross-enterprise Document Sharing for Imaging](https://wiki.ihe.net/index.php/Cross-enterprise_Document_Sharing_for_Imaging)
- [IHE Wiki: MHD for Imaging Proposal](https://wiki.ihe.net/index.php/Mobile_access_to_Health_Documents_for_Imaging_-_Detailed_Proposal)

### 2.3 FHIR R4 ImagingStudy Resource

The FHIR R4 ImagingStudy resource bridges FHIR and DICOM:

**Key fields:**
- `identifier` -- DICOM Study Instance UID (encoded as `urn:dicom:uid` system)
- `status` -- registered | available | cancelled | entered-in-error | unknown
- `subject` -- Reference to Patient (mandatory)
- `started` -- When study began
- `modality` -- CT, MR, etc.
- `endpoint` -- References to DICOMweb servers (WADO-RS) for actual pixel data retrieval
- `series` -- Array of series, each with `uid`, `modality`, `bodySite`, `instance` array
- `numberOfSeries` / `numberOfInstances` -- Count summaries

**How it references DICOM data:**
ImagingStudy does NOT contain pixel data. It contains metadata and `endpoint` references
to DICOMweb servers where the actual images can be retrieved via WADO-RS. The resource
maps to DICOM attributes using standard 32-bit tags (e.g., 0008,103E for Series Description).

**Relationship to other FHIR resources:**
- Referenced by DiagnosticReport (links imaging to structured reports)
- Referenced by Observation (clinical measurements)
- References Patient, Encounter, ServiceRequest

**Important limitation:** "ImagingStudy provides access to significant DICOM information
but will only eliminate the need for DICOM query (e.g., QIDO-RS) in the simplest cases."
For full imaging workflows, DICOMweb is still required alongside FHIR.

Sources:
- [HL7: ImagingStudy - FHIR v4.0.1](http://hl7.org/fhir/R4/imagingstudy.html)
- [HL7: FHIR ImagingStudy v5.0.0](https://www.hl7.org/fhir/imagingstudy.html)

### 2.4 What US Hospitals Actually Support Today

Based on research across vendor documentation, KLAS reports, and ONC regulatory activity:

**Widely supported:**
- Legacy DIMSE (C-STORE, C-FIND, C-MOVE) -- universal in hospital PACS
- HL7 v2 messaging for radiology orders/results
- CD/DVD burning (still common, being phased out)

**Growing adoption:**
- DICOMweb (STOW-RS, WADO-RS, QIDO-RS) -- supported by major PACS vendors, cloud platforms
- FHIR R4 for clinical data (mandated by CMS/ONC), but ImagingStudy support varies
- Image exchange networks (Ambra/Intelerad, PowerShare/Microsoft) -- over 750+ providers on Ambra

**Early/theoretical:**
- IHE MHD-I (proposal stage)
- Carequality Image Exchange (guide approved March 2021, only 5 implementers)
- TEFCA for imaging (RFI issued January 2026, no rules yet)

**The gap:** There is no mandated standard for patient-to-provider image sharing today.
ONC's January 2026 RFI on Diagnostic Imaging Interoperability Standards is explicitly
asking industry what to do. This creates both uncertainty and opportunity.

Sources:
- [Federal Register: Diagnostic Imaging Interoperability RFI](https://www.federalregister.gov/documents/2026/01/30/2026-01866/request-for-information-diagnostic-imaging-interoperability-standards-and-certification)
- [OnHealthcare.tech: 2026 ISA Analysis](https://www.onhealthcare.tech/p/the-2026-isa-onc-drops-a-catalog)

### 2.5 DICOM De-identification (PS3.15)

DICOM PS3.15 Annex E defines the **Attribute Confidentiality Profiles** for removing
patient identifiers from DICOM data:

- The **Basic Application Level Confidentiality Profile** tabulates all potential
  identifier-containing data elements and prescribes actions (remove, replace, hash, etc.)
- Options control the level of protection vs. data utility preserved
- Covers ~100+ DICOM tags including patient name, ID, dates, institution name, etc.

**Important caveats:**
- De-identification of attributes does NOT guarantee de-identification of the information
  object (burned-in text on images, face reconstructions from CT/MRI, etc.)
- Manufacturers have been "slow to adopt" PS3.15 for de-identification
- A robust de-identification process requires context assessment, regulatory interpretation,
  and re-identification risk analysis beyond just tag removal

**For myradone:** De-identification is relevant for research sharing, not provider sharing.
When sharing with a provider, the images should retain patient identifiers so the provider
can match them to the correct patient record.

Sources:
- [DICOM PS3.15 Annex E: Attribute Confidentiality Profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_e.html)
- [PMC: NCI 2023 Workshop on Medical Image De-identification](https://pmc.ncbi.nlm.nih.gov/articles/PMC11810855/)

---

## 3. Epic MyChart Integration

### 3.1 Can Patients Upload Imaging into MyChart?

**Not directly.** Epic MyChart allows patients to:
- **View** imaging studies that are already in the Epic system
- **Print** and download imaging from the Mobility module
- **Connect third-party apps** via SMART on FHIR to read clinical data

However, MyChart does **not** have a native DICOM upload feature for patients. The
pathway for getting patient imaging into Epic is:

1. **Through Ambra Health's MyChart integration** -- Ambra provides a patient portal
   integrated with MyChart that allows secure image sharing
2. **Through provider ordering** -- Patient brings CD/USB, provider imports into PACS,
   Epic links via PACS integration
3. **Through SMART on FHIR app** -- A third-party app could potentially write imaging
   references, but this is heavily restricted

### 3.2 Epic's SMART on FHIR and ImagingStudy

Epic supports SMART on FHIR (OAuth 2.0-based) for both EHR Launch and Standalone Launch.
For patient-facing apps launched from MyChart:

**What is supported:**
- ~450 FHIR R4 API endpoints across ~55 resource types
- Patient authentication via MyChart OAuth flow
- ImagingStudy.Read (R4) -- retrieve imaging study metadata
- ImagingStudy.Search (R4) -- search for imaging studies

**What is NOT supported or heavily restricted:**
- ImagingStudy write/create operations for patient-facing apps
- Direct DICOM pixel data upload via FHIR
- The MyChart approval screen has "no way to prompt a user about whether they want to
  share imaging data" specifically

**DICOM interfaces Epic supports:**
- WADO (Web Access to DICOM Objects) -- for pulling images from PACS
- MWL, MPPS, SR, SC -- standard modality integration
- Enterprise Image Access API -- generates secure links to launch enterprise image viewers
- PACS integration APIs (SSO, context sync, measurement exchange)

**Key limitation:** Epic's imaging integration is designed for provider-to-provider and
PACS-to-EHR workflows, not patient-to-Epic uploads. Ambra's Epic integration is the
closest thing to a patient imaging upload path.

Sources:
- [Open.Epic: Imaging Ancillary Systems](https://open.epic.com/Ancillary/Imaging)
- [Open.Epic: FHIR Interface](https://open.epic.com/interface/FHIR)
- [Epic on FHIR: Documentation](https://fhir.epic.com/Documentation)

### 3.3 Open.Epic Developer Program

**Registration:** Free. Any developer can register at open.epic.com to access:
- Sandbox environments for testing
- API documentation
- Community Member test environments

**To list on Showroom / Connection Hub:**
- Annual fee: **$500** for Connection Hub listing (basic tier)
- Must validate functionality in a Community Member sandbox
- Must complete Epic's attestation and security checklists
- Listing is optional -- you can integrate with Epic customers without it

**Three tiers (Showroom, launched 2024):**
1. **Connection Hub** -- $500/year, basic listing for integrated products
2. **Toolbox** -- recommended integration patterns, higher visibility
3. **Workshop** -- deep co-development partnerships (by invitation)

### 3.4 Realistic Cost of Epic Integration

**Total cost for a startup:**
- **Engineering:** 2-3 engineers for 6-12 months (~$150K-$300K in labor)
- **Connection Hub listing:** $500/year
- **Per-customer integration:** Each Epic customer must individually approve and configure
  third-party access ("Integration is 20% development, 80% negotiation and coordination")
- **Compliance prerequisites:** SOC 2 or HITRUST certification, HIPAA BAAs
- **Real-world example:** One documented case showed ~$300K in labor over 8 months,
  excluding maintenance
- **Annual maintenance:** 20-30% of initial implementation cost
- **Timeline:** 6-18 months from initiation to production

**Epic contracts typically prohibit system access from outside the United States.**

Sources:
- [Invene: Epic EHR API Integration Guide](https://www.invene.com/blog/epic-ehr-api-integration)
- [Folio3: Epic Integration Cost Breakdown](https://digitalhealth.folio3.com/blog/epic-integration-cost-breakdown/)
- [TopFlightApps: How to Integrate with Epic in 2026](https://topflightapps.com/ideas/how-integrate-health-app-with-epic-ehr-emr/)

### 3.5 Real Examples of Consumer Apps Integrated with Epic for Imaging

**Ambra Health (Intelerad)** is the primary example:
- Full MyChart integration for patient imaging access
- Single sign-on from Epic to Ambra viewer
- AutoFilm Library feature links imaging to Epic orders
- Physician portal integration for viewing from order records
- Deployed at UC San Diego Health, Johns Hopkins, Memorial Hermann, NYP

No other consumer-facing imaging app has achieved deep Epic integration comparable to
Ambra's. This underscores the difficulty and cost of direct Epic integration.

Sources:
- [PR Newswire: Ambra Health Epic Integrations](https://www.prnewswire.com/news-releases/ambra-health-offers-access-to-medical-imaging-with-epic-integrations-301081064.html)
- [PR Newswire: Ambra Patient Portal and EHR Integration](https://www.prnewswire.com/news-releases/ambra-health-deepens-patient-access-to-medical-imaging-with-new-patient-portal-and-integration-to-leading-electronic-health-record-ehr-platforms-300608024.html)

---

## 4. Ambra Health (Intelerad) Integration

### 4.1 Company Background

Ambra Health was founded in 2004 as DICOM Grid. Raised $62.2M total (investors include
Canaan Partners, Mayo Clinic Business Accelerator). Reached $10.3M revenue by 2020 with
114 employees. Acquired by Intelerad (date undisclosed). Won Best in KLAS for Medical
Image Exchange for **8 consecutive years** (through 2024).

750+ healthcare providers on the network.

### 4.2 Ambra REST API (v3)

Ambra provides a comprehensive REST API at `access.dicomgrid.com/api/v3/`:

**Authentication:**
- Session ID (SID) -- login-based
- Basic authentication (username/password)
- OAuth tokens for third-party integrations

**Core endpoints:**

| Category | Key Endpoints | Description |
|----------|--------------|-------------|
| Session | `/session/login`, `/session/logout` | Authentication |
| Study | `/study/add`, `/study/get`, `/study/list`, `/study/delete` | CRUD for imaging studies |
| Sharing | `/study/share`, `/study/share/stop`, `/study/share/list` | Share studies via codes/email |
| Patient | `/patient/add`, `/patient/get`, `/patient/portal/login` | Patient management |
| Upload | `/study/add` with DICOM validation | Upload DICOM files |
| Retrieve | `/study/retrieve` | PACS query/retrieve |

**Sharing mechanisms:**
- Share codes (time-limited access tokens)
- Email sharing (direct recipient delivery)
- Account-level sharing (organization-wide)
- Group/location sharing (department-based)
- Anonymous linking (public study access without authentication)

**Filtering:** Field-based filters with conditions (equals, like, gt, lt, in).
Pagination: configurable row count (default 100-1000, max 5000).

### 4.3 Compliance

Ambra Health is **HIPAA-compliant** and offers BAAs. Their platform includes:
- Audit logging and compliance reporting
- Role-based access control (Admin, User, PHR, Anonymous)
- HL7 integration for EHR connectivity
- DICOM conformance (Ambra Gateway DICOM Conformance Statement published)

No public SOC 2 or HITRUST certification status found in research, but as a KLAS
#1 vendor serving major health systems, enterprise-grade compliance is implied.

### 4.4 Pricing

**Not publicly disclosed.** Ambra offers "customized pricing tailored to the specific
needs of each practice." They serve organizations of all sizes including startups.
Contact Intelerad directly for quotes.

Based on industry context: cloud PACS and image exchange platforms typically price by:
- Per-study volume
- Storage capacity (GB/TB)
- Number of connected endpoints/locations
- Annual subscription

### 4.5 Comparison to Competitors

| Vendor | Parent | Key Strength | KLAS Ranking | Best For |
|--------|--------|-------------|-------------|----------|
| **Ambra/InteleShare** | Intelerad | Broadest network, Epic integration, API | #1 (8 years running) | Enterprise image exchange |
| **PowerShare** | Microsoft (Nuance) | Best in KLAS 2026, multi-modality | #1 in 2026 | Large health systems |
| **LifeImage** | Intelerad | PACS-neutral, early adopter base | N/A (acquired) | Merged into Intelerad |
| **Nucleus.io** | NucleusHealth | Pure cloud PACS, Azure-based | N/A | Cloud-first organizations |
| **Medicai** | Independent | Modern cloud PACS, AI integration | N/A | Startups, modern stack |
| **Purview** | Independent | Patient upload workflow, web-based | N/A | Patient-initiated sharing |

**Key consolidation:** Intelerad now owns both Ambra and LifeImage, controlling a
dominant share of the image exchange market.

Sources:
- [Ambra v3 API Documentation](https://access.dicomgrid.com/api/v3/api.html)
- [Intelerad: Enterprise Image Exchange](https://www.intelerad.com/wp-content/uploads/2022/03/Ambra-Enterprise-Image-Exchange-Datasheet.pdf)
- [Microsoft: PowerShare Image Sharing](https://www.microsoft.com/en-us/health-solutions/radiology-workflow/powershare-image-sharing)

---

## 5. Other Integration Paths

### 5.1 Oracle Health (Cerner)

Oracle Health (formerly Cerner) provides:
- **HealtheLife** patient portal with health record access
- **DICOM data export** in original format from Multimedia Storage
- **Radiology PACS** supporting full imaging lifecycle
- **PowerChart** integration for clinician access to imaging

Patient imaging upload capabilities are more limited than Epic. FHIR API support exists
but imaging-specific endpoints are less documented than Epic's.

Sources:
- [Oracle Health: Service Lines and Departments](https://www.oracle.com/health/service-lines-departments/)
- [IntuitionLabs: Cerner Patient Portal](https://intuitionlabs.ai/software/radiology-workflow-informatics/patient-communication-portals/cerner-patient-portal)

### 5.2 Cloud Healthcare Platforms

**Google Cloud Healthcare API:**
- Full DICOMweb implementation (STOW-RS, WADO-RS, QIDO-RS)
- Storage pricing: Standard blob storage ~$0.020-0.026/GB/month (varies by region),
  Coldline $0.01/GB/month
- Structured metadata storage charged separately
- First 1 GB storage free; first 25K operations/month free
- OHIF Viewer integration available
- HIPAA BAA available

**AWS HealthImaging:**
- HIPAA-eligible service with DICOMweb APIs plus cloud-native APIs
- Intelligent tiering (Frequent Access -> Archive Instant Access after 30 days)
- Free tier: 20 GB/month storage, 20K API requests/month
- Data imports always free; no retrieval charges
- Petabyte-scale design

**Microsoft Azure Health Data Services (DICOM Service):**
- Full DICOMweb implementation (STOW-RS, WADO-RS, QIDO-RS, UPS-RS)
- Integrates with FHIR service in same workspace
- Custom APIs: change feed, extended query tags
- Data Lake Storage integration for analytics
- HIPAA BAA available

**Comparison for myradone:**

All three would work as backend infrastructure if myradone needs a cloud relay for
sharing. Google and Azure have the most mature DICOMweb implementations. AWS
HealthImaging is optimized for large-scale storage with intelligent tiering.

For a startup, Google Cloud Healthcare API has the most developer-friendly documentation
and the OHIF viewer integration provides a good reference architecture.

Sources:
- [Google Cloud: DICOM Concepts](https://docs.cloud.google.com/healthcare-api/docs/concepts/dicom)
- [AWS HealthImaging](https://aws.amazon.com/healthimaging/)
- [Azure: DICOM Service Overview](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/overview)

### 5.3 Image Exchange Networks

**Current landscape (2026):**

The three original major networks have consolidated under two parents:

1. **Intelerad** -- owns Ambra Health + LifeImage
2. **Microsoft** -- owns PowerShare (via Nuance acquisition 2021)

**Carequality Image Exchange:**
- Implementation guide approved March 2021
- 5 implementers: Ambra, Hyland, LifeImage, Nuance, Philips
- Still early; production deployment limited
- Uses IHE XDS-I infrastructure

**Key finding:** The image exchange market is now an effective duopoly (Intelerad vs
Microsoft). A startup building a sharing feature should integrate with one or both
of these networks rather than building direct hospital connections.

### 5.4 CommonWell Health Alliance

CommonWell connects 15,000+ healthcare organizations for clinical data exchange.
Carequality connection enables cross-network data exchange. However:

- The eHealth Exchange adopted Image Exchange Use Case requirements in November 2016
- As of the latest available data, this use case "has not yet been implemented by
  Participants to exchange radiology images"
- CommonWell's imaging capabilities remain limited compared to dedicated image
  exchange networks

### 5.5 TEFCA (Trusted Exchange Framework)

TEFCA is the national interoperability network, reaching nearly 500 million health
records exchanged as of February 2026. However:

- **Imaging is NOT currently covered** by TEFCA
- ONC issued a **Diagnostic Imaging Interoperability RFI** on January 30, 2026
- Comment period closed March 16, 2026
- This is a "listening phase, not a new rule" -- no imaging mandate is imminent
- DICOM professionals want imaging treated like other healthcare data under TEFCA

**Implication:** TEFCA imaging support is 2-5+ years away from production. Do not wait
for it.

Sources:
- [TEFCA: Sequoia Project](https://rce.sequoiaproject.org/tefca/)
- [Federal Register: Diagnostic Imaging Interoperability RFI](https://www.federalregister.gov/documents/2026/01/30/2026-01866/request-for-information-diagnostic-imaging-interoperability-standards-and-certification)
- [HHS: TEFCA 500 Million Records](https://www.hhs.gov/press-room/tefca-americas-national-interoperability-network-reaches-nearly-500-million-health-records-exchanged.html)

### 5.6 Direct Protocol

The Direct protocol is a HIPAA-compliant secure messaging standard (based on S/MIME)
used for provider-to-provider communication. It supports attachments including clinical
documents.

**Relevance to imaging:** Limited. Direct is designed for small clinical documents
(CCDs, referral letters), not large DICOM datasets. A single CT scan can be 100-500 MB.
Direct is not a practical path for imaging exchange.

---

## 6. Realistic Path for a Startup

### 6.1 Minimum Viable Compliance

**To legally share PHI as a PHR vendor (FTC-regulated):**

1. **Privacy policy** that discloses data practices, sharing, and third parties
2. **Consent mechanism** for data sharing (explicit, affirmative)
3. **Breach notification capability** (FTC HBNR: 60 days to individuals, concurrent to FTC)
4. **Reasonable security safeguards** (encryption in transit/at rest, access controls)
5. **Compliance with Washington MHMDA** if available to WA residents (no threshold)
6. **Compliance with Texas HB 300** if handling TX resident data

**To sell to hospitals/health systems (HIPAA-adjacent):**

Add:
7. **HIPAA-grade compliance program** (risk assessment, policies, training)
8. **BAA template** ready for provider customers
9. **SOC 2 Type II** or **HITRUST e1** certification
10. **Vendor security questionnaire** responses (SIG, HECVAT, or custom)

### 6.2 Cost Estimates

| Item | Year 1 Cost | Ongoing Annual |
|------|------------|----------------|
| **Compliance platform** (Vanta, Drata, Sprinto) | $10K-$25K | $10K-$25K |
| **SOC 2 Type II audit** | $12K-$20K (audit) + $20K-$40K (readiness) | $8K-$15K |
| **OR HITRUST e1** | $20K-$70K total | $15K-$40K |
| **Penetration test** | $5K-$25K | $5K-$15K |
| **Legal (policies, BAA templates)** | $10K-$30K | $5K-$10K |
| **Cyber insurance** | $3K-$10K | $3K-$10K |
| **Total (SOC 2 route)** | **$40K-$110K** | **$30K-$75K** |
| **Total (HITRUST e1 route)** | **$35K-$100K** | **$25K-$65K** |

These are conservative ranges for a small startup (<20 employees, limited scope).

### 6.3 Timeline

| Phase | Duration | Activities |
|-------|----------|-----------|
| **Phase 1: Foundation** | Months 1-3 | Risk assessment, policy development, technical controls, vendor selection |
| **Phase 2: Implementation** | Months 3-6 | Deploy encryption, audit logging, access controls, breach notification |
| **Phase 3: Certification** | Months 6-12 | SOC 2 observation window (3-12 months) or HITRUST assessment |
| **Phase 4: Integration** | Months 6-18 | Build sharing feature, integrate with exchange network, test with providers |

### 6.4 Fastest Path to Sharing

**Recommended approach: Integrate with Ambra/Intelerad or PowerShare**

Rather than building direct hospital connections:

1. **Integrate with Ambra's API** -- patient uploads DICOM to Ambra via API, Ambra
   handles routing to the provider's PACS/EHR via its existing hospital connections
2. **Ambra handles the hospital-side complexity** -- PACS integration, HL7 messaging,
   Epic/Cerner connectivity are Ambra's core competency
3. **Ambra's compliance posture covers the hospital relationship** -- they already have
   BAAs with 750+ providers
4. **myradone only needs to be compliant for the patient-to-Ambra leg** -- significantly
   simpler scope

This is the **Purview model** as well: build a patient-friendly upload interface, route
through an established exchange network for the provider delivery.

**Alternative: Use a cloud PACS as relay**
- Deploy DICOMweb-compliant storage (Google Cloud Healthcare API, Azure DICOM Service)
- Patient uploads via STOW-RS to cloud
- Generate share link or route to provider's DICOMweb endpoint
- Requires more infrastructure but gives more control

### 6.5 Startup Examples

**Ambra Health (the benchmark):**
- Founded 2004 as DICOM Grid
- Raised $62.2M over multiple rounds
- Built HIPAA-compliant cloud PACS with image exchange
- Won Best in KLAS for 8 consecutive years
- Acquired by Intelerad
- Key lesson: Started with cloud storage and exchange before expanding to EHR integration

**Purview:**
- Built web-based DICOM upload system for patient-to-provider sharing
- HIPAA-compliant, browser-based (no plugins)
- Focused on the patient upload workflow specifically
- Key lesson: Solved one problem well (patient upload) rather than building full PACS

**Medicai:**
- Modern cloud PACS with AI integration
- Image sharing, diagnostic viewer, research tools
- API-first approach
- Key lesson: Built for modern web, not legacy PACS integration

**PostDICOM:**
- Cloud DICOM viewer and storage
- Patient sharing via secure links
- Free tier available
- Key lesson: Freemium model for adoption, compliance built in

### 6.6 The Build vs Buy Decision

| Approach | Pros | Cons | Best When |
|----------|------|------|-----------|
| **Integrate with Ambra/PowerShare** | Fastest to market, leverages existing hospital connections, compliance partially inherited | Revenue share, dependency on vendor, limited control | First version, MVP, proving demand |
| **Build on cloud PACS (GCP/Azure/AWS)** | Full control, DICOMweb standard, scalable | Must build hospital connections yourself, longer compliance path | Building proprietary workflow, want to own the network |
| **Build direct hospital integrations** | Maximum control, no middleman | Extremely expensive ($100K+ per hospital), slow (6-18 months each), requires per-site configuration | Only when you have dedicated sales team and enterprise contracts |

---

## 7. Architecture Implications for myradone

### 7.1 Does Sharing Require Server-Side Infrastructure?

**Yes.** Patient-initiated sharing cannot work purely client-side because:

1. **Receiving systems (hospital PACS, exchange networks) require server-to-server
   communication** -- browsers cannot maintain persistent connections to DICOM servers
2. **Audit logging must be tamper-proof** -- client-side logs can be modified
3. **BAAs and compliance require a controlled data path** -- the sharing pathway must
   pass through infrastructure you control and can audit
4. **Exchange network APIs (Ambra, etc.) require server-side authentication** -- API
   keys and OAuth secrets cannot be exposed in client-side code

**Minimum server-side components needed:**

```
Patient's browser/desktop app
  |
  | HTTPS (TLS 1.2+)
  v
myradone API server (or cloud function)
  |-- Audit logging (immutable)
  |-- Authentication (OAuth 2.0)
  |-- DICOM validation
  |-- Consent verification
  v
Exchange network API (Ambra, etc.)
  |
  v
Provider PACS/EHR
```

### 7.2 Can It Work from Browser/Desktop Directly?

**Partially.** The desktop (Tauri) app could handle local file selection, DICOM
validation, and upload to our API. But the API-to-exchange-network leg must be
server-side.

**Hybrid approach:**
- Desktop/browser app: File selection, preview, metadata extraction, user consent flow
- Server API: DICOM upload relay, exchange network integration, audit logging
- Exchange network: Hospital delivery

### 7.3 Encryption Requirements

| Requirement | Standard | Implementation |
|-------------|----------|----------------|
| Data in transit | TLS 1.2+ (TLS 1.3 preferred) | All API communications |
| Data at rest | AES-256 | Any stored DICOM data, logs, metadata |
| Key management | Use managed KMS (AWS KMS, GCP KMS, Azure Key Vault) | Never store keys alongside data |
| End-to-end | Consider for patient-to-provider path | Complex but strongest posture |

### 7.4 Audit Logging Requirements

**What must be logged:**
- All access to DICOM data (view, download, share, delete)
- Authentication events (login, logout, failed attempts)
- Sharing events (who shared what with whom, when, consent record)
- System administration events (config changes, user management)
- Data modification events (upload, delete, de-identification)

**Retention:** Minimum 6 years (HIPAA). Some states require longer.

**Technical requirements:**
- Immutable storage (append-only, no modification or deletion)
- Timestamped with synchronized clocks
- Searchable for incident investigation
- Regular review (automated alerts for anomalies)

### 7.5 Authentication: SMART on FHIR Launch Framework

If myradone integrates with EHRs via FHIR, the SMART App Launch framework is the
standard authentication mechanism:

**Two launch modes:**
1. **EHR Launch** -- app launched from within Epic/Cerner UI, receives context (patient ID, encounter)
2. **Standalone Launch** -- app launched independently, user authenticates via EHR's OAuth flow

**Flow (Standalone Launch for patient app):**
1. App discovers EHR's authorization endpoints via `.well-known/smart-configuration`
2. App redirects to EHR authorization endpoint
3. Patient authenticates via MyChart/HealtheLife
4. EHR returns authorization code
5. App exchanges code for access token (+ optional refresh token)
6. App uses access token to call FHIR APIs (ImagingStudy.Search, etc.)

**Scopes:** SMART uses FHIR-based scopes like `patient/ImagingStudy.read` to define
granular access permissions.

Sources:
- [HL7: SMART App Launch v2.2.0](https://www.hl7.org/fhir/smart-app-launch/)
- [SMART Authorization Best Practices](https://docs.smarthealthit.org/authorization/best-practices/)

---

## 8. Regulatory Landscape and Timing

### 8.1 What Is Changing

The imaging interoperability landscape is in active flux:

1. **ONC Diagnostic Imaging RFI (Jan 2026)** -- Federal government is asking what standards
   to mandate. Comments closed March 2026. Rulemaking could follow in 2027-2028.

2. **TEFCA Imaging** -- Not yet supported. Under active consideration. 2-5 years away.

3. **HIPRA Legislation (Nov 2025)** -- If enacted, would create unified FTC+HHS framework
   for health apps. Would significantly clarify regulatory obligations.

4. **FTC HBNR Enforcement** -- Active and expanding. GoodRx, BetterHelp precedents show
   FTC is serious about enforcement.

5. **State law proliferation** -- Washington MHMDA (2023), NY SHIELD amendments (2025)
   creating patchwork of obligations.

### 8.2 What This Means for myradone

**The window is favorable.** Because there are no mandated standards for patient-to-provider
imaging exchange yet, a startup that builds a compliant sharing feature now can:

1. Influence which standards get adopted (via ONC RFI participation)
2. Establish market presence before regulations create barriers to entry
3. Build on DICOMweb + FHIR (the likely winners) before they become mandatory

**The risk:** Building on a standard that doesn't get adopted. Mitigate by integrating
with exchange networks (which abstract the hospital-side protocol) rather than betting
on a single standard for direct hospital integration.

---

## 9. Recommended Path for ADR 009

Based on this research, the recommended approach for myradone's sharing feature:

### Phase 1: Foundation (Months 1-6)
- Implement FTC HBNR compliance (privacy policy, consent, breach notification)
- Begin SOC 2 Type II or HITRUST e1 preparation
- Build server-side API with audit logging and encryption
- Design consent flow and data path architecture

### Phase 2: MVP Sharing (Months 6-12)
- Integrate with Ambra/Intelerad API for image delivery
- Patient uploads DICOM from desktop/web app to myradone API
- myradone API validates, logs, and forwards to Ambra
- Provider receives via their existing Ambra/exchange network connection
- Achieves sharing with 750+ providers on day one

### Phase 3: Expand (Months 12-24)
- Add PowerShare/Microsoft integration for broader coverage
- Explore SMART on FHIR integration for EHR context
- Consider HITRUST i1 certification if enterprise buyers demand it
- Monitor TEFCA imaging and ONC rulemaking developments
- Evaluate direct DICOMweb integration with specific health systems

### Key Decisions for ADR 009

1. **Regulatory posture:** PHR vendor (FTC) vs. Business Associate (HIPAA) -- depends
   on whether we contract with providers or only with patients
2. **Compliance certification:** SOC 2 Type II vs. HITRUST e1 as first credential
3. **Exchange network partner:** Ambra/Intelerad vs. PowerShare/Microsoft vs. both
4. **Infrastructure:** Google Cloud Healthcare API vs. Azure DICOM Service vs. AWS
   HealthImaging for server-side relay
5. **Feature scope:** Sharing only vs. sharing + receiving (bidirectional exchange)

---

## Sources Index

### HIPAA & Compliance
- [HHS: HIPAA/FTC Consumer Health Info](https://www.hhs.gov/hipaa/for-professionals/special-topics/hipaa-ftc-act/index.html)
- [HHS: Access Right, Health Apps & APIs](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html)
- [HHS: Business Associates FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/business-associates/index.html)
- [HHS: Conduit Exception FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/2077/can-a-csp-be-considered-to-be-a-conduit-like-the-postal-service-and-therefore-not-a-business%20associate-that-must-comply-with-the-hipaa-rules/index.html)
- [FTC: Health Breach Notification Rule](https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule)
- [FTC: Complying with Health Breach Notification Rule](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)
- [Federal Register: HBNR Final Rule 2024](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)
- [AccountableHQ: HIPAA for Startups](https://www.accountablehq.com/post/hipaa-compliance-for-healthcare-accelerator-startups-a-practical-guide-and-checklist)
- [HIPAA Journal: Risk Assessment 2026](https://www.hipaajournal.com/hipaa-risk-assessment/)
- [HIPAA Journal: Conduit Exception 2026](https://www.hipaajournal.com/hipaa-conduit-exception-rule/)

### Certifications & Costs
- [Scytale: SOC 2 Cost 2026](https://scytale.ai/center/soc-2/how-much-does-soc-2-compliance-cost/)
- [Sprinto: SOC 2 Audit Cost 2026](https://sprinto.com/blog/soc-2-audit-cost/)
- [Sprinto: HITRUST Cost 2026](https://sprinto.com/blog/hitrust-certification-cost/)
- [ComplyJet: HITRUST Certification 2026](https://www.complyjet.com/blog/hitrust-certification)
- [Thoropass: SOC 2 Audit Cost Guide](https://www.thoropass.com/blog/soc-2-audit-cost-a-guide)

### State & International Law
- [CA Lawyers Association: Washington MHMDA](https://calawyers.org/privacy-law/the-washington-my-health-my-data-act-not-just-washington-or-health/)
- [HIPAA Journal: Texas HB 300](https://www.hipaajournal.com/what-is-texas-hb-300/)
- [Recording Law: NY SHIELD Act 2026](https://www.recordinglaw.com/us-laws/data-privacy-laws/new-york-data-privacy-laws/)
- [PMC: GDPR and the Radiologist](https://pmc.ncbi.nlm.nih.gov/articles/PMC5438318/)
- [Office of the Privacy Commissioner: PIPEDA](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/)

### DICOM & Interoperability Standards
- [DICOM Standard: DICOMweb](https://www.dicomstandard.org/using/dicomweb)
- [Medicai: DICOMweb Explained](https://blog.medicai.io/en/what-is-dicomweb/)
- [HL7: ImagingStudy R4](http://hl7.org/fhir/R4/imagingstudy.html)
- [DICOM PS3.15: Attribute Confidentiality](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_e.html)
- [IHE Wiki: XDS-I](https://wiki.ihe.net/index.php/Cross-enterprise_Document_Sharing_for_Imaging)

### Epic Integration
- [Open.Epic: Imaging](https://open.epic.com/Ancillary/Imaging)
- [Open.Epic: FHIR](https://open.epic.com/interface/FHIR)
- [Epic on FHIR](https://fhir.epic.com/)
- [Invene: Epic Integration Guide](https://www.invene.com/blog/epic-ehr-api-integration)
- [Epic Showroom](https://showroom.epic.com/)

### Ambra Health / Intelerad
- [Ambra v3 API](https://access.dicomgrid.com/api/v3/api.html)
- [Intelerad: Enterprise Image Exchange](https://www.intelerad.com/wp-content/uploads/2022/03/Ambra-Enterprise-Image-Exchange-Datasheet.pdf)
- [Ambra Health Wikipedia](https://en.wikipedia.org/wiki/Ambra_Health)
- [Ambra Epic Integration](https://www.prnewswire.com/news-releases/ambra-health-offers-access-to-medical-imaging-with-epic-integrations-301081064.html)

### Cloud Platforms
- [Google Cloud Healthcare API: DICOM](https://docs.cloud.google.com/healthcare-api/docs/concepts/dicom)
- [Google Cloud Healthcare API: Pricing](https://cloud.google.com/healthcare-api/pricing)
- [AWS HealthImaging](https://aws.amazon.com/healthimaging/)
- [AWS HealthImaging Pricing](https://aws.amazon.com/healthimaging/pricing/)
- [Azure DICOM Service](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/overview)
- [Azure Health Data Services Pricing](https://azure.microsoft.com/en-us/pricing/details/health-data-services/)

### Exchange Networks & National Infrastructure
- [TEFCA: Sequoia Project](https://rce.sequoiaproject.org/tefca/)
- [Federal Register: Imaging Interoperability RFI](https://www.federalregister.gov/documents/2026/01/30/2026-01866/request-for-information-diagnostic-imaging-interoperability-standards-and-certification)
- [OnHealthcare.tech: 2026 ISA Analysis](https://www.onhealthcare.tech/p/the-2026-isa-onc-drops-a-catalog)
- [Microsoft PowerShare](https://www.microsoft.com/en-us/health-solutions/radiology-workflow/powershare-image-sharing)
- [Carequality Image Exchange IG](https://carequality.org/the-nations-leading-framework-for-health-information-exchange-is-expanding-to-include-imaging-data/)
- [HL7: SMART App Launch](https://www.hl7.org/fhir/smart-app-launch/)

### Patient-Initiated Sharing
- [PMC: Patient-Controlled Image Sharing](https://pmc.ncbi.nlm.nih.gov/articles/PMC3555338/)
- [Purview: How Patients Send DICOM Studies](https://www.purview.net/blog/how-patients-send-physicians-an-existing-dicom-medical-imaging-study)

---

*Research conducted April 2026 by Divergent Health Technologies.*
*This document informs ADR 009: DICOM Sharing Architecture.*
