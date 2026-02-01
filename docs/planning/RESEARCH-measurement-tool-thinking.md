# Research Thinking Process

## Initial Assessment

The user is benchmarking medical imaging viewers to understand measurement tool implementation patterns before building their own. They've already researched Horos and NilRead. Now they need Ambra Health's approach.

## Research Strategy

1. **Direct documentation search** - Look for Ambra user guides, technical specs
2. **FDA 510(k) submission** - Often contains technical details for cleared medical devices
3. **DICOM conformance statements** - Standard document for DICOM implementations
4. **Parent company docs** - Ambra was acquired by Intelerad, so InteleViewer docs may apply
5. **Third-party guides** - Hospital/clinic-specific guides sometimes have more detail

## Key Findings and Reasoning

### Finding 1: Documentation Gap

Ambra's publicly available user guides are operational quick-reference documents, not technical specifications. They explain HOW to use tools but not HOW they work internally. This is common for commercial medical software - implementation details are proprietary.

**Implication**: Need to infer from related Intelerad documentation and observable behavior.

### Finding 2: Intelerad Connection

Since Ambra is now part of Intelerad, the InteleViewer documentation provides the most detailed technical information. InteleViewer explicitly documents:
- Three-attribute calibration system (IPS, PS, ERMF)
- Validity rules (IPS > PS)
- Manual calibration fallback
- Warning message system

**Assumption**: Ambra's web viewer likely uses similar or identical calibration logic, possibly as a shared library or API.

### Finding 3: Interaction Model Consistency

All guides consistently describe click-and-drag for line measurements. This matches Horos and NilRead - it's the industry standard pattern.

### Finding 4: Unit Display Strategy

Ambra uses automatic mm/cm switching at 100mm threshold. This is different from:
- Horos: Always shows cm (or µm for small values)
- NilRead: Configurable units

This is a UX decision with tradeoffs:
- Pro: Avoids tiny decimals (0.01 cm) or large numbers (150 mm)
- Con: Unit changes during interaction could confuse users

### Finding 5: Uncalibrated Image Handling

The InteleViewer docs mention "Measurements are uncertain" warning and manual calibration tool. This is a middle-ground approach:
- Less strict than NilRead (which hides measurements entirely)
- Less permissive than Horos (which shows pixels without explicit warning)

## Questions That Remain Unanswered

1. **Anisotropic pixel handling** - What happens when row and column spacing differ?
2. **Measurement persistence** - Are measurements saved as DICOM SR, GSPS, or proprietary format?
3. **Web vs desktop parity** - Does the web viewer have identical calibration to InteleViewer?
4. **Rounding rules** - How exactly are 2 decimal places computed (truncate, round, banker's rounding)?

## Synthesis for User's Implementation

The three viewers benchmarked represent a spectrum of approaches to uncalibrated images:

| Approach | Viewer | Safety vs Usability |
|----------|--------|---------------------|
| Hide measurements | NilRead | Maximum safety, minimum usability |
| Warning message | Ambra | Balanced |
| Show in pixels | Horos | Maximum usability, requires user awareness |

For clinical use, I would recommend the Ambra/InteleViewer approach:
1. Attempt automatic calibration from DICOM attributes
2. Show warning when calibration is uncertain or unavailable
3. Provide manual calibration tool as fallback
4. Always clearly label units

This balances clinical safety (users are warned) with practical usability (measurements are still available with appropriate caution).
