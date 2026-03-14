# Research Thinking Process

## Approach

A single research agent ran 93 tool calls across Pro Medicus/Visage product pages, AWS case studies, NVIDIA case studies, investor presentations, press releases, blog posts, job postings, DICOM conformance statements, IHE connectathon results, patent databases, financial reports, and industry comparison sites.

## Key Findings

### The Zuse Institute Berlin Origin

The most important historical detail: Visage's rendering technology traces back to the **Zuse Institute Berlin**, a prestigious German research institute for scientific computing. The founders (Westerhoff, Stalling, Hege) were visualization researchers building Amira, a 3D scientific visualization tool. This academic visualization heritage -- not medical imaging heritage -- explains why Visage's rendering architecture is fundamentally different from traditional PACS vendors who evolved from film management systems.

Malte Westerhoff, the CTO, is still running the Berlin engineering center. The technical DNA has been continuous from ZIB spinoff (1999) through Mercury (2003) through Pro Medicus (2009) to today.

### Smart Client, Not Zero-Footprint

A critical distinction: Visage's primary diagnostic viewer is a **native application** (C++/Qt), not a browser. They recently added an HTML5 web viewer (RSNA 2025), but it's positioned for enterprise access, not primary diagnostic reading. This is a significant nuance -- even the purest SSR vendor doesn't trust the browser for primary diagnosis.

This has implications for our Tauri desktop app: there may be diagnostic-quality scenarios where a native client is genuinely better than a browser, even with identical rendering code.

### Patent Opacity

Despite "patented" being mentioned dozens of times across Pro Medicus materials, **no specific patent numbers are ever cited publicly**. USPTO searches for "Visage Imaging," "Pro Medicus," and "Malte Westerhoff" did not surface obvious results. The patents may be filed under "Indeed - Visual Concepts GmbH" or Mercury Computer Systems, or under individual inventor names not publicly associated with the company. This is unusual -- most medical device companies reference their patent numbers. It may indicate the patents are defensive (discouraging competitors from the SSR space) rather than actively enforced.

### 100% Customer Retention

The most striking business metric: no hospital has ever left Visage since Pro Medicus acquired it in 2009. This is partly structural (enormous switching costs -- retraining every radiologist, migrating years of archives) and partly product quality. Combined with the per-study pricing model, it creates an annuity-like revenue stream.

### Pre-Processing at Ingest

A key architectural detail: Visage pre-processes cross-sectional data (CT, MR, PET, DBT) at the time of ingest, not when the radiologist opens the study. This means volumes are already reconstructed and cached in GPU-ready format before anyone asks for them. This is the main reason they can claim "subsecond" display -- the heavy work was done minutes or hours earlier.

This is the opposite of our approach where processing happens on-demand when the user opens a file. For our cloud platform, pre-processing at upload would be a significant performance improvement.

## What We Could Not Determine

- **Streaming protocol specifics**: codec (JPEG? H.264? proprietary?), transport (WebSocket? custom TCP?), quality adaptation strategy
- **GPU hardware**: Current models unknown (K6000 is from ~2014 NVIDIA case study)
- **EC2 instance types**: G4? G5? P4? Not disclosed
- **Patent numbers**: Despite extensive searching, no specific patents identified
- **HTML5 viewer technology**: WebGL? Canvas? Framework? (likely minimal since rendering is server-side)
- **Concurrent user scaling**: How many radiologists per render server? GPU memory per user?
- **Frame rate**: What FPS during rapid scroll? During volume rotation?

## Confidence Assessment

- **High confidence**: Company history, C++/Qt stack, SSR architecture, AWS infrastructure, financial metrics, customer list, pricing model, native client as primary diagnostic tool
- **Medium confidence**: Pre-processing at ingest (consistent across multiple sources but implementation details unknown), adaptive streaming mechanism (clearly exists but specifics proprietary)
- **Low confidence**: Patent portfolio (exists but unidentified), specific GPU hardware, streaming protocol details, HTML5 viewer capabilities
