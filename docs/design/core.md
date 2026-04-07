# Design Core

Use this file as the first read for design work in this repository.

## Brand Essence

- Divergent Health should feel calm, rigorous, warm, and quietly premium.
- myRadOne should feel like a trustworthy medical imaging library, not a cold
  radiology workstation and not a generic startup dashboard.
- The product voice is professional and humane: clear, confident, and never
  flashy for its own sake.

## Current Direction

- Warm neutral foundation for the library and marketing surfaces.
- Amber is the primary brand accent and the clearest interactive signal.
- The viewer gets a darker, calmer atmosphere with restrained warm accents.
- Serif typography carries brand warmth; sans-serif typography carries UI clarity.

## Selected Brand Moves

- myRadOne wordmark: Lora with amber `myRad` and stone `One`
- Divergent Health lockup: Inter `DIVERGENT`, upright amber dot, italic Source
  Serif 4 `health`
- Folder icon: amber-tinted outlined SVG
- App icon direction: amber-background lettermark, final candidate still pending

## Hard Constraints

- Durable brand rules live in `docs/design/`, not in private memory.
- Desktop assets must work offline and under Tauri CSP.
- Prefer self-hosted fonts for shipped product surfaces.
- Prefer outlined SVG for final brand marks used in app chrome or desktop
  packaging.
- Do not silently make broad visual direction changes after a direction has been
  approved.

## Known Implementation Lag

- The checked-in `docs/css/style.css` still reflects an older navy/blue visual
  system in several places.
- Some branded assets and fonts currently exist only in local exploration
  directories or an uncommitted checkout.
- Treat those mismatches as migration work, not as evidence that the old visual
  system is still preferred.

## Active Questions

- Which app icon candidate becomes the shipped desktop icon?
- Should the desktop shell and bundle metadata switch from `DICOM Viewer` to
  `myRadOne` now or later?
- What is the final outlined-SVG export path for the Divergent Health logo?
- Which viewer-dark token values are final once the old blue CSS is retired?

## Session Reminder

Read `brand-system.md` next, then the relevant `surfaces/*.md` file, then
`workflow.md` if the task involves exploration or promotion of new decisions.
