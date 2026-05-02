# Research: Direct-to-Consumer Personal Medical Imaging Cloud Services

**Date:** 2026-05-01
**Question:** Do direct-to-consumer personal medical imaging cloud services actually exist? Has anyone caught on?
**Verdict:** The space is NOT empty. Several products exist. Pure direct-to-consumer plays have stayed small. The largest player (PocketHealth, 2M+ patients) reached scale via B2B2C hospital partnerships, not pure consumer signup.

---

## Executive Summary

Under the strict definition (patient can sign up independently, no hospital/provider required, can upload their own DICOM files):

- **Pure direct-to-consumer products exist** but at modest scale (MyMedicalImages.com).
- **The largest player in the space** (PocketHealth) is hybrid: it scaled via hospital partnerships and added patient self-upload in 2022. ~2M users, but primarily acquired through hospital onboarding.
- **Several "patient-tier" products** are technically self-signupable but priced as B2B/clinic products (PostDICOM, Purview), making them inaccessible to ordinary consumers.
- **No pure direct-to-consumer DICOM cloud has broken through at mass-consumer scale.**

The architect's earlier claim — "patient-facing personal medical imaging has been tried multiple times, none has caught on with consumers" — is directionally correct but oversimplified. The space has real, active products. But the pure direct-to-consumer wedge has not produced a mass-market winner.

---

## Qualifying Services (Patient Can Sign Up Independently)

### 1. MyMedicalImages.com

- **URL:** https://mymedicalimages.com/
- **Pricing:** $29.95/year, unlimited storage
- **Viewer:** Browser-based DICOM viewer
- **Sharing:** Email/link sharing with families, friends, physicians
- **Founded:** 2017
- **Traction:** Smaller scale; partnerships with CVS Pharmacy (7,400 locations for CD upload), OrthoNOW, AAOE, Pioneer Medical Foundation, and MDView (radiology second opinions)
- **Strengths:** Cleanest direct-to-consumer model, simple pricing, browser-based, supports multi-user family folders
- **Weaknesses:** Limited mass-consumer awareness, browser-only (no mobile upload), modest brand recognition
- **Verdict:** Cleanest match for "Dropbox for medical imaging" but small scale

### 2. PocketHealth

- **URL:** https://www.pockethealth.com/
- **Pricing:**
  - Basic: Free (download imaging from connected hospitals)
  - Core: $29 CAD/year (online access across devices)
  - Unlimited: $49 CAD/year (full features, 4 family members)
  - Flex: $10 CAD/month
- **Viewer:** Browser-based, mobile apps available
- **Sharing:** Provider sharing, family sharing, "Print-a-Link" for paper-based handoff
- **Patient self-upload:** Added in 2022 — patients can now upload from CD/USB
- **Founded:** ~2016 (Toronto)
- **Traction:** **2M+ patients, 900+ hospitals/clinics across North America** — largest in the space
- **Strengths:** Real scale, real network effects, polished UX, multiple growth channels
- **Weaknesses:** Mixed consumer reviews (billing complaints, customer-service issues, hard-to-cancel subscriptions), grew primarily via B2B2C
- **Important caveat:** Primary onboarding path is still hospital-driven. To get historical exams imported automatically, patients connect through a participating hospital. Self-upload exists but is the secondary path.
- **Verdict:** The dominant player by far, but its growth proves B2B2C beat pure DTC

### 3. PostDICOM

- **URL:** https://www.postdicom.com/
- **Pricing:** $79.99/$149.99/$499.99 per month (Lite/Pro/Advanced)
- **Storage:** 100 GB / 500 GB / 2,000 GB
- **Viewer:** Browser-based HTML5 viewer
- **Sharing:** Link sharing with password
- **Patient tier:** Has a "Patients" solution page but pricing is identical to clinic tiers
- **Verdict:** **Disqualified as consumer product** — pricing is clinic/practice level (~$1,000+/year minimum). Calling itself "for patients" is marketing; the economics are B2B.

### 4. Purview Image / Purview Patient

- **URL:** https://www.purview.net/
- **Pricing:** Starts at $3,000/year + setup fees
- **Verdict:** **Disqualified as consumer product** — explicit enterprise pricing and onboarding model.

### 5. Medicai

- **URL:** https://www.medicai.io/
- **Model:** Free DICOM uploader for sending files to doctors/clinics
- **Verdict:** **Partially qualifying** — closer to "WeTransfer for DICOM" than a persistent personal library. Free but not designed for ongoing storage.

### 6. DICOM Library

- **URL:** https://www.dicomlibrary.com/
- **Model:** Free anonymized DICOM sharing for educational/scientific purposes
- **Verdict:** **Disqualified as personal cloud** — purpose is anonymized teaching/research sharing, not personal medical record keeping.

---

## Adjacent / Disqualified Services Worth Noting

### CarePassport

Patient-engagement platform with DICOM viewing, but predominantly hospital-integrated. Not pure self-signup.

### PicnicHealth

Different model — collects medical records and imaging on the patient's behalf via authorized release forms. Patient doesn't upload DICOM directly; PicnicHealth retrieves from providers. Closer to "PicnicHealth for everything" than DICOM-specific. Real funding and traction, but a different category.

### LifeImage

Acquired by Intelerad in 2022. Patient Connect Portal launched 2020 was free but operated within a B2B2C model. Now part of Intelerad's enterprise stack.

### Hospital Patient Portals (MyChart, FollowMyHealth, Cerner HealtheLife, Epic-based portals)

Disqualified per the prompt — access is granted by provider, not self-signupable.

---

## Why Hasn't This Space Broken Through at Consumer Scale?

Synthesizing across reviews, market analyses, and product positioning:

1. **No compelling triggering event for most consumers.**
   Most people don't have medical imaging often enough to justify a subscription. The active "I need to organize my imaging" moment is rare and short-lived.

2. **The CD problem partially solved itself via portals.**
   Hospital patient portals (MyChart et al.) increasingly provide electronic access to imaging, even if clunky. The acute pain of physical CDs is slowly disappearing.

3. **Pricing-to-frequency mismatch.**
   $30–50/year for a service you might use once or twice a year feels expensive. The value density per use is high (compared to streaming media), but the use frequency is low.

4. **Sharing is the killer feature, but recipient acceptance is uneven.**
   Doctors don't always accept arbitrary share links. Receiving providers want imaging in their PACS, not a third-party portal. The marketing of "share with any doctor" oversells the operational reality.

5. **Trust and mindshare gap.**
   "Where do I keep my medical imaging?" isn't a question most patients ask themselves. There's no cultural mental model for "your medical imaging library" the way there is for photos or documents. The category itself is undefined in consumers' minds.

6. **B2B2C is structurally easier.**
   PocketHealth's 2M users came primarily from hospitals onboarding patients during their visits. Pure DTC requires solving the awareness problem from scratch, which is expensive.

7. **Compliance complications with sharing.**
   HIPAA and BAA requirements make patient-to-provider sharing harder than the marketing implies. Real workflow integration is a B2B sale.

8. **Imaging files are large; storage cost models are constrained.**
   Unlike consumer photo storage (where Google Photos can absorb the cost), DICOM files are larger and harder to monetize at consumer prices. PocketHealth gets around this partly by passing storage cost through hospital partnerships.

---

## Implications for myradone Strategy

**The space is not empty, but it's also not "won."** PocketHealth dominates by scale but grew B2B2C. MyMedicalImages is the closest pure-DTC analog and remains small.

A pure-DTC entrant in 2026 has to confront:

- **Awareness problem:** No category of "medical imaging library" exists in consumer minds. PocketHealth used hospital partnerships to short-circuit this. A pure DTC play needs an alternative awareness wedge — viral, content-driven, partnership-driven (advocacy groups, cancer organizations, etc.), or via a different gateway product (e.g., a free best-in-class viewer that earns trust before asking for storage payments).
- **Frequency problem:** Most users won't return often. Either the product makes itself useful between imaging events (notes, reports, longitudinal tracking, education) or it accepts a low-frequency relationship and prices accordingly.
- **Trust problem:** Patient-facing medical data startups have historically struggled to build trust at scale. Brand and design quality matter disproportionately.
- **Sharing problem:** "Send your doctor a link" sounds easy but the receiving doctor's workflow rarely cooperates. Real sharing value-add requires DICOMweb-compatible integrations on the receiving side, or a viewer the doctor will accept opening.

**Where myradone might differentiate:**

- **Quality of the viewer.** Most existing services have functional but uninspired viewers. myradone's Darkroom-lineage viewer is genuinely better.
- **Consumer brand and design.** Existing players feel utility-grade. myRadOne's positioning (Google Photos lineage for the library, Darkroom for the viewer) is more deliberate.
- **The web-first cloud architecture from day one.** Most competitors have technical legacy from earlier eras (PocketHealth started in 2016, MyMedicalImages in 2017). A modern DICOMweb + HTJ2K cloud architecture (per ADR 004) is meaningfully better engineering.
- **No subscription friction at the basic tier.** PocketHealth's review complaints concentrate on billing/cancellation. A genuinely good free tier with no surprise charges is a competitive opening.

**Key insight:** The question isn't whether the space is fresh (it isn't). The question is whether the existing players have actually delivered the consumer experience the category deserves. Based on the review evidence, they haven't — the category is occupied but not satisfied.

---

## Sources

- [PocketHealth Pricing](https://www.pockethealth.com/patients/pricing/)
- [PocketHealth on Wikipedia and FeaturedCustomers](https://www.featuredcustomers.com/vendor/pockethealth)
- [PocketHealth BBB reviews showing billing/cancellation complaints](https://www.bbb.org/ca/on/toronto/profile/medical-records/pockethealth-0107-1379955/customer-reviews)
- [MyMedicalImages.com](https://mymedicalimages.com/)
- [MyMedicalImages help — uploading DICOM](https://mymedicalimages.com/help/uploading-dicom-images/)
- [MyMedicalImages partnership with OrthoNOW](https://www.orthonowcare.com/mymedicalimages-announces-strategic-partnership-with-orthonow/)
- [MyMedicalImages partnership with Pioneer Medical Foundation](https://www.prnewswire.com/news-releases/mymedicalimagescom-partners-with-pioneer-medical-foundation-302112459.html)
- [PostDICOM Pricing](https://www.postdicom.com/en/pricing)
- [PostDICOM Patients page](https://www.postdicom.com/en/solutions/patients)
- [Purview Image Pricing](https://www.purview.net/pricing)
- [Medicai Free Send](https://www.medicai.io/send-medical-imaging-for-free)
- [DICOM Library](https://www.dicomlibrary.com/)
- [CarePassport](https://carepassport.com/)
- [PicnicHealth](https://picnichealth.com/)
- [Life Image (Wikipedia)](https://en.wikipedia.org/wiki/Life_Image)
- [Life Image Patient Connect Portal launch (2020)](https://www.businesswire.com/news/home/20200519005165/en/)
- [Healthcare cloud PACS market analysis (Grand View Research)](https://www.grandviewresearch.com/industry-analysis/healthcare-cloud-picture-archiving-communications-system-market)
- [Cloud-based imaging market trends (AuntMinnie)](https://www.auntminnie.com/imaging-informatics/enterprise-imaging/article/15707322/cloudbased-imaging-the-new-catalyst-for-healthcare-transformation)
