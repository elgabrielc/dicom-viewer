# Viewer Surface

## Role

The viewer is the focused viewing workspace -- where the user opens a single study to read, scroll, measure, and annotate. The image is primary.

## Character Benchmarks

The viewer models after consumer apps with serious technical depth, not legacy clinical workstations:

- **Darkroom** -- dark, image-first, precise controls inside a calm shell
- **Lightroom** -- professional tooling without the harshness of a pro-only interface
- **Photos edit mode (Apple)** -- consumer-accessible surface that still carries calibration and precision

myradone's viewer is a consumer surface with real technical depth. Accuracy and legibility are non-negotiable. The shell around that accuracy stays calm, warm, and human -- not the clinical grey of a PACS reading station. "Consumer" never means "dumbed down" here.

## Durable Direction

- dark, low-glare atmosphere (image-first, not professional posture)
- restrained warm accents instead of blue neon
- clear utility hierarchy for window/level, pan, zoom, measure, and reset
- strong separation between series navigation, image plane, and metadata

## Layout Model

- header with back navigation, study title, and help
- left series panel
- central image panel with compact toolbar and slice controls
- right metadata panel

## Visual Rules

- Keep the image plane visually quiet.
- Do not let decorative backgrounds or gradients compete with the scan itself.
- Amber should be used for emphasis and state, not to wash the whole viewer.
- Viewer chrome should feel calm and serious: image-first, low-glare, precise.

## Precision Biases

- Calibration warnings and window/level readouts must remain legible.
- Tool states should be clear even in peripheral vision.
- Metadata should be easy to scan without overpowering the image.
- Future advanced modes should inherit the same disciplined chrome.

## Implementation Note

The checked-in CSS still uses an older navy/blue system for the viewer. Treat the
warmer dark direction in `docs/design/brand-system.md` as the intended future
state when visual work resumes here.
