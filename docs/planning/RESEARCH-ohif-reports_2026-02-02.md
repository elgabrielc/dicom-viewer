# Research: OHIF Viewer Document/Report Handling

## Executive Summary

OHIF Viewer handles documents through **DICOM-wrapped formats** (DICOM Encapsulated PDF, DICOM Structured Reports) rather than standalone file attachments. It's designed as a "zero-footprint" viewer that pulls data from external sources rather than storing locally. For client-side caching, OHIF has limited built-in support focused on user preferences, though discussions exist about using IndexedDB for large volume handling.

---

## 1. Document Support

### DICOM Encapsulated PDF

OHIF has a dedicated `dicom-pdf` extension for viewing PDF documents wrapped in DICOM format:

- **SOP Class UID**: `1.2.840.10008.5.1.4.1.1.104.1`
- **How it works**:
  1. Extension detects PDF SOP Class from DICOM tag `x00080016`
  2. Extracts PDF bytes from tag `x00420011` (Encapsulated Document)
  3. Renders PDF in viewport using extracted byte data
- **Package**: `@ohif/extension-dicom-pdf` (standard extension, installed by default)

### DICOM Structured Reports (SR)

Full support via `cornerstone-dicom-sr` extension:

- **Read**: Load existing DICOM SR and "rehydrate" measurements into viewer
- **Write**: Create DICOM SR from tracked measurements and push to server
- **Export**: Measurement tracking → DICOM SR export workflow

### No Standalone Document Attachments

OHIF does **not** support attaching arbitrary PDF/image files to studies. Documents must be:
1. DICOM-wrapped PDFs (Encapsulated Document)
2. DICOM Structured Reports
3. Served from the configured DICOM source (DICOMweb server)

---

## 2. Storage Architecture

### "Zero-Footprint" Design

OHIF is explicitly designed as a viewer, not a storage system:

> "The Viewer persists some data, but its scope is limited to caching things like user preferences and previous query parameters."

> "All studies, series, images, imageframes, metadata, and the images themselves must come from an external source."

### Data Sources

OHIF requires an external data source:
- **DICOMweb** (primary): Standards-based REST API for DICOM
- **AWS HealthImaging**: Cloud-native medical imaging
- **Local files**: Development/testing only

### Client-Side Caching

Current implementation:
- **User preferences**: Persisted locally
- **Query parameters**: Cached for convenience
- **Images**: In-memory caching at imageId level, not persisted to disk

### IndexedDB Discussions

GitHub Issue #3082 discusses using IndexedDB/FilesystemAPI for:
- Extremely large volumes (4D imaging)
- Mobile devices with memory constraints
- Progressive loading when some imageIds get decached

This is for **image caching**, not document storage - but shows the team is aware of IndexedDB's potential.

---

## 3. Architecture Patterns

### Modular Extension System

```
OHIF Viewer
├── Core (business logic)
├── Viewer (routing, composition)
├── Extensions (plugins)
│   ├── dicom-pdf (PDF rendering)
│   ├── cornerstone-dicom-sr (Structured Reports)
│   ├── cornerstone (image rendering)
│   └── ... more extensions
└── Modes (configurations)
```

### Viewport Pattern

Each content type has a dedicated viewport component:
- `DicomPDFViewport` for PDFs
- `CornerstoneViewport` for images
- SR viewport for Structured Reports

Mode configuration maps SOP Class UIDs to viewports.

### Progressive Web App (PWA)

OHIF is a PWA (HTML/JS/CSS bundle) but explicitly notes:
> "A web page's offline cache capabilities are limited and somewhat volatile (mostly imposed at the browser vendor level). For more robust offline caching, you may want to consider a server on the local network."

---

## 4. Key Differences from Our Viewer

| Feature | OHIF | Our Viewer |
|---------|------|------------|
| **Document Format** | DICOM-wrapped only | Standalone PDF/images |
| **Storage** | External server required | Client-side (browser) |
| **Caching** | In-memory only | IndexedDB (planned) |
| **Offline** | Limited/not supported | Full offline support |
| **Architecture** | Modular extension system | Single-file SPA |

---

## 5. Takeaways for Our Implementation

### What We Can Learn

1. **Viewport pattern**: OHIF uses dedicated viewport components per content type. Our modal-based approach (iframe for PDF, img for images) is similar.

2. **SOP Class mapping**: OHIF maps content types to viewers via SOP Class UID. We use file extension detection (`getReportType()`).

3. **Extension architecture**: OHIF's modular approach is overkill for our use case, but the concept of isolated document handling is sound.

### What's Different for Us

1. **We need local storage**: OHIF explicitly doesn't persist documents. We need IndexedDB because we don't have a server backend.

2. **Standalone files**: OHIF only supports DICOM-wrapped documents. We support raw PDFs/images directly - this is simpler and more user-friendly.

3. **Offline-first**: OHIF acknowledges offline limitations. We're designing for offline from the start.

---

## Sources

- [OHIF dicom-pdf Extension README](https://github.com/OHIF/Viewers/blob/master/extensions/dicom-pdf/README.md)
- [OHIF Architecture Documentation](https://docs.ohif.org/development/architecture/)
- [OHIF Scope of Project](https://docs.ohif.org/faq/scope-of-project.html)
- [OHIF Measurement Tracking](https://docs.ohif.org/user-guide/viewer/measurement-tracking/)
- [OHIF GitHub Issue #3082 - Large Volumes](https://github.com/OHIF/Viewers/issues/3082)
- [OHIF DicomPDFViewport Source](https://github.com/OHIF/Viewers/blob/e7e1a8a6cdfcc333c7d2723e156a2760f8fa722e/extensions/dicom-pdf/src/DicomPDFViewport.js)
- [@ohif/extension-dicom-pdf npm](https://www.npmjs.com/package/@ohif/extension-dicom-pdf)
