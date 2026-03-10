# Visage 7 / Pro Medicus - Deep Technical Architecture Benchmark

Research the following product in depth. I need to understand the technical architecture, rendering pipeline, and how it compares to building a web-based DICOM viewer.

## Product Context

- Visage 7 by Visage Imaging (wholly owned subsidiary of Pro Medicus Limited)
- Parent company: Pro Medicus Limited, founded 1983, Melbourne, Australia (ASX: PME)
- Pro Medicus market cap ~$25B AUD (2026), one of Australia's most valuable tech companies
- Visage Imaging acquired by Pro Medicus in 2009, originally a German company (formerly Open Infrastructure)
- Server-side rendering pioneer -- patented adaptive streaming from GPU render servers
- $520M+ in new contracts FY2025 ($330M Trinity Health, $170M UCHealth, $40M Duke Health)
- ~8% US market share but winning the largest academic/health system deals
- Key differentiator: pure thin-client SSR, performance independent of client hardware
- Works over 6 Mbps broadband, even through VPN/Citrix
- Claimed: 6 GB 3D mammography study displayed in 2-3 seconds
- CEO: Dr. Sam Hupert (co-founder), CTO/Head of Visage: Marcel Kornacker
- Architecture: single codebase for viewer, archive, and AI orchestration

## Research Areas (investigate all thoroughly)

1. **Server-Side Rendering Architecture**: How does Visage 7 implement SSR? What GPU hardware powers their render servers? What streaming protocol do they use? How do they handle latency for interactive operations (scroll, W/L, zoom)? What is their "patented adaptive streaming"?

2. **Thin Client Technology**: What does the browser/client actually do? Is it HTML5? Does it use WebGL, WebAssembly, or just display streamed frames? What are the client hardware requirements? How does it work through VPN/Citrix?

3. **Single Codebase Architecture**: Visage claims viewer + archive + AI in one codebase. How is this structured? What programming language/framework? How does the archive work?

4. **Performance and Large Datasets**: How do they achieve 2-3 second load times for 6 GB studies? What prefetching/caching strategies? GPU memory management? Concurrent user scaling?

5. **AI Integration**: How does Visage Open AI integrate third-party AI? What is the Visage AI Accelerator? How do AI results appear in the viewer?

6. **AWS Partnership**: Visage runs on AWS. What specific services? EC2 GPU instances? Storage architecture? How do they handle multi-region deployment?

7. **Patent Portfolio**: What patents does Visage/Pro Medicus hold? Especially the "adaptive streaming" patent and any rendering-related patents.

8. **Deployment Architecture**: Cloud-only or hybrid? How do they handle on-premises requirements? Network architecture for hospitals?

9. **Standards Compliance**: DICOM conformance, DICOMweb, IHE profiles, HL7/FHIR integration?

10. **Business Model**: How does their pricing work? Per-study? Per-click? Why are they winning the largest contracts?

11. **Competitive Advantages**: What specifically makes Visage better than Sectra, Philips, GE? Why do the largest US health systems choose them?

12. **Comparison to Client-Side Viewers**: How does Visage's pure SSR compare to client-side rendering? What are the fundamental tradeoffs?

## Sources to Search

Technical whitepapers, RSNA/HIMSS presentations, patent filings (USPTO, EPO), Pro Medicus investor presentations and annual reports, Visage developer documentation, DICOM conformance statements, AWS case studies, clinical validation studies, customer testimonials, KLAS reports, analyst coverage (Macquarie, Morgan Stanley, Bell Potter), press releases, job postings (which reveal tech stack), Marcel Kornacker presentations, Sam Hupert interviews, and any academic papers. Also search for the original Open Infrastructure / Visage Imaging German company history and technology origins.
