# OHIF Viewer Deep-Dive Research

Research date: 2026-03-10
Researcher: Claude Code (Opus 4.6)

---

## Table of Contents

1. [Organization and Community](#1-organization-and-community)
2. [Repository Statistics](#2-repository-statistics)
3. [Architecture Overview](#3-architecture-overview)
4. [Cornerstone.js vs Cornerstone3D](#4-cornerstonejs-vs-cornerstone3d)
5. [Rendering Pipeline](#5-rendering-pipeline)
6. [Extension and Mode System](#6-extension-and-mode-system)
7. [Data Loading Pipeline](#7-data-loading-pipeline)
8. [State Management](#8-state-management)
9. [Performance and Memory](#9-performance-and-memory)
10. [Hanging Protocols](#10-hanging-protocols)
11. [Segmentation and Annotation](#11-segmentation-and-annotation)
12. [DICOM Support](#12-dicom-support)
13. [Deployment](#13-deployment)
14. [Package Ecosystem](#14-package-ecosystem)
15. [Academic Citation](#15-academic-citation)
16. [Relevance to Our Viewer](#16-relevance-to-our-viewer)

---

## 1. Organization and Community

### Governance

OHIF (Open Health Imaging Foundation) is a **program of Massachusetts General Hospital (MGH)**, launched in 2015 through a partnership between MGH Department of Radiology and **Radical Imaging**, a software engineering firm.

- **MGH**: Project management, UX design, product testing
- **Radical Imaging**: Software architecture, development, and third-party support
- **License**: MIT (commercially permissive)

### Funding

- NIH/NCI Informatics Technology for Cancer Research (ITCR) grants (2015-2020, 2023-2028)
- Direct MGH Department of Radiology funding
- Radical Imaging in-kind support
- Kitware contributions (NIH NINDS, NIBIB, NIGMS grants)
- Chan Zuckerberg Initiative (Essential Open Source Software for Science)

### Key People (from the 2020 paper)

- **Gordon J. Harris, PhD** -- MGH, principal investigator
- **Erik Ziegler, PhD** -- Lead developer (early OHIF)
- **Steve D. Pieper, PhD** -- Isomics, VTK/3D Slicer connection
- **Chris Hafey** -- Cornerstone creator, WASM codec pioneer
- **Rob Lewis** -- Radical Imaging
- **Trinity Urban, Danny Brown, James Petts** -- Contributors

### Conference Presence

Regular presentations at RSNA, SIIM, NA-MIC Project Weeks, ITCR meetings, and Imaging Network Ontario (ImNO). Best presentation award at NCI ITCR Annual Meeting for HTJ2K progressive loading work. Training courses co-delivered with Kitware on VTK.js integration (2019).

### Adoption

The OHIF Viewer has served as the basis for "many active, production, and FDA Cleared medical imaging viewers." Integrated into:
- The Cancer Imaging Archive (TCIA)
- NCI Imaging Data Commons
- XNAT (radiotherapy/segmentation workflows)
- LabCAS (NASA/NCI partnership)
- ISB Cancer Genomics Cloud
- Kheops image sharing platform
- Crowds Cure Cancer (crowdsourced annotation, 5,000+ measurements)
- ProstateCancer.ai (Tesseract-MI)
- eContour (3D contouring)
- TB Portals (tuberculosis)
- Flywheel (commercial)

---

## 2. Repository Statistics

Data from GitHub API (2026-03-10):

| Repository | Stars | Forks | Open Issues | Language | License |
|-----------|-------|-------|-------------|----------|---------|
| OHIF/Viewers | 4,070 | 4,169 | 459 | TypeScript | MIT |
| cornerstonejs/cornerstone3D | 1,027 | 473 | 477 | TypeScript | MIT |
| cornerstonejs/dicomParser | 744 | 231 | 42 | JavaScript | MIT |
| dcmjs-org/dcmjs | 339 | 128 | 102 | JavaScript | MIT |

- OHIF/Viewers created: 2015-10-13
- cornerstone3D created: 2022-03-21
- 136 unique code contributors (as of 2020 paper)
- dcmjs: ~15,000 weekly npm downloads
- Community translations: Chinese, Japanese, Vietnamese, Portuguese, Spanish, Russian, Arabic

### Version History

| Version | Date | Highlights |
|---------|------|------------|
| v3.7.0 | Oct 2023 | Segmentation editing tools |
| v3.8.0 | Early 2024 | Architecture enhancements |
| v3.9.0 | May 2024 | Cornerstone3D 2.0, VoxelManager, viewport-centric segmentation |
| v3.10.0 | Apr 2025 | AI-powered segmentation, @ohif/ui-next component library |
| v3.11.0 | Aug 2025 | Multimodality fusion, RT Dose, ultrasound mode, DICOM Labelmap, SCOORD3D |
| v3.12.0 | Feb 2026 | Contour segmentation tools, segment combination, unified panel |
| v3.13.0-beta | Feb 2026 | In development |

---

## 3. Architecture Overview

### Monorepo Structure

OHIF is a Lerna monorepo:

```
OHIF/Viewers/
  extensions/              # Feature modules
    default/               # Layout, study browser, DICOMWeb datasource
    cornerstone/           # 2D/3D rendering via Cornerstone3D
    cornerstone-dicom-sr/  # DICOM Structured Report
    cornerstone-dicom-seg/ # DICOM Segmentation
    cornerstone-dicom-rt/  # DICOM RT Struct
    cornerstone-microscopy/# Whole Slide Imaging
    dicom-pdf/             # PDF viewport
    dicom-video/           # Video viewport
    measurement-tracking/  # Longitudinal measurements
    tmtv/                  # Total Metabolic Tumor Volume
  modes/
    longitudinal/          # Measurement tracking workflow
    basic-dev-mode/        # Development mode
    tmtv/                  # PET/CT TMTV workflow
    segmentation/          # Segmentation workflow
  platform/
    core/                  # @ohif/core -- business logic, managers, services
    i18n/                  # @ohif/i18n -- internationalization
    ui/                    # @ohif/ui -- React component library
    ui-next/               # @ohif/ui-next -- Shadcn UI-based components (v3.10+)
    app/                   # @ohif/app -- framework connector, routing
```

### Data Flow

```
App -> Modes -> Extensions -> Services/Components
```

1. `@ohif/app` registers extensions and composes modes
2. Modes configure which extensions compose a particular workflow
3. Extensions provide modules (viewports, panels, tools, datasources)
4. Services handle state, data, and UI through pub/sub patterns

### Key Paradigm (v3)

In v2, extensions were "plugins" that automatically hooked into the app. In v3, **extensions are building blocks** that modes consume. Registering an extension makes its components *available* to modes. A mode is a configuration object that tells `@ohif/app` how to compose extensions to build an application on a specific route.

---

## 4. Cornerstone.js vs Cornerstone3D

### Why the Rewrite

Legacy Cornerstone (cornerstone-core) had GPU-accelerated rendering via WebGL, but **only handled 2D rendering**. To add 3D, the team created `react-vtkjs-viewport` which used vtk.js directly. This hit critical limitations:

1. **WebGL context limits**: Maximum 16 WebGL contexts per browser tab. PET/CT hanging protocols need 10+ viewports.
2. **No texture sharing**: Each vtk.js viewport had its own WebGL instance with separate GPU textures. A PET volume displayed in 4 viewports meant 4x GPU memory.
3. **No SVG annotation**: vtk.js has no support for SVG overlay annotation tools.

### What Changed

| Aspect | Legacy Cornerstone | Cornerstone3D |
|--------|-------------------|---------------|
| Rendering | Mix of WebGL and vtk.js | Unified vtk.js backbone with offscreen canvas |
| Coordinate system | 2D canvas/image coordinates | 3D world space (patient coordinates) |
| Data model | Image-at-a-time | Volumes + stacks in 3D space |
| Annotations | Stored per-image in 2D | Stored in 3D world space (FrameOfReference) |
| GPU textures | Per-viewport | Shared via volume mappers |
| WebGL contexts | One per viewport | Pooled (default: 8 contexts) |
| Tool state | Per-element | Shared across viewports in same Frame of Reference |
| Volume rendering | External (react-vtkjs-viewport) | Native VolumeViewport3D |
| API | `loadAndCacheImage()` per element | `viewport.setStack()` / `createAndCacheVolume()` |
| Types | JavaScript | TypeScript |
| Modules | CommonJS | ES Modules |

### Cornerstone3D 2.0 (May 2024)

Major update with v3.9:
- **VoxelManager**: Replaces large scalar data arrays with image-by-image access. Cuts memory usage in half.
- **Viewport-centric segmentation**: Segmentations managed per-viewport rather than per-toolGroup.
- **SharedArrayBuffer removed**: No longer requires special headers (COOP/COEP).
- **TypeScript + ES modules**: Modern build tool compatibility (Vite, React, Vue).

---

## 5. Rendering Pipeline

### Architecture

Cornerstone3D uses **vtk.js** as the rendering backbone. vtk.js provides WebGL GPU-accelerated rendering with ray-casting shaders for volume rendering.

```
DICOM Pixel Data
  -> Image Loader (decode, decompress)
  -> Cache (image or volume)
  -> VoxelManager (data access layer)
  -> vtk.js Volume/Image Mapper
  -> WebGL Fragment Shaders (GPU)
  -> Offscreen Canvas (single shared)
  -> Copy to On-screen Canvases (per viewport)
```

### Offscreen Canvas Model

The central innovation: **all viewports render into a single large offscreen WebGL canvas**. On render, pixel data is copied from the offscreen canvas to each on-screen canvas element. This is dramatically faster than re-rendering each viewport independently.

**Two rendering engine implementations:**

1. **TiledRenderingEngine** (legacy): Single massive offscreen canvas, all viewports tiled horizontally. Limited by browser max canvas size (16,384px in Chrome). Causes silent cropping with many viewports.

2. **ContextPoolRenderingEngine** (default, v3.11+): Each viewport gets its own viewport-sized offscreen canvas. WebGL contexts are pooled (default: 8). Eliminates canvas size limits. Consistent performance regardless of viewport count.

### GPU Texture Sharing

**Shared Volume Mappers**: A volume's GPU texture is created once and reused across all viewports that display it. A PET-CT fusion layout with 9 viewports sharing 2 volumes (PET + CT) creates only 2 GPU textures, not 18.

### Window/Level and LUT

Window/level transforms are applied in the rendering pipeline. The LUT conversion function transforms stored pixel values to display pixel values. This is described as "the most performance-sensitive code in cornerstone" with special optimization tricks.

VOI (Values of Interest) LUT transforms modality values into a visible range. If no VOI LUT data exists on the viewport, the system computes one to display all pixels.

### Viewport Types

| Type | Purpose | Rendering |
|------|---------|-----------|
| **StackViewport** | 2D image stacks (may differ in shape/size/orientation) | GPU-accelerated 2D |
| **VolumeViewport** | MPR (axial, sagittal, coronal, oblique) | GPU-accelerated 3D slicing |
| **VolumeViewport3D** | True 3D volume rendering | GPU ray-casting with presets (Bone, Soft Tissue, Lung) |
| **VideoViewport** | MPEG-4 video DICOM | Browser video playback |
| **WholeSlideImageViewport** | Pathology slides | Tiled image display |

### Blending Modes

- Maximum Intensity Projection (MIP)
- Average Intensity Projection
- Standard volume rendering with transfer functions
- Image fusion (PET/CT overlay with opacity/blending controls)

### CPU Fallback

When GPU is unavailable, Cornerstone3D supports CPU rendering as a fallback.

---

## 6. Extension and Mode System

### Extension Structure

An extension is a plain JavaScript object:

```javascript
{
  id: 'myExtension',
  version: '1.0.0',
  preRegistration: ({ servicesManager }) => { /* init */ },
  onModeEnter: () => { /* setup for mode */ },
  onModeExit: () => { /* cleanup */ },
  getLayoutTemplateModule: () => [...],
  getDataSourceModule: () => [...],
  getSOPClassHandlerModule: () => [...],
  getPanelModule: () => [...],
  getViewportModule: () => [...],
  getCommandsModule: () => [...],
  getToolbarModule: () => [...],
  getContextModule: () => [...],
  getHangingProtocolModule: () => [...],
  getUtilityModule: () => [...],
}
```

### Module Types (10 types)

| Module | Purpose |
|--------|---------|
| **LayoutTemplate** | Controls route layout and viewport grid arrangement |
| **DataSource** | Maps DICOM metadata to OHIF format (DICOMWeb, JSON, etc.) |
| **SOPClassHandler** | Splits study data into DisplaySets based on SOP Class UID |
| **Panel** | Left/right sidebar panels |
| **Viewport** | React components that render DisplaySets |
| **Commands** | Named, context-scoped actions (CommandsManager) |
| **Toolbar** | Toolbar buttons and custom UI elements |
| **Context** | React Context-based shared state |
| **HangingProtocol** | Rules for automatic viewport population |
| **Utility** | Helper functions shared across extensions |

### Context System

Active contexts scope extension functionality:
- Route contexts: `ROUTE:VIEWER`, `ROUTE:STUDY_LIST`
- Viewport contexts: `ACTIVE_VIEWPORT:CORNERSTONE`, `ACTIVE_VIEWPORT:VTK`

Toolbar buttons can conditionally activate based on active context.

### Mode Structure

```javascript
{
  id: 'longitudinal',
  displayName: 'Measurement Tracking',
  version: '1.0.0',
  extensionDependencies: ['@ohif/extension-default', '@ohif/extension-cornerstone'],
  modeModalities: ['CT', 'MR', 'PT'],  // required modalities
  isValidMode: ({ modalities }) => { /* validation */ },
  routes: [{
    path: '',
    init: () => {},
    layoutInstance: {
      id: 'layout',
      props: {
        leftPanels: ['extension.panelModule.seriesList'],
        rightPanels: ['extension.panelModule.trackedMeasurements'],
        viewports: [{ namespace: 'extension.viewportModule.cornerstone' }],
      }
    }
  }],
  hangingProtocol: 'default',
  sopClassHandlers: ['extension.sopClassHandlerModule.stack'],
  hotkeys: { name: 'custom', hotkeys: [/* bindings */] },
  onModeEnter: () => {},
  onModeExit: () => {},
}
```

### Built-in Modes

- **Basic** (basic-dev-mode): Core viewer without tracking
- **Longitudinal**: Measurement tracking across studies, DICOM SR export
- **TMTV**: PET/CT Total Metabolic Tumor Volume calculation
- **Segmentation**: Labelmap, contour, and surface segmentation workflows

### Extension Registration

Managed via `pluginConfig.json` and the OHIF CLI:

```json
{
  "extensions": [
    { "packageName": "@ohif/extension-cornerstone", "version": "3.12.0" }
  ],
  "modes": [
    { "packageName": "@ohif/mode-longitudinal", "version": "3.12.0" }
  ]
}
```

---

## 7. Data Loading Pipeline

### DICOMweb Support

OHIF natively supports the DICOMweb standard:

| Service | Protocol | Purpose |
|---------|----------|---------|
| QIDO-RS | Query | Search for studies/series/instances |
| WADO-RS | Retrieve | Fetch DICOM objects (modern REST) |
| WADO-URI | Retrieve | Fetch DICOM objects (legacy HTTP) |
| STOW-RS | Store | Upload DICOM files |

Configuration:

```javascript
dataSources: [{
  namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
  configuration: {
    wadoUriRoot: 'https://server/wado',
    qidoRoot: 'https://server/rs',
    wadoRoot: 'https://server/rs',
    qidoSupportsIncludeField: true,
    imageRendering: 'wadors',
    thumbnailRendering: 'wadors',
    enableStudyLazyLoad: true,
    supportsFuzzyMatching: true,
    supportsWildcard: true,
    dicomUploadEnabled: true,
  }
}]
```

### Alternative Data Sources

- **DICOM JSON**: Supply study data as JSON via `?url=` query parameter
- **Static DICOMweb files**: Pre-generated static files via `static-wado` project
- **Local files**: Via DICOM image loader

### Image Loading Pipeline

```
ImageId (scheme://path)
  -> Registered ImageLoader (based on URL scheme)
  -> Network fetch (XHR) via imageRetrievalPoolManager
  -> DICOM parsing (dicomParser)
  -> Codec decoding via Web Worker
  -> Image Object (pixelData, metadata)
  -> Cache
  -> Viewport rendering
```

### Web Worker Decoding

The DICOM image loader uses web workers for CPU-intensive decoding:

```javascript
import { init } from '@cornerstonejs/dicom-image-loader';
init({ maxWebWorkers: navigator.hardwareConcurrency || 1 });
```

Workers handle JPEG 2000, JPEG Lossless, RLE, JPEG-LS, and JPEG Baseline decoding using WASM codecs. The `maxNumberOfWebWorkers` parameter defaults to `Math.min(navigator.hardwareConcurrency, configured_max)`.

**Known issue**: The JPEG Lossless decoder (`jpeg-lossless-decoder-js`) is not thread-safe. The `Decoder` class stores temporary data in instance attributes, which can cause image corruption when multiple web workers share a singleton instance.

### Request Pool Management

Two separate priority queues:

1. **imageRetrievalPoolManager**: Handles network fetches (XHR)
2. **imageLoadPoolManager**: Handles decoding (Retrieval + Decoding)

Three request types with configurable concurrency:
- **Interaction**: Highest priority (user-initiated)
- **Thumbnail**: Medium priority
- **Prefetch**: Lowest priority (background loading)

Priority is a numeric value (lower = higher priority). The combination of requestType and priority enables sophisticated scheduling.

### Streaming Volume Loading

`StreamingImageVolumeLoader` enables progressive volume construction:

1. Pre-fetch metadata from all imageIds
2. Pre-allocate volume in cache
3. Stream pixel data image-by-image, inserting directly into volume at correct location
4. Render progressively as slices arrive

```javascript
const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
await volume.load();  // streams images progressively
```

Key optimization: Uses `skipCreateImage` to bypass individual Image object creation. Pixel data goes directly into the volume array.

### Progressive Loading (HTJ2K)

First-class support for High-Throughput JPEG 2000 progressive decoding:

```javascript
stages: [
  { id: 'initialImages', positions: [0.5, 0, -1], retrieveType: 'initial', priority: -1 },
  { id: 'firstPass', decimate: 2, offset: 0, retrieveType: 'fast', priority: 2 },
  { id: 'secondPass', decimate: 2, offset: 1, retrieveType: 'fast', priority: 3 },
]
```

Features:
- **Position-based retrieval**: Load specific slices first (middle, first, last)
- **Decimation**: Load every Nth image, then fill gaps
- **Nearby frame replication**: Copy adjacent frames as placeholders
- **Lossy-to-lossless**: Start with low-quality HTJ2K byte ranges, progressively refine
- **Quality status tracking**: `SUBRESOLUTION`, `ADJACENT_REPLICATE`, full quality

---

## 8. State Management

### Architecture Evolution

- **v2**: Redux store (centralized)
- **v3.0-3.8**: Custom services with pub/sub pattern (replaced Redux)
- **v3.9+**: Zustand stores for granular state (replaced StateSyncService)

### Service-Based State (v3)

Each service manages its own internal state independently:

```javascript
// Services are factories
{
  name: 'MeasurementService',
  create: ({ servicesManager }) => {
    // Returns service instance with internal state
  }
}
```

Services communicate via **publish-subscribe** pattern. Extensions and components subscribe to state changes through the `ServicesManager`.

### Data Services

| Service | Purpose |
|---------|---------|
| DicomMetadataStore | Centralized DICOM metadata storage |
| DisplaySetService | Converts metadata into displayable sets |
| HangingProtocolService | Automatic viewport arrangement |
| ToolbarService | Toolbar state and actions |
| MeasurementService | Annotation/measurement state |
| SegmentationService | Segmentation creation and management |
| PanelService | Side panel activation/display |
| SyncGroupService | Multi-viewport synchronization |
| ToolGroupService | Tool group management |
| WorkflowStepService | Multi-step clinical workflows |
| MultiMonitorService | Multi-monitor window management |
| CustomizationService | Dynamic UI customization |

### UI Services

| Service | Purpose |
|---------|---------|
| UIModalService | Centered modal dialogs |
| UIDialogService | Draggable dialog windows |
| UINotificationService | Toast notifications |
| UIViewportDialogService | In-viewport dialogs |
| CINEService | Cine playback control |
| ViewportGridService | Viewport layout management |

UI services use React Context providers wrapping application routes:

```jsx
<ViewportGridProvider>
  <ViewportDialogProvider>
    <CineProvider>
      <SnackbarProvider>
        <DialogProvider>
          <ModalProvider>
            {appRoutes}
          </ModalProvider>
        </DialogProvider>
      </SnackbarProvider>
    </CineProvider>
  </ViewportDialogProvider>
</ViewportGridProvider>
```

Extensions access UI services via hooks (e.g., `useModal()`) without tight coupling to component implementations.

### Zustand Stores (v3.9+)

StateSyncService was replaced with individual Zustand stores:

- `useLutPresentationStore` -- Window/level presentation state
- `useSynchronizersStore` -- Viewport synchronization state
- Extensions can create custom Zustand stores

State rehydration from localStorage on mode entry, cleanup on mode exit.

### React

OHIF uses **React 18** with concurrent rendering. The UI component library migrated from `@ohif/ui` to `@ohif/ui-next` (based on **Shadcn UI** with **Tailwind CSS**) starting in v3.10.

---

## 9. Performance and Memory

### GPU Memory Optimization

1. **Shared Volume Mappers**: One GPU texture per volume, shared across all viewports displaying it.
2. **16-bit textures via EXT_texture_norm16**: WebGL extension for 16-bit normalized textures (ideal for most medical images). Halves GPU memory vs 32-bit float. Configurable in OHIF config:
   ```javascript
   preferSizeOverAccuracy: true  // Use 16-bit instead of 32-bit
   ```
3. **VoxelManager** (CS3D 2.0): Eliminates large scalar data arrays. Data stored as individual images, converted on demand. Single image cache as authoritative source. Streams directly to GPU.

### Web Worker Pool

Configurable worker count for parallel decoding. Separate pools for retrieval (network) and decoding (CPU), executing asynchronously.

### Request Prioritization

- Interaction requests (user-driven) get highest priority
- Prefetch requests fill in background
- Priority values allow fine-grained ordering within each type

### Progressive Loading

HTJ2K byte-range requests enable lossy-first display with progressive refinement. Position-based loading shows clinically important slices first (middle, first, last).

### Known Limitations

- **Canvas size**: Legacy TiledRenderingEngine limited by browser max canvas size (16,384px). Solved by ContextPoolRenderingEngine in v3.11+.
- **JPEG Lossless thread safety**: The decoder singleton is not thread-safe, causing occasional image corruption with concurrent web workers. Documented bug.
- **WebGL context limits**: Browsers limit WebGL contexts per tab (typically 8-16). Managed by context pooling.
- **Large volume memory**: Very large volumes (e.g., 512x512x2000 at 32-bit) may exceed available memory. VoxelManager and 16-bit textures mitigate this.

---

## 10. Hanging Protocols

### Overview

Hanging protocols automatically arrange images in viewports based on matching rules. OHIF's implementation:

1. Registered protocols are matched against available DisplaySets
2. Each protocol gets a score based on matching rules
3. Highest-scoring protocol wins and its layout is applied

### Protocol Structure

```javascript
{
  id: 'petCt',
  protocolMatchingRules: [
    { weight: 2, attribute: 'ModalitiesInStudy', constraint: { contains: 'PT' }, required: true },
    { weight: 1, attribute: 'ModalitiesInStudy', constraint: { contains: 'CT' } }
  ],
  displaySetSelectors: {
    ptDisplaySet: {
      seriesMatchingRules: [
        { attribute: 'Modality', constraint: { equals: 'PT' }, required: true }
      ]
    },
    ctDisplaySet: {
      seriesMatchingRules: [
        { attribute: 'Modality', constraint: { equals: 'CT' }, required: true }
      ]
    }
  },
  stages: [{
    stageActivation: {
      enabled: { minViewportsMatched: 2 },
      passive: { minViewportsMatched: 0 }
    },
    viewportStructure: { /* grid layout */ },
    viewports: [
      { displaySets: [{ id: 'ctDisplaySet' }] },
      { displaySets: [{ id: 'ptDisplaySet' }] }
    ]
  }]
}
```

### Matching Rules

Match on any DICOM attribute or custom attributes:
- Modality, SeriesDescription, ModalitiesInStudy
- Custom attributes: `sameAs` (cross-DisplaySet equality), `maxNumImageFrames`, `numberOfDisplaySets`
- Rules have `weight` (for scoring) and `required` (mandatory vs optional)

### Stages

Protocols can have multiple stages with different viewport layouts:
- **enabled**: Fully applicable (enough matching viewports)
- **passive**: Applicable but incomplete
- **disabled**: Insufficient data

### Synchronization

Hanging protocols can define viewport synchronization rules (scroll sync, W/L sync, etc.) via the SyncGroupService.

### Events

- `NEW_LAYOUT`: New layout requested
- `PROTOCOL_CHANGED`: Protocol or stage changed
- `RESTORE_PROTOCOL`: Protocol restored after mode exit
- `STAGE_ACTIVATION`: Stage status computed

---

## 11. Segmentation and Annotation

### Annotation Architecture

Cornerstone3D stores annotations in **3D world space** (FrameOfReference coordinates), not per-image. This enables sharing annotations across Stack and Volume viewports.

**Rendering**: Annotations render as **SVG elements** overlaid on the canvas. SVG ensures crisp rendering at any monitor resolution.

**Coordinate conversion**: `viewport.canvasToWorld()` and `viewport.worldToCanvas()` convert between screen and patient coordinate systems.

**State management**: FrameOfReference-based state manager with APIs for:
- `annotation.state` -- stores all annotations
- `annotation.selection` -- selection/deselection (Shift+click)
- `annotation.locking` -- prevent modification
- `annotation.config` -- styling configuration

### Annotation Tools

**Manipulation tools:**
- WindowLevelTool
- PanTool
- ZoomTool
- StackScrollMouseWheelTool
- CrosshairsTool

**Measurement/annotation tools:**
- LengthTool
- HeightTool
- BidirectionalTool
- RectangleROITool
- EllipseROITool
- CircleROITool
- ProbeTool
- ArrowAnnotateTool
- AngleTool
- CobbAngleTool
- PlanarFreehandROITool

**Segmentation tools:**
- BrushTool (various strategies)
- CircleScissorsTool
- RectangleScissorsTool
- SphereScissorsTool
- ThresholdTool

### Segmentation Architecture

**Decoupled model**: `Segmentation` (data) is separate from `SegmentationRepresentation` (visual). One segmentation can have multiple representations:

| Representation | Status | Use Case |
|---------------|--------|----------|
| **Labelmap** | Fully implemented | Manual segmentation, algorithm output |
| **Contour** | Implemented (v3.12) | RT Structure Sets, planar contours |
| **Surface** | Implemented | 3D visualization, mesh rendering |

**Polymorphic segmentation (PolySeg)**: Automatic conversion between representations. Requires `@icr/polyseg-wasm` package.

**Viewport-centric** (v3.9+): Each viewport manages its own segmentation representations. Only one segmentation is "active" (modifiable) per viewport.

### DICOM Interoperability

| Format | Extension | Support |
|--------|-----------|---------|
| DICOM SR | cornerstone-dicom-sr | Read/write structured reports, measurement hydration |
| DICOM SEG | cornerstone-dicom-seg | Read/write segmentation objects |
| DICOM RT Struct | cornerstone-dicom-rt | Read RT Structure Sets, cross-plane projection |
| DICOM Labelmap | Built-in (v3.11+) | New IOD for faster, smaller segmentations |
| SCOORD3D | Built-in (v3.11+) | 3D coordinate annotations across planes |

### Measurement Tracking Workflow

1. Draw annotations in viewer
2. Track measurements across series/studies
3. Export as DICOM SR
4. Re-import DICOM SR to "hydrate" measurements back into viewer

---

## 12. DICOM Support

### Parsing Library

**dicomParser** (cornerstonejs/dicomParser):
- Lightweight JavaScript parser for DICOM Part 10 data
- No external dependencies
- Browser and Node.js compatible
- Lazy parsing: defers type conversion until requested
- Guards against corrupt data with sanity checking
- Handles both Part 10 and raw byte streams

**dcmjs** (dcmjs-org/dcmjs):
- Higher-level DICOM manipulation
- Bidirectional Part 10 binary <-> DICOMweb JSON conversion
- "Naturalized" programmer-friendly DICOM format
- Creates DICOM Segmentation and Structured Report objects
- No rendering, networking, or transcoding (separate packages)

### Supported Transfer Syntaxes

| UID | Name | Codec |
|-----|------|-------|
| 1.2.840.10008.1.2 | Implicit VR Little Endian | Native |
| 1.2.840.10008.1.2.1 | Explicit VR Little Endian | Native |
| 1.2.840.10008.1.2.2 | Explicit VR Big Endian | Native |
| 1.2.840.10008.1.2.5 | RLE Lossless | C++ WASM |
| 1.2.840.10008.1.2.4.50 | JPEG Baseline (8-bit) | libjpeg-turbo WASM |
| 1.2.840.10008.1.2.4.51 | JPEG Baseline (12-bit) | libjpeg-turbo WASM |
| 1.2.840.10008.1.2.4.57 | JPEG Lossless (Process 14) | jpeg-lossless-decoder-js |
| 1.2.840.10008.1.2.4.70 | JPEG Lossless (Process 14, SV1) | jpeg-lossless-decoder-js |
| 1.2.840.10008.1.2.4.80 | JPEG-LS Lossless | CharLS WASM |
| 1.2.840.10008.1.2.4.81 | JPEG-LS Lossy | CharLS WASM |
| 1.2.840.10008.1.2.4.90 | JPEG 2000 Lossless | OpenJPEG WASM |
| 1.2.840.10008.1.2.4.91 | JPEG 2000 Lossy | OpenJPEG WASM |
| 3.2.840.10008.1.2.4.96 | HTJ2K (experimental) | OpenJPEG WASM |
| 1.2.840.10008.1.2.1.99 | Deflated Explicit VR | Native + inflate |

### WASM Codec Architecture

The `@cornerstonejs/codecs` monorepo contains three codec packages compiled to WebAssembly:
- **charls-js**: JPEG-LS (CharLS)
- **libjpeg-turbo-js**: JPEG Baseline/Extended (libjpeg-turbo)
- **openjpegjs**: JPEG 2000 / HTJ2K (OpenJPEG)

Codecs are loaded dynamically at runtime when needed, reducing initial bundle size.

### Supported Modalities and SOP Classes

Through its extension system, OHIF supports:
- **CT, MR, PT (PET), NM** -- Standard cross-sectional imaging
- **US** -- Ultrasound (dedicated mode in v3.11)
- **CR, DX, MG** -- Radiography, mammography
- **RT Dose, RT Struct** -- Radiation therapy
- **DICOM SEG** -- Segmentation objects
- **DICOM SR** -- Structured reports
- **DICOM PDF** -- Encapsulated PDF (via dicom-pdf extension)
- **DICOM Video** -- Encapsulated video (via dicom-video extension)
- **Whole Slide Imaging** -- Pathology microscopy (via cornerstone-microscopy extension)
- **Parametric Maps** -- AI-driven visualizations
- **Secondary Capture** -- SC images

---

## 13. Deployment

### Build Output

OHIF builds to static files (HTML, CSS, JS, fonts, images) via Webpack:

```bash
APP_CONFIG=config/my-config.js yarn build
# Output: platform/app/dist/
```

### Deployment Options

| Method | Complexity | Best For |
|--------|-----------|----------|
| **Netlify Drop** | Drag and drop | Quick demo |
| **Surge.sh** | CLI one-liner | Quick demo |
| **GitHub Pages** | Git push | Open-source projects |
| **Docker** | docker-compose | Production with PACS |
| **AWS S3 + CloudFront** | Terraform/CLI | Scalable production |
| **GCP + Cloudflare** | CLI | Google Cloud Healthcare |
| **Azure** | Portal/CLI | Microsoft Azure Healthcare |
| **Nginx reverse proxy** | docker-compose | On-premise with PACS |

### Docker

Official Docker images at `ohif/app` on Docker Hub, built via CI/CD. Docker Compose files set up both OHIF and image archive (Orthanc or DCM4CHEE).

### PACS Integration

**Orthanc** (recommended for development):
- Lightweight DICOM server
- DICOMweb plugin
- Docker-ready
- DIMSE C-STORE on port 4242
- Web UI on port 8042

**DCM4CHEE Archive 5.x** (enterprise):
- Java-based, enterprise-grade
- Full DICOMweb support
- Docker deployment available

**Google Cloud Healthcare API**:
- Scalable cloud DICOM storage
- Near-complete DICOMweb API
- OAuth 2.0 authentication
- OHIF Docker container supports Client ID via environment variable

**Microsoft Azure Healthcare APIs**:
- Azure DICOM service
- OHIF configuration guide available

### Authentication

- OpenID Connect (configurable flows)
- Keycloak integration guide (with Orthanc and DCM4CHEE)
- OAuth2 proxy support
- SSL/TLS configuration for Docker

### Embedding

V3 supports **iframe embedding** (script-tag embedding deprecated due to web worker/vtk.js dependencies). Communication via `postMessage` API.

### CORS

Required when viewer and data source are on different origins. Must be configured on the image archive server.

---

## 14. Package Ecosystem

### Core Cornerstone3D Packages

| Package | Purpose |
|---------|---------|
| `@cornerstonejs/core` | Rendering engine, viewports, cache, VoxelManager |
| `@cornerstonejs/tools` | Annotation, manipulation, segmentation tools |
| `@cornerstonejs/dicom-image-loader` | DICOM parsing, decoding, WADO-RS/URI loading |
| `@cornerstonejs/streaming-image-volume-loader` | Progressive volume construction from 2D slices |
| `@cornerstonejs/nifti-volume-loader` | NIfTI neuroimaging format support |
| `@cornerstonejs/adapters` | Format adapters |

### OHIF Platform Packages

| Package | Purpose |
|---------|---------|
| `@ohif/app` | Framework connector, routing, extension/mode composition |
| `@ohif/core` | Business logic, managers, services |
| `@ohif/ui` | React component library (original) |
| `@ohif/ui-next` | Shadcn UI-based components (v3.10+) |
| `@ohif/i18n` | Internationalization |

### OHIF Extension Packages

| Package | Purpose |
|---------|---------|
| `@ohif/extension-default` | Layout, study browser, DICOMWeb datasource |
| `@ohif/extension-cornerstone` | 2D/3D rendering via Cornerstone3D |
| `@ohif/extension-cornerstone-dicom-sr` | DICOM Structured Reports |
| `@ohif/extension-cornerstone-dicom-seg` | DICOM Segmentation |
| `@ohif/extension-cornerstone-dicom-rt` | DICOM RT Struct |
| `@ohif/extension-dicom-pdf` | PDF viewport |
| `@ohif/extension-dicom-video` | Video viewport |
| `@ohif/extension-measurement-tracking` | Longitudinal measurements |
| `@ohif/extension-tmtv` | Total Metabolic Tumor Volume |

### DICOM Libraries

| Package | Purpose |
|---------|---------|
| `dcmjs` | DICOM manipulation (Part 10, JSON, SR/SEG creation) |
| `dicom-parser` | Low-level DICOM Part 10 byte stream parsing |
| `@cornerstonejs/codecs` | WASM decoders (OpenJPEG, CharLS, libjpeg-turbo) |
| `dcmjs-dimse` | DICOM DIMSE networking (C-STORE, C-FIND, etc.) |
| `dcmjs-imaging` | Image rendering |
| `dcmjs-codecs` | Transfer syntax transcoding |

### Supporting Libraries

| Package | Purpose |
|---------|---------|
| `@icr/polyseg-wasm` | Polymorphic segmentation conversion |
| `vtk.js` | 3D rendering backbone (WebGL, ray-casting) |
| `jpeg-lossless-decoder-js` | JPEG Lossless decoding (JS, no WASM) |

---

## 15. Academic Citation

**Primary paper:**

> Ziegler E, Urban T, Brown D, Petts J, Pieper SD, Lewis R, Hafey C, Harris GJ. "Open Health Imaging Foundation Viewer: An Extensible Open-Source Framework for Building Web-Based Imaging Applications to Support Cancer Research." *JCO Clinical Cancer Informatics*. 2020;4:336-345. DOI: [10.1200/CCI.19.00131](https://ascopubs.org/doi/10.1200/CCI.19.00131). PMC: [PMC7259879](https://pmc.ncbi.nlm.nih.gov/articles/PMC7259879/).

---

## 16. Relevance to Our Viewer

### What We Can Learn

**Architecture patterns we should study:**
- The extension/mode composition pattern is elegant but overkill for us. However, the *idea* of separating rendering, tools, and data loading into clean layers is valuable.
- Pub/sub service pattern for state management (vs Redux) is the direction we should go if we ever need more complex state.
- Offscreen canvas rendering with shared GPU textures is the gold standard for multi-viewport performance.

**Rendering decisions that validate ours:**
- Cornerstone3D chose vtk.js as the rendering backbone. We already decided on vtk.js for our 3D volume rendering. OHIF's experience confirms this is the right choice.
- Their offscreen canvas + texture sharing architecture solves the multi-viewport GPU problem we'll eventually face.
- Their progressive loading (HTJ2K) is cutting-edge and something we should watch but don't need yet.

**Technical details relevant to our implementation:**
- Their WASM codec approach (OpenJPEG, CharLS, libjpeg-turbo compiled to WASM, loaded dynamically) is more sophisticated than our approach. We use browser-native JPEG decoding and OpenJPEG WASM.
- Their VoxelManager pattern (avoid allocating large scalar arrays, work image-by-image) is a memory optimization we should consider for our 3D volume rendering.
- The 16-bit texture optimization via EXT_texture_norm16 halves GPU memory -- directly applicable to our vtk.js integration.
- Their LUT/W-L pipeline is "the most performance-sensitive code" -- validates that our W/L implementation needs to be optimized.

**What we intentionally avoid:**
- The full OHIF extension/mode system adds massive complexity. Our vanilla JS SPA approach is deliberately simpler.
- DICOMweb/PACS integration is not our primary use case (we do client-side File System Access API).
- React dependency tree. Our vanilla JS approach has zero framework dependencies.
- Their 217+ documentation pages reflect an enterprise-grade project. We aim for focused simplicity.

### Key Architectural Differences

| Aspect | OHIF | Our Viewer |
|--------|------|------------|
| Framework | React 18 + Tailwind + Shadcn | Vanilla JS |
| Rendering | vtk.js via Cornerstone3D | Canvas 2D (+ planned vtk.js for 3D) |
| State | Zustand stores + pub/sub services | Plain JS state object |
| Data source | DICOMweb (WADO-RS/URI) | File System Access API |
| DICOM parsing | dicomParser + dcmjs | Custom parser in index.html |
| Architecture | Extension/mode composition | Single SPA |
| Bundle size | Large (React + vtk.js + all codecs) | Minimal (no framework) |
| Deployment | Docker + PACS | Static files / Flask / Tauri |

### What to Watch

- **Cornerstone3D 2.x VoxelManager**: Study the implementation before our vtk.js integration
- **HTJ2K progressive loading**: Future consideration for server-based workflows
- **EXT_texture_norm16**: Enable when we add volume rendering
- **Contour segmentation tools (v3.12)**: New representation type for RT workflows
- **DICOM Labelmap IOD (v3.11)**: New standard for faster segmentation storage

---

## Sources

- [OHIF Official Documentation](https://docs.ohif.org/)
- [Cornerstone.js Documentation](https://www.cornerstonejs.org/)
- [OHIF/Viewers GitHub](https://github.com/OHIF/Viewers)
- [cornerstonejs/cornerstone3D GitHub](https://github.com/cornerstonejs/cornerstone3D)
- [dcmjs-org/dcmjs GitHub](https://github.com/dcmjs-org/dcmjs)
- [cornerstonejs/dicomParser GitHub](https://github.com/cornerstonejs/dicomParser)
- [cornerstonejs/codecs GitHub](https://github.com/cornerstonejs/codecs)
- [OHIF Architecture Documentation](https://docs.ohif.org/development/architecture/)
- [OHIF Extensions Documentation](https://docs.ohif.org/platform/extensions/)
- [OHIF Modes Documentation](https://docs.ohif.org/platform/modes/)
- [OHIF Hanging Protocol Service](https://docs.ohif.org/platform/services/data/hangingprotocolservice/)
- [OHIF UI Services](https://docs.ohif.org/platform/services/ui/)
- [OHIF DICOMweb Configuration](https://docs.ohif.org/configuration/datasources/dicom-web/)
- [OHIF Deployment Overview](https://docs.ohif.org/deployment/)
- [OHIF Educational Resources](https://docs.ohif.org/resources/)
- [Cornerstone3D RenderingEngine](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/renderingengine/)
- [Cornerstone3D Viewports](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/viewports/)
- [Cornerstone3D VoxelManager](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/voxelmanager/)
- [Cornerstone3D Image Loaders](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/imageloader/)
- [Cornerstone3D Streaming Volumes](https://www.cornerstonejs.org/docs/concepts/streaming-image-volume/streaming/)
- [Cornerstone3D Progressive Loading](https://www.cornerstonejs.org/docs/concepts/progressive-loading/advance-retrieve-config/)
- [Cornerstone3D Segmentation](https://www.cornerstonejs.org/docs/concepts/cornerstone-tools/segmentation/)
- [Cornerstone3D Annotations](https://www.cornerstonejs.org/docs/concepts/cornerstone-tools/annotation/)
- [Cornerstone3D Tools](https://www.cornerstonejs.org/docs/concepts/cornerstone-tools/tools/)
- [Cornerstone3D FAQ](https://www.cornerstonejs.org/docs/faq/)
- [Legacy to Cornerstone3D Migration](https://www.cornerstonejs.org/docs/migration-guides/legacy-to-3d/)
- [Cornerstone3D 2.0 Migration](https://www.cornerstonejs.org/docs/migration-guides/2x/general/)
- [OHIF v3.9 Release Notes](https://ohif.org/release-notes/3p9/)
- [OHIF v3.11 Release Notes](https://ohif.org/release-notes/3p11/)
- [OHIF About Page](https://ohif.org/about/)
- [OHIF Academic Paper (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7259879/)
- [OHIF Academic Paper (JCO CCI)](https://ascopubs.org/doi/10.1200/CCI.19.00131)
- [Cornerstone WADO Image Loader Transfer Syntaxes](https://github.com/cornerstonejs/cornerstoneWADOImageLoader/blob/master/docs/TransferSyntaxes.md)
- [MGH OHIF Press Release](https://www.massgeneral.org/news/press-release/open-health-imaging-foundation)
- [Radical Imaging](https://radicalimaging.com/)
- [OHIF llms.txt](https://docs.ohif.org/llms.txt)
