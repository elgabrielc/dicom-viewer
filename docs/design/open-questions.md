# Open Questions

These issues are intentionally unresolved and should stay visible between design
sessions.

## App Icon Final Selection

The icon family is narrowed to amber-background lettermarks, but the final
shipped candidate is still pending. The numeral `1` must read clearly.

## Divergent Health Production Asset Export

The parent-brand lockup direction is chosen, but the final outlined-SVG export
pipeline for app-safe use is not yet captured here.

## Desktop Naming Cutover

`desktop/src-tauri/tauri.conf.json` still uses `DICOM Viewer` for `productName`
and the window title. Decide when the shipped shell should become `myRadOne`.

## Self-Hosted Font Completion

The durable rule is self-hosted fonts for shipped surfaces, but the current repo
state is incomplete and some desktop-facing surfaces still fall back to system
fonts. Decide the final packaging plan, migration order, and timing.

## Viewer-Dark Finalization

The durable direction is a calmer dark viewer with warm accents, but the checked
in CSS still reflects an older navy system. Decide the final dark token values
when the migration happens.

## myRadOne Consumer Landing Brief

The current `surfaces/landing.md` is scoped to the Divergent Health parent brand.
In the cloud-primary end state, app.divergent.health (or myradone.com) will need
its own consumer product landing -- a different design brief: conversion-oriented,
benefit-led, patient-first, rather than a composed company brand page. Decide the
scope and distinctness of this surface when cloud work resumes.
