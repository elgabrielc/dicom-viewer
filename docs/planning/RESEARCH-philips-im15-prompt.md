# Philips Image Management 15 (Web Diagnostic Viewer) - Deep Technical Architecture Benchmark

Research the following product in depth. I need to understand the technical architecture, rendering pipeline, and how it compares to building a web-based DICOM viewer.

## Product Context

- "Philips Image Management 15 (Web Diagnostic Viewer)" -- launched November 2025
- Parent company: Royal Philips (NYSE: PHG, AEX: PHIA), founded 1891, Eindhoven, Netherlands
- Product lead: Madhuri Sebastian, Business Leader Imaging Informatics at Philips
- Focus: Next-generation zero-footprint web-based diagnostic viewer (successor to Philips Vue PACS) -- full radiology workstation capabilities in a browser with no local install
- Key features: server-side rendering, AI integration, native interactive reporting module, handles large datasets (DBT, cardiac CT), workflow automation
- Deployment: SaaS via Philips HealthSuite cloud (powered by AWS), with on-premises option
- Availability: currently USA (select customers), broader rollout and international expansion planned 2026
- In development: generative AI for display protocol normalization and patient summaries; Agentic AI for anatomy-aware study prioritization
- Early adopter quote from Pieter Hoste, Chief Radiologist at AZ West Hospital, Belgium
- Related R&D: RadConnect (research prototype for async radiology communication, tested at Leiden University Medical Center 2022-2023, not commercialized)

## Research Areas (investigate all thoroughly)

1. **Server-Side Rendering Architecture**: How does Philips implement server-side rendering for medical images? What gets rendered on the server vs client? How do they handle the latency problem? What protocols do they use for streaming rendered frames to the browser? Compare to client-side rendering approaches.

2. **Zero-Footprint Web Viewer Technology**: What browser technologies do they leverage? WebGL, WebAssembly, Canvas API? How do they achieve "diagnostic quality" in a browser without plugins? What resolution/bit-depth do they support? How do they handle calibration for diagnostic monitors?

3. **Large Dataset Handling**: How do they handle Digital Breast Tomosynthesis (DBT) datasets (which can be 1-4GB per study) and cardiac CT in a browser? What streaming/progressive loading strategies do they use? How do they manage memory?

4. **AI Integration Architecture**: How is AI integrated into the viewer? What AI models do they use? How does the "generative AI for display protocol normalization" work? What is "Agentic AI for anatomy-aware study prioritization"? How do these connect to the viewing workflow?

5. **HealthSuite Cloud Platform**: What is the technical architecture of Philips HealthSuite? How does it use AWS? What services (compute, storage, networking) power the viewer? How do they handle HIPAA/medical data compliance in the cloud?

6. **Interactive Reporting Module**: How does the native reporting module work? How is it different from traditional dictation/reporting? What structured reporting standards do they support?

7. **Workflow Automation**: What workflow automation capabilities exist? How do they integrate with hospital RIS/HIS systems? What standards (HL7 FHIR, DICOM worklist) do they use?

8. **Predecessor Technology (Vue PACS)**: What was the architecture of Philips Vue PACS? How does IM15 differ architecturally? What lessons did they learn?

9. **Competitive Positioning**: How does this compare to other zero-footprint viewers (Visage 7, Sectra, Change Healthcare, Ambra/Intelerad)? What makes their approach unique?

10. **Performance Claims**: What performance benchmarks or claims do they make? Study load times, scrolling frame rates, concurrent user capacity?

11. **RadConnect Research**: What was the RadConnect prototype? How did async radiology communication work? Why wasn't it commercialized? Any technology that made it into IM15?

12. **Standards Compliance**: What DICOM services do they support? DICOMweb? IHE profiles? What about FHIR integration?

## Sources to Search

Technical whitepapers, RSNA/HIMSS presentations, patent filings, developer documentation, architecture diagrams, clinical validation studies, customer case studies, analyst reports (Frost & Sullivan, KLAS), press releases, job postings (which reveal tech stack), and any open-source components they use or contribute to.
