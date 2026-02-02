# DICOM Viewer Measurement Tool Research

Benchmarking how professional medical imaging viewers implement measurement tools.

## Implementation Status

**Status**: Implemented (2026-02-01, commit b75f15e)

**Implementation Details**:
- **Location**: `docs/index.html` - measurement tool functions
- **Interaction**: Click-drag (matching Ambra/Horos pattern)
- **Calibration**: Uses PixelSpacing DICOM tag (0028,0030)
- **Related Docs**: [CLAUDE.md Feature Inventory](../../CLAUDE.md#feature-inventory), [SITEMAP.md](SITEMAP.md#current-work-in-progress)

---

## Viewers Researched

| Viewer | Vendor | Type | FDA Cleared |
|--------|--------|------|-------------|
| Horos | Open Source | Desktop (macOS) | No |
| NilRead | NilRead | Desktop | Yes |
| Ambra | Intelerad | Web (zero-footprint) | Yes (K231360) |
| Sectra UniView | Sectra AB | Web (zero-footprint) | Yes (K193054) |

---

# Sectra UniView

## Overview

Sectra UniView is a web-based, zero-footprint universal viewer from Sectra AB (Sweden). It integrates with Epic MyChart and other EHR systems. Primarily intended for reference viewing, but can be used for diagnostic review (except mammography) on stationary platforms.

## Measurement Tools

### Editable (Create/Modify/Delete)
- Arrow
- Angle
- Distance
- ROI Area

### View-Only
CTR, Circle, Curved Distance, Ellipse, ETDRS Grid, Histogram Circle, Line, NM ROI Area, NM ROI Circle, Orthogonal Distance, PDT, Polyline, Ratio, Rectangle, ROI Circle, Spine Labeling, Text, Text Mark

## Interaction Model

| Tool | Interaction |
|------|-------------|
| **Distance** | Click-click (two separate clicks) |
| **Angle** | Click-click-click (three clicks) |

**Steps for Distance:**
1. Select Distance tool (from right-click menu or toolbar)
2. Left-click at first point
3. Move mouse to second point
4. Left-click to complete

**Note:** Measurements made by physicians are visible only during viewing session and are NOT saved.

## Calibration

Public documentation does not detail pixel spacing handling. FDA 510(k) testing confirms measurement accuracy was validated against reference standards for both SVS and DICOM formats.

## Regulatory

- **FDA 510(k)**: K193054, K232208
- **Intended Use**: Display and manipulation of medical images
- **Cleared for**: Radiology, mammography (with restrictions), pathology, orthopedic planning

---

# Ambra Health (Intelerad)

## Executive Summary

Ambra Health (now part of Intelerad) provides a web-based zero-footprint DICOM viewer with measurement capabilities. While the viewer is FDA 510(k) cleared for diagnostic use, publicly available documentation lacks detailed technical specifications about calibration and measurement accuracy handling. This research synthesizes findings from multiple user guides and related Intelerad/InteleViewer documentation.

---

## 1. Calibration and Pixel Spacing

### What We Know

**From InteleViewer documentation (Ambra's parent company Intelerad):**

InteleViewer uses three DICOM attributes for calibration:

| Attribute | DICOM Tag | Purpose |
|-----------|-----------|---------|
| **Imager Pixel Spacing (IPS)** | (0018,1164) | Distance between pixel centers on imager plate |
| **Pixel Spacing (PS)** | (0028,0030) | Physical distance in patient between pixel centers |
| **Estimated Radiographic Magnification Factor (ERMF)** | (0018,1114) | Calibration factor for converting to anatomical units |

**Calibration Logic:**
1. If valid IPS and ERMF exist, compute true physical size automatically
2. If IPS exists but ERMF is missing, use PS value instead
3. IPS is considered valid only when IPS > PS

**From Ambra-specific documentation:**
- The Ambra user guides do NOT document how pixel spacing is handled
- No mention of DICOM tag extraction for calibration
- Likely inherits behavior from InteleViewer/Intelerad platform

### What We Don't Know
- Specific implementation details for Ambra's web viewer
- Whether the web viewer handles calibration differently than desktop InteleViewer
- Priority order when multiple spacing values are present

---

## 2. Uncalibrated Images

### InteleViewer Behavior (Likely Same for Ambra)

> "If there is insufficient DICOM data to compute the true physical size for the measurements, InteleViewer does not calibrate the measurements."

**Options for uncalibrated images:**
- Measurements display **without calibration** (implied: in pixels or with warning)
- Users can use the **Calibrate Measurement tool** to manually calibrate
- System displays message: **"Measurements are uncertain"** when data is suboptimal

### Manual Calibration
- Draw a reference line over a known distance
- Enter the actual physical measurement
- System uses this to compute pixel-to-physical conversion

### Clinical Warning Display
- On-screen messages indicate calibration status
- Tooltip on hover explains which DICOM attributes were used

---

## 3. Interaction Model

### Measure Line Tool

| Aspect | Ambra Implementation |
|--------|---------------------|
| **Interaction** | Click-and-drag (single continuous gesture) |
| **Documentation** | "Click and drag on an image to make a linear measurement" |
| **Start** | Press mouse button at start point |
| **End** | Drag to endpoint, release mouse button |
| **Editing** | Move cursor to endpoints to resize/reangle; move to middle to relocate |
| **Annotation** | Double-click measurement to add text |

### Angle Tool
- **Interaction**: Three separate clicks (click-click-click)
- **Documentation**: "Select three points using the left mouse button. The angle at the middle point will be measured and displayed."

### Other Measurement Tools
- **Rectangle/Ellipse**: Click to create, dimensions calculated automatically
- **Radius**: Draw circle, radius calculated automatically
- **Cobb Angle**: Specialized angle for spinal curvature

---

## 4. Display Format

### Units
| Measurement Range | Unit Displayed |
|-------------------|----------------|
| < 100 mm | **Millimeters (mm)** |
| >= 100 mm | **Centimeters (cm)** |

### Precision
- **2 decimal places** observed in screenshots (e.g., "4.14 cm", "131.45 degrees")

### Label Position
- **Linear measurements**: Label appears near endpoint of line
- **Angles**: Label appears at vertex (middle point)
- **Location**: Bottom corner of viewport shows corresponding length

### Additional Display Features
- Numbered measurement lines (1, 2, 3...)
- Ratio between multiple measurements displayed automatically
- Center point indicator on lines
- Show/hide annotation toggle available

---

## 5. Clinical Warnings and Regulatory

### FDA 510(k) Clearance
- **Submission**: K231360 (May 2023)
- **Classification**: 21 CFR 892.2050 (Medical image management)
- **Class**: II (Product code LLZ)

### Documented Limitations
1. "Lossy compressed mammographic images and digitized film screen images must not be reviewed for primary diagnosis"
2. "Mammographic images may only be viewed using cleared monitors intended for mammography"
3. "Not intended for diagnostic use on mobile devices"

### Measurement-Specific Warnings
- **"Measurements are uncertain"** message when calibration data is suboptimal
- Hover tooltip explains which DICOM attributes were used
- **No explicit warnings** about measurement accuracy in user guides

### Compliance
- HIPAA compliant
- 21 CFR Part 11 compliant
- Considered "Continuous Use" device

---

## 6. Comparison with Other Viewers

| Feature | Horos | NilRead | Ambra | Sectra UniView |
|---------|-------|---------|-------|----------------|
| **Calibration source** | Pixel Spacing (0028,0030) | Pixel Spacing + ImagerPixelSpacing | IPS + PS + ERMF | Not documented |
| **Uncalibrated fallback** | Show in pixels | Hide measurements | "Measurements are uncertain" | Not documented |
| **Manual recalibration** | Yes, per-ROI | Yes, dedicated tool | Yes, Calibrate tool | Not documented |
| **Interaction** | Click-drag | Click-drag | Click-drag | Click-click |
| **Units** | cm, µm, px | Configurable | mm/cm automatic | Not documented |
| **Precision** | Variable | Configurable | 2 decimal places | Not documented |
| **Persistence** | Saved | Saved | Saved | NOT saved (physician view) |

---

## 7. Key Findings for Implementation

### Architecture Decisions Worth Noting

1. **Automatic unit switching** at 100mm threshold (mm → cm)
2. **Multiple DICOM attribute fallback** (IPS → PS with ERMF consideration)
3. **Validity check**: IPS > PS required for IPS to be used
4. **Visual warning system** with tooltip explanation
5. **Manual calibration** as fallback for uncalibrated images
6. **Ratio display** when multiple measurements exist

### Gaps in Documentation

The publicly available Ambra documentation does not address:
- Exact algorithm for measurement calculation
- Handling of anisotropic pixels (different row/column spacing)
- Behavior when DICOM tags are malformed
- Precision/rounding rules
- Persistence format for measurements (DICOM SR, GSPS, proprietary)

---

## Sources

### Ambra / Intelerad
- [InteleViewer Measurement Calibration Documentation](https://inteleviewer.documentation.intelerad.com/iv-help/PACS-5-1-1-P171/en/Content/Topics/IV_Measurement_Calibration.html)
- [InteleViewer Measuring Straight Lines](https://inteleviewer.documentation.intelerad.com/iv-help/PACS-5-4-1-P2/en/Content/Topics/IV_Images_StraightLines_Measuring.html)
- [FDA 510(k) K231360 - Ambra PACS](https://www.accessdata.fda.gov/cdrh_docs/pdf23/K231360.pdf)
- [Johns Hopkins Ambra Viewer Guide](https://ambra-hosted.s3.amazonaws.com/JohnsHopkins+Ambra+Viewer+Guide.pdf)
- [Cimar UK Ambra Viewer Guide (2017)](http://www.cimaruk.co.uk/Cimar_Tech_Support_Documents/2017/Cimar-Ambra-Viewer-Guide-January-2017-1.pdf)
- [Ambra Gateway DICOM Conformance Statement](https://www.intelerad.com/wp-content/uploads/2022/04/Ambra-Gateway-DICOM-Conformance-Statement.pdf)

### Sectra
- [Sectra UniView Product Page](https://medical.sectra.com/product/sectra-uniview/)
- [Sectra UniView Users Guide (Kettering Health)](http://wp.ketteringhealth.org/knews/wp-content/uploads/2020/01/Sectra-Uniview-Users-Guide.pdf)
- [Sectra IDS7 PACS General Users Guide](http://wp.ketteringhealth.org/knews/wp-content/uploads/2020/01/Sectra-IDS7-PACS-General-Users-Guide.pdf)
- [FDA 510(k) K193054 - Sectra](https://www.accessdata.fda.gov/cdrh_docs/reviews/K193054.pdf)
- [FDA 510(k) K232208 - Sectra](https://www.accessdata.fda.gov/cdrh_docs/reviews/K232208.pdf)
- [Sectra Resident Quick Reference (UNC)](https://rads.web.unc.edu/wp-content/uploads/sites/12234/2023/07/Sectra-Quick-Reference-1.0.pdf)
