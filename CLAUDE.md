# DICOM Medical Imaging Viewer - Claude Code Context

## Project Overview

A web-based DICOM medical imaging viewer built by Divergent Health Technologies.
Supports multiple modalities: CT, MRI, and other imaging types.

- **Repository**: https://github.com/elgabrielc/dicom-viewer
- **Stack**: Flask (Python) backend, vanilla JavaScript frontend
- **Primary Workflow**: Client-side DICOM processing via File System Access API (Chrome/Edge)

## Workspace Structure

```
claude 0/                    # Workspace - drop files here for Claude to process
├── dicom-viewer/            # Git repo - organized, version-controlled project
├── test-data-mri-1/         # Test DICOM data (used by Flask test mode)
├── test-data-mri-2/         # Additional test data
└── test-data-errors/        # Problem files for debugging
```

- **`claude 0/`** is a workspace/inbox where the user drops files
- **`dicom-viewer/`** is the organized project; Claude moves files here as appropriate
- When searching for docs or resources, check both locations
- Planning docs, bug tracking, and research live in `dicom-viewer/docs/planning/`

## Architecture

```
Browser (index.html)
├── dicom-parser (DICOM parsing)
├── jpeg-lossless-decoder-js (JPEG Lossless)
├── OpenJPEG WASM (JPEG 2000)
└── Canvas 2D (rendering)

Flask Server (app.py)
└── Static file serving only (primary workflow)
└── Optional server-side APIs (alternative workflow)
```

## Key Files

- `docs/index.html` - Main SPA with all client-side logic
- `docs/css/style.css` - All styling (dark theme for medical imaging)
- `docs/js/` - OpenJPEG WASM decoder files
- `docs/sample/` - Sample CT scan for demo (188 slices, anonymized)
- `app.py` - Flask server (serves docs/, provides test mode API)

**Single source of truth**: All web assets live in `docs/`. Flask serves from there. GitHub Pages serves from there. No duplication.

## Supported Transfer Syntaxes

| Format | Status | Decoder |
|--------|--------|---------|
| Uncompressed (Implicit/Explicit VR) | Supported | Native TypedArray |
| JPEG Lossless | Supported | jpeg-lossless-decoder-js |
| JPEG Baseline/Extended | Supported | Browser native |
| JPEG 2000 | Supported | OpenJPEG WASM |
| RLE, JPEG-LS, MPEG | Not Supported | - |

## Current Work: 3D Volume Rendering

**Status**: Benchmarking complete, ready for implementation

### Research Completed
1. **Onshape** - Browser-first, custom WebGL, Parasolid kernel in cloud
2. **Autodesk Fusion 360** - Desktop-first (C++/Qt), Three.js r71 web viewer (frozen)
3. **3D Slicer / vtk.js** - VTK/ITK desktop, vtk.js for web, VolView reference app
4. **Horos / OsiriX** - macOS desktop, VTK volume rendering, extensive CLUT/preset system

### Technology Decision: vtk.js
- **Rationale**: Industry standard (all major medical imaging apps use VTK); vtk.js is official web port
- **Bundle**: ~500KB (acceptable for medical imaging app)
- **Features**: Volume rendering, MIP, CVR, transfer functions, medical presets
- **Backing**: Kitware (NIH funded, active development)

### Next Steps
1. Add vtk.js to index.html
2. Implement volume stacking (slices → 3D array)
3. Basic ray-casting with preset transfer functions
4. View mode toggle (2D Slices / 3D Volume / MIP)

See [RESEARCH-3d-volume-rendering.md](docs/planning/RESEARCH-3d-volume-rendering.md) for architecture decisions, and `3D_VOLUME_RENDERING_PLAN.md` for implementation details.

## Technical Notes

### DICOM Tags Used

**Common (all modalities):**
- (0008,0060) Modality
- (0028,0010) Rows, (0028,0011) Columns
- (0028,0100) Bits Allocated, (0028,0103) Pixel Representation
- (0028,1050) Window Center, (0028,1051) Window Width
- (0028,1052) Rescale Intercept, (0028,1053) Rescale Slope
- (0002,0010) Transfer Syntax UID
- (7FE0,0010) Pixel Data

**MRI-specific:**
- (0018,0080) Repetition Time (TR)
- (0018,0081) Echo Time (TE)
- (0018,1314) Flip Angle
- (0018,0087) Magnetic Field Strength
- (0018,1030) Protocol Name
- (0018,0024) Sequence Name

### Window/Level (Modality-Aware)

| Modality | Default Center | Default Width | Notes |
|----------|---------------|---------------|-------|
| CT | 40 | 400 | Hounsfield units (soft tissue) |
| MR | Auto-calculated | Auto-calculated | Based on pixel statistics |
| US | 128 | 256 | 8-bit typical |
| CR/DX/MG | 2048 | 4096 | 12-bit typical |

For MRI without window/level in DICOM, auto-calculation uses pixel data statistics.

## Algorithm Documentation

### MRI Window/Level Auto-Calculation

**When Used**: For MR, PT (PET), and NM (Nuclear Medicine) modalities when no Window Center (0028,1050) or Window Width (0028,1051) is present in the DICOM file.

**Function**: `calculateAutoWindowLevel(pixelData, rescaleSlope, rescaleIntercept)` (line ~1379)

**Algorithm**:
1. **Sampling**: Samples every 10th pixel for performance (pixelData.length / 10 samples)
2. **Statistics**: Computes min, max, and mean of rescaled values (`value = pixel * rescaleSlope + rescaleIntercept`)
3. **Window Calculation**:
   - `windowCenter = mean` (center at the mean pixel value)
   - `windowWidth = range * 0.9` (90% of min-max range to reduce outlier influence)
   - Minimum width of 1 to avoid division by zero
4. **Returns**: `{windowCenter, windowWidth, isBlank}` (all values rounded to integers)

**Rationale**: MRI pixel values are arbitrary signal intensities (unlike CT Hounsfield units), so there are no standard defaults. This percentile-inspired approach centers the display range on the actual data while trimming 10% of the range to reduce outlier influence.

### Blank Slice Detection

**Purpose**: Detect and handle uniform/padding slices that contain no useful image data. Common in MPR (Multi-Planar Reconstruction) datasets where padding slices fill the volume.

**Functions**:
- `isBlankSlice(pixelData, rescaleSlope, rescaleIntercept)` (line ~1414) - Detection only
- `calculateAutoWindowLevel()` also returns `isBlank` flag (line ~1377)
- `displayBlankSlice(rows, cols)` (line ~1434) - Renders black canvas

**Detection Criteria**:
- Samples every 10th pixel (same as W/L calculation)
- Computes `range = max - min` of rescaled values
- **Threshold**: `range < 1` means blank (all sampled pixels have essentially the same value)
- `isBlankSlice()` uses early exit optimization: returns `false` immediately when `max - min >= 1`

**Behavior When Detected**:
1. `renderDicom()` checks `isBlankSlice()` before W/L calculations (line ~1815)
2. If blank, calls `displayBlankSlice()` which fills canvas with solid black (`#000`)
3. Returns `{..., isBlank: true}` in the render result
4. UI shows reduced metadata (no W/L values, just slice position and size)
5. On initial load, auto-advances past blank slices (up to 50) to find displayable content (line ~2727)

### Canvas Transform System

**State Object**: `state.viewTransform` (line ~203)
```javascript
viewTransform: { panX: 0, panY: 0, zoom: 1 }
```

**Coordinate System**:
- Origin: Center of canvas (via `transformOrigin: 'center center'`)
- panX/panY: Offset in CSS pixels from center (positive = right/down)
- zoom: Scale factor (1 = 100%, range: 0.1 to 10)

**Transform Application**: `applyViewTransform()` (line ~2119)
```javascript
canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
canvas.style.transformOrigin = 'center center';
```
- **Order**: Translation applied first, then scale (in CSS transform syntax, rightmost applies first, but `translate` followed by `scale` means translate in pre-scaled coordinates)
- Same transform applied to measurement overlay canvas via `syncMeasurementCanvas()` (line ~604)

**Tool Interactions**:
- **Pan tool** (`handlePanDrag`, line ~2169): Adds mouse delta directly to panX/panY
- **Zoom tool** (`handleZoomDrag`, line ~2178): Adjusts zoom based on vertical drag (sensitivity: 0.005 per pixel)
- **Scroll wheel in zoom mode** (line ~2550): Discrete zoom steps (+/- 0.1 per scroll tick)
- **Reset** (`resetView`, line ~2188): Sets `{panX: 0, panY: 0, zoom: 1}`

**Coordinate Conversion**: `screenToImage(screenX, screenY)` (line ~344)
- Converts viewport coordinates to image pixel coordinates
- Accounts for: canvas bounding rect, CSS display scaling, pan offset, and zoom level
- Used by measurement tool for accurate distance calculations

## Development Notes

- Browser requirement: Chrome 86+ or Edge 86+ (File System Access API)
- Python venv for Flask server (`pip install -r requirements.txt`)
- Flask serves from `docs/` - same files as GitHub Pages
- To run locally: `python app.py` then open `http://127.0.0.1:5001/`

## Testing

- **Run tests**: `npx playwright test`
- **Test mode URL**: `http://127.0.0.1:5001/?test` (auto-loads test data)
- **Test docs**: `docs/TESTING.md`
- **Global process**: `~/.claude/TESTING_PROCESS.md`

After each test run, apply continuous improvement: analyze results, strengthen tests, add missing coverage.

## Feature Inventory

**CRITICAL: Do not remove any of these features without explicit discussion.**

### Library View
- [x] Drag-and-drop folder loading
- [x] **"Load Sample CT/MRI" buttons** - lets new users try the viewer without their own data
- [x] Study/series table with patient info, date, description, modality
- [x] Expandable rows to show series within studies
- [x] Warning icons for unsupported compression formats
- [x] **Notes system** - Descriptions and timestamped comments on studies/series (localStorage persistence)

### Image Viewer
- [x] **Viewing toolbar** - W/L, Pan, Zoom, Measure, Reset buttons
- [x] **Measurement tool** - Click-drag distance measurement with PixelSpacing calibration. See [RESEARCH-measurement-tool.md](docs/planning/RESEARCH-measurement-tool.md) for benchmarking details
- [x] **Keyboard shortcuts** - W, P, Z, M, R for tools; arrows for slices; Esc to exit
- [x] **Instant tooltips** showing keyboard shortcuts on hover
- [x] Slice navigation (scroll wheel, slider, arrow buttons)
- [x] Series list sidebar
- [x] Metadata panel (slice info, MRI parameters)

### Technical Features
- [x] Modality-aware window/level defaults (CT, MR, US, etc.)
- [x] Auto-calculated W/L for MRI when not in DICOM
- [x] Blank slice detection
- [x] JPEG Lossless, JPEG 2000, uncompressed support
- [x] Test mode (`?test` URL parameter) for automated testing

---

## Documentation Requirements

- **Keep SITEMAP.md accurate.** Update `docs/planning/SITEMAP.md` whenever project structure changes (new files, moved files, renamed folders). It's the reference for understanding the project.
- **Track bugs in BUGS.md.** Document in `docs/planning/BUGS.md` with full context:
  - How the bug was encountered (symptoms, reproduction steps)
  - Root cause analysis (why it happened)
  - Solution implemented (what was changed)
  - Why that solution was chosen (alternatives considered, tradeoffs)
  - Prevention control added (test, code guideline, or check to prevent recurrence)

## Git Workflow Controls

- **Never push without explicit permission.** Commit when asked, but wait for explicit "push" instruction.
- **Review deletions before committing.** Any deletion of 3+ lines should be justified.
- **Check Feature Inventory before removing code.** If it's listed above, discuss first.

---

## Deployment Modes

The same codebase serves two different purposes:

| Mode | URL | Purpose | Audience |
|------|-----|---------|----------|
| **Demo site** | elgabrielc.github.io/dicom-viewer | Showcase features, let people try it | Public, anonymous visitors |
| **Personal app** | localhost:5001 (or self-hosted) | Actual medical image viewing | Individual user with their own data |

### Key Differences

| Behavior | Demo Site | Personal App |
|----------|-----------|--------------|
| Notes persistence | Disabled (stateless) | Enabled (localStorage) |
| Sample scans | Primary use case | Convenience for testing |
| User data | None expected | User's own DICOM files |
| Session length | Brief exploration | Extended viewing sessions |

### Design Principle

**Demo site = stateless showcase.** No data persists between visits. Every visitor gets a fresh experience. This is intentional:
- No accumulated cruft from random visitors
- No privacy concerns about shared state
- Always shows the app in its clean state

**Personal app = full-featured tool.** All features enabled, data persists locally. The user owns their environment.

### Implementation

Detection is via hostname:
```javascript
function shouldPersistNotes() {
    return !window.location.hostname.endsWith('github.io');
}
```

When adding features that persist state, check `shouldPersistNotes()` or add similar guards.

---

## Past Decisions

- Chose vanilla JS over React/Vue for simplicity and learning
- Client-side processing to keep medical data in browser (privacy)
- Dark theme optimized for radiologist viewing environment
- Single source of truth in docs/ (consolidation done 2026-01-28)
