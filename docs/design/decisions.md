# Design Decisions

This file records durable accepted and rejected design choices.

## Accepted

### 2026-03-28 - Warm-Neutral Brand Base

Adopted a warm-neutral base for brand and library surfaces instead of a cold or
clinical palette. This gives the product a calmer, more humane posture.

### 2026-03-28 - Amber As Primary Brand Accent

Amber became the primary accent color for brand emphasis, calls to action, and
human warmth. It gives the system a recognizable signal without drifting into
generic blue SaaS styling.

### 2026-04-01 - myRadOne Wordmark Direction

Selected `v10 #07` as the product lockup:

- `myRad`: Lora 400 in amber
- `One`: Lora 500 in stone
- tagline in Inter drift

The split keeps the mark warm and distinctive without overcomplicating it.

### 2026-04-01 - Tagline Spacing

Selected a `1.5rem` / `24px` gap between the wordmark and the tagline. Tighter
spacing felt cramped; wider spacing weakened the lockup.

### 2026-04-01 - Light-Only App Icon Backgrounds

Constrained app icon exploration to light or amber-family backgrounds. Dark icon
backgrounds were explicitly rejected during exploration.

### 2026-04-06 - Folder Icon

Selected the amber outlined folder treatment:

- fill 15%
- stroke 55% at 2px
- tab 65%

This gives the import zone a branded product asset instead of relying on a stock
emoji or browser-default feel.

### 2026-04-06 - Divergent Health Parent Lockup

Selected the parent-brand lockup using:

- Inter 500 uppercase `DIVERGENT`
- upright amber dot
- Source Serif 4 italic `health`

This preserved professionalism while keeping the `.health` suffix distinctive.

### 2026-04-06 - Exploration Review Format

Each option in a design exploration must include a short **Why this works** /
**Why this loses** comparison. This makes tradeoffs explicit at review time
instead of relying on implicit preference signals.

## Rejected / Closed

### Sage Primary Palette

Rejected as the main brand direction because it felt too muted for the intended
product presence. Green remains supportive, but amber plus warm neutrals is the
main system.

### Teal / Dark Pre-Rebrand Direction

Early teal-on-dark landing and mark explorations were superseded by the warmer
system. They are useful history, not the current direction.

### Dark App Icon Backgrounds

Rejected after exploration rounds. The preferred icon family lives on light or
amber backgrounds only.

### SVG Text For Shipped App Marks

Rejected for production use because text-based SVG marks are unreliable in
desktop embedding contexts that do not guarantee font availability.

### Kalam For Divergent `.health`

Rejected after exploration because it added personality at the expense of
professional confidence. Source Serif 4 italic won.

### Full Charcoal `One`

Rejected because the darker `One` felt too heavy and made the lockup harsher
than intended. Stone kept the mark softer and more balanced.

## Notes

When a new decision is approved, update this file first, then promote the same
rule into the relevant canonical doc.
