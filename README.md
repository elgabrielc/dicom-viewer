# DICOM CT Viewer

**[Try it live](https://elgabrielc.github.io/dicom-viewer/)** | **By [Divergent Health Technologies](https://divergent.health/)**

A web-based DICOM medical image viewer built with Flask and vanilla JavaScript. This viewer allows radiologists and researchers to browse, view, and annotate CT imaging studies directly in the browser.

> **Demo available**: Click "Load Sample CT Scan" to view an anonymized brain CT with multiple series (axial, coronal, sagittal views).

## Features

- **Drag-and-drop DICOM folder loading** - Drop a folder containing DICOM files to automatically organize by study/series
- **Multi-series support** - View multiple series within a study, organized hierarchically
- **Slice navigation** - Scroll through slices using mouse wheel, keyboard arrows, or slider
- **Multiple compression formats** - Supports uncompressed, JPEG Lossless, JPEG Baseline/Extended, and JPEG 2000
- **Comments and annotations** - Add comments to studies and individual series
- **Client-side processing** - All DICOM parsing happens in the browser (files never leave your machine)

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

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
├─────────────────────────────────────────────────────────────────┤
│  index.html                                                     │
│  ├── Library View (study/series browser)                        │
│  ├── Viewer View (slice display + navigation)                   │
│  └── Inline JavaScript                                          │
│      ├── dicom-parser (DICOM file parsing)                      │
│      ├── jpeg-lossless-decoder-js (JPEG Lossless decoding)      │
│      └── OpenJPEG WASM (JPEG 2000 decoding)                     │
├─────────────────────────────────────────────────────────────────┤
│  File System Access API                                         │
│  └── Drag-and-drop folder access (Chrome/Edge)                  │
└─────────────────────────────────────────────────────────────────┘
         │
         │ HTTP (only for serving static files)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Flask Server (app.py)                        │
├─────────────────────────────────────────────────────────────────┤
│  Routes:                                                        │
│  ├── GET /              → Serve index.html                      │
│  ├── GET /static/*      → Serve CSS, JS, WASM files             │
│  └── POST /api/upload   → (Optional) Server-side file upload    │
└─────────────────────────────────────────────────────────────────┘
```

**Note:** The primary workflow uses client-side DICOM processing via the File System Access API. The Flask server primarily serves static files. Server-side APIs exist for alternative upload/processing workflows but are not used in the default drag-and-drop flow.

## Project Structure

```
dicom-viewer/
├── app.py                      # Flask server (serves static files + optional APIs)
├── requirements.txt            # Python dependencies (Flask, pydicom)
├── package.json                # Node dependencies (OpenJPEG codec)
│
├── templates/
│   └── index.html              # Main application (single-page app with inline JS)
│
├── static/
│   ├── css/
│   │   └── style.css           # All application styles
│   └── js/
│       ├── openjpegwasm.js     # OpenJPEG WASM loader
│       ├── openjpegwasm.wasm   # OpenJPEG WebAssembly binary
│       └── ...                 # Other codec files
│
├── uploads/                    # (Optional) Server-side uploaded files
├── venv/                       # Python virtual environment
└── node_modules/               # Node.js dependencies
```

## Setup

### Prerequisites
- Python 3.8+
- Node.js (for OpenJPEG codec installation)
- Chrome or Edge browser (for File System Access API support)

### Installation

1. **Clone the repository**
   ```bash
   cd dicom-viewer
   ```

2. **Create and activate a Python virtual environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Install Node dependencies (for JPEG 2000 support)**
   ```bash
   npm install
   ```

5. **Copy codec files to static directory**
   ```bash
   cp node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegwasm* static/js/
   ```

6. **Run the server**
   ```bash
   python app.py
   ```

7. **Open in browser**
   Navigate to `http://localhost:5001` in Chrome or Edge.

## Usage

1. **Load DICOM files**: Drag and drop a folder containing DICOM files onto the drop zone
2. **Browse studies**: The library view shows all detected studies organized by patient
3. **Expand series**: Click on a study row to see its series
4. **View images**: Click on a series to open the viewer
5. **Navigate slices**: Use mouse wheel, arrow keys, or the slider to scroll through slices
6. **Add comments**: Click "Add comment" on any study or series to annotate

## Browser Compatibility

- **Chrome 86+**: Full support (File System Access API)
- **Edge 86+**: Full support (File System Access API)
- **Firefox**: Not supported (no File System Access API)
- **Safari**: Not supported (no File System Access API)

## Technical Details

### DICOM Parsing
The viewer uses [dicom-parser](https://github.com/cornerstonejs/dicomParser) for parsing DICOM files in the browser. This library handles the complex DICOM file format including various Value Representations (VR) and transfer syntaxes.

### Image Decoding
- **Uncompressed**: Native TypedArray operations
- **JPEG Lossless**: [jpeg-lossless-decoder-js](https://github.com/cornerstonejs/jpeg-lossless-decoder-js)
- **JPEG 2000**: [OpenJPEG](https://github.com/nickygerritsen/openjpegjs) compiled to WebAssembly
- **JPEG Baseline**: Browser's native `createImageBitmap()` API

### Window/Level
The viewer automatically reads Window Center and Window Width from DICOM tags (0028,1050) and (0028,1051) to apply appropriate display settings for CT images.

## Future Plans

See [3D_VOLUME_RENDERING_PLAN.md](./3D_VOLUME_RENDERING_PLAN.md) for plans to add:
- 3D volume rendering
- Maximum Intensity Projection (MIP)
- Multiplanar Reformation (MPR)

## License

MIT License - Copyright (c) 2026 Divergent Health Technologies

## About

Developed by Gabriel Casalduc at [Divergent Health Technologies](https://divergent.health/)

## Acknowledgments

- [dicom-parser](https://github.com/cornerstonejs/dicomParser) - DICOM parsing
- [jpeg-lossless-decoder-js](https://github.com/cornerstonejs/jpeg-lossless-decoder-js) - JPEG Lossless decoding
- [OpenJPEG](https://www.openjpeg.org/) - JPEG 2000 decoding
- [Cornerstone.js](https://github.com/cornerstonejs) - Inspiration and codec implementations
