# AWS HealthImaging -- Deep Technical Research

Research date: 2026-03-14
Service: AWS HealthImaging (formerly AWS HealthLake Imaging, formerly Amazon HealthImaging)
GA: July 26, 2023
Regions: us-east-1, us-west-2, eu-west-1, ap-southeast-2

---

## 1. HTJ2K Encoding and Progressive Loading

### How Encoding Works

On import, HealthImaging transcodes most DICOM transfer syntaxes to **HTJ2K Lossless with RPCL** (Resolution Position Component Layer progression order). The stored transfer syntax UID is `1.2.840.10008.1.2.4.202`.

Exceptions that are retained as-is (not transcoded):
- Explicit VR Little Endian (`1.2.840.10008.1.2.1`) -- for binary segmentation
- JPEG Baseline (`1.2.840.10008.1.2.4.50`) -- lossy 8-bit
- JPEG 2000 Lossy (`1.2.840.10008.1.2.4.91`)
- JPEG XL (`1.2.840.10008.1.2.4.112`)
- HTJ2K Lossy (`1.2.840.10008.1.2.4.203`)
- All MPEG/H.264/H.265 video transfer syntaxes

Transfer syntaxes that get transcoded to HTJ2K lossless:
- Implicit VR Endian, Deflated Explicit VR, Explicit VR Big Endian
- JPEG Lossless (Process 14 and First-Order Prediction)
- JPEG-LS Lossless and Near-Lossless
- JPEG 2000 Lossless
- RLE Lossless
- Standard HTJ2K Lossless (re-encoded with RPCL progression)

Alternative: Data stores can be configured at creation time to use **JPEG 2000 Lossless** instead of HTJ2K (November 2025 release).

### RPCL Progression Order

The DICOM standard (Supplement 235, Part 5 Section 10.18) mandates that HTJ2K RPCL uses:
- **Resolution-first progression**: lower resolution data appears first in the bitstream, enabling progressive display
- **Base resolution constraint**: width or height of base resolution must be <= 64 pixels, ensuring useful thumbnails
- **Tile Length Markers (TLM)**: required by the standard, enabling identification of resolution breakpoints in the bitstream

### Compression Ratios

- **Lossless HTJ2K**: typically 2:1 to 3:1 for medical images (same as standard JPEG 2000 lossless -- lossless compression is math, not codec-dependent)
- **Maximum supported**: up to 20:1 for lossy import (JPEG Baseline, JPEG 2000 lossy, HTJ2K lossy)
- Storage is billed based on compressed size, so the 2-3x lossless compression directly reduces storage costs

### Progressive Loading via TLM Proxy

HealthImaging does NOT natively expose a progressive/byte-range API on the GetImageFrame endpoint. Instead, AWS provides a **Tile Level Marker (TLM) Proxy** as an open-source sample project:

- Deployed as **Fargate containers** (2 vCPU, 4GB each) behind an ALB
- API: `POST /datastore/{id}/imageSet/{id}/getImageFrame?startLevel=X&endLevel=Y`
- Fetches the full frame from HealthImaging, parses TLM markers, returns only the requested resolution levels
- Caches parsed levels server-side (Node.js local cache + optional ElastiCache/memcached)
- Uses `htj2k-js` library for TLM marker parsing
- Progressive workflow: request level 0 first (thumbnail ~64px), then append higher levels incrementally

The metadata confirms multi-resolution support via `PixelDataChecksumFromBaseToFullResolution`, which lists checksums at each resolution level:
```json
"PixelDataChecksumFromBaseToFullResolution": [
  {"Width": 256, "Height": 188, "Checksum": 2598394845},
  {"Width": 512, "Height": 375, "Checksum": 1227709180}
]
```

### HTJ2K Performance vs Standard JPEG 2000

- HTJ2K decode is **an order of magnitude faster** than standard JPEG 2000
- HTJ2K is **at least 2x faster** than all other DICOM transfer syntaxes
- SIMD acceleration (including WASM-SIMD for browsers) provides additional speedup
- GPU-accelerated decoding (NVIDIA nvJPEG2000): 7x faster than CPU on g4dn instances

### Browser Decoding

Recommended library: **OpenJPH** (open-source, has WASM build with SIMD support)
- `openjphjs` -- C++/WASM build specifically for medical imaging
- Supports progressive decoding: browser can decide how many bytes to load based on rendering resolution
- Also used by Cornerstone3D / OHIF for HTJ2K support

---

## 2. DICOMweb API

### Supported Services

All three core DICOMweb services are supported as of 2025:

| Service | Availability | Endpoint |
|---------|-------------|----------|
| **QIDO-RS** (Search) | May 2025 | `dicom-medical-imaging.{region}.amazonaws.com` |
| **WADO-RS** (Retrieve) | July 2024 | `dicom-medical-imaging.{region}.amazonaws.com` |
| **STOW-RS** (Store) | July 2025 | `dicom-medical-imaging.{region}.amazonaws.com` |

Note: DICOMweb APIs use a **separate endpoint** (`dicom-medical-imaging.*`) from cloud-native APIs (`runtime-medical-imaging.*` and `medical-imaging.*`).

### QIDO-RS Details

Supported search levels:
- **Study-level**: no prerequisites
- **Series-level**: requires StudyInstanceUID
- **Instance-level**: requires both StudyInstanceUID and SeriesInstanceUID

Search capabilities:
- Attribute value queries (exact match)
- Keyword queries (using DICOM keywords)
- Tag queries (hex group/element form)
- **Range queries**: e.g., `StudyDate=19900101-20230901`
- **Wildcard queries**: `*` (any sequence) and `?` (single character)
- **Fuzzy matching**: case-insensitive prefix word matching on PatientName and ReferringPhysicianName

Pagination:
- Default limit: 1,000 results
- Maximum limit: 1,000 per page
- Maximum offset: 9,000
- **Hard cap: 10,000 total records** -- cannot retrieve more via QIDO-RS

Searchable attributes include: PatientID, PatientName, AccessionNumber, StudyDate, StudyDescription, Modality, SeriesInstanceUID, StudyInstanceUID, and more.

### WADO-RS Details

Supported operations:
- `GetDICOMSeriesMetadata` -- returns JSON for all instances in a series
- `GetDICOMInstance` -- returns full .dcm file
- `GetDICOMInstanceMetadata` -- returns JSON metadata for a single instance
- `GetDICOMInstanceFrames` -- returns pixel data frames (single or batch via multipart)
- `GetDICOMBulkData` -- retrieves bulk data elements

Frame retrieval supports transcoding via Accept header:
- Default: Explicit VR Little Endian (uncompressed)
- `transfer-syntax=*`: returns in stored format (no transcoding, lowest latency)
- Can request specific syntax: HTJ2K (`1.2.840.10008.1.2.4.202`), JPEG 2000, JPEG Baseline, JPEG XL
- Returns `406 NotAcceptableException` if requested syntax is incompatible

### STOW-RS Details

- Upload up to **1 GB per request**
- Supports single file (`Content-Type: application/dicom`) or multipart
- Synchronous -- ideal for latency-sensitive workflows
- Data organization follows same rules as async import jobs
- Requires SigV4 signing with `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`

### Authentication

- **Default**: AWS SigV4 (standard AWS credential signing)
- **OIDC** (September 2025): OpenID Connect token in `Authorization: Bearer <JWT>` header
  - Requires Lambda authorizer configured on the data store
  - OIDC can only be enabled on **new** data stores (not retroactively)
  - Lambda must respond within 1 second
  - HealthImaging pre-validates `exp`, `iat`, `nbf` claims before invoking Lambda

### DICOMweb Limitations vs Full Server

- DICOMweb APIs are **not available** through AWS CLI or SDKs -- HTTP requests only
- 10,000 record cap on QIDO-RS results
- No WADO-URI support (only WADO-RS)
- No UPS-RS (Unified Procedure Step) support
- No DIMSE support (C-FIND, C-MOVE, C-STORE) -- though a DIMSE proxy sample exists
- References primary image sets by default; non-primary require explicit imageSetId parameter
- BulkData elements >1MB auto-replaced with BulkDataURIs

---

## 3. Data Model

### Hierarchy

```
AWS Account
  Data Store (regional, up to 10 per region)
    Image Set (roughly maps to DICOM Series)
      Patient metadata (normalized)
      Study metadata (normalized)
      Series metadata (normalized)
      Instances (1..N per image set)
        DICOM attributes
        Image Frames (1..N per instance, HTJ2K encoded)
```

### Image Sets

- Created automatically during import
- Grouped by consistent Patient/Study/Series metadata
- **Versioned**: every modification creates a new version; prior versions accessible
- Have ARNs, support IAM RBAC/ABAC, and can be tagged (up to 50 tags)
- Primary vs. non-primary: conflicting metadata creates non-primary image sets

### Metadata Format

Metadata returned as **human-readable JSON** with DICOM keywords (not hex tags):
```json
{
  "SchemaVersion": "1.1",
  "DatastoreID": "2aa75d103f7f45ab977b0e93f00e6fe9",
  "ImageSetID": "46923b66d5522e4241615ecd64637584",
  "Patient": {
    "DICOM": {
      "PatientID": "2178309",
      "PatientName": "MISTER^CT"
    }
  },
  "Study": {
    "DICOM": { "StudyTime": "083501" },
    "Series": {
      "<SeriesInstanceUID>": {
        "DICOM": { "Modality": "CT" },
        "Instances": {
          "<SOPInstanceUID>": {
            "DICOM": { "SOPClassUID": "...", "HighBit": 15 },
            "ImageFrames": [{
              "ID": "0d1c97c51b773198a3df44383a5fd306",
              "PixelDataChecksumFromBaseToFullResolution": [...],
              "MinPixelValue": 451,
              "MaxPixelValue": 1466,
              "FrameSizeInBytes": 384000
            }]
          }
        }
      }
    }
  }
}
```

Key observations:
- Patient and Study metadata is **normalized** across instances (single source of truth)
- Metadata is gzip-compressed in API responses (must gunzip before parsing)
- Image frame IDs are 32-character hex strings
- MinPixelValue/MaxPixelValue provided for transcoded frames (null for retained originals)

### Automatic Data Organization (May 2025)

Imported data is automatically organized into DICOM Study and Series resources based on:
- Study-level: StudyDate, AccessionNumber, PatientID, StudyInstanceUID, StudyID
- Series-level: SeriesInstanceUID, SeriesNumber

---

## 4. Storage Architecture

### Backend

AWS does not publicly disclose the internal storage backend. The service manages storage entirely, providing:
- Two storage tiers with automatic lifecycle management
- Built-in redundancy (implied by AWS managed service SLA)
- No direct S3 access to stored data

### Storage Tiers

| Tier | Price/GB/month | When Used |
|------|---------------|-----------|
| **Frequent Access** | $0.105 | New imports, recently accessed data |
| **Archive Instant Access** | $0.006 | Data not accessed for 30+ days |

Intelligent Tiering behavior:
- Image sets start in Frequent Access on import
- After 30 consecutive days without access, auto-transition to Archive Instant Access
- Accessed data moves back to Frequent Access (and resets the 30-day timer)
- **No retrieval charges** for tier transitions
- **Minimum storage duration**: 30 days (early deletion charged for remainder)
- **Minimum billing size**: 5 MB per image set

Actions that constitute "access" (move to Frequent): GetImageSetMetadata, GetImageFrame, WADO-RS actions, CopyImageSet, UpdateImageSetMetadata, console viewing.

Actions that do NOT constitute access: SearchImageSets, QIDO-RS, ListImageSetVersions, GetImageSet, tag operations, delete operations.

### Subsecond Retrieval

Both storage tiers provide **millisecond access latencies**. There is no restore delay for Archive Instant Access (unlike S3 Glacier).

### CloudFront CDN Integration

HealthImaging can deliver frames via CloudFront:
- First request: HealthImaging -> CloudFront PoP via AWS backbone -> user
- Subsequent requests: cached at PoP, served from edge
- AWS provides a CDK sample project for CloudFront distribution with Cognito JWT auth

---

## 5. Performance

### Retrieval Latency Claims

- **Subsecond** image retrieval for both Frequent Access and Archive Instant Access
- "On-premises-level performance" -- designed to match local PACS latency
- CloudFront caching reduces repeat-access latency further

### No Published Benchmarks

AWS does not publish specific millisecond latency numbers. Performance depends on:
- Image size and encoding
- Region proximity
- Whether CloudFront caching is used
- Whether TLM proxy is used (adds proxy overhead but reduces first-paint time)

### Scaling

- Managed service with automatic scaling
- Supports petabyte-scale storage
- Concurrent import jobs: 100 per data store (adjustable, 20 in ap-southeast-2)
- Import speed improved 20x in December 2023 release
- Digital pathology (WSI) imports up to 6x faster since November 2024

### vs Self-Hosted (Orthanc/DCM4CHEE)

| Factor | AWS HealthImaging | Self-Hosted Orthanc/DCM4CHEE |
|--------|-------------------|------------------------------|
| Setup | Managed, minutes | Days/weeks to configure |
| Scaling | Automatic | Manual (add instances, configure LB) |
| Maintenance | Zero | OS patches, DB maintenance, backup |
| Latency | Subsecond (both tiers) | Depends on hardware, typically <100ms local |
| Throughput | High (managed) | Limited by hardware |
| HTJ2K | Native, built-in | Not supported (standard transfer syntaxes) |
| Progressive loading | Via TLM proxy | Not available |
| Cost | Per-GB + per-API | EC2 + RDS + S3 + ops time |

---

## 6. Integration Patterns for Browser-Based Viewers

### Option A: Cloud-Native API + AWS SDK (SigV4)

```javascript
import { MedicalImagingClient, GetImageFrameCommand } from "@aws-sdk/client-medical-imaging";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

const client = new MedicalImagingClient({
  region: "us-east-1",
  credentials: fromCognitoIdentityPool({
    clientConfig: { region: "us-east-1" },
    identityPoolId: "us-east-1:xxxxx-xxxxx-xxxxx",
  }),
});

const response = await client.send(new GetImageFrameCommand({
  datastoreId: "xxxx",
  imageSetId: "xxxx",
  imageFrameInformation: { imageFrameId: "xxxx" },
}));
const buffer = await response.imageFrameBlob.transformToByteArray();
// Decode HTJ2K buffer with OpenJPH WASM...
```

Browser auth flow:
1. User signs in via Cognito User Pool (or federated identity)
2. Browser gets Cognito ID token
3. Exchange for temporary AWS credentials via Cognito Identity Pool
4. AWS SDK signs requests with SigV4 automatically
5. Direct browser-to-HealthImaging calls

Pros: Direct connection, no proxy needed.
Cons: Exposes AWS SDK in browser, bundle size, SigV4 complexity, vendor lock-in.

### Option B: DICOMweb API + OIDC (Recommended for Standards Compliance)

```
Browser --[Bearer JWT]--> HealthImaging DICOMweb endpoint
                            --> Lambda authorizer validates JWT
                            --> Returns IAM role ARN
                            --> HealthImaging processes request
```

Browser auth flow:
1. User signs in via Cognito (or any OIDC provider)
2. Browser gets OIDC access token (JWT)
3. DICOMweb requests include `Authorization: Bearer <token>`
4. HealthImaging validates basic claims (exp, iat, nbf)
5. Lambda authorizer validates token signature and returns IAM role
6. HealthImaging executes request with that role's permissions

Pros: Standard DICOMweb, works with any OIDC provider, no AWS SDK in browser.
Cons: OIDC only on new data stores, Lambda latency adds ~100ms, Lambda cost.

### Option C: Backend Proxy (Most Flexible)

```
Browser --[app auth]--> Your API (Lambda/ECS)
                          --> AWS SDK call to HealthImaging
                          --> Return frame to browser
```

Pros: Full control over auth, caching, transformation, billing isolation.
Cons: Additional infrastructure, double egress, latency overhead.

### Reference Architecture (AWS Sample)

AWS provides a production-ready OHIF + HealthImaging deployment:
- **S3**: hosts static viewer files (OHIF or custom)
- **CloudFront**: serves viewer + optional frame caching
- **Cognito User Pool**: OIDC identity provider
- **Lambda Authorizer**: validates JWT tokens on DICOMweb requests
- **HealthImaging**: stores/serves DICOM data via DICOMweb
- **Optional**: TLM Proxy (Fargate) for progressive loading
- **Optional**: CloudFront distribution for frame caching

---

## 7. Metadata Search

### Cloud-Native Search (SearchImageSets)

Available via AWS SDK/CLI. Supports:
- Filter by DICOMPatientId, DICOMStudyDateAndTime, DICOMAccessionNumber, SeriesInstanceUID, updatedAt
- Operators: EQUAL, BETWEEN
- Pagination via SDK
- Sorting by DICOMStudyDateAndTime or updatedAt

### DICOMweb QIDO-RS Search (May 2025+)

Full DICOMweb-standard search:
- Study, Series, Instance level hierarchical queries
- Wildcard (`*`, `?`), range, exact, fuzzy matching
- Attributes: PatientID, PatientName, StudyDate, AccessionNumber, Modality, StudyDescription, etc.
- **Limitation**: 10,000 record maximum total
- **Limitation**: Series search requires StudyInstanceUID; Instance search requires both Study and Series UIDs

### Structured Data Storage Costs

Metadata is indexed separately and charged per GB/month. Each data store includes 10 GB pre-provisioned at no cost.

Estimated record sizes:
- Study record: 1,024 bytes
- Series record: 830 bytes
- Instance record: 680 bytes

Example: 1,000 studies / 10,000 series / 100,000 instances = ~77.3 MB of indexed storage.

---

## 8. Import/Export

### Import Methods

**Async S3 Import (StartDICOMImportJob)**:
- Upload DICOM P10 files to S3 staging bucket
- Call StartDICOMImportJob with inputS3Uri and outputS3Uri
- Up to 5,000 files per job, 10 GB total per job, 4 GB max per file
- Up to 100 concurrent import jobs per data store
- Results in job-output-manifest.json with per-file success/error status
- Pixel data verification (CRC32 checksums) performed automatically
- **Import is always free** -- no API charges for ingestion

**Sync DICOMweb STOW-RS (July 2025)**:
- POST with `Content-Type: application/dicom` or multipart
- Up to 1 GB per request
- Ideal for real-time/latency-sensitive workflows
- Standard DICOMweb response format

**DIMSE Bridge (via sample project)**:
- S3 StoreSCP: Fargate-based DICOM listener receives DIMSE C-STORE, writes P10 to S3
- On-prem ingestion: AWS Greengrass IoT receives DIMSE at edge, routes to S3

### Export / Data Portability

**WADO-RS Instance Retrieval**:
- `GetDICOMInstance` returns full .dcm file
- Can specify transfer syntax (uncompressed ELE or stored format)
- Reconstructs standard DICOM P10 from internal representation

**Bulk Export**:
- No native bulk export API
- AWS sample project `healthlake-imaging-to-dicom-python-module` exports image sets to P10 files
- Must iterate image sets and reconstruct P10 files programmatically

**Vendor Lock-in Considerations**:
- Data is transformed on import (transcoded to HTJ2K, metadata normalized)
- Original P10 files are not preserved as-is
- Export is possible but requires reconstruction work
- DICOMweb WADO-RS provides standards-based retrieval path
- No proprietary data format -- output is standard DICOM

---

## 9. Pricing

### Storage

| Component | Cost |
|-----------|------|
| Frequent Access | $0.105/GB/month |
| Archive Instant Access | $0.006/GB/month |
| Structured Data (metadata) | Charged per GB/month (10 GB free per data store) |

### Operations

| Component | Cost |
|-----------|------|
| API calls | $0.005 per 1,000 calls |
| Data import | Free |
| Tier transitions | Free |
| Data retrieval from archive | Free |

### Data Transfer

Standard AWS data transfer rates apply:
- Within-region (HealthImaging to other AWS services): Free
- Outbound to internet: First 100 GB/month free across all AWS services, then tiered pricing

### Free Tier

- 20 GB/month storage (up to 10 GB each tier)
- 20,000 API requests/month
- New accounts (July 2025+): up to $200 credits across eligible services for 12 months

### Cost Comparison: HealthImaging vs S3 + Orthanc

For 10 TB of DICOM data, mostly archival (80% Archive, 20% Frequent):

**AWS HealthImaging:**
- Storage: (2TB * $0.105) + (8TB * $0.006) = $210 + $48 = ~$258/month
- Note: with 2-3x compression, 10TB raw becomes ~4TB stored, so ~$103/month
- API calls (100K/month): $0.50
- Total: ~$104-260/month (depending on compression)

**S3 + Orthanc on EC2:**
- S3 Standard (10TB): $230/month
- EC2 (t3.xlarge): ~$120/month
- RDS PostgreSQL (db.t3.medium): ~$50/month
- No compression savings (stored as raw DICOM P10)
- Operational overhead: patches, backups, monitoring
- Total: ~$400/month + ops time

HealthImaging is roughly comparable on raw storage cost but saves on compression and eliminates operational overhead.

---

## 10. Security and Compliance

### HIPAA

- **HIPAA-eligible service** (confirmed on AWS HIPAA Eligible Services Reference, updated March 5, 2026)
- Business Associate Addendum (BAA) available through AWS Artifact
- PHI can be stored and processed in HealthImaging

### Encryption

**At rest:**
- AWS-owned KMS keys (default, no configuration needed)
- Customer-managed KMS keys (symmetric, you control lifecycle)
- KMS grant created automatically for HealthImaging service access
- CloudTrail logs all KMS operations

**In transit:**
- HTTPS/TLS for all API connections (enforced, no HTTP option)
- FIPS endpoints available in us-east-1 and us-west-2

### Access Control

- **IAM**: fine-grained policies at data store, image set, and tag level
- **RBAC**: role-based access using IAM roles
- **ABAC**: attribute-based access using resource tags
- **OIDC**: delegated auth via Lambda authorizer (DICOMweb only)
- **Metadata-level access control**: expose only required metadata fields per role

### Audit

- **CloudTrail**: logs all API calls (management and data events)
- **CloudWatch**: resource usage metrics (February 2026)
- **EventBridge**: event notifications for import jobs, data changes

### Data Isolation

- Data stores are isolated per region, per account
- VPC access via AWS PrivateLink (no internet exposure required)
- De-identified copies share pixel data references (no duplication), controlled at metadata level

---

## 11. Limitations and Quotas

### Service Quotas

| Quota | Default | Adjustable |
|-------|---------|-----------|
| Data stores per region | 10 | Yes |
| Concurrent import jobs | 100 (20 in ap-southeast-2) | Yes |
| Files per import job | 5,000 | Yes |
| Total size per import job | 10 GB | No |
| Max file size per DICOM P10 | 4 GB | No |
| Max nested folders per import | 10,000 | No |
| Max metadata size per operation | 50 MB | Yes |
| UpdateImageSetMetadata payload | 10 KB | Yes |
| Max frames per CopyImageSet | 1,000 | Yes |
| Concurrent CopyImageSet per store | 100 | Yes |
| Concurrent DeleteImageSet per store | 100 | Yes |
| STOW-RS max per request | 1 GB | -- |
| QIDO-RS max results | 10,000 | No |

### Unsupported Features

- **No DIMSE protocol** (C-FIND, C-MOVE, C-STORE) -- DICOMweb and cloud-native APIs only
- **No WADO-URI** -- only WADO-RS
- **No UPS-RS** (Unified Procedure Step)
- **No RLE Lossless output** -- RLE is transcoded on import, cannot be retrieved as RLE
- **No bulk export API** -- must reconstruct P10 files programmatically
- **No raw P10 preservation** -- originals are transformed on import
- **OIDC only on new data stores** -- cannot add OIDC to existing stores
- **4 regions only** -- limited geographic availability

### Supported Modalities

X-Ray, CT, MRI, Ultrasound, Digital Pathology (WSI), and DICOM video (MPEG2, H.264, H.265).

---

## 12. Comparison to Alternatives

### vs Self-Hosted Orthanc

| | AWS HealthImaging | Orthanc |
|---|---|---|
| **Type** | Managed SaaS | Open-source, self-hosted |
| **Cost** | Per-GB + per-API | Infrastructure + ops labor |
| **Setup** | Minutes | Hours to days |
| **DICOMweb** | QIDO/WADO/STOW-RS | Full DICOMweb plugin |
| **DIMSE** | Not supported | Full C-FIND/C-MOVE/C-STORE |
| **HTJ2K** | Native | Not supported |
| **Progressive loading** | Via TLM proxy | Not available |
| **Scaling** | Automatic | Manual |
| **Vendor lock-in** | Moderate (AWS-specific) | None |
| **HIPAA** | Built-in | Your responsibility |

### vs Self-Hosted DCM4CHEE

| | AWS HealthImaging | DCM4CHEE Arc Light 5 |
|---|---|---|
| **Type** | Managed SaaS | Open-source, self-hosted (Java EE) |
| **IHE profiles** | Limited | Comprehensive IHE compliance |
| **HL7 support** | Not built-in | Full HL7 server |
| **MPPS/UPS** | Not supported | Supported |
| **Storage Commitment** | Not supported | Supported |
| **Complexity** | Low | High (WildFly, Keycloak, LDAP, PostgreSQL) |
| **Best for** | Cloud-native apps | Hospital PACS replacement |

### vs Google Cloud Healthcare API (DICOM)

| | AWS HealthImaging | Google Cloud Healthcare API |
|---|---|---|
| **DICOMweb** | QIDO/WADO/STOW-RS | Full DICOMweb (REST only) |
| **DIMSE** | Not native | Via open-source adapter |
| **Image encoding** | HTJ2K (optimized) | Stored as-is (no transcoding) |
| **Progressive loading** | Via TLM proxy | Not available |
| **Intelligent tiering** | Built-in (Frequent/Archive) | Multiple storage classes (Nearline, Coldline, Archive) |
| **Analytics** | Via SageMaker integration | BigQuery, AutoML, Vertex AI |
| **Regions** | 4 | Many (global GCP presence) |
| **Pub/Sub** | Via EventBridge | Native Pub/Sub integration |
| **Pricing** | $0.105/GB Frequent, $0.006/GB Archive | Blob storage varies by class |

Google advantage: more regions, deeper analytics integration, no transcoding overhead.
AWS advantage: HTJ2K compression (2-3x storage savings), progressive loading, faster decode.

### vs Azure Health Data Services (DICOM)

| | AWS HealthImaging | Azure DICOM Service |
|---|---|---|
| **DICOMweb** | QIDO/WADO/STOW-RS | Full DICOMweb including UPS-RS |
| **Extended Query Tags** | Not supported | Supported (custom tag indexing) |
| **Storage** | HTJ2K compressed | Stored as-is |
| **Data Lake** | Via S3/Athena | Native Azure Data Lake integration |
| **Pricing** | Published, transparent | Published but hard to find exact numbers |

Azure advantage: UPS-RS support, extended query tags, broader DICOMweb compliance.
AWS advantage: HTJ2K compression, progressive loading, simpler pricing model.

---

## 13. Fit for Our Architecture

### Our Architecture (ADR 004)

- Client-side DICOM rendering in browser (vanilla JS, Canvas 2D, future vtk.js)
- Cloud storage for the hosted platform
- DICOMweb API for interoperability

### How HealthImaging Would Fit

```
Browser (our viewer)
  |-- Cognito login --> OIDC token
  |-- DICOMweb QIDO-RS --> search studies (HealthImaging)
  |-- DICOMweb WADO-RS --> retrieve metadata (HealthImaging)
  |-- DICOMweb WADO-RS frames --> get HTJ2K pixel data (HealthImaging)
  |-- OpenJPH WASM --> decode HTJ2K in browser
  |-- Canvas 2D / vtk.js --> render
  |
  Optional:
  |-- TLM Proxy (Fargate) --> progressive frame loading
  |-- CloudFront --> frame caching at edge
```

### Integration Approach

1. **Auth**: Use Cognito User Pool as OIDC provider. Create HealthImaging data store with OIDC enabled. Configure Lambda authorizer.

2. **Search**: Use DICOMweb QIDO-RS from browser. Replace our Flask-based library with QIDO-RS queries against HealthImaging.

3. **Viewing**: Use DICOMweb WADO-RS to retrieve frames. Request `transfer-syntax=1.2.840.10008.1.2.4.202` for HTJ2K (fastest decode). Add OpenJPH WASM decoder to our viewer.

4. **Upload**: Use STOW-RS for individual uploads, S3 import jobs for bulk.

### Gaps to Fill

| Gap | Solution |
|-----|----------|
| HTJ2K decoding | Add OpenJPH WASM to our viewer (we already have OpenJPEG WASM for J2K) |
| Authentication | Add Cognito integration, OIDC token management |
| Progressive loading | Deploy TLM proxy or implement client-side progressive decode |
| Notes/Reports | Our own backend (HealthImaging stores images, not app data) |
| De-identification | HealthImaging metadata-level access + our app layer |
| Study management | QIDO-RS replaces our current file-system based library |

### Key Decision Points

1. **Vendor lock-in**: HealthImaging is AWS-specific. DICOMweb provides a standards-based abstraction, so our viewer code would work with any DICOMweb backend. The lock-in is in the deployment infrastructure, not the viewer.

2. **HTJ2K dependency**: Adding OpenJPH WASM is a one-time effort. We already support JPEG 2000 via OpenJPEG WASM, so the pattern is established.

3. **Cost vs DIY**: For our scale (initially small), HealthImaging's per-GB pricing may be more expensive than S3 + simple API. At scale, the managed service eliminates operational burden.

4. **Progressive loading**: The TLM proxy adds infrastructure complexity. Alternative: use `transfer-syntax=1.2.840.10008.1.2.1` (uncompressed) for small images, HTJ2K for large ones, and implement progressive loading later.

---

## Appendix: Release Timeline

| Date | Key Feature |
|------|-------------|
| Jul 2023 | General availability (4 regions) |
| Dec 2023 | 20x faster imports, 5K files/job, CloudFormation |
| Mar 2024 | 4GB max file size, JPEG Lossless + HTJ2K import |
| May-Jul 2024 | WADO-RS instance/frames/metadata, EventBridge, cross-account import |
| Nov 2024 | Lossy support (JPEG, J2K, HTJ2K), binary segmentation, 6x WSI import |
| Jan 2025 | Simplified image set grouping |
| May 2025 | QIDO-RS search, automatic data organization, series metadata retrieval, video |
| Jul 2025 | STOW-RS, BulkData support |
| Sep 2025 | OIDC authentication for DICOMweb |
| Nov 2025 | JPEG 2000 Lossless storage option, enhanced import warnings |
| Dec 2025 | QIDO-RS wildcards and fuzzy search |
| Feb 2026 | JPEG XL support, CloudWatch metrics, service-linked roles |

---

## Sources

- [What is AWS HealthImaging?](https://docs.aws.amazon.com/healthimaging/latest/devguide/what-is.html)
- [AWS HealthImaging Features](https://aws.amazon.com/healthimaging/features/)
- [AWS HealthImaging Pricing](https://aws.amazon.com/healthimaging/pricing/)
- [Endpoints and Quotas](https://docs.aws.amazon.com/healthimaging/latest/devguide/endpoints-quotas.html)
- [Supported Transfer Syntaxes](https://docs.aws.amazon.com/healthimaging/latest/devguide/supported-transfer-syntaxes.html)
- [Understanding Image Sets](https://docs.aws.amazon.com/healthimaging/latest/devguide/understanding-image-sets.html)
- [Getting Image Set Pixel Data](https://docs.aws.amazon.com/healthimaging/latest/devguide/get-image-frame.html)
- [GetImageFrame API Reference](https://docs.aws.amazon.com/healthimaging/latest/APIReference/API_GetImageFrame.html)
- [Image Frame Decoding Libraries](https://docs.aws.amazon.com/healthimaging/latest/devguide/reference-libraries.html)
- [Pixel Data Verification](https://docs.aws.amazon.com/healthimaging/latest/devguide/pixel-data-verification.html)
- [Searching DICOM Data (QIDO-RS)](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-search.html)
- [Retrieving DICOM Data (WADO-RS)](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-retrieve.html)
- [Getting DICOM Instance Frames](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-retrieve-instance-frames.html)
- [Storing Instances (STOW-RS)](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-storing.html)
- [OIDC Authentication Workflow](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-oidc-how.html)
- [OIDC Lambda Authorizer Setup](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-oidc-requirements.html)
- [Data Encryption](https://docs.aws.amazon.com/healthimaging/latest/devguide/data-encryption.html)
- [Cost Optimization](https://docs.aws.amazon.com/healthimaging/latest/devguide/cost-optimization.html)
- [Release History](https://docs.aws.amazon.com/healthimaging/latest/devguide/releases.html)
- [AWS HealthImaging FAQs](https://aws.amazon.com/healthimaging/faqs/)
- [AWS HealthImaging Customers](https://aws.amazon.com/healthimaging/customers/)
- [AWS HealthImaging Samples (GitHub)](https://github.com/aws-samples/aws-healthimaging-samples)
- [OHIF + HealthImaging Integration (GitHub)](https://github.com/RadicalImaging/ohif-aws-healthimaging)
- [HealthImaging SDK for JavaScript v3 Examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_medical-imaging_code_examples.html)
- [OHIF + HealthImaging + OIDC Blog Post](https://aws.amazon.com/blogs/industries/integrate-ohif-viewer-with-aws-healthimaging-and-openid-connect-authentication/)
- [DICOM Standard HTJ2K Transfer Syntaxes](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_10.18.html)
- [NVIDIA nvImageCodec HTJ2K Performance](https://developer.nvidia.com/blog/advancing-medical-image-decoding-with-gpu-accelerated-nvimagecodec/)
- [OpenJPH (HTJ2K decoder)](https://github.com/aous72/OpenJPH)
- [HTJ2K Resources Collection](https://github.com/chafey/HTJ2KResources)
- [AWS HIPAA Eligible Services Reference](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/)
- [Google Cloud Healthcare API DICOM](https://docs.cloud.google.com/healthcare-api/docs/concepts/dicom)
- [Azure DICOM Service Overview](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/overview)
