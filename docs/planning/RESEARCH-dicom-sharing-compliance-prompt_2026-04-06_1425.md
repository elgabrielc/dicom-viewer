# Research: DICOM Sharing to Medical Providers -- Compliance & Integration

## Summary

A consumer app facilitating patient-to-provider imaging transfer is most likely regulated by the **FTC** (not HHS/HIPAA) as a vendor of personal health records, unless it contracts with covered entities. The conduit exception does not apply. The fastest path to market is integrating with **Ambra Health's API** (750+ provider network) rather than building direct hospital connections. Server-side infrastructure is required. Minimum viable compliance costs $40K-$110K in year one (SOC 2 route). No mandated standard for patient image sharing exists today -- ONC issued an RFI in January 2026, still in comment period.

---

## 1. HIPAA Classification

### Are we a covered entity, business associate, or something else?

**Most likely: vendor of personal health records (PHR), regulated by FTC.**

The classification depends on the data flow:

| Scenario | Classification | Regulator |
|----------|---------------|-----------|
| Patient uses our app to view their own DICOM files locally | Not regulated by HIPAA | Minimal (state laws) |
| Patient uses our app to send imaging to their provider | PHR vendor | FTC |
| Hospital contracts with us to receive patient imaging | Business associate | HHS/HIPAA |
| Provider uses our platform to share imaging with patient | Business associate | HHS/HIPAA |

**The critical distinction:** If the patient initiates and controls the sharing, and we don't have a contract with the receiving provider, we're a PHR vendor under FTC jurisdiction. If we contract with providers (e.g., Ambra-style network agreements), we become a business associate under HIPAA.

### FTC Health Breach Notification Rule

Updated July 2024, now explicitly covers health apps:
- 60-day breach notification to FTC and affected individuals
- If breach affects 500+ people, notify media
- Violations: $50,000+ per violation
- Applies to apps that collect health information, even without HIPAA relationship
- No certification requirement (unlike HIPAA which has no certification either, but has the Security Rule)

### The conduit exception does NOT apply

The conduit exception is narrowly limited to ISPs, telecommunications carriers, and postal-type services. Any software that processes, displays, routes, or temporarily stores data is not a conduit. A DICOM viewer that facilitates sharing is definitively not a conduit.

### Minimum HIPAA compliance program (if we become a BA)

If we contract with providers and become a business associate:
1. **Risk assessment** -- documented analysis of threats to PHI
2. **Policies and procedures** -- security, access control, breach response, data retention
3. **BAAs** -- with every subcontractor that touches PHI (cloud providers, Ambra, etc.)
4. **Training** -- workforce training on HIPAA requirements
5. **Audit logging** -- access logs for all PHI, retained 6 years
6. **Breach response plan** -- documented, tested
7. **Security officer** -- designated individual responsible
8. **Encryption** -- TLS 1.2+ in transit, AES-256 at rest

### State laws beyond HIPAA

| State | Law | Key Provision |
|-------|-----|---------------|
| Washington | My Health My Data Act (2024) | Consent required before collecting/sharing health data. Private right of action. Applies to non-HIPAA entities. |
| California | CMIA + CCPA | Medical information confidentiality. CCPA applies if we have California users. |
| Texas | THIPA | State-level health data protections, AG enforcement |
| New York | SHIELD Act | Broad data security requirements, health data included |
| Connecticut, Nevada, Colorado | Various | Consumer health data protections similar to Washington |

**Washington's law is the most aggressive.** It applies to any entity (not just HIPAA-covered) that collects health data from Washington residents. Consent required before collection. Private right of action means individuals can sue directly.

### International

- **EU (GDPR)**: Health data is "special category" requiring explicit consent. Data Protection Impact Assessment required. Standard contractual clauses for US transfers.
- **Canada (PIPEDA/PHIPA)**: Provincial health privacy laws vary. Ontario's PHIPA is the strictest. Consent required.
- **UK**: UK GDPR post-Brexit, similar to EU but separate adequacy decisions.

---

## 2. DICOM Interoperability Standards

### DICOMweb REST APIs

| API | Purpose | Method | Use Case |
|-----|---------|--------|----------|
| **STOW-RS** | Store | POST multipart | Upload DICOM studies to a server |
| **WADO-RS** | Retrieve | GET | Download studies, series, instances, frames |
| **QIDO-RS** | Query | GET with params | Search for studies/series/instances by criteria |

These are RESTful wrappers around traditional DICOM operations (C-STORE, C-GET, C-FIND). They use standard HTTP, making them accessible from web applications unlike traditional DICOM networking (which requires TCP/IP DIMSE protocol).

**STOW-RS is the critical one for sharing.** It's a multipart POST (Content-Type: multipart/related) containing DICOM instances. The receiving server validates, stores, and indexes the studies.

### FHIR ImagingStudy Resource

FHIR R4 ImagingStudy is a **metadata pointer**, not a container for pixel data:

```json
{
  "resourceType": "ImagingStudy",
  "status": "available",
  "subject": { "reference": "Patient/123" },
  "numberOfSeries": 3,
  "numberOfInstances": 188,
  "series": [{
    "uid": "1.2.840...",
    "modality": { "code": "CT" },
    "numberOfInstances": 188,
    "endpoint": [{ "reference": "Endpoint/dicomweb-server" }]
  }]
}
```

The `endpoint` field points to a DICOMweb server where the actual pixel data lives. FHIR handles the metadata and workflow; DICOMweb handles the imaging data.

### IHE Profiles

| Profile | Purpose | US Adoption |
|---------|---------|-------------|
| XDS-I.b | Cross-enterprise document sharing for imaging | Low (mostly EU) |
| XCA-I | Cross-community access for imaging | Very low |
| MHD-I | Mobile access to health documents (imaging) | Emerging |
| WADO-WS/RS | Web access to DICOM objects | Growing via DICOMweb |

**Reality check:** Most US hospitals support traditional DICOM networking (C-STORE over TCP) and are slowly adopting DICOMweb. IHE profiles are more common in EU. The practical integration path in the US is through exchange networks (Ambra, LifeImage) that handle the per-hospital protocol variations.

### Current state of hospital support

- **Traditional DICOM (DIMSE)**: Nearly universal. Every PACS supports it.
- **DICOMweb**: Growing. Major cloud PACS (Ambra, Google, Azure) support it. Hospital on-prem PACS adoption is 30-50% and rising.
- **FHIR ImagingStudy**: Epic supports it in their API. Cerner/Oracle supports it. Actual implementation varies by site.
- **Patient-initiated upload**: Almost no hospitals accept this natively. It goes through intermediaries (Ambra, CD burning, patient portals with limited imaging support).

### DICOM De-identification

DICOM PS3.15 defines Attribute Confidentiality Profiles:
- **Basic Profile**: Removes/replaces 60+ identifying attributes
- **Retain Safe Private Option**: Keeps non-identifying private tags
- **Clean Pixel Data Option**: Removes burned-in annotations (OCR-based, imperfect)

For patient-to-provider sharing, de-identification is generally NOT needed -- the patient is sending their own identified data to their own provider. De-identification matters for research, not clinical sharing.

---

## 3. Epic MyChart Integration

### Can patients upload imaging into MyChart?

**Not natively.** MyChart has no built-in DICOM upload. Patients can:
- View imaging reports (text) in MyChart
- View imaging thumbnails (JPEG, not DICOM) via Epic's "Enhanced MyChart Imaging" (requires hospital to enable)
- Share imaging through third-party integrations (Ambra is the primary partner)

### Epic's SMART on FHIR

Epic implements SMART on FHIR for patient-authorized app access:
- OAuth 2.0 authorization flow
- Patient can authorize an app to read their data
- ImagingStudy resource is supported in Epic's FHIR R4 API
- **But**: Read access to imaging metadata, not write access for uploading new studies
- Patient-facing FHIR scopes: `patient/ImagingStudy.read`

To **push** imaging into Epic, you'd need:
1. Provider-side integration (not patient-facing FHIR)
2. DICOMweb STOW-RS to Epic's imaging infrastructure (requires per-site agreement)
3. Or: route through Ambra, which has existing Epic integrations

### Open.Epic and App Market

- **Open.Epic** (open.epic.com): Free developer registration, sandbox environment
- **App Market** (formerly App Orchard): $500/year listing fee
- **Connection Hub**: $500/year to list your connection type
- **Reality**: The listing fee is trivial. The real cost is per-customer implementation:
  - Each Epic site has its own configuration
  - Customer negotiation, security review, BAA signing
  - $100K-$300K+ and 6-18 months for a meaningful integration
  - Epic's "Launch" framework handles the OAuth flow

### Real-world examples

- **Ambra Health**: The only company with deep patient-facing imaging integration into Epic. Ambra's patient upload portal feeds directly into Epic's imaging workflow.
- **PocketHealth**: Patient imaging access platform. Integrates with hospital PACS to let patients view/share their imaging. Works alongside Epic, not directly through the FHIR API.
- **Nuance PowerShare**: Provider-to-provider image exchange with Epic integration.

---

## 4. Ambra Health (Intelerad) Integration

### Overview

Ambra Health (acquired by Intelerad in 2022) is the dominant medical image exchange platform. KLAS #1 for image exchange 8 consecutive years. 750+ provider network.

### API (v3)

REST API with OAuth 2.0 authentication:

**Key endpoints:**
- `POST /study` -- Upload a DICOM study (multipart)
- `GET /study/{id}` -- Retrieve study metadata
- `GET /study/{id}/image` -- Download DICOM instances
- `POST /study/{id}/share` -- Share a study with a provider on the network
- `GET /destination` -- List available share destinations (providers)
- `POST /study/{id}/anonymize` -- De-identify a study
- DICOMweb endpoints (STOW-RS, WADO-RS, QIDO-RS) also available

**Upload flow:**
1. Create upload session
2. POST DICOM instances (multipart or per-instance)
3. Ambra validates, indexes, and stores
4. Share to destination provider via Ambra network
5. Provider's PACS receives via their existing Ambra integration

### Compliance

- HIPAA compliant (BAA available)
- SOC 2 Type II certified
- HITRUST CSF certified
- FDA registered (for certain products)
- Data encrypted at rest (AES-256) and in transit (TLS 1.2+)

### Pricing

Not publicly listed. Enterprise/custom pricing based on:
- Volume (studies per month)
- Features (upload, sharing, viewer, AI routing)
- Integration depth
- Likely $1-5 per study or volume-based subscription

### Comparison to alternatives

| Platform | Strengths | Weaknesses |
|----------|-----------|------------|
| **Ambra (Intelerad)** | 750+ providers, Epic/Cerner integration, REST API, KLAS #1 | Pricing opaque, enterprise-focused |
| **LifeImage (Intelerad)** | Large network (merged with Ambra parent) | Being consolidated into Intelerad |
| **PowerShare (Nuance/Microsoft)** | Microsoft backing, radiologist workflow | Provider-to-provider focus, not patient-facing |
| **Nucleus.io** | Modern cloud PACS, DICOMweb native | Smaller network, viewer-focused |
| **Google Cloud Healthcare API** | DICOMweb, FHIR, ML integration | Infrastructure, not exchange network |
| **AWS HealthLake Imaging** | Subsecond retrieval, cost-effective storage | Infrastructure, not exchange network |
| **Azure DICOM Service** | DICOMweb, FHIR integration | Infrastructure, not exchange network |

**The market is consolidating.** Intelerad now owns both Ambra and LifeImage -- effectively a duopoly with Microsoft (PowerShare/Nuance) for image exchange.

---

## 5. Other Integration Paths

### Cloud PACS Infrastructure

These are infrastructure services, not exchange networks. You'd use them as your backend storage, then connect to exchange networks for sharing:

**Google Cloud Healthcare API:**
- Full DICOMweb implementation (STOW-RS, WADO-RS, QIDO-RS)
- FHIR R4 with ImagingStudy support
- HIPAA compliant, BAA available
- ML integration (Vertex AI)
- Pay per GB stored + API calls

**AWS HealthLake Imaging:**
- Subsecond image retrieval at scale
- HIPAA eligible, BAA available
- HTJ2K compression (up to 10:1 visually lossless)
- Pay per GB stored
- Integration with SageMaker for ML

**Azure Health Data Services (DICOM):**
- DICOMweb compliant
- FHIR integration
- HIPAA compliant, BAA with Microsoft
- Managed service, pay per transaction

### Exchange Networks

- **CommonWell Health Alliance**: Carequality connection exists but imaging exchange is minimal in practice. Mostly document exchange.
- **Carequality**: Framework for interoperability, not an exchange network itself. Imaging is not a primary use case.
- **TEFCA**: ONC's Trusted Exchange Framework. Does not yet cover imaging. RFI issued January 2026 for imaging interoperability -- still in comment period. No mandated standard exists.

### Direct-to-PACS

Not realistic for a consumer app. Requires:
- VPN tunnel to each hospital's network
- DICOM association negotiation per site
- Firewall rules, network security review
- Per-site maintenance
- Scales to maybe 5-10 sites before it's unmanageable

---

## 6. Realistic Path for a Small Company

### Minimum Viable Compliance

**If staying FTC-regulated (PHR vendor, no provider contracts):**
- FTC Health Breach Notification Rule compliance (~$5K-$15K legal review)
- Privacy policy and terms of service
- Encryption (TLS + AES-256)
- Breach response plan
- State law compliance (Washington My Health My Data Act is the highest bar)
- No certification required, but SOC 2 opens doors

**If becoming a HIPAA business associate (provider contracts):**
- Everything above, plus:
- HIPAA Security Rule compliance
- Risk assessment (documented)
- BAAs with all subcontractors
- Workforce training
- Designated security officer
- Audit logging (6-year retention)
- SOC 2 Type II strongly expected by providers

### Compliance Costs

| Item | Cost | Timeline |
|------|------|----------|
| SOC 2 Type II (first year) | $40K-$110K | 6-12 months |
| HITRUST CSF | $200K-$400K | 12-18 months |
| HIPAA compliance program | $15K-$40K | 2-4 months |
| Legal review (privacy policy, BAA templates, terms) | $10K-$30K | 1-2 months |
| Penetration testing | $5K-$20K | 2-4 weeks |
| Ongoing compliance (annual) | $20K-$50K | Continuous |

**SOC 2 is the right first step.** Hospitals and health systems ask for SOC 2 Type II. HITRUST is a "nice to have" that some large systems require but most accept SOC 2. HITRUST is not worth the cost until revenue justifies it.

### Fastest Path to Market

1. **Build the viewer (done).** Local-first, no PHI leaves the machine.
2. **Add cloud sync (ADR 006/008).** User accounts, server-side storage, instrumentation.
3. **Integrate with Ambra's API.** Patient uploads to myradone -> our API -> Ambra -> provider PACS. Gets access to 750+ providers without per-site negotiation.
4. **SOC 2 Type II.** Required for Ambra partnership and provider trust.
5. **HIPAA compliance program.** If/when we sign BAAs with providers.

Steps 1-2 are consumer app work. Steps 3-5 are healthcare platform work. The Ambra integration is the bridge.

### Build vs Buy

**Buy (Ambra integration): Recommended.**
- 750+ providers on day one
- Ambra handles PACS-side complexity, protocol variations, per-site configuration
- Ambra is HIPAA/SOC2/HITRUST compliant -- their compliance covers the exchange
- We focus on the patient experience, they handle the healthcare infrastructure

**Build (direct integrations): Not recommended initially.**
- Each hospital is a custom integration ($100K+, 6-18 months)
- Protocol variations (DIMSE vs DICOMweb, vendor-specific extensions)
- Network/firewall/VPN complexity per site
- Doesn't scale without a dedicated integration team

### Startup Examples

- **Ambra themselves**: Started as a startup (2006), built the exchange network, acquired by Intelerad (2022)
- **PocketHealth**: Patient imaging access platform, Series A ($12M), integrated with hospital PACS
- **Aidoc**: AI-powered radiology, SOC 2 + HIPAA, raised $250M+
- **Viz.ai**: Clinical AI platform, HIPAA/SOC2/HITRUST, FDA cleared

---

## 7. Technical Architecture Implications

### Server-side infrastructure is required

Patient-to-provider sharing cannot work purely client-side:
- Ambra's API requires server-to-server authentication (OAuth client credentials)
- DICOM studies must be staged on a server for reliable multi-part upload
- Audit logging must be server-side (client-side logs are not tamper-proof)
- Encryption at rest requires server-side storage (even if temporary)

### Proposed sharing architecture

```
Desktop/Browser (client)
  |
  | DICOM files (user-selected)
  v
myradone API (our backend)
  |
  | 1. Receive DICOM upload from client (TLS)
  | 2. Validate DICOM (no corrupt/malicious files)
  | 3. Temporarily store (encrypted, AES-256)
  | 4. Log audit trail (who, what, when, where)
  | 5. Forward to Ambra via REST API
  | 6. Delete temporary copy after confirmation
  v
Ambra Health API
  |
  | Route to destination provider
  v
Provider PACS
```

### Encryption requirements

- **In transit**: TLS 1.2+ (mandatory, no exceptions)
- **At rest**: AES-256 for any stored PHI (even temporary staging)
- **Key management**: Server-side, not client-side. AWS KMS, GCP KMS, or Azure Key Vault.

### Audit logging

- Every PHI access must be logged: who, what, when, from where
- Logs retained minimum 6 years (HIPAA requirement)
- Logs must be tamper-evident (append-only, or cryptographically signed)
- Separate from instrumentation (ADR 008) -- audit logs contain PHI references, telemetry does not

### Authentication

- **Patient authentication**: OAuth 2.0 (our platform accounts)
- **EHR authorization**: SMART on FHIR launch framework (if integrating with Epic/Cerner directly)
- **Ambra authentication**: OAuth 2.0 client credentials (server-to-server)
- **MFA**: Required for any user accessing PHI through our platform

### Interaction with instrumentation (ADR 008)

The two-stream architecture from ADR 008 is critical here:
- **Telemetry stream**: Track "shares initiated," "shares completed," "share errors" as counters. No PHI.
- **Audit log stream**: Record full details of each share (patient ID, study UIDs, destination, timestamps). Contains PHI references. Subject to HIPAA retention requirements. This is NOT telemetry -- it is a compliance requirement.
- **Product data stream**: The DICOM files themselves. Temporarily staged, encrypted, deleted after transfer.

Three streams, not two. The audit log is a third stream that sits between telemetry and product data.

---

## 8. Recommended ADR 010 Structure

Based on this research, ADR 010 should cover:

1. **Decision**: Integrate with Ambra Health API as the primary sharing path. Do not build direct hospital integrations initially.
2. **Compliance path**: FTC Health Breach Notification Rule compliance first (lighter). SOC 2 Type II when pursuing provider partnerships. HIPAA BA status if/when signing provider contracts.
3. **Architecture**: Server-side staging with encrypted temporary storage, Ambra API forwarding, audit logging.
4. **Three-stream data model**: Telemetry (counters, no PHI), audit logs (PHI references, 6-year retention), product data (DICOM files, temporary).
5. **Scope**: Cloud platform only. Desktop and personal modes do not share.
6. **Prerequisites**: Cloud mode (accounts, authentication), server infrastructure, Ambra partnership.

---

## Sources

- [FTC Health Breach Notification Rule (updated July 2024)](https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule)
- [HIPAA Business Associate Definition](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/business-associates/index.html)
- [HIPAA Conduit Exception](https://www.hhs.gov/hipaa/for-professionals/faq/245/are-entities-that-transmit-protected-health-information-business-associates/index.html)
- [DICOMweb Standard](https://www.dicomstandard.org/using/dicomweb)
- [FHIR R4 ImagingStudy](https://www.hl7.org/fhir/imagingstudy.html)
- [Epic Open.Epic Developer Program](https://open.epic.com/)
- [Epic App Market](https://appmarket.epic.com/)
- [Ambra Health Platform](https://ambrahealth.com/)
- [Google Cloud Healthcare API](https://cloud.google.com/healthcare-api)
- [AWS HealthLake Imaging](https://aws.amazon.com/healthlake/imaging/)
- [Azure Health Data Services DICOM](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/)
- [Washington My Health My Data Act](https://app.leg.wa.gov/billsummary?BillNumber=1155&Year=2023)
- [ONC Imaging Interoperability RFI (January 2026)](https://www.healthit.gov/)
- [DICOM PS3.15 Attribute Confidentiality Profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html)
- [IHE IT Infrastructure Profiles](https://www.ihe.net/resources/profiles/)
- [PocketHealth](https://www.pockethealth.com/)
- [Intelerad/Ambra Acquisition](https://www.intelerad.com/)
