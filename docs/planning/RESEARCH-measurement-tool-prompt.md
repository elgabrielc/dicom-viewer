# Research Question: Ambra Health DICOM Viewer Measurement Implementation

## Context
I'm building a DICOM viewer and benchmarking how professional medical imaging viewers implement measurement tools. I've already researched Horos and NilRead. Now I need to understand Ambra Health's approach.

## Specific Questions

1. **Calibration and Pixel Spacing**: How does Ambra handle DICOM pixel spacing (0028,0030) and ImagerPixelSpacing (0018,1164) for converting pixel measurements to real-world units (mm)?

2. **Uncalibrated Images**: What happens when images lack DICOM pixel spacing metadata? Does Ambra:
   - Show measurements in pixels with a warning?
   - Hide/disable measurement tools entirely?
   - Offer a manual calibration option?

3. **Interaction Model**: How does the Measure Line tool work?
   - Click-drag? Click-click (two points)?
   - How are endpoints displayed and adjusted?
   - Can measurements be edited after creation?

4. **Display Format**: How are measurements shown?
   - What units (mm, cm, pixels)?
   - What precision (decimal places)?
   - Where is the label positioned?

5. **Clinical Warnings**: Are there any documented warnings about:
   - Measurement accuracy limitations?
   - Conditions where measurements may be unreliable?
   - FDA/regulatory considerations?

## Sources to Check
- Ambra Health official documentation
- FDA 510(k) submissions for Ambra viewer (K231360)
- DICOM conformance statements
- User guides and technical specifications
- Any public information about their web viewer architecture

## Output Format
Provide implementation details that would help a developer understand architectural decisions and tradeoffs for building a similar measurement tool.
