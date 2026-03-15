# Deep Research: EasyRadiology

## Subject
EasyRadiology (https://easyradiology.de/en/) - Cloud-based medical image management and sharing platform based in Germany.

## Research Questions

### Product and Architecture
1. What is EasyRadiology's product offering? What can users do with it?
2. What is the technical architecture? Client-side rendering, server-side rendering, or hybrid?
3. What DICOM viewer technology do they use? Custom-built, OHIF, Cornerstone, or another library?
4. What transfer syntaxes and compression formats are supported?
5. How does their viewer compare in capability to enterprise PACS viewers (Sectra, Philips, Visage)?

### Cloud Infrastructure
6. Where is the platform hosted? AWS, Azure, GCP, or self-hosted?
7. How do they handle DICOM storage? DICOMweb, proprietary API, or direct file storage?
8. What is their data sovereignty story? (Important for a German company handling medical data)
9. How do they handle image sharing between institutions or with patients?
10. What authentication and access control model do they use?

### Business Model
11. What is their pricing model? Per-study, per-user, subscription, or other?
12. Who are their target customers? Hospitals, clinics, teleradiology, patients?
13. How do they position against enterprise PACS vs. lightweight cloud sharing tools?
14. What regulatory certifications do they hold? (CE marking, MDR, FDA?)

### Comparison to Our Viewer
15. How does their approach to cloud-based image management compare to our planned cloud platform (ADR 004)?
16. What can we learn from their sharing model for our future cloud features?
17. How does their viewer's feature set compare to ours (measurement tools, W/L, multi-modality)?
18. What is their approach to progressive loading and performance optimization?

## Context
We are building a web-based DICOM viewer (client-side rendering, vanilla JS) and planning a cloud platform (ADR 004: client-side rendering + cloud storage). EasyRadiology is interesting as a reference for simple, accessible cloud-based image management and sharing -- a different market segment from enterprise PACS but relevant to our cloud platform plans.
