# DICOM Medical Imaging Viewer

[![CI](https://github.com/elgabrielc/dicom-viewer/actions/workflows/pr-validate.yml/badge.svg)](https://github.com/elgabrielc/dicom-viewer/actions/workflows/pr-validate.yml)

**[Try it live](https://elgabrielc.github.io/dicom-viewer/)** | **By [Divergent Health Technologies](https://divergent.health/)**

A web-based DICOM medical image viewer for CT and MRI studies. Built with Flask and vanilla JavaScript, all processing happens client-side - your medical images never leave your machine.

## Features

- **Drag-and-drop folder loading** - Drop a folder containing DICOM files to automatically organize by study/series
- **Sample scans included** - Click "CT Scan" or "MRI Scan" to load demo data instantly
- **Multi-series support** - View multiple series within a study, organized hierarchically
- **Slice navigation** - Mouse wheel, keyboard arrows, or slider
- **Window/Level adjustment** - Drag to adjust brightness and contrast
- **Pan and Zoom** - Navigate large images with pan and zoom tools
- **Measurement tool** - Measure distances in millimeters using pixel spacing metadata
- **Keyboard shortcuts** - W (window/level), P (pan), Z (zoom), R (reset)
- **Notes** - Add descriptions and timestamped comments to studies and series (persisted to localStorage)
- **Multiple compression formats** - Uncompressed, JPEG Lossless, JPEG Baseline/Extended, JPEG 2000
- **Modality-aware defaults** - Automatic W/L presets for CT, MR, and other modalities
- **Client-side processing** - All DICOM parsing happens in the browser

## Supported DICOM Transfer Syntaxes

| Format | Status |
|--------|--------|
| Implicit VR Little Endian | Supported |
| Explicit VR Little Endian | Supported |
| Explicit VR Big Endian | Supported |
| JPEG Baseline (8-bit) | Supported |
| JPEG Extended (12-bit) | Supported |
| JPEG Lossless | Supported |
| JPEG 2000 (Lossless/Lossy) | Supported |
| RLE Lossless | Not Supported |
| JPEG-LS | Not Supported |

## Quick Start

### Option 1: Static file server (simplest)

```bash
cd dicom-viewer/docs
python3 -m http.server 8000
```

Open `http://localhost:8000` in Chrome or Edge.

### Option 2: Flask server (for development/testing)

```bash
cd dicom-viewer
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5001` in Chrome or Edge.

## Usage

1. **Load DICOM files**: Drag and drop a folder onto the drop zone, or click "CT Scan" / "MRI Scan" for samples
2. **Browse studies**: The library shows all detected studies organized by patient
3. **View series**: Click a series row to open the viewer
4. **Navigate**: Scroll wheel or arrow keys to move through slices
5. **Adjust display**: Drag with W/L tool to adjust brightness/contrast
6. **Measure**: Select the measure tool and click two points to measure distance

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| W | Window/Level tool |
| P | Pan tool |
| Z | Zoom tool |
| R | Reset view |
| Arrow keys | Navigate slices |
| Esc | Return to library |

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome 86+ | Full support |
| Edge 86+ | Full support |
| Firefox | Not supported (no File System Access API) |
| Safari | Not supported (no File System Access API) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                 │
├─────────────────────────────────────────────────────────────────┤
│  docs/index.html (single-page application)                      │
│  ├── Library View (study/series browser)                        │
│  ├── Viewer View (slice display + tools)                        │
│  └── Inline JavaScript                                          │
│      ├── dicom-parser (DICOM file parsing)                      │
│      ├── jpeg-lossless-decoder-js (JPEG Lossless)               │
│      └── OpenJPEG WASM (JPEG 2000)                              │
├─────────────────────────────────────────────────────────────────┤
│  File System Access API                                         │
│  └── Drag-and-drop folder access (Chrome/Edge only)             │
└─────────────────────────────────────────────────────────────────┘
         │
         │ HTTP (static files only)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Any HTTP server (Flask, Python http.server, nginx, etc.)       │
│  └── Serves static files from docs/                             │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
dicom-viewer/
├── app.py                  # Flask server (static files + test API)
├── requirements.txt        # Python: flask, pydicom
├── package.json            # Node: OpenJPEG codec, Playwright
├── playwright.config.js    # E2E test configuration
│
├── docs/                   # Static frontend (served as-is)
│   ├── index.html          # Main application (single-page app)
│   ├── css/style.css       # Styles
│   ├── js/                 # JavaScript + WASM codecs
│   ├── sample/             # Demo CT scan
│   └── sample-mri/         # Demo MRI scan
│
├── tests/                  # Playwright E2E tests
│   └── viewing-tools.spec.js
│
├── CLAUDE.md               # Technical documentation
├── USER_GUIDE.md           # End-user documentation
└── 3D_VOLUME_RENDERING_PLAN.md  # Future 3D features
```

## Running Tests

```bash
npm install
npx playwright install chromium
npx playwright test
```

Tests automatically start the Flask server and use test data from `~/claude 0/test-data-mri-1` (configurable via `DICOM_TEST_DATA` environment variable).

## Future Plans

See [3D_VOLUME_RENDERING_PLAN.md](./3D_VOLUME_RENDERING_PLAN.md) for planned features:
- 3D volume rendering with vtk.js
- Maximum Intensity Projection (MIP)
- Multiplanar Reformation (MPR)

## License

MIT License - Copyright (c) 2026 Divergent Health Technologies

## About

Developed by Gabriel Casalduc at [Divergent Health Technologies](https://divergent.health/)
