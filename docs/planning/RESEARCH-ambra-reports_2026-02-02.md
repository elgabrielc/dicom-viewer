# Research: Ambra Health Document/Report Handling

## Executive Summary

Ambra Health is a **cloud PACS platform** that supports uploading both DICOM images and non-DICOM medical reports. Documents are stored server-side in their cloud infrastructure (Google Cloud Platform). The platform includes a built-in viewer (Ambra Pro Viewer) for diagnostic-quality image display and supports PDF report attachments as part of the study workflow.

---

## 1. Document Upload Methods

### Web Portal Upload

Ambra provides a web-based upload interface:

1. **Browse button**: Click Browse → select medical report → click "Upload report"
2. **Drag-and-drop**: Supported for DICOM images
3. **CD/DVD upload**: Scan for DICOM images on physical media

### Medical Report Upload

Users can upload medical reports separately from imaging:
- Reports can be attached to existing studies
- Option appears after initial image upload: "upload a medical report, if it was included with your images"

### Ambra Gateway

For institutional use, the Ambra Gateway enables:
- Automatic routing from site PACS
- **PDF to DICOM conversion**: "Configuration can be added to convert PDF reports into DICOM secondary capture, including Study Instance UID"
- De-identification workflows

---

## 2. Supported File Types

### DICOM Files
- Standard DICOM images (CT, MRI, US, etc.)
- DICOM Secondary Capture (for converted PDFs)

### Non-DICOM Files
- **PDF reports**: Explicitly supported upload path
- Medical images from CDs/DVDs
- Other document types (specific formats not documented in search results)

---

## 3. Storage Architecture

### Cloud-Based Storage

Ambra uses **server-side cloud storage**:

- **Platform**: Google Cloud Platform
- **Architecture**: DICOM medical image management system
- **Scope**: "routing and managing diagnostic medical image files, clinical reports and patient information"

### Research PACS Features

For academic/research use:
- Centralized repository of anonymized imaging and report data
- Configurable workflows with automated sharing
- Electronic Case Report Forms (eCRF) for radiological data
- Export capabilities linked to clinical data

### Data Routing

Studies flow through configurable workflows:
- Automatic sharing to organizations, locations, groups, users
- QA personnel and investigator routing
- Cross-project access controls

---

## 4. Viewing Experience

### Ambra Pro Viewer

FDA-cleared diagnostic viewer with:
- Primary diagnostic and analysis tool capabilities
- Diagnostic quality DICOM image display
- 3D visualization and reordering
- Multi-series layout (display multiple series simultaneously)

### Viewer Features

- **Thumbnail navigation**: Click or drag-drop from thumbnails
- **Active series highlighting**: Blue border on selected series
- **Full toolset**: Available in toolbar
- **Layout options**: Multiple series display configurations

### Study Sharing

- Select study → Actions dropdown → Share
- Share window with access controls
- Images icon opens DICOM Viewer from worklist

---

## 5. Key Differences from Our Viewer

| Feature | Ambra Health | Our Viewer |
|---------|--------------|------------|
| **Deployment** | Cloud SaaS | Client-side browser app |
| **Storage** | Google Cloud Platform | IndexedDB (browser) |
| **File Upload** | Server upload | Local file selection |
| **PDF Handling** | Server storage + optional DICOM conversion | Direct blob storage |
| **Multi-user** | Yes, with sharing/routing | Single user |
| **Offline** | No (cloud required) | Yes (full offline) |
| **FDA Clearance** | Yes (diagnostic use) | No (personal viewing) |

---

## 6. Takeaways for Our Implementation

### What Ambra Does Well

1. **Separate report upload**: Clear UI path for attaching reports to studies (not mixed with image upload)

2. **PDF to DICOM conversion**: They can wrap PDFs as DICOM Secondary Capture for archival. We could consider this for compatibility with other DICOM systems, but it's overkill for personal use.

3. **Workflow integration**: Reports are linked to studies via Study Instance UID. We already do this via our state structure.

### What's Different for Us

1. **No server**: We can't store on a cloud backend. IndexedDB is our "server equivalent."

2. **Simpler viewer**: We don't need diagnostic-quality 3D visualization or FDA clearance. A modal PDF viewer is sufficient.

3. **Privacy model**: Ambra routes data to multiple users/systems. We keep everything local by design.

### Validation

Ambra's approach validates our design decisions:
- **Report attachments are a real use case** in medical imaging workflows
- **PDF is the primary format** for medical reports
- **Study-level association** is the right granularity (not series-level)

---

---

## 6. Deep Dive: Cloud Architecture

### Infrastructure Stack (Google Cloud Platform)

Ambra uses object storage rather than traditional database BLOB storage:

| GCP Component | Purpose |
|---------------|---------|
| **Compute Engine** | Virtual machine infrastructure for processing |
| **Cloud Storage** | Unified object storage for DICOM and documents |
| **Cloud DLP API** | De-identification and PHI redaction at scale |
| **Cloud Healthcare API** | FHIR/DICOM-native healthcare data management |

They also use AWS for global expansion (multi-cloud strategy).

### Storage Model

```
Upload Flow:
1. Client uploads via Web Portal, Gateway, or API
2. Files go to Cloud Storage (object storage)
3. Metadata indexed in application database
4. Study UUID links files to patient/study records
```

### API Capabilities (v3 Services API)

| Feature | Description |
|---------|-------------|
| **Non-DICOM uploads** | Separate upload forms for non-DICOM content |
| **File types** | PDF, DOCX, JPEG, AVI, MP4, plus DICOM |
| **DICOM wrapping** | Can wrap non-DICOM files as DICOM Secondary Capture |
| **Multipart upload** | Chunked uploads for large files |
| **Drag-and-drop** | Web uploader supports drag-and-drop |
| **Study attachment** | Files linked via Study UUID |

### Key Technical Details

1. **Namespace separation**: PHI data vs. storage namespaces (for de-identification workflows)
2. **Custom field mapping**: DICOM tags can be stored in custom fields
3. **Automatic conversion**: DOCX to viewer format, AVI to web-compatible video
4. **Gateway integration**: DICOM C-STORE for institutional PACS integration

### Architecture Comparison

```
Enterprise (Ambra):
  Client → API → Cloud Storage → Database Index

Our Pattern (IndexedDB):
  Client → IndexedDB (blob) + localStorage (metadata)
```

We're implementing the same separation of concerns:
- **Blob storage**: Ambra uses Cloud Storage, we use IndexedDB
- **Metadata index**: Ambra uses a database, we use localStorage
- **Study association**: Both link by Study UID

The difference is scale and multi-user - they need cloud for sharing/collaboration, we keep everything local for privacy.

---

## Sources

- [Ambra User Guide - Health Images](https://www.healthimages.com/content/uploads/sites/2/2018/12/health-images-user-guide.pdf)
- [Ambra User Guide - Clear Connect Medical Imaging](https://clearconnectimaging.com/content/uploads/2023/07/ambra-user-guide-ccmi.pdf)
- [Ambra Patient Upload Guide - El Camino Health](https://www.elcaminohealth.org/sites/default/files/2022-01/ambra-patient-upload.pdf)
- [Ambra Portal Actions Guide](https://oralradiologyconsultants.com/wp-content/uploads/2020/08/Ambra_Portal_Actions.pdf)
- [Ambra Health Case Study - Google Cloud](https://cloud.google.com/customers/ambra-health)
- [Ambra v3 Services API](https://access.dicomgrid.com/api/v3/api.html)
- [Ambra Gateway DICOM Conformance](https://www.intelerad.com/wp-content/uploads/2022/04/Ambra-Gateway-DICOM-Conformance-Statement.pdf)
- [UVA Radiology - Upload Outside CDs to PACS](https://med.virginia.edu/radiology/wp-content/uploads/sites/191/2020/11/upload-outside-CDs-to-Radiology-PACS.pdf)
- [Ambra Research for Academic Medical Centers](https://www.intelerad.com/wp-content/uploads/2022/03/Ambra-Research-for-Academic-Medical-Centers-One-pager.pdf)
- [Ambra PACS FDA 510(k) Summary](https://www.accessdata.fda.gov/cdrh_docs/pdf23/K231360.pdf)
