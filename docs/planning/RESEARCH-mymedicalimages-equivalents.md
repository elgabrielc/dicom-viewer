# Research: Direct-to-Consumer DICOM Cloud Services Like MyMedicalImages.com

**Date:** 2026-05-01
**Question:** Are there any other products that are functionally equivalent to MyMedicalImages.com — true direct-to-consumer DICOM cloud with patient self-signup?
**Verdict:** **MyMedicalImages is not alone.** Found 4 confirmed qualifying competitors. The strongest direct competitor is **3DICOM Patient** (same $29.95/yr price, publicly-traded parent). The space is occupied but none has broken through at consumer scale.

---

## Executive Summary

Under the strict criteria (patient self-signup, DICOM upload, persistent personal cloud, real viewer, consumer pricing under $100/year):

| Product | Pricing | Storage | Differentiator | Active? |
|---------|---------|---------|----------------|---------|
| **MyMedicalImages.com** | $29.95/yr | Unlimited | Browser-based, family folders, CVS partnership | Yes |
| **3DICOM Patient** | $29.95/yr | Unlimited | 3D rendering of CT/MRI/PET, mobile apps, ASX-listed parent | **Yes — strongest direct competitor** |
| **DicomShare Personal** | $9/mo or $90/yr | 10 GB | Browser anonymization, share-link focused | Yes |
| **Falcon Mx + Falcon Cloud** | $69.99/yr + $4.99–$14.99/mo | Tiered | Mobile-first iOS, FDA-cleared sibling product (Falcon MD), 4.5★ App Store | Yes |

The user's prior belief that "MyMedicalImages is the only equivalent" was nearly right but missed at least three real products. The space is more occupied than the previous round of research suggested. None has reached mass-consumer scale.

---

## Product Profiles

### 1. MyMedicalImages.com (reference)

- **URL:** https://mymedicalimages.com/
- **Country:** USA
- **Pricing:** $29.95/year, unlimited storage
- **Viewer:** Browser-based DICOM viewer (Chrome/Safari, desktop only for upload)
- **Sharing:** Email/link sharing, family folders
- **Mobile:** Mobile viewing supported, no mobile upload
- **Founded:** 2017
- **Traction:** Smaller scale; CVS Pharmacy partnership (7,400 locations), OrthoNOW, AAOE, MDView second-opinion partnership
- **Strengths:** Cleanest direct-to-consumer pricing and mental model
- **Weaknesses:** No mobile upload, modest brand awareness, browser-only

### 2. 3DICOM Patient (Singular Health Group, ASX: SHG) — strongest competitor

- **URL:** https://3dicomviewer.com/3d-dicom-viewer-patients/
- **Country:** Australia (publicly-traded, ASX-listed; US presence)
- **Pricing:** $29.95/year (annual saves up to 50% vs. monthly)
- **Storage:** Unlimited (in cloud-storage tier)
- **Viewer:** Online viewer + desktop apps + mobile apps (iOS/Android). **3D rendering of 2D scans is the headline feature** — converts CT/MRI/PET to interactive 3D models
- **Sharing:** "Secure DICOM sharing" mentioned; details unclear
- **Mobile:** Yes — iOS and Android companion apps; "Long Term Cloud Storage" toggle per scan
- **Founded:** 2017
- **Traction:** Public company (ASX:SHG), real revenue, growing commercial traction. 510(k) clearance for the **MD** sibling product. Multiple licensing deals (e.g., PNS expansion). Distribution via Knoxlabs.
- **Strengths:** Same exact consumer price as MyMedicalImages, real engineering investment (3D), publicly-funded, mobile apps, FDA-cleared sibling, US/global reach
- **Weaknesses:** 3D-rendering-as-headline may be less compelling for typical users than basic 2D viewing; user-reported "high cost" relative to alternatives; needs decent processing power
- **Verdict:** **The most direct competitor to myradone's plan.** Same audience, same price, same pitch. Differentiated by 3D.

### 3. DicomShare (share.dicomviewer.net)

- **URL:** https://share.dicomviewer.net/
- **Country:** Unclear (no obvious country anchor)
- **Pricing:**
  - Personal: $9/month or **$90/year** (2 months free annually)
  - Pro: $29/month or $290/year (100 GB)
- **Storage:** Personal tier = 10 GB
- **Viewer:** DICOM viewer included
- **Sharing:** Public share links with QR codes; toggle public/private
- **Mobile:** Not advertised
- **Founded:** Unknown, recent updates (Feb 2026 changelog)
- **Privacy posture:** Browser-side DICOM anonymization before upload — interesting privacy angle
- **Verdict:** Closer to "WeTransfer for DICOM with persistent storage" than a personal library. 10 GB is restrictive vs. unlimited competitors. Pricing-to-storage ratio is worse than MyMedicalImages.

### 4. Falcon Mx (with Falcon Cloud)

- **URL:** https://apps.apple.com/us/app/falcon-mx/id1494173140
- **Country:** USA
- **Pricing:**
  - Standard Monthly: $9.99
  - Standard Bi-Annual: $39.99
  - Standard Yearly: **$69.99**
  - Falcon Cloud: $4.99–$14.99/month tiered
- **Storage:** Tiered with Falcon Cloud, plus optional iCloud/Dropbox/Google Drive integration for personal storage
- **Viewer:** Mobile DICOM viewer (iPhone/iPad)
- **Sharing:** "Falcon Link — your personal storage space for your patients to share with you"
- **Mobile:** **Mobile-first** (iPhone/iPad)
- **Founded:** App-store-traceable (since 2020)
- **Traction:** **4.5/5 stars on App Store, 278 ratings** — positive but modest scale
- **Sibling product:** Falcon MD is **FDA-cleared** for primary interpretation (excluding mammography)
- **Strengths:** FDA-cleared sibling, mobile-first, multi-cloud personal storage integration, 4.5★ ratings
- **Weaknesses:** Higher annual pricing ($70 + cloud) than MyMedicalImages or 3DICOM Patient; mobile-only is a niche; reviewer complaints about mandatory subscriptions for offline access
- **Verdict:** Mobile-first competitor at higher price point. Different positioning (handheld pro tool that patients can also use) rather than consumer-first.

---

## Borderline / Disqualified

- **3DICOM Mobile** — Companion to 3DICOM Patient, requires active subscription. Not a separate product.
- **Medicai** — Free DICOM uploader, not persistent personal storage. Disqualified.
- **DICOM Library** — Anonymized teaching/research sharing. Disqualified.
- **PostDICOM** — Has "patient" tier but pricing starts at $79.99/MONTH. Disqualified as consumer.
- **Purview Image / Purview Patient** — $3,000+/year. Enterprise. Disqualified.
- **SonicDICOM** — Cloud PACS, B2B-priced. Disqualified.
- **CarePassport** — Hospital-integrated. Disqualified.
- **Ambra / Intelerad / LifeImage** — B2B2C, hospital onboarding required. Disqualified.
- **PicnicHealth** — Different model (record retrieval on patient's behalf, not direct DICOM upload).
- **PocketHealth** — Primary onboarding via hospital partnerships. Disqualified per strict criteria, even though self-upload added in 2022.
- **IDV (IMAIOS DICOM Viewer)** — Free viewer, no cloud storage tier. Local-only.
- **MedFilm** — DICOM viewer for retrieving from PACS, not consumer cloud library.
- **OsiriX HD (iPad)** — Pro-grade local viewer, not consumer cloud.

---

## Why None Has Broken Through (Updated)

The four qualifying products share traits that explain limited consumer scale:

1. **App Store presence is modest.** Falcon Mx has 278 ratings — a real consumer scale would be in the tens of thousands.
2. **None has cracked the awareness problem.** "Where do I keep my medical imaging?" is still not a question patients ask.
3. **All are utility-grade products.** None has invested in consumer-grade brand, design, or onboarding the way Apple Photos / Dropbox did for their categories. The viewers are functional, not delightful.
4. **3D / FDA-cleared / pro-grade marketing dilutes consumer focus.** 3DICOM leans into 3D rendering for clinicians; Falcon leans into FDA-cleared / mobile-first pro use. MyMedicalImages stays consumer but at small scale.
5. **No category-defining product.** No one has made "the consumer medical imaging library" feel inevitable the way Notion, Figma, or Linear did for their respective categories.

---

## Implications for myradone Strategy

**The space is occupied but not won.** myradone enters a category with at least 4 active competitors at consumer pricing. None has the consumer-product-quality positioning myradone aspires to.

### Where competitors are strongest

- **3DICOM Patient** has real engineering (3D rendering), public-company resources, mobile apps, FDA-cleared sibling, and identical pricing. This is the most serious competitor and not a sleeper.
- **Falcon Mx** owns mobile-first iOS and has FDA-cleared credibility.
- **MyMedicalImages** owns the simplest pure-consumer pitch and CVS retail distribution.
- **DicomShare** owns share-with-link as the primary action.

### Where myradone can differentiate

1. **Viewer quality** (Darkroom / Lightroom lineage) — none of the named competitors are this serious about viewer craft. 3DICOM has 3D but the 2D viewer is conventional. Falcon is functional. This is myradone's strongest current asset.
2. **Library design** (Google Photos lineage) — all competitors have utility-grade libraries. A consumer-quality library is open territory.
3. **Modern web architecture** — DICOMweb + HTJ2K + browser-native rendering (per ADR 004) is meaningfully better engineering than legacy stacks.
4. **Onboarding and brand** — none of the competitors have invested in consumer brand. The category is wide open for a Linear/Notion-quality consumer brand at the top.
5. **Free tier with no surprise charges** — PocketHealth's billing complaints are informative. A genuinely good free tier without dark patterns is a competitive opening.
6. **Sharing UX when it ships** — none of the competitors have nailed share-to-doctor reliably. There's room for a meaningfully better sharing experience as a future moment.

### A note on "ownership"

It is tempting to read this competitive landscape as "incumbent X owns feature Y, so don't chase it." That framing does not apply here. None of these competitors has reached the scale or brand recognition required to own anything. They are all small. 3DICOM has a 2D-to-3D feature, not a 3D moat. MyMedicalImages has a CVS partnership, not retail-channel ownership. Falcon has FDA clearance for the MD product, not consumer mindshare. Every dimension — including 3D, retail distribution, mobile-first, and FDA-cleared accuracy — is contestable.

What myradone deprioritizes should come from internal product strategy and consumer-focus discipline, not from misreading utility-grade competitors as established incumbents.

### The wedge

Not first-mover; *quality-mover*. The category has been occupied for ~9 years (MyMedicalImages, 3DICOM, others all from ~2017). None has produced the consumer experience the category deserves. myradone's bet is that consumer-grade design + viewer quality + modern architecture beats utility-grade incumbents.

---

## Sources

- [MyMedicalImages.com](https://mymedicalimages.com/)
- [3DICOM Patient (Singular Health)](https://3dicomviewer.com/3d-dicom-viewer-patients/)
- [Singular Health Group (ASX:SHG)](https://singular.health/)
- [3DICOM pricing](https://3dicomviewer.com/pricing/)
- [3DICOM Mobile on Google Play](https://play.google.com/store/apps/details?id=com.SingularHealth.ThreeDicomMobile)
- [Singular Health 510(k) for 3Dicom MD (MobiHealthNews)](https://www.mobihealthnews.com/news/anz/roundup-singular-health-gets-510k-3dicom-md-and-more-briefs)
- [DicomShare](https://share.dicomviewer.net/)
- [DicomShare FAQ](https://share.dicomviewer.net/faq)
- [Falcon Mx on App Store](https://apps.apple.com/us/app/falcon-mx/id1494173140)
- [Falcon MD on App Store (FDA-cleared sibling)](https://apps.apple.com/us/app/falcon-md/id1670707774)
- [IDV IMAIOS DICOM Viewer (free, no cloud)](https://apps.apple.com/us/app/idv-imaios-dicom-viewer/id1444841062)
- [Best mobile DICOM viewer guide (IMAIOS)](https://www.imaios.com/en/resources/blog/mobile-dicom-viewer-apps)
- [Top 5 Mobile DICOM Viewers (Medicai blog)](https://blog.medicai.io/en/mobile-dicom-viewer/)
