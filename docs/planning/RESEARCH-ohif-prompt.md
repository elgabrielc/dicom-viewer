# OHIF (Open Health Imaging Foundation) Viewer - Deep Technical Architecture Benchmark

Research the following open-source project in depth. I need to understand the technical architecture, rendering pipeline, and how it compares to our web-based DICOM viewer. Unlike the previous benchmarks (Philips, Sectra, Visage), this is open-source -- so we should be able to get much deeper into actual implementation details.

## Product Context

- OHIF Viewer (Open Health Imaging Foundation)
- Open-source, MIT licensed, web-based medical imaging viewer
- GitHub: github.com/OHIF/Viewers (very active, thousands of stars)
- Built on Cornerstone.js (also OHIF project) for rendering
- Used by major institutions: Massachusetts General Hospital, NIH, Google Health
- Backed by: Gordon Harris (MGH), originally funded by Open Health Imaging Foundation
- Integration: commonly deployed with Orthanc, DCM4CHEE, Google Cloud Healthcare API
- Key differentiator: open-source, extensible, client-side rendering in browser
- Current version: OHIF v3 (major rewrite with extension system)
- Most direct architectural comparison to our viewer (both are client-side browser-based)

## Research Areas (investigate all thoroughly)

1. **Rendering Pipeline**: How does OHIF/Cornerstone.js render DICOM images? WebGL vs Canvas? How do they handle window/level, transfer syntaxes, pixel manipulation? What decoders do they use for JPEG 2000, JPEG Lossless, etc.? How does this compare to our approach?

2. **Cornerstone.js / Cornerstone3D**: What is the relationship between Cornerstone.js (legacy) and Cornerstone3D (current)? How does the 3D rendering work? What changed architecturally?

3. **Extension/Mode System**: OHIF v3 has a plugin architecture. How do extensions and modes work? How do you add custom tools, panels, and viewers? What is the module system?

4. **Data Loading Architecture**: How does OHIF load DICOM data? DICOMweb (WADO-RS)? Local files? What is the image loading pipeline? How do they handle streaming/progressive loading?

5. **State Management**: How does OHIF manage viewer state? What framework do they use? React? How is the UI structured?

6. **Performance**: How does OHIF handle large datasets? Memory management? Web Workers? What are the known performance limitations?

7. **Hanging Protocols**: OHIF has a hanging protocol system. How does it work? How configurable is it?

8. **Segmentation and Annotation**: How do they handle segmentations, measurements, and annotations? What tools are available? How is DICOM SR supported?

9. **Deployment Options**: How is OHIF typically deployed? Static files? Docker? What backend servers does it connect to (Orthanc, DCM4CHEE, Google Cloud Healthcare)?

10. **DICOM Support**: What transfer syntaxes are supported? What SOP classes? How complete is their DICOM parsing compared to ours?

11. **Community and Ecosystem**: How active is development? Who contributes? What is the governance model? How does the foundation work?

12. **Architecture Comparison to Our Viewer**: Detailed comparison of OHIF's architecture vs ours. Where are they more sophisticated? Where are we simpler/better? What can we learn? What should we adopt?

## Sources to Search

GitHub repository (README, architecture docs, contributing guides), official documentation site (docs.ohif.org), Cornerstone.js documentation, npm packages and their READMEs, GitHub issues and discussions (reveal limitations and design decisions), conference presentations (RSNA, SIIM), academic papers citing OHIF, blog posts by contributors, deployment guides, Docker configurations, and the OHIF community forum/Discord.
