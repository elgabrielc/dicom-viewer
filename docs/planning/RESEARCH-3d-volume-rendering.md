# 3D Volume Rendering Research

Architecture considerations and implementation status for adding 3D volume rendering to the DICOM viewer.

## Implementation Status

**Status:** Research complete, not started.

**Technology decision:** vtk.js (industry standard, NIH-funded via Kitware, ~500KB bundle).

**Related Docs:**

- [Competitive benchmarks](RESEARCH-3d-volume-rendering-benchmarks.md) -- Onshape, Fusion 360, 3D Slicer/vtk.js, Horos: comparison tables, transfer functions, presets, GPU ray casting, recommended path
- [PLAN-3d-volume-rendering.md](PLAN-3d-volume-rendering.md) -- implementation plan
- [CLAUDE.md → Current Work](../../CLAUDE.md#current-work-3d-volume-rendering) -- next steps
- [SITEMAP.md](SITEMAP.md#current-work-in-progress) -- project structure

---

## Architecture Considerations

These principles were articulated during the research phase and should anchor the implementation when work starts.

### Modularity

The 3D system should be cleanly separable from the 2D viewer. They should be able to evolve independently. If 3D becomes its own product surface later, untangling it from a tightly-coupled implementation is expensive. Concretely: 3D code lives in its own file/module from day one, with a defined interface against the rest of the viewer.

### Graceful degradation

3D can fail for many reasons -- old browser, weak GPU, WebGL context loss, unsupported hardware. The app must handle this without crashing, and users must always be able to fall back to 2D viewing.

Practical implications:

- Detect WebGL 2 support before the user tries to use 3D; surface a clear message if unsupported.
- WebGL context loss handlers must restore state or fail gracefully.
- 2D viewing must not depend on 3D infrastructure being healthy.

### Testability

3D rendering bugs are notoriously hard to diagnose because the output is inherently visual. Test strategy needs to be designed up front, not bolted on later.

Approaches to consider:

- Visual regression tests with reference images.
- Unit tests for transfer-function math, blend modes, ray-casting parameter selection.
- Headless rendering for CI.

### Healthcare-aware architecture

This is not a medical device today, and there's no near-term plan to seek FDA clearance. But certain architectural choices made now could close that door later. Things worth not foreclosing:

- Deterministic rendering (same input produces same output).
- Data integrity through the rendering pipeline.
- Audit-trail-friendly logging hooks.

We don't need to implement these now; we need to avoid choices that preclude them.

---

## Dependency Evaluation Criteria

When choosing 3D libraries, evaluate beyond "established":

- **Maintenance:** Last commit, release frequency, issue-response cadence.
- **Backing:** Company, foundation, individual? NIH/Kitware-backed projects (vtk.js) sit much higher than individual maintainers.
- **Community size:** Big enough to find help when stuck. For JS 3D libraries, healthy communities are 50,000+ stars, 1,000+ contributors, weekly releases.
- **Exit path:** What's the migration story if the project dies? Are there alternatives we could swap in?

For vtk.js specifically: Kitware backing, weekly releases, NIH funding, used by 3D Slicer and OHIF/Cornerstone3D. Low risk on all four criteria.

---

## See Also

The full benchmark of how Onshape, Fusion 360, 3D Slicer/vtk.js, and Horos approach 3D rendering -- including transfer-function design, preset systems, GPU ray casting pipelines, and the comparison matrix that drove the vtk.js decision -- lives in [RESEARCH-3d-volume-rendering-benchmarks.md](RESEARCH-3d-volume-rendering-benchmarks.md).
