# 3D Volume Rendering Benchmarking Research

**Purpose**: Research how established companies implement 3D volume rendering to inform technology decisions for our DICOM CT Viewer.

**Status**: Completed

---

## Executive Summary

| Company | Platform | Rendering Tech | GPU API | Key Insight |
|---------|----------|----------------|---------|-------------|
| Onshape | Browser-first | Custom WebGL | WebGL 2.0 | Browser-native 3D is production-ready for complex CAD |
| Autodesk Fusion 360 | Desktop + Web Viewer | C++/Qt desktop, Three.js web | OpenGL/Metal desktop, WebGL web | Web viewer is read-only; heavy computation stays desktop |
| 3D Slicer / vtk.js | Desktop + Web via vtk.js | VTK (C++) / vtk.js (JS) | OpenGL/Metal desktop, WebGL 2.0 web | vtk.js brings medical imaging to browser with full CVR |
| Horos/OsiriX | macOS Desktop | VTK + Cocoa | OpenGL (deprecated) | Mature VTK integration; CLUT/preset system is gold standard |

**Recommended Approach**: vtk.js for web-based volume rendering. It's battle-tested, has CVR built-in, and is backed by Kitware (NIH funding). The desktop implementations (Horos, 3D Slicer) all use VTK, and vtk.js is its web port.

---

## 1. Onshape (PTC)

### Overview
- **Type**: Browser-first CAD (Computer-Aided Design)
- **Acquired by**: PTC (2019, $470M)
- **Unique aspect**: Full CAD in browser, no desktop app

### Architecture
```
Browser (Chrome/Edge/Firefox)
├── Custom WebGL 2.0 renderer
├── Parasolid geometry kernel (runs in cloud)
└── Real-time sync via WebSockets
```

### Key Findings
- **Custom WebGL implementation**: Built from scratch, not Three.js
- **Heavy compute in cloud**: Geometry kernel runs server-side
- **Rendering in browser**: WebGL handles display only
- **Target**: CAD/mechanical, not medical imaging

### Relevance to Our Project
- Proves browser-first 3D is viable at scale
- Different use case (surface modeling vs. volume rendering)
- Their WebGL expertise took years to develop

---

## 2. Autodesk Fusion 360

### Overview
- **Type**: Desktop CAD/CAM with web viewer
- **Platform**: macOS, Windows, web (viewer only)
- **Stack**: C++/Qt desktop, Three.js r71 (frozen) for web

### Architecture
```
Desktop App (C++/Qt)
├── OpenGL/Metal for rendering
├── Custom geometry engine
└── Full editing capabilities

Web Viewer (Three.js r71)
├── Read-only viewing
├── Frozen Three.js version
└── Limited 3D features
```

### Key Findings
- **Desktop-first strategy**: Heavy features stay native
- **Web viewer is minimal**: Viewing only, no editing
- **Three.js frozen at r71**: Shows maintenance burden of dependencies
- **No volume rendering**: Surface-based CAD only

### Relevance to Our Project
- Validates hybrid approach (desktop + web)
- Warning about freezing dependencies
- Different domain (CAD vs. medical imaging)

---

## 3. 3D Slicer / vtk.js / Kitware Ecosystem

### Overview
- **3D Slicer**: Desktop medical imaging platform
- **vtk.js**: VTK ported to JavaScript (same maintainers)
- **VolView**: Reference web app using vtk.js
- **Backed by**: NIH, national labs, Kitware

### Architecture
```
Desktop (3D Slicer)
├── VTK (Visualization Toolkit) - C++
├── ITK (Image Processing) - C++
├── MRML (Scene Graph)
└── Python scripting

Web (vtk.js / VolView)
├── vtk.js (VTK in JavaScript)
├── WebGL 2.0 for rendering
├── WASM for heavy computation
└── itk-wasm for image processing
```

### vtk.js Volume Rendering Features
- **Blend Modes**:
  - COMPOSITE_BLEND (standard volume rendering)
  - MAXIMUM_INTENSITY_BLEND (MIP)
  - MINIMUM_INTENSITY_BLEND (MinIP)
  - AVERAGE_INTENSITY_BLEND
  - ADDITIVE_INTENSITY_BLEND
  - RADON_TRANSFORM_BLEND
  - LABELMAP_EDGE_PROJECTION_BLEND

- **Cinematic Volume Rendering (CVR)**:
  - Gradient-based shading (Phong model)
  - Volumetric scattering
  - Local Ambient Occlusion (LAO)
  - Global illumination reach

- **Transfer Functions**:
  - Color transfer function (scalar → RGB)
  - Opacity transfer function (scalar → alpha)
  - Gradient opacity (edge enhancement)
  - Piecewise hermite interpolation

### Key Findings
- **Most relevant to our project**: Medical imaging focused
- **CVR built-in**: No need to write custom shaders
- **Active development**: Regular releases, responsive maintainers
- **Bundle size**: ~500KB but includes everything

### VolView Reference App
- https://volview.kitware.com/
- Open source web viewer using vtk.js
- Demonstrates what's achievable in browser
- Good reference for UI patterns

---

## 4. Horos / OsiriX

### Overview
- **Horos**: Open-source OsiriX fork (LGPL-3.0)
- **OsiriX**: Commercial version (FDA-cleared)
- **Platform**: macOS only
- **Languages**: 38.8% C++, 30.3% Objective-C

### Architecture
```
macOS App
├── VTK (volume rendering)
├── ITK (image processing)
├── DCMTK (DICOM networking)
├── OpenJPEG/Grok (JPEG 2000)
└── Cocoa/AppKit (UI)

Rendering Pipeline
├── vtkSmartVolumeMapper (GPU/CPU auto-select)
├── vtkVolumeProperty (shading, transfer functions)
├── vtkVolume (actor)
├── vtkRenderer → NSOpenGLView
└── OpenGL (deprecated on macOS)
```

### VTK Volume Rendering Pipeline

**Data Flow**:
```
DICOM Files
    ↓
vtkDICOMImageReader
    ↓
vtkImageData (3D structured grid)
    ↓
vtkSmartVolumeMapper / vtkGPUVolumeRayCastMapper
    ↓
vtkVolume + vtkVolumeProperty
    ↓
vtkRenderer → OpenGL → Display
```

**vtkSmartVolumeMapper**:
- Automatically selects GPU or CPU rendering
- Adapts to hardware capabilities
- Falls back gracefully on older systems

**vtkVolumeProperty Parameters**:
| Parameter | Purpose | Typical Range |
|-----------|---------|---------------|
| Ambient | Background lighting | 0.0-1.0 |
| Diffuse | Directional light response | 0.0-1.0 |
| Specular | Highlight intensity | 0.0-1.0 |
| Specular Power | Highlight sharpness | 1-100 |
| Interpolation | Sampling quality | Nearest/Linear |

### Transfer Function / CLUT System

**Color Lookup Table (CLUT)**:
- Maps scalar values to RGBA
- 8-bit CLUT: 256 entries
- 16-bit CLUT: 65,536 entries
- Stored as 1D GPU textures for fast lookup

**Gradient Opacity**:
- Uses gradient magnitude to modulate opacity
- Enhances boundaries/edges
- Formula: `Final Opacity = Scalar Opacity × Gradient Opacity`

**Built-in Presets**:

*Bone CT Presets (~10 options)*:
- Optimized for high-attenuation bone
- "Glossy", "Glossy II", "Pencil"
- White/light gray for high density

*Soft Tissue CT Presets (~15 options)*:
- Black/red/yellow/white progressions
- Smooth opacity gradients
- Designed for organ visualization

**Preset Components**:
Each preset stores:
- CLUT (color lookup table)
- Opacity transfer function
- Shading parameters (ambient, diffuse, specular)
- Projection mode (perspective/orthographic)
- Background color
- Interpolation type

### GPU Ray Casting Implementation

**Pipeline Stages**:

1. **Setup**:
   - Load volume into 3D GPU texture
   - Load transfer functions as 1D textures
   - Create bounding box geometry

2. **Ray Casting**:
   - Render front-facing bounding box polygons
   - Fragment shader initiates ray per pixel
   - Step through volume at regular intervals
   - Sample, lookup color/opacity, blend

3. **Compositing**:
   - Front-to-back alpha blending
   - Early ray termination (opacity ≈ 1.0)
   - Depth buffer integration with opaque geometry

**Memory Management**:

*Bricking Strategy*:
- Large volumes split into sub-blocks
- Each "brick" fits in GPU texture memory
- Processed back-to-front for correct composition

*GPU Memory Limits*:
- Configurable max memory fraction (0.1 to 1.0)
- Automatic downsampling for large datasets
- >2000 CT images requires >1GB free RAM

### Performance Characteristics

**GPU vs CPU**:
- GPU: 10-15× faster than CPU ray casting
- NVIDIA GPUs perform best
- Apple Silicon support is limited (OpenGL deprecated)

**Optimization Techniques**:
- Level of Detail (LOD): Lower resolution for distant views
- Progressive rendering: Coarse → fine quality
- Pre-computed illumination tables
- Gradient caching

### Known Issues

- **macOS Compatibility**: OpenGL deprecated since macOS 10.14
- **Apple Silicon**: GPU rendering can fail, falls back to CPU
- **Last Update**: Horos hasn't been updated since 2023
- **GitHub Issues**: Multiple reports of 3D rendering failures

### Key Classes (Horos Architecture)

**VRController**:
- Manages volume rendering session lifecycle
- Coordinates UI and rendering engine
- Handles transfer function/preset changes
- Controls rendering parameters

**VRView**:
- Subclass of NSOpenGLView
- Manages OpenGL context
- Implements vtkRenderWindow integration
- Handles mouse/keyboard events for 3D navigation

**ViewerController**:
- High-level DICOM viewer controller
- Manages 2D and 3D views
- Synchronizes windowing across views

---

## Comparison Matrix

### Feature Comparison

| Feature | Onshape | Fusion 360 | 3D Slicer/vtk.js | Horos |
|---------|---------|------------|------------------|-------|
| Volume Rendering | No (surface only) | No | Yes (CVR) | Yes |
| MIP | N/A | N/A | Yes | Yes |
| MPR | N/A | N/A | Yes | Yes |
| Browser-based | Yes | Viewer only | Yes (vtk.js) | No |
| Transfer Functions | N/A | N/A | Full support | Full support |
| Medical Presets | N/A | N/A | CT/MR presets | 25+ presets |
| Open Source | No | No | Yes | Yes |

### Technology Stack Comparison

| Stack | Onshape | Fusion 360 | vtk.js | Horos |
|-------|---------|------------|--------|-------|
| Language | JS/TS | C++/Qt + JS | JavaScript | Obj-C/C++ |
| GPU API | WebGL 2.0 | OpenGL/Metal + WebGL | WebGL 2.0 | OpenGL |
| 3D Library | Custom | Qt3D + Three.js | vtk.js | VTK |
| Bundle Size | N/A | N/A | ~500KB | N/A |

### Backing & Health

| Project | Backing | Last Update | Contributors | Risk |
|---------|---------|-------------|--------------|------|
| Onshape | PTC (enterprise) | Active | 100+ | Low |
| Fusion 360 | Autodesk (enterprise) | Active | 100+ | Low |
| vtk.js | Kitware (NIH funded) | Active (weekly) | 50+ | Low |
| Horos | Community | 2023 | <10 active | Medium |

---

## Recommendations

### Primary Choice: vtk.js

**Reasons**:
1. **Medical imaging focus**: Built for our exact use case
2. **CVR included**: Gradient shading, LAO, volumetric scattering
3. **Transfer functions**: Color/opacity with presets
4. **Blend modes**: MIP, composite, average all supported
5. **Active development**: Kitware is well-funded (NIH)
6. **Reference apps**: VolView demonstrates browser capability
7. **VTK compatibility**: Same architecture as desktop tools

**Bundle consideration**: ~500KB is acceptable for medical imaging application where users load multi-GB datasets anyway.

### Alternative: Three.js + Custom Shaders

**When to consider**:
- If vtk.js bundle size becomes problematic
- If we need features vtk.js doesn't support
- If we want maximum control over rendering

**Risks**:
- Significant development time
- Must implement CVR features ourselves
- No medical imaging community around it

### Avoid: Raw WebGL

**Reason**: Too complex for no meaningful benefit. vtk.js already optimizes WebGL usage.

---

## Implementation Path (using vtk.js)

### Phase 1: Basic Integration
```javascript
// Load vtk.js from CDN
import '@kitware/vtk.js';

// Create volume from DICOM slices
const imageData = vtkImageData.newInstance();
imageData.setDimensions([512, 512, sliceCount]);
imageData.getPointData().setScalars(volumeData);

// Set up volume mapper
const mapper = vtkVolumeMapper.newInstance();
mapper.setInputData(imageData);
mapper.setBlendMode(BlendMode.COMPOSITE_BLEND);

// Set up volume actor
const actor = vtkVolume.newInstance();
actor.setMapper(mapper);
```

### Phase 2: Transfer Functions
```javascript
// Color transfer function
const ctfun = vtkColorTransferFunction.newInstance();
ctfun.addRGBPoint(-1000, 0, 0, 0);      // Air: black
ctfun.addRGBPoint(0, 0.8, 0.6, 0.5);    // Soft tissue: tan
ctfun.addRGBPoint(400, 1, 0.9, 0.8);    // Bone: white

// Opacity transfer function
const ofun = vtkPiecewiseFunction.newInstance();
ofun.addPoint(-1000, 0.0);              // Air: transparent
ofun.addPoint(0, 0.3);                  // Soft tissue: semi-transparent
ofun.addPoint(400, 0.8);                // Bone: opaque

// Apply to volume property
const volumeProperty = vtkVolumeProperty.newInstance();
volumeProperty.setRGBTransferFunction(0, ctfun);
volumeProperty.setScalarOpacity(0, ofun);
```

### Phase 3: Shading (CVR)
```javascript
// Enable gradient-based shading
volumeProperty.setShade(true);
volumeProperty.setAmbient(0.2);
volumeProperty.setDiffuse(0.7);
volumeProperty.setSpecular(0.3);
volumeProperty.setSpecularPower(8);

// Enable gradient opacity for edge enhancement
volumeProperty.setGradientOpacityMinimumValue(0, 0);
volumeProperty.setGradientOpacityMaximumValue(0, 100);
volumeProperty.setGradientOpacityMinimumOpacity(0, 0.0);
volumeProperty.setGradientOpacityMaximumOpacity(0, 1.0);
```

---

## References

### Primary Sources
- [VTK Volume Rendering Pipeline](https://book.vtk.org/en/latest/VTKBook/07Chapter7.html)
- [vtkGPUVolumeRayCastMapper Documentation](https://vtk.org/doc/nightly/html/classvtkGPUVolumeRayCastMapper.html)
- [vtk.js VolumeMapper API](https://kitware.github.io/vtk-js/api/Rendering_Core_VolumeMapper.html)
- [vtk.js VolumeProperty API](https://kitware.github.io/vtk-js/api/Rendering_Core_VolumeProperty.html)
- [Horos GitHub Repository](https://github.com/horosproject/horos)
- [VolView Web Application](https://kitware.github.io/VolView/)

### Research Papers
- [GPU-based multi-volume ray casting within VTK](https://pubmed.ncbi.nlm.nih.gov/24841148/)
- [Volume Rendering Improvements in VTK](https://www.kitware.com/volume-rendering-improvements-in-vtk/)
- Xu et al., 2022 - Cinematic Volume Rendering in vtk.js

### Comparisons
- [Horos vs OsiriX vs RadiAnt Comparison](https://sourceforge.net/software/compare/Horos-vs-Osirix-vs-RadiAnt-DICOM-Viewer/)
- [DICOM Viewers Overview](https://pycad.co/dicom-viewer/)

---

*Last Updated: January 2026*
*Research by: Gabriel Casalduc, Divergent Health Technologies*
