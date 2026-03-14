# Research Thinking Process

## Approach

A single research agent ran 79 tool calls across AWS documentation (docs.aws.amazon.com/healthimaging), AWS blog posts, pricing pages, SDK references, GitHub examples (including the TLM Proxy reference architecture), re:Invent session content, customer case studies, and comparison articles. AWS documentation is thorough and public, so we got deep implementation-level detail.

## Key Findings

### HTJ2K is the Core Innovation

HealthLake Imaging's entire value proposition rests on HTJ2K (High Throughput JPEG 2000) -- a newer, faster variant of JPEG 2000 standardized in ISO 15444-15. Key properties:
- 2-3x lossless compression vs raw DICOM (storage cost savings)
- RPCL progression order enables resolution-level progressive decoding
- Order of magnitude faster decode than traditional JPEG 2000
- All DICOM is transcoded to HTJ2K on import -- the original encoding is not preserved

This last point is important: HealthLake Imaging transforms your data on import. You cannot get the original DICOM Part 10 file back out. This is a vendor lock-in concern and a data fidelity concern for some use cases.

### Progressive Loading Requires Extra Infrastructure

A surprise finding: progressive loading is NOT built into the HealthLake Imaging API itself. You need to deploy a separate **TLM Proxy** (an AWS-provided reference architecture using Fargate containers, CloudFront, and Lambda) that sits between the client and HealthLake Imaging. The proxy parses tile-level markers from the HTJ2K bitstream and serves partial resolution levels via HTTP byte-range requests.

This means progressive loading is achievable but requires additional infrastructure beyond the base service. For our viewer, this adds deployment complexity.

### DICOMweb Support is Now Complete

As of September 2025, HealthLake Imaging supports all three DICOMweb services (WADO-RS, STOW-RS, QIDO-RS) with OIDC authentication. This is significant because earlier versions only had a proprietary AWS API. The DICOMweb endpoint means our viewer could connect using standard DICOMweb libraries without AWS SDK dependency.

The OIDC support means browser-based authentication is possible via Cognito, which is the recommended path for web applications. This aligns well with our planned architecture.

### Pricing is Compelling

The storage cost structure is aggressive:
- $0.105/GB/month (Frequent Access)
- $0.006/GB/month (Archive Instant Access -- subsecond retrieval!)
- With 2-3x HTJ2K compression, effective active storage is ~$0.035-0.053/GB/month

For comparison, running Orthanc on EC2 + S3 would cost the EC2 instance (~$50-200/month) plus S3 storage (~$0.023/GB/month) plus operational overhead. HealthLake Imaging removes the operational burden but adds API call costs ($0.005/1K calls).

### Browser Integration Architecture

Two viable paths identified:
1. **DICOMweb + OIDC** (recommended): Standard DICOMweb client in browser, Cognito for auth, no AWS SDK needed. Most portable, least vendor lock-in.
2. **AWS SDK + Cognito Identity Pool**: Direct AWS API calls from browser with temporary credentials. More AWS-locked but gives access to features beyond DICOMweb.

Both require adding an HTJ2K decoder to our browser. The recommended decoder is **OpenJPH** (compiled to WASM). Our current OpenJPEG WASM decoder may also work but OpenJPH is specifically optimized for HTJ2K.

## Fit for Our Architecture (ADR 004)

HealthLake Imaging is a strong fit for our cloud platform:
- DICOMweb API aligns with our planned data source swap (File System Access API -> DICOMweb)
- Client-side rendering is preserved (we decode HTJ2K in browser, render locally)
- OIDC + Cognito provides browser-native authentication
- Archive tier at $0.006/GB with subsecond retrieval is very cost-effective
- Progressive loading via TLM Proxy would give us Sectra RapidConnect-like behavior

Gaps to address:
- Need HTJ2K decoder (OpenJPH WASM) in our browser
- TLM Proxy infrastructure for progressive loading
- 4 regions only (may limit international deployment)
- No DIMSE protocol (can't receive studies from hospital PACS directly -- need a DICOM router)
- Data transformation on import means we can't use it as a bit-perfect archive

## Confidence Assessment

- **High confidence**: Pricing, DICOMweb API, data model, security, OIDC auth flow, HTJ2K encoding
- **Medium confidence**: Progressive loading via TLM Proxy (reference architecture exists but production experience is limited), performance claims (AWS marketing vs real-world)
- **Low confidence**: Actual decode performance of OpenJPH WASM in our viewer (would need benchmarking)
