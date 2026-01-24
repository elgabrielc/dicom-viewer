# DICOM CT Viewer - Claude Code Context

## Project Overview

A web-based DICOM medical imaging viewer built by Divergent Health Technologies.

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

**Status**: Benchmarking mode - researching technology options before implementation

### Research Completed
1. **Onshape** - Browser-first, custom WebGL, Parasolid kernel in cloud
2. **Autodesk Fusion 360** - Desktop-first (C++/Qt), Three.js r71 web viewer (frozen)
3. **3D Slicer / vtk.js** - VTK/ITK desktop, vtk.js for web, VolView reference app

### Technology Decision Pending
- **Option A**: vtk.js - Built-in volume rendering, CVR, medical presets
- **Option B**: Three.js + custom shaders - Smaller bundle, more control
- **Option C**: Raw WebGL - Maximum performance, most complex

See `3D_VOLUME_RENDERING_PLAN.md` for full details.

## Technical Notes

### DICOM Tags Used
- (0028,0010) Rows, (0028,0011) Columns
- (0028,0100) Bits Allocated, (0028,0103) Pixel Representation
- (0028,1050) Window Center, (0028,1051) Window Width
- (0028,1052) Rescale Intercept, (0028,1053) Rescale Slope
- (0002,0010) Transfer Syntax UID
- (7FE0,0010) Pixel Data

### Window/Level
Default values if not in DICOM: Window Center = 40, Window Width = 400 (typical CT)

## Development Notes

- Browser requirement: Chrome 86+ or Edge 86+ (File System Access API)
- Node dependencies only needed for OpenJPEG codec (`npm install` then copy to static/js/)
- Python venv for Flask server (`pip install -r requirements.txt`)

## Past Decisions

- Chose vanilla JS over React/Vue for simplicity and learning
- Client-side processing to keep medical data in browser (privacy)
- Dark theme optimized for radiologist viewing environment
