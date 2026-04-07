# Viewer Surface

## Role

The viewer is the focused clinical workspace. The image must remain primary.

## Durable Direction

- dark, low-glare atmosphere
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
- Viewer chrome should feel calm and serious, not flashy or consumer-app bright.

## Clinical Usability Biases

- Calibration warnings and window/level readouts must remain legible.
- Tool states should be clear even in peripheral vision.
- Metadata should be easy to scan without overpowering the image.
- Future advanced modes should inherit the same disciplined chrome.

## Implementation Note

The checked-in CSS still uses an older navy/blue system for the viewer. Treat the
warmer dark direction in `docs/design/brand-system.md` as the intended future
state when visual work resumes here.
