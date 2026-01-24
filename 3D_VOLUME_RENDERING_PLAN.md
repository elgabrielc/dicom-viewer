# 3D Volume Rendering Implementation Plan

## Project Goal
Add 3D volume rendering capabilities to our DICOM CT Viewer web application.

**Current objective**: Minimum viable product to demonstrate 3D capability and learn. This is the foundation for what will eventually become a large, complex system.

---

## Guiding Principles

When making design and architectural decisions, prioritize:

### Core Values
1. **Efficiency** - Don't be wasteful with resources
2. **Reliability** - It should work consistently
3. **Security** - Healthcare data requires careful handling
4. **Longevity** - Choices should age well
5. **Optionality** - Preserve ability to change and grow

### Technical Principles
6. **Modularity** - The 3D system should be cleanly separable from the 2D viewer. They should evolve independently. If 3D becomes its own product, we shouldn't have to untangle it from everything else.

7. **Graceful degradation** - When 3D fails (old browser, weak GPU, WebGL context loss), the app should handle it gracefully. Users should always be able to fall back to 2D.

8. **Testability** - 3D rendering bugs are hard to diagnose. We need a strategy for verifying correctness (visual regression tests, reference images, etc.).

### Dependency Evaluation Criteria

When evaluating libraries/tools, use these rules of thumb:

#### Scale Reference (npm weekly downloads)
| Category | Downloads | Examples |
|----------|-----------|----------|
| Dominant | 20M+ | React (57M) |
| Mainstream | 2-10M | Vue, Angular, Three.js (2.7M) |
| Established niche | 100K-2M | Specialized tools |
| Small | 10K-100K | Emerging or very specialized |
| Risky | <10K | Unless very new or niche |

*Assumption: Downloads can be inflated by CI, but order of magnitude is meaningful.*

#### GitHub Health Indicators
| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| Last commit | <1 month | 1-6 months | >1 year |
| Last release | <3 months | 3-12 months | >1 year |
| Issue response | Days | Weeks | Months/ignored |
| Contributors | 50+ | 10-50 | <10 |
| Bus factor | 5+ core | 2-4 core | 1 (dangerous) |

*Assumption: Niche project with 15 active contributors can be healthier than popular one with 500 drive-by contributors.*

#### Backing/Funding Tiers

**Tier 1 - High confidence:**
- Major tech companies with strategic interest (Google, Meta, Microsoft)
- Government/academic institutions (NIH, NSF, DARPA, national labs)
- Established foundations (Linux Foundation, Apache)
- Companies where software IS the core business

**Tier 2 - Good confidence:**
- VC-backed companies (risk: pivot pressure)
- Consortium of companies with shared interest
- ESOP/employee-owned companies

**Tier 3 - Moderate confidence:**
- Crowdfunded (GitHub Sponsors, Open Collective)
- Single corporate sponsor (risk: sponsor leaves)

**Tier 4 - Low confidence:**
- Solo maintainer hobby project
- Unfunded volunteer effort on critical infrastructure

*Assumption: Funding doesn't guarantee quality, but reduces abandonment risk.*

### Healthcare-Specific
9. **Regulatory awareness** - This isn't a medical device today, but architectural choices now could help or hurt future FDA clearance. Consider: deterministic rendering, data integrity, audit trails. We don't implement these now, but we shouldn't preclude them.

### Process
10. **Decision documentation** - Document *why* we made choices, not just what. Future-us will need this context.

---

**Technology selection bias**: Favor methods and tools that are well-established and proven effective in healthcare, academia, and technology products.

**Decision-making rule**: When choosing between a safe/incumbent path and a promising/innovative path, discuss in depth. The answer is often nuanced and context-dependent.

---

## Research Summary

### Reference Implementations Studied
1. **Kitware's vtk.js** - Open-source, CVR built-in, WebGL 2.0
2. **Med3Web/MRI Viewer** - Three.js + custom GLSL shaders, 2D texture atlas approach
3. **AMI Toolkit** - Three.js-based medical imaging toolkit
4. **Cinematic Volume Rendering Paper** (Xu et al., 2022) - Kitware's research on in-browser CVR

### Key Technical Insights

#### From the CVR Paper:
- **Gradient shading** (Phong model with surface normals) is fast and preferred for CT
- **Hybrid shading** (gradient + volumetric) provides best visual quality
- **Density gradient** works better than scalar gradient (avoids normal flipping)
- **Gradient opacity** accentuates edges without complex transfer functions
- Interactive frame rates achievable on consumer GPUs (NVIDIA, Apple Silicon)
- Multiple scatter is too slow for real-time rendering

#### WebGL Approaches:
| Approach | Pros | Cons |
|----------|------|------|
| vtk.js | CVR built-in, medical-optimized, WebXR ready | Larger bundle (~500KB) |
| Three.js + custom shaders | Smaller bundle, full control | More development work |
| Raw WebGL 2 | Maximum performance | Very complex |

---

## Technology Decision

**[DECISION NEEDED]** Which approach should we use?

### Option A: vtk.js with CVR
- Use Kitware's battle-tested implementation
- Gradient shading, hybrid mode, LAO already included
- Fastest path to high-quality rendering
- Larger bundle size

### Option B: vtk.js Basic
- Use vtk.js for volume rendering basics
- Start simple, add CVR features incrementally
- Balance between speed and control

### Option C: Three.js Custom
- Write custom GLSL ray-casting shaders
- Smaller bundle, matches our vanilla JS approach
- More work but educational
- Reference: Med3Web uses this approach

---

## Rendering Features to Implement

### Phase 1: Core Volume Rendering
- [ ] Load all slices into 3D texture/volume buffer
- [ ] Basic ray-casting (direct volume rendering)
- [ ] Transfer function (HU to RGBA mapping)
- [ ] Mouse rotation/zoom controls
- [ ] View mode toggle (2D Slices / 3D Volume)

### Phase 2: Basic Presets
- [ ] CT Bone preset (high density = white/opaque)
- [ ] CT Soft Tissue preset
- [ ] MIP mode (Maximum Intensity Projection)

### Phase 3: Enhanced Rendering (CVR)
- [ ] Gradient-based shading (Phong lighting)
- [ ] Gradient opacity (edge enhancement)
- [ ] Adjustable light position

### Phase 4: Advanced (Future)
- [ ] Hybrid shading (gradient + volumetric)
- [ ] Local Ambient Occlusion (LAO)
- [ ] Clipping planes
- [ ] 3D measurements

---

## UI Design

### View Mode Toggle
```
[ 2D Slices ] [ 3D Volume ] [ MIP ]
```

### 3D Controls Panel
```
Preset: [Bone v] [Soft Tissue] [Lung] [Custom]

Quality: [Fast] [Normal] [High Quality]

[ Reset View ]
```

### Rendering Quality Levels
- **Fast**: Direct volume rendering, lower sample rate
- **Normal**: Gradient shading
- **High Quality**: Hybrid shading (gradient + volumetric)

---

## Performance Considerations

### Memory Requirements
- 512 x 512 x 300 slices (Int16) = ~150MB
- Need progress indicator while loading volume
- May need to downsample very large volumes

### GPU Requirements
- WebGL 2.0 required (3D textures)
- Works on most modern GPUs (2017+)
- Intel integrated GPUs may struggle with full volumetric shading

### Browser Limits
- JavaScript heap typically limited to 2GB
- Need to handle WebGL context loss gracefully

---

## Files to Modify

### Primary: `/templates/index.html`
- Add vtk.js or Three.js script
- Add 3D viewport container
- Add view mode toggle UI
- Add volume loading function
- Add rendering initialization
- Add preset controls

### Secondary: `/static/css/style.css`
- 3D viewport styling
- Control panel styling
- Toggle button styling

---

## Open Questions

1. **Bundle size vs features**: Do we prioritize smaller bundle (Three.js) or faster implementation (vtk.js)?

2. **Initial scope**: Start with just MIP (simpler) or go straight to full volume rendering?

3. **Presets**: What CT visualization presets should we include?

4. **Quality levels**: Should we offer Fast/Normal/High Quality options?

5. **Loading UX**: How should we handle the delay while loading all slices into volume?

---

## Resources

- vtk.js Documentation: https://kitware.github.io/vtk-js/
- vtk.js CVR Example: https://kitware.github.io/vtk-js/examples/WebXRHeadGradientCVR.html
- Kitware CVR Paper: Xu et al., 2022 (in project folder)
- Med3Web Source: https://github.com/epam/mriviewer
- Will Usher WebGL Tutorial: https://www.willusher.io/webgl/2019/01/13/volume-rendering-with-webgl/

---

## Notes

_Add discussion notes here_

