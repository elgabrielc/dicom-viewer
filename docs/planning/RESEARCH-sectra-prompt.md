# Sectra PACS (Medical Imaging IT) - Deep Technical Architecture Benchmark

Research the following product in depth. I need to understand the technical architecture, rendering pipeline, and how it compares to building a web-based DICOM viewer.

## Product Context

- Sectra Medical Imaging IT (enterprise PACS/VNA solution)
- Parent company: Sectra AB, founded 1978, Linkoping, Sweden (publicly traded on Nasdaq Stockholm)
- KLAS #1 enterprise PACS for 13 consecutive years (91.0 large / 93.0 small in 2025)
- UniView: zero-footprint universal web viewer
- 3D Core: server-side 3D rendering component
- RapidConnect: technology for fast image delivery over poor networks
- Used across 2,000+ hospitals worldwide
- Strong presence in Nordics, UK NHS, North America, Australia
- Key differentiator: radiologist workflow efficiency, "100% of users would buy again"

## Research Areas (investigate all thoroughly)

1. **Rendering Architecture**: How does Sectra split client-side vs server-side rendering? What does UniView render in the browser vs on the server? How does 3D Core work? What GPU/compute infrastructure powers their server-side rendering?

2. **RapidConnect Technology**: How does this work technically? What compression, streaming, or progressive loading strategies make it fast over poor networks? Patents or technical papers describing the approach?

3. **Zero-Footprint UniView Viewer**: What browser technologies does UniView use? WebGL, WebAssembly, Canvas API? How do they achieve diagnostic quality in a browser? What bit depths and resolutions are supported?

4. **Large Dataset Handling**: How do they handle DBT (digital breast tomosynthesis), cardiac CT, and other large studies? Streaming strategies? Memory management?

5. **Workflow and Hanging Protocols**: Sectra is known for workflow efficiency. How do their hanging protocols work? What automation exists? How does the worklist integrate?

6. **AI Integration**: What AI marketplace or integration capabilities exist? How do third-party AI algorithms connect to the viewer? FHIR/DICOMweb integration points?

7. **Architecture and Deployment**: On-premises vs cloud deployment options? What cloud infrastructure do they use? Microservices vs monolith? Database technology?

8. **IDS7 Platform**: What is the IDS7 platform architecture? How do the components (PACS, VNA, RIS, reporting) fit together?

9. **Standards Compliance**: DICOM conformance, DICOMweb support (WADO-RS, STOW-RS, QIDO-RS), IHE profiles, HL7/FHIR integration?

10. **Performance**: What benchmarks or performance claims exist? Study load times, scrolling frame rates, concurrent user capacity?

11. **Competitive Advantages**: Why has Sectra been KLAS #1 for 13 years? What do customers specifically praise? What are the weaknesses?

12. **Comparison to Client-Side Viewers**: How does Sectra's architecture compare to a client-side rendering approach like ours? What can we learn from their design decisions?

## Sources to Search

Technical whitepapers, RSNA/HIMSS/ECR presentations, patent filings, Sectra developer documentation, DICOM conformance statements, clinical validation studies, customer case studies, KLAS reports, Frost & Sullivan analysis, press releases, job postings (which reveal tech stack), IHE integration statements, and any open-source components they use or contribute to. Also search for academic papers by Sectra engineers or affiliated researchers (Linkoping University has close ties to Sectra).
