# Research Thinking Process

## Approach

A single research agent ran 83 tool calls across OHIF's official documentation (docs.ohif.org), Cornerstone.js documentation (cornerstonejs.org), GitHub repositories (OHIF/Viewers, cornerstonejs/cornerstone3D, dcmjs-org/dcmjs, cornerstonejs/dicomParser), release notes, the academic paper (PMC7259879), and community resources. Being open-source, we got significantly deeper than with the proprietary vendors.

## Key Findings

### Cornerstone3D's Offscreen Canvas Architecture

The most technically interesting finding: Cornerstone3D uses a single shared offscreen WebGL canvas for all viewports, with pixels copied to on-screen canvases. This solves the browser's WebGL context limit (max 16 per tab) and enables GPU texture sharing across viewports. A PET-CT layout with 9 viewports and 2 volumes creates only 2 GPU textures instead of 18. This is the kind of deep optimization that matters at scale.

The newer ContextPoolRenderingEngine (v3.11+) improves on this by pooling WebGL contexts (default 8) with viewport-sized offscreen canvases, eliminating the legacy TiledRenderingEngine's 16,384px canvas limit.

### VoxelManager Pattern

Cornerstone3D 2.0 introduced VoxelManager, which replaces large pre-allocated scalar data arrays with image-by-image access. This halves memory usage for volumes because you don't need to allocate the full volume array upfront -- data is streamed image-by-image and converted on demand. This is directly relevant to our planned vtk.js integration.

### JPEG Lossless Thread Safety Bug

A notable finding: the `jpeg-lossless-decoder-js` library (which we also use!) has a documented thread-safety bug in OHIF. The Decoder class stores temporary data in instance attributes, causing image corruption when multiple web workers share a singleton instance. We should verify whether this affects our implementation.

### HTJ2K Progressive Loading

OHIF has first-class HTJ2K progressive loading with sophisticated staging: load middle/first/last slices first, then decimate (every Nth), then fill gaps. Combined with byte-range requests, this enables lossy-to-lossless progressive refinement. This directly validates our ADR 004 direction for the cloud platform.

### Extension/Mode Complexity

OHIF's extension/mode system is powerful but adds enormous complexity: 10 module types, service-based state, React Context providers nested 6 levels deep, pub/sub patterns, Zustand stores. This is enterprise-grade architecture for a platform that needs to support dozens of clinical workflows and third-party plugins. Our vanilla JS SPA is deliberately simpler and that's the right choice for our stage.

## What This Means for Us

### Directly Applicable
1. **VoxelManager pattern** -- study before our vtk.js integration
2. **EXT_texture_norm16** (16-bit WebGL textures) -- enable for volume rendering, halves GPU memory
3. **Shared GPU textures** -- when we add multi-viewport support
4. **Progressive loading stages** -- for cloud platform (ADR 004)
5. **JPEG Lossless thread safety** -- verify our implementation

### Worth Watching
1. **ContextPoolRenderingEngine** -- better than tiled approach for many viewports
2. **Contour segmentation** (v3.12) -- if we add annotation/segmentation
3. **DICOM Labelmap IOD** (v3.11) -- new standard, faster than DICOM SEG

### Deliberately Different
1. **React vs vanilla JS** -- we stay vanilla
2. **Extension/mode system** -- overkill for us
3. **DICOMweb primary** -- we're File System Access API primary
4. **Full PACS integration** -- not our current scope

## Confidence Assessment

High confidence across the board. Open-source means we can verify everything against source code. The documentation at docs.ohif.org and cornerstonejs.org is extensive (217+ pages). The academic paper provides authoritative context on governance, funding, and adoption. GitHub stats are live data.
