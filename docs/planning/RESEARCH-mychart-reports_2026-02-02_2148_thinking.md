# Research Thinking Process

## Initial Research Goals

The user asked to benchmark Epic MyChart's document upload implementation to inform decisions about report storage for the DICOM viewer. Key questions:

1. How do patients upload documents?
2. What file types are supported?
3. How are documents stored and persisted?
4. What's the UX for viewing?
5. What's the technical architecture?

## Search Strategy

I conducted multiple targeted searches:

1. **"Epic MyChart patient document upload feature"** - To understand the user-facing upload workflow
2. **"Epic MyChart supported file types"** - To identify accepted formats and limits
3. **"Epic EHR document storage architecture BLOB"** - To understand backend storage
4. **"Epic MyChart document viewer mobile experience"** - For UX insights
5. **"Epic FHIR API DocumentReference"** - For technical API details

## Key Findings Analysis

### Storage Architecture Discovery

The most significant finding was that Epic uses a **server-side BLOB server** architecture, not client-side storage. This makes sense for their enterprise healthcare context:

- Multi-user systems need centralized storage
- Clinical workflows require document routing/approval
- HIPAA compliance needs audit trails
- Cross-device access is expected

However, this doesn't directly translate to our use case because:
- We're building a privacy-focused client-side viewer
- No server infrastructure needed/wanted
- Single user, single browser model
- No clinical workflow integration needed

### File Type Standardization

Epic's choice of PDF, JPG, PNG, and TIFF with 10MB limits validates our initial design decision to support PDF and images. The 10MB limit is interesting - large enough for most radiology reports but small enough to prevent abuse.

### Viewing Experience

Epic renders documents in-app rather than forcing downloads. This confirms our decision to show PDFs in an iframe and images in a modal viewer.

## Implications for Our Design

The research confirms that our **IndexedDB approach** is the right choice for client-side persistence because:

1. **Epic's server storage solves the same problem we need to solve** - persistence across sessions. IndexedDB is the client-side equivalent.

2. **File types align** - PDF, JPG, PNG are the standard. We don't need TIFF initially (but documented it as future enhancement).

3. **In-app viewing is expected** - Users expect to view documents without downloading. Our iframe/img approach matches this expectation.

4. **Size limits are reasonable** - IndexedDB can handle much more than 10MB, giving us headroom.

## What Epic Does Differently (and Why)

| Epic's Choice | Why They Do It | Our Alternative |
|---------------|----------------|-----------------|
| Server BLOB storage | Multi-user, multi-device, HIPAA compliance | IndexedDB (client-side, privacy-first) |
| Clinical review workflow | Legal/medical record requirements | Not needed - personal viewer |
| FHIR API access | Interoperability with other systems | Not needed - standalone app |

## Conclusion

The benchmarking validated that:
1. Our file type choices (PDF, JPG, PNG) are correct
2. In-app viewing is the expected UX
3. Persistence is important (Epic uses servers, we should use IndexedDB)
4. The complexity difference is justified by different use cases (enterprise healthcare vs personal viewer)

Recommendation stands: Implement IndexedDB for blob storage to achieve the persistence users expect, matching the UX of professional tools like MyChart while maintaining our client-side privacy model.
