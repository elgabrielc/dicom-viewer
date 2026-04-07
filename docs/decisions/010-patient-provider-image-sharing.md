# ADR 010: Patient-to-Provider Image Sharing

## Status
Proposed

## Context

Users want to share their DICOM imaging with medical providers. Today, this process is painful: burn a CD, carry it to the appointment, hope the provider's system can read it. Or use a hospital portal that may not support imaging uploads at all. Epic MyChart has no native patient DICOM upload.

We want to add a "share with your provider" feature that lets patients send imaging from myradone to their provider's system (PACS, EMR, or image exchange network). This is a fundamentally different capability from viewing -- it involves transmitting PHI across organizational boundaries and triggers compliance obligations.

### Regulatory classification

A consumer app where the patient controls their own data is most likely a **vendor of personal health records (PHR)**, regulated by the **FTC** under the Health Breach Notification Rule -- not by HHS/HIPAA. HIPAA applies only when we contract with covered entities (hospitals, insurers). The conduit exception does not apply -- it is narrowly limited to ISPs and postal services, not software that processes or routes data.

If we later sign contracts with providers (e.g., network agreements), we become a HIPAA business associate with full Security Rule obligations.

### Market landscape

The medical image exchange market has consolidated into a duopoly:
- **Intelerad** (Ambra Health + LifeImage) -- 750+ provider network, KLAS #1 for 8 consecutive years
- **Microsoft** (Nuance PowerShare) -- large network, radiologist workflow focused

No mandated standard for patient-initiated image sharing exists. ONC issued an RFI in January 2026 on imaging interoperability -- still in comment period. Hospitals are not required to accept patient-uploaded DICOM. However, DICOMweb adoption is at 30-50% and rising, and it is the clear direction of the industry.

### Benchmarking research

Four products were benchmarked for their approach to data handling and compliance:
- **Todoist**: Custom analytics, user-facing stats, consent-first web model
- **Sublime Text**: Near-zero telemetry, no privacy policy (a gap, not a feature)
- **Claude (Anthropic)**: Two-stream architecture, SOC 2 + HIPAA BAA for enterprise, zero data retention option
- **Spotify**: Data as beloved feature, massive-scale collection reframed through Wrapped

Key principles from the instrumentation research (ADR 008) carry forward:
1. Two-stream separation (product data vs telemetry) -- now becomes three streams with audit logs
2. PHI never touches the telemetry stream
3. User transparency about what is tracked and shared
4. Pick the right privacy default at launch and don't change it
5. SOC 2 + HIPAA BAA is the compliance bar for cloud mode

See related research documents for full analysis.

## Decision

Build in-house DICOMweb (STOW-RS) integration as the primary sharing path. No dependency on Ambra or other exchange network intermediaries. Server-side staging infrastructure is required. Pursue SOC 2 Type II as the first compliance certification.

### Why DICOMweb in-house

- **No per-study fees.** Ambra charges $5-$7/study (not publicly listed). At 2K studies/month this is $120K/yr; at 10K it's $600K-$840K/yr. This single line item would dominate the entire cost structure. Building in-house eliminates it permanently.
- **DICOMweb is the standard.** STOW-RS, WADO-RS, and QIDO-RS are the modern REST-based DICOM APIs. Adoption is at 30-50% and rising. ONC's January 2026 RFI signals regulatory momentum toward mandating interoperability.
- **No vendor lock-in.** Ambra's pricing is opaque, they're a duopoly player (Intelerad), and their API could change. Owning the integration layer means we control our cost structure and technical roadmap.
- **We already parse DICOM.** The client-side parser handles all major transfer syntaxes. Serializing back to DICOM for STOW-RS is a natural extension of existing capability.
- **Cloud DICOM infrastructure is cheap.** AWS HealthImaging, Google Cloud Healthcare API, and Azure DICOM services all provide DICOMweb-compliant endpoints. Storage costs $100-$300/mo at 10K studies/month.

### Per-site integration reality

DICOMweb eliminates the exchange network intermediary, but each provider destination still requires some coordination:
- Provider must expose a DICOMweb endpoint (or we connect to their cloud PACS)
- Network/firewall configuration for the provider's endpoint
- BAA if we're acting as a business associate
- Testing and validation per site

This is more work per provider than using Ambra, but the economics are clear: the engineering cost of building DICOMweb integration ($150K-$300K one-time) is recovered in under 2 years at even modest volume (2K studies/month) vs. Ambra per-study fees.

### Sharing flow

```
Desktop/Browser (client)
  |
  | User selects studies to share, picks destination provider
  v
myradone API (our backend)
  |
  | 1. Receive DICOM upload from client (TLS 1.2+)
  | 2. Validate DICOM (see validation requirements below)
  | 3. Temporarily store (encrypted AES-256 at rest)
  | 4. Log audit trail (who, what, when, where)
  | 5. Forward via DICOMweb STOW-RS to destination
  | 6. Delete temporary copy after destination confirms receipt
  v
Provider DICOMweb Endpoint / Cloud PACS
```

### Staged data lifecycle

Temporary PHI staging must have enforced invariants, not just design intent:

- **Maximum TTL**: 24 hours from upload start, regardless of transfer status. No staged DICOM data survives beyond this window.
- **Garbage collection**: An independent sweep process runs on a schedule (e.g., hourly), deleting any staged data past TTL. This operates independently of the transfer workflow.
- **Orphan handling**: If a transfer fails or times out, the staged data is deleted at TTL. The audit log records the forced deletion with reason (timeout, transfer failure, etc.).
- **Retry semantics**: Up to 3 retry attempts over 1 hour. After final failure, the user is notified and the staged data is marked for GC deletion. No indefinite retry loops.

### DICOM validation

DICOM files are complex binary objects with real attack vectors. Validation before staging:

- **Format check**: DICM preamble (bytes 128-131), parseable DICOM dataset
- **Dimension consistency**: Rows, Columns, BitsAllocated match actual pixel data size
- **Transfer syntax**: Known standard transfer syntax (reject unknown/proprietary)
- **Size limit**: Maximum study size (e.g., 2 GB per study, configurable)
- **No embedded executables**: Reject or strip encapsulated documents (DICOM supports embedded PDFs/CDAs which could carry malware)
- **Private tags**: Strip private tags by default (may contain unexpected PHI or non-standard data). Offer optional preservation for advanced users.
- **Pixel data present**: Reject instances with no pixel data unless they are structured reports or other non-image DICOM objects that the destination expects

### Three-stream data model

Evolution of ADR 008's two-stream architecture. Sharing introduces a third stream:

| Stream | Contents | PHI? | Retention | Purpose |
|--------|----------|------|-----------|---------|
| **Telemetry** | Usage counters, feature stats, error counts | Never | Indefinite (local) | Product signal |
| **Audit log** | Share events: patient ID, study UIDs, destination, timestamps, outcome | Yes (it is PHI -- DICOM UIDs are HIPAA identifiers) | 6 years minimum (HIPAA) | Compliance |
| **Product data** | DICOM files in transit | Yes (full) | Temporary (24-hour max TTL, deleted after transfer) | Sharing functionality |

These streams share no storage, no API, and no persistence layer.

### Audit log security

Audit logs contain PHI (DICOM UIDs are one of HIPAA's 18 identifiers) and require full HIPAA Security Rule treatment:

- **Encryption at rest**: AES-256, same standard as product data
- **Access controls**: Only compliance officer and authorized operations staff. Access must be justified and documented.
- **Meta-audit**: Access to audit logs must itself be logged (who accessed the logs, when, why)
- **Tamper-evidence**: Append-only storage (S3 Object Lock / WORM mode) preferred over cryptographic signing alone
- **Durability**: Cross-region replication (e.g., S3 with CRR). RPO: zero data loss. RTO: 24 hours.
- **Backup**: Automated, encrypted backups. Tested recovery annually.
- **Covered by BAA**: The cloud provider storing audit logs must have a signed BAA

### User consent and transparency

Sharing is the highest-stakes data flow in the product. The transparency principle from ADR 008 ("the stats panel is the privacy policy") extends here:

- **Explicit consent before first share**: Clear disclosure of what leaves the device and where it goes (our server for staging, then the destination provider). Not a buried checkbox -- a deliberate confirmation step.
- **Share history**: A view showing past shares (destination, date, status, outcome). The user sees everything the audit log records about their shares, minus internal system metadata.
- **Cancel pending shares**: If a share is queued but not yet delivered, the user can cancel and the staged data is deleted immediately.
- **No silent sharing**: We never share without explicit user action, per share. No "auto-share all future studies" setting.

### Scope

- **Cloud mode only** for v1. Desktop and personal modes do not share (no server infrastructure).
- **Desktop-to-cloud path** (future): Desktop users sign into cloud account, desktop app uploads to cloud backend, cloud shares via DICOMweb. This is a natural Phase 3-4 feature -- the desktop architecture should not make decisions that block it.
- **Patient-initiated only.** The patient selects what to share and with whom.
- **No de-identification.** The patient is sending their own identified data to their own provider. De-identification is for research, not clinical sharing.
- **US-only for v1.** International users can view locally but cannot share. GDPR, PIPEDA, and cross-border data transfer requirements are out of scope until a separate ADR addresses international expansion.

## Alternatives Considered

### 1. Ambra Health as primary sharing path

**Rejected as primary path. Preserved as future supplementary option.**

Ambra Health (Intelerad) is the dominant medical image exchange platform: 750+ provider network, KLAS #1 for 8 consecutive years, REST API with DICOMweb support, HIPAA/SOC 2/HITRUST compliant, and the only company with deep patient-facing imaging integration into Epic.

**What Ambra gives you:**
- 750+ provider destinations on day one -- no per-site negotiation
- Ambra handles PACS-side protocol variations, firewall config, and per-site testing
- Their compliance covers the exchange (their HITRUST, their BAAs with providers)
- Existing Epic and Cerner integrations (we wouldn't need to build our own)
- Provider directory API for destination lookup
- Patient upload portal that feeds directly into Epic's imaging workflow
- De-identification service built into their API
- 8 consecutive years as KLAS #1 -- hospitals trust them

**What Ambra costs:**
- Per-study fees of $5-$7/study (pricing not public, estimates from secondary sources)
- Opaque pricing with no published rate schedule
- Vendor lock-in to a duopoly player (Intelerad owns both Ambra and LifeImage)
- No contractual cap on price increases publicly documented
- API could change without adequate notice
- At volume, per-study fees dominate the entire cost structure

**Cost comparison:**

| Volume | Annual Ambra fees | DICOMweb in-house (build $150K + $60K/yr maintain) |
|--------|-------------------|-----------------------------------------------------|
| 500/mo | $30K | $60K (maintenance only, after year 1) |
| 1,000/mo | $60K | $60K |
| 2,000/mo | $120K | $60K |
| 5,000/mo | $300K | $60K |
| 10,000/mo | $600K-$840K | $60K |

**Breakeven analysis** (DICOMweb $150K build cost amortized vs. Ambra fees saved minus $60K/yr maintenance):
- At 1,000 studies/mo: breakeven never (wash at $60K vs $60K)
- At 2,000 studies/mo: 2.5 years
- At 3,000 studies/mo: 1.7 years
- At 5,000 studies/mo: 1.25 years
- At 10,000 studies/mo: under 1 year

The DICOMweb integration is a one-time capital cost with fixed maintenance. Ambra fees scale linearly forever. The math favors building in-house at any volume above 1,000 studies/month.

**What we give up by not using Ambra:**
- No instant provider network. Each destination must be onboarded individually (DICOMweb endpoint, BAA, testing). Initial reach is zero and grows provider by provider.
- We own the PACS-side complexity. DICOMweb is a standard, but real-world implementations vary. We will hit vendor-specific quirks, timeout behaviors, and error handling differences per site.
- No Epic shortcut. Ambra's Epic integration is their deepest moat. Without Ambra, reaching Epic sites requires either Epic direct integration ($300K+) or waiting for Epic sites to expose DICOMweb through their imaging infrastructure.
- We need our own provider directory. Ambra's API provides destination lookup. Without it, we need to build and maintain a directory of DICOMweb-enabled providers.
- Higher engineering burden. Ambra's integration is weeks of API work. DICOMweb integration that handles real-world PACS diversity is months of engineering plus ongoing maintenance.

**Why we're building in-house anyway:**
- The economics are clear at any scale we'd consider product-market fit
- DICOMweb is the industry standard, backed by ONC regulatory momentum
- We already parse DICOM client-side -- STOW-RS serialization is a natural extension
- No vendor lock-in, no opaque pricing, no duopoly dependency
- Ambra can always be added later as a supplementary path for providers that don't expose DICOMweb endpoints. This is additive, not exclusive -- building DICOMweb first does not close the Ambra door.

### 2. Epic direct integration

**Deferred.** ~$300K engineering investment (2-3 engineers, 6-12 months) + $35K in Epic fees + $60K-$90K/yr maintenance. The middleware route (Redox at $45K/yr) reduces per-customer deployment cost but adds ongoing SaaS spend. Not justified until revenue supports it. Our DICOMweb integration may reach Epic sites that expose DICOMweb through their imaging infrastructure without a separate Epic integration.

### 3. Build our own exchange network

**Rejected.** We're building DICOMweb integration (standards-based point-to-point), not a network with provider enrollment, routing, and network effects. Ambra took 15+ years to build their network. We're not competing with that -- we're using the open standard they'll eventually have to support too.

### 4. Peer-to-peer sharing (patient sends directly from browser)

**Rejected.** Cannot work purely client-side. DICOMweb STOW-RS requires server-to-server authentication for most provider endpoints. Audit logging must be server-side (client-side logs are not tamper-proof). Encryption at rest requires server-side storage.

### 5. CD/USB export only (no network sharing)

**Rejected as primary path.** Physical media is the status quo we're trying to replace. However, local DICOM export (USB, folder, DICOMDIR-compliant package) is a complementary offline feature that requires no compliance infrastructure and could ship as Phase 0.5.

## Cost Analysis

### Scenario A: Minimum Viable (FTC-regulated PHR, DICOMweb in-house)

Stay as PHR vendor (FTC, not HIPAA). Build DICOMweb integration. SOC 2.

| Item | Year 1 | Ongoing |
|------|--------|---------|
| Legal (privacy policy, terms, state law review) | $10,000 | $3,000 |
| SOC 2 (platform + audit + pen test + tooling) | $30,000 | $28,000 |
| Cloud DICOM staging (AWS HealthImaging, 1K studies/mo) | $200 | $200 |
| DICOMweb integration engineering | $150,000 | -- |
| DICOMweb maintenance | -- | $60,000 |
| **Total (cash)** | **$190,000** | **$91,000** |

Higher Year 1 than the Ambra path ($190K vs $75K) but dramatically lower ongoing ($91K vs $61K + scaling Ambra fees). Breaks even vs. Ambra within 2 years at 500 studies/month.

### Scenario B: HIPAA Business Associate (provider contracts, DICOMweb)

Provider contracts, BAAs, full HIPAA program. DICOMweb integration. SOC 2.

| Item | Year 1 | Ongoing |
|------|--------|---------|
| Legal (BAAs, HIPAA privacy policy, terms) | $16,000 | $5,000 |
| HIPAA program (risk analysis, policies, consultant, training) | $35,000 | $12,000 |
| SOC 2 (specialist firm) | $43,000 | $33,000 |
| Cloud DICOM staging (AWS, 5K studies/mo) | $1,000 | $1,000 |
| HIPAA-compliant hosting (BAA with AWS/GCP) | $2,000 | $2,000 |
| DICOMweb integration engineering | $150,000 | -- |
| DICOMweb maintenance | -- | $60,000 |
| **Total (cash)** | **$247,000** | **$113,000** |

### Scenario C: Full Healthcare Platform (HIPAA + HITRUST + Epic)

HITRUST r2, Epic Showroom listing, HIPAA, enterprise SOC 2, middleware.

| Item | Year 1 | Ongoing |
|------|--------|---------|
| Legal (comprehensive) | $30,000 | $11,000 |
| HIPAA program (consultant/vCISO) | $57,000 | $40,000 |
| HITRUST r2 (MyCSF + assessor + report credit) | $107,000 | $87,000 |
| SOC 2 (combined with HITRUST) | $40,000 | $30,000 |
| Epic (Connection Hub + Vendor Services + engineering + validation) | $337,000 | $77,000 |
| Redox middleware | $45,000 | $45,000 |
| Cloud DICOM (AWS, 10K studies/mo) | $3,000 | $3,000 |
| HIPAA-compliant hosting | $5,000 | $5,000 |
| DICOMweb integration (already built in Phase 2) | -- | $60,000 |
| **Total (cash)** | **$624,000** | **$358,000** |

### What's cheap

Cloud DICOM storage: $100-$300/mo for 10K studies/month on AWS HealthImaging. Storage is a rounding error. The expense is compliance ($50K-$120K/yr), EHR integration ($300K one-time for Epic), and the DICOMweb engineering investment ($150K one-time). No per-study fees.

## Design Details

### Prerequisites

This feature requires:
1. Cloud mode with user accounts and authentication (ADR 006)
2. Server-side infrastructure (backend API, encrypted storage, audit logging)
3. SOC 2 Type II certification (begin prep during Phase 1 -- 6-12 month lead time)
4. Published privacy policy (modeled on Panic's approach -- explicit retention, named vendors, clear opt-out)
5. DICOMweb STOW-RS implementation and testing against target provider endpoints

### Encryption

- **In transit**: TLS 1.2+ (mandatory, no exceptions)
- **At rest**: AES-256 for any stored PHI (staged DICOM data and audit logs)
- **Key management**: Server-side via AWS KMS, GCP KMS, or Azure Key Vault (not client-side)

### Authentication

- **Patient**: OAuth 2.0 (our platform accounts) with MFA at login. Session tokens with configurable lifetime (e.g., 24 hours). No MFA per-share (too much friction for a consumer app) but re-authentication required if session expired.
- **Provider endpoints**: TLS mutual auth or OAuth 2.0 client credentials, depending on provider requirements
- **Epic/EHR** (future): SMART on FHIR launch framework

### Monitoring and alerting

For a system that temporarily stores and forwards PHI, operational monitoring is a compliance requirement:

- Alert when staged data exceeds TTL (orphaned PHI -- most critical alert)
- Alert on DICOMweb STOW-RS failures or timeouts
- Alert on audit log write failures (compliance gap if logging fails silently)
- Alert on failed shares (user experience)
- Monitor staging storage utilization
- Monitor per-provider success/failure rates

### Interaction with instrumentation (ADR 008)

Telemetry tracks sharing as aggregate counters only:
- `sharesInitiated`: counter
- `sharesCompleted`: counter
- `shareErrors`: counter

No PHI in telemetry. The audit log handles the compliance-grade detail.

### Deployment mode behavior

| Mode | Sharing | Audit logs | Why |
|------|---------|------------|-----|
| Demo | Disabled | None | Stateless, no server |
| Personal | Disabled | None | No server infrastructure |
| Desktop | Disabled (v1) | None | Local-first, no server. Future: upload to cloud for sharing |
| Cloud | Enabled | 6-year retention | Full compliance |

### CORS and architecture constraint

CORS is not supported under Zero Data Retention arrangements with cloud AI vendors. If we use ZDR for any AI features (e.g., Claude API for report generation), browser-based apps must proxy through the backend. The sharing flow already requires a backend proxy (for server-to-server DICOMweb auth), so this constraint is naturally satisfied.

## Phased Implementation

| Phase | What | Cost | Prerequisite |
|-------|------|------|-------------|
| **Current** | Local-first viewer, no sharing | $0 compliance | None |
| **Phase 0.5** | Local DICOM export (USB/folder, DICOMDIR) | $0 compliance | None (ships in any mode) |
| **Phase 1** | Cloud sync + instrumentation + SOC 2 kickoff (ADR 006/008) | Infrastructure + $8K-$15K SOC 2 platform | User accounts |
| **Phase 2** | DICOMweb integration + SOC 2 completion | ~$190K Year 1 | Cloud mode, server backend, SOC 2 |
| **Phase 3** | HIPAA BA + provider contracts | ~$97K incremental | SOC 2, DICOMweb working |
| **Phase 4** | Epic integration + HITRUST | ~$530K Year 1 | Revenue from Phase 2-3 |

Each phase is independently valuable. No phase requires committing to later phases.

SOC 2 prep starts in Phase 1 (compliance platform, policies, security tooling) because it has a 6-12 month lead time and is on the critical path for Phase 2. The audit itself completes in Phase 2.

## Consequences

**Positive:**
- Solves a real patient pain point (no more CDs)
- No per-study exchange fees -- cost structure scales favorably
- Standards-based (DICOMweb) -- aligned with industry direction and ONC regulatory momentum
- No vendor lock-in to Ambra/Intelerad duopoly
- Three-stream architecture keeps telemetry clean and compliance tractable
- Client-side DICOM processing remains our biggest compliance asset
- Cloud storage is cheap ($100-300/mo) -- infrastructure costs are a rounding error
- Phase 0.5 (local export) delivers value immediately with zero compliance cost

**Negative:**
- Higher upfront engineering cost than Ambra path ($150K vs $5K)
- No 750+ provider network on day one -- reach is built per-provider
- Server-side infrastructure is a new operational burden
- Compliance is an ongoing expense ($30K-$60K/yr minimum)
- 6-year audit log retention is a long-term storage and durability commitment
- Per-provider onboarding required (DICOMweb endpoint, BAA, testing)

**Risks:**
- DICOMweb adoption at hospitals may be slower than expected (currently 30-50%)
- Providers that don't expose DICOMweb endpoints are unreachable without Ambra or similar intermediary
- ONC could mandate a different standard than DICOMweb (unlikely but possible)
- Washington My Health My Data Act and similar state laws add compliance complexity
- HIPAA enforcement is increasing ($36M in fines in 2024, 40% YoY increase)

**Acceptable tradeoffs:**
- Higher upfront cost for DICOMweb build, because it eliminates the per-study fee risk permanently
- Slower initial provider reach, because each connected provider has no ongoing marginal cost
- Ambra can be added later as a supplementary path for providers without DICOMweb -- but as a fallback, not the primary dependency
- Deferring Epic direct integration until revenue justifies $300K+ investment
- Deferring HITRUST until enterprise payer customers explicitly require it
- No sharing in desktop/personal modes for v1 -- cloud-only is acceptable
- US-only for v1 -- international sharing deferred to a separate ADR

## Related Research

- [RESEARCH-instrumentation.md](../planning/RESEARCH-instrumentation.md) -- Todoist/Bitmapist benchmarking
- [RESEARCH-sublime-instrumentation](../planning/RESEARCH-sublime-instrumentation-prompt_2026-04-06_1333.md) -- Sublime Text benchmarking
- [RESEARCH-claude-instrumentation](../planning/RESEARCH-claude-instrumentation-prompt_2026-04-06_1345.md) -- Claude/Anthropic benchmarking, HIPAA BAA deep dive
- [RESEARCH-spotify-instrumentation](../planning/RESEARCH-spotify-instrumentation-prompt_2026-04-06_1358.md) -- Spotify/Wrapped benchmarking
- [RESEARCH-dicom-sharing-compliance](../planning/RESEARCH-dicom-sharing-compliance-prompt_2026-04-06_1425.md) -- HIPAA classification, interoperability standards, Epic/Ambra integration
- [RESEARCH-healthcare-compliance-costs](../planning/RESEARCH-healthcare-compliance-costs-prompt_2026-04-06_1445.md) -- Itemized cost analysis, vendor pricing, three scenarios
- [ADR 008: Local-First Instrumentation](008-local-first-instrumentation.md) -- Two-stream architecture, telemetry design
- [ADR 006: Cloud Sync Storage Architecture](006-cloud-sync-storage-architecture.md) -- Cloud mode prerequisites
