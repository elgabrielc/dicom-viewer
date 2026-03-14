# AWS HealthLake Imaging - Deep Technical Architecture Benchmark

Research this AWS service in depth as a potential component of our cloud platform stack. Unlike the previous benchmarks (competing PACS products), this is infrastructure we might build on top of. We need to understand capabilities, limitations, pricing, and how it fits into our planned architecture (ADR 004: client-side rendering + cloud storage + DICOMweb API).

## Product Context

- AWS HealthLake Imaging (formerly Amazon HealthImaging, launched July 2023)
- Part of AWS for Health and its broader HealthLake family
- Purpose-built cloud service for storing, accessing, and analyzing medical images at scale
- Uses HTJ2K (High Throughput JPEG 2000) for optimized storage and retrieval
- DICOMweb API compatible (WADO-RS, STOW-RS, QIDO-RS subset)
- Used by: Philips HealthSuite, Visage 7 (adapter), Change Healthcare, Hyland, others
- Positioned as alternative to self-hosted DICOM servers (Orthanc, DCM4CHEE)

## Research Areas (investigate all thoroughly)

1. **HTJ2K Encoding and Progressive Loading**: How does HealthLake Imaging encode DICOM data into HTJ2K? What compression ratios? How does progressive resolution decoding work? What are the tile-level markers (TLM)? How does byte-range retrieval work for progressive loading? Compare to standard JPEG 2000 and uncompressed DICOM.

2. **DICOMweb API Implementation**: Which DICOMweb services are supported? WADO-RS, STOW-RS, QIDO-RS -- what subset? What are the limitations vs. a full DICOMweb server? How does authentication work? What are the API patterns?

3. **Data Model**: How does HealthLake Imaging organize data? Data stores, image sets, image frames -- what's the hierarchy? How does it map to DICOM Study/Series/Instance? How is metadata handled (normalized vs. raw)?

4. **Storage Architecture**: How is data stored internally? S3-backed? What redundancy? What are the storage tiers? How does the "subsecond image retrieval" claim work? What's the storage cost structure?

5. **Performance**: What are the actual retrieval latencies? How does it compare to self-hosted Orthanc/DCM4CHEE? Throughput for concurrent requests? How does it scale?

6. **Integration Patterns**: How do you connect a web viewer to HealthLake Imaging? What SDKs are available? How does authentication flow work for browser-based access? Can a static web app connect directly or does it need a backend proxy?

7. **Metadata Search**: What search capabilities exist? Can you query by patient name, study date, modality, etc.? How does the QIDO-RS subset compare to a full DICOM query?

8. **Import/Export**: How do you ingest DICOM data? STOW-RS? S3 import? What about export? Can you get raw DICOM back out?

9. **Pricing Model**: What does it cost per GB stored? Per API call? Per frame retrieved? How does this compare to self-hosted S3 + Orthanc?

10. **Security and Compliance**: HIPAA BAA? Encryption at rest/transit? Access controls? Audit logging? How does it handle PHI?

11. **Limitations and Gotchas**: What are the known limitations? Maximum image sizes? Supported transfer syntaxes? Missing DICOMweb features? Vendor lock-in concerns? Data portability?

12. **Comparison to Alternatives**: How does it compare to self-hosted Orthanc, DCM4CHEE, Google Cloud Healthcare API DICOM, and Azure DICOM service? What are the tradeoffs?

13. **Fit for Our Architecture**: Given ADR 004 (client-side rendering + cloud storage), how would HealthLake Imaging fit? Can our browser-based viewer connect to it? What would the integration architecture look like? What are the gaps?

## Sources to Search

AWS documentation (docs.aws.amazon.com/healthimaging), AWS blog posts, re:Invent presentations, AWS architecture whitepapers, pricing pages, SDK documentation (Python boto3, JavaScript AWS SDK), customer case studies, third-party integration guides, Stack Overflow questions, GitHub examples, and comparison articles. Also search for the original launch announcement and any updates since July 2023.
