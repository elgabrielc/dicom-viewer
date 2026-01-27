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

- `templates/index.html` - Main SPA with all client-side logic (~1200 lines)
- `app.py` - Flask server with optional DICOM processing APIs
- `static/css/style.css` - All styling (dark theme for medical imaging)
- `static/js/` - OpenJPEG WASM decoder files

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
- Node dependencies only needed for OpenJPEG codec (`npm install` then copy to static/js/)
- Python venv for Flask server (`pip install -r requirements.txt`)

## Testing

- **Run tests**: `npx playwright test`
- **Test mode URL**: `http://127.0.0.1:5001/?test` (auto-loads test data)
- **Test docs**: `docs/TESTING.md`
- **Global process**: `~/.claude/TESTING_PROCESS.md`

After each test run, apply continuous improvement: analyze results, strengthen tests, add missing coverage.

## Past Decisions

- Chose vanilla JS over React/Vue for simplicity and learning
- Client-side processing to keep medical data in browser (privacy)
- Dark theme optimized for radiologist viewing environment
