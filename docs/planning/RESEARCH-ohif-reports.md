# Research: OHIF Viewer Document/Report Handling

## Research Question

How does the OHIF (Open Health Imaging Foundation) Viewer handle document attachments and reports associated with imaging studies?

## Specific Areas to Investigate

1. **Document Support**: Does OHIF support attaching non-DICOM documents (PDFs, images) to studies?

2. **Storage Architecture**: How does OHIF store data?
   - Client-side vs server-side
   - What databases/storage systems are used?
   - How are large files handled?

3. **DICOM SR (Structured Reports)**: How does OHIF handle DICOM Structured Reports?
   - Viewing SR documents
   - Creating/editing SR

4. **User Experience**: How are documents/reports displayed?
   - In-viewer rendering
   - Separate panel/modal
   - Integration with imaging workflow

5. **Technical Architecture**:
   - React/web architecture patterns
   - State management for documents
   - Offline/caching capabilities

## Context

OHIF is an open-source web-based DICOM viewer, making it the most architecturally similar to our DICOM viewer. Understanding their approach will inform our document storage decisions.
