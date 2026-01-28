# DICOM Medical Imaging Viewer - Claude Code Context

## Project Overview

A web-based DICOM medical imaging viewer built by Divergent Health Technologies.
Supports multiple modalities: CT, MRI, and other imaging types.

- **Repository**: https://github.com/elgabrielc/dicom-viewer
- **Stack**: Flask (Python) backend, vanilla JavaScript frontend
- **Primary Workflow**: Client-side DICOM processing via File System Access API (Chrome/Edge)

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

See `3D_VOLUME_RENDERING_PLAN.md` and `BENCHMARKING_RESEARCH.md` for full details.

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
- [ ] Drag-and-drop folder loading
- [ ] **"Load Sample CT Scan" button** - lets new users try the viewer without their own data
- [ ] Study/series table with patient info, date, description, modality
- [ ] Expandable rows to show series within studies
- [ ] Warning icons for unsupported compression formats

### Image Viewer
- [ ] **Viewing toolbar** - W/L, Pan, Zoom, Reset buttons
- [ ] **Keyboard shortcuts** - W, P, Z, R for tools; arrows for slices; Esc to exit
- [ ] **Instant tooltips** showing keyboard shortcuts on hover
- [ ] Slice navigation (scroll wheel, slider, arrow buttons)
- [ ] Series list sidebar
- [ ] Metadata panel (slice info, MRI parameters)

### Technical Features
- [ ] Modality-aware window/level defaults (CT, MR, US, etc.)
- [ ] Auto-calculated W/L for MRI when not in DICOM
- [ ] Blank slice detection
- [ ] JPEG Lossless, JPEG 2000, uncompressed support
- [ ] Test mode (`?test` URL parameter) for automated testing

---

## Past Decisions

- Chose vanilla JS over React/Vue for simplicity and learning
- Client-side processing to keep medical data in browser (privacy)
- Dark theme optimized for radiologist viewing environment
- Single source of truth in docs/ (consolidation done 2026-01-28)
