# Research: Epic MyChart Document Upload Implementation

## Executive Summary

Epic MyChart uses a **server-side storage architecture** with a dedicated BLOB server for document persistence. Documents are uploaded to the server, go through a clinical review workflow, and are stored in Epic's hierarchical database system (Chronicles) with file content in the BLOB server. The patient-facing experience supports common file types (PDF, JPG, PNG) with ~10MB limits, while viewing is handled through in-app rendering.

---

## 1. Upload Process

### Patient Upload Methods

MyChart provides multiple upload pathways:

1. **Messaging Attachment**: Patients select Messages > Send a message, then attach files via a paperclip icon. Documents uploaded this way go to a "Documents In Review" queue for clinical staff approval before being added to the official record.

2. **Direct Upload Button**: A dedicated "Upload document" button allows patients to add files with description names.

3. **Insurance Card Upload**: Specialized flow for capturing insurance card photos (front/back).

4. **Advance Care Planning**: Specific upload path for legal documents like advance directives.

### Workflow After Upload

- Documents enter a "Documents In Review" section
- Clinical staff must review and approve before finalization
- Patient selects which clinician's office should be notified
- Documents become accessible from all locations once approved

---

## 2. Supported File Types

### Patient-Facing MyChart Portal

| Format | Supported |
|--------|-----------|
| PDF | Yes |
| JPEG/JPG | Yes |
| PNG | Yes |
| TIF/TIFF | Yes (for messaging) |

### Upload Limits

- **File size**: Typically 10MB per file maximum
- **File count**: Up to 5 files per upload (varies by organization)

### Healthcare Professional Side (Media Manager)

Epic's Media Manager (clinician-facing) supports a broader range of file types compared to the patient portal.

---

## 3. Storage Architecture

### Server-Side Storage Model

Epic uses **server-side storage** exclusively - no client-side persistence:

1. **Chronicles Database**: Epic's primary transactional database (a hierarchical database using InterSystems Cache/IRIS). Stores metadata and references to documents.

2. **BLOB Server**: Dedicated server for storing actual file content. Referenced from masterfiles in Chronicles.

3. **WebBLOB**: Web-accessible blob storage component, replicated via NetApp SnapMirror for backup/disaster recovery.

### Why Server-Side?

- **Clinical workflow requirements**: Documents must be reviewed by clinical staff
- **Multi-device access**: Patient can upload from phone, view from desktop
- **HIPAA compliance**: Centralized security and audit logging
- **Integration**: Documents become part of the legal medical record

### Document Management System Integration

Most Epic customers use a separate Document Management System (commonly Hyland OnBase) that integrates with Epic. Epic is developing its own full DMS but hasn't formally launched it yet.

---

## 4. User Experience for Viewing

### Web Portal

- Documents viewable directly in the MyChart web interface
- PDF reports display inline
- Imaging studies link to "Mobility" viewer for DICOM images

### Mobile App (iOS/Android)

- Full MyChart functionality available on mobile
- Documents accessible through the app
- Signature capture supported (auto-generated or hand-drawn)
- Optimized for instant access without desktop/laptop

### Document Organization

- Documents categorized by type (test results, visit summaries, uploaded documents)
- Chronological organization with search/filter capabilities
- Notifications for new documents requiring attention

---

## 5. Technical Architecture Details

### API Layer (FHIR)

Epic exposes documents via HL7 FHIR DocumentReference API:

```
GET /FHIR/R4/DocumentReference?patient={id}
```

- **DocumentReference** resource: Contains metadata (author, date, type, patient)
- **Binary** resource: Actual document content accessed via `DocumentReference.content.attachment.url`
- Documents are not embedded in the API response; retrieved separately via Binary endpoint

### Security

- OAuth 2.0 authentication for API access
- HIPAA-compliant encryption in transit and at rest
- Role-based access control
- Audit logging for all document access

### Error Handling

- API returns error codes with human-readable descriptions
- Applications expected to interpret codes and provide user-friendly messages
- Codes intended for developers, not end users

---

## Key Takeaways for DICOM Viewer Implementation

### What MyChart Does That We Should Consider

1. **Server-side storage**: Documents persist reliably across devices and sessions
2. **Clinical review workflow**: Not applicable for personal viewer, but shows importance of document status
3. **Standard file types**: PDF, JPG, PNG cover 99% of use cases
4. **10MB file limit**: Reasonable for radiology reports
5. **In-app viewing**: Documents render directly without download

### Key Differences for Our Use Case

| Epic MyChart | Our DICOM Viewer |
|--------------|------------------|
| Server-side storage | Client-side (privacy-focused) |
| Multi-user, multi-device | Single user, single browser |
| Clinical workflow integration | Personal viewing only |
| HIPAA infrastructure | Browser-based isolation |

### Recommendation

For our client-side privacy-focused viewer, **IndexedDB** is the appropriate storage mechanism. It provides:

- Persistence across page reloads (like Epic's server storage)
- Large capacity for PDFs and images
- No server infrastructure required
- Privacy: data stays in user's browser

---

## Sources

- [MyChart Patient User Guide - UT Medicine](https://mychart.utmedicinesa.com/mychart/en-US/docs/MCPUG.pdf)
- [Cleveland Clinic - MyChart Upload Files](https://mychart.clevelandclinic.org/public/MyChart-Upload-Files.pdf)
- [MD Anderson - How to Upload Documents](https://www.mdanderson.org/content/dam/mdanderson/documents/patients-and-family/becoming-our-patient/planning-for-care/MyChart-Upload-Tipsheet.pdf)
- [Hyland OnBase - Integration for Epic MyChart](https://support.hyland.com/r/OnBase/Integration-for-Epic-MyChart/Foundation-23.1/Integration-for-Epic-MyChart/Usage/Uploading-Files)
- [NetApp - Epic Architecture Overview](https://docs.netapp.com/us-en/ontap-apps-dbs/epic/epic-arch-overview.html)
- [Health API Guy - Epic Saga Origin Story](https://healthapiguy.substack.com/p/an-epic-saga-the-origin-story)
- [Epic on FHIR - Documentation](https://fhir.epic.com/Documentation?docId=fhir)
- [Open Epic - Clinical Document Specifications](https://open.epic.com/Clinical/Document)
- [Valley Medical - Viewing Imaging Studies in MyChart](https://www.valleymed.org/globalassets/valley-medical/media/files/our_services/mychart/epic--mychart---viewing-and-printing-imaging-studies.pdf)
