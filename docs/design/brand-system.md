# Brand System

This file captures the durable visual system for Divergent Health and myRadOne.

## Brand Hierarchy

- **Divergent Health Technologies** is the parent company and should appear on
  company-facing surfaces such as `divergent.health`, legal copy, and parent
  brand moments.
- **myRadOne** is the product brand and should lead inside the application,
  desktop shell, and product marketing.

## Color System

### Warm Neutrals

| Token | Value | Role |
| --- | --- | --- |
| `--color-light` | `#FFF8F3` | primary light background |
| `--color-dawn` | `#F2F0E2` | secondary background |
| `--color-sand` | `#E5E0D4` | borders and muted surfaces |
| `--color-stone` | `#C4BFB3` | softened brand contrast |
| `--color-drift` | `#A09B8F` | muted text and tagline |
| `--color-ash` | `#6B6660` | secondary text |
| `--color-charcoal` | `#3D3A36` | primary text |
| `--color-night` | `#1E1C1A` | deepest neutral |

### Accent and Support

| Token | Value | Role |
| --- | --- | --- |
| `--color-amber-400` | `#F08C00` | primary brand accent |
| `--color-amber-500` | `#D67D00` | accent hover / stronger emphasis |
| `--color-amber-50` | `#FFF4E6` | subtle accent wash |
| `--color-success` | `#7A9966` in current token file | success/status green |

### Viewer-Dark Atmosphere

Current approved values:

| Token | Value |
| --- | --- |
| `--color-viewer-bg` | `#0F1E14` |
| `--color-viewer-panel` | `#14281A` |
| `--color-viewer-header` | `#0A160E` |
| `--color-viewer-text` | `#EEEEEE` |

These values match ADR 009 and the committed app CSS. Older exploration files
under `design/colors/` still contain nearby but superseded dark values from the
sage branch of the system.

## Typography

| Role | Typeface | Notes |
| --- | --- | --- |
| UI / body | Inter | functional UI sans |
| Brand / headings | Lora | warmth and literary contrast |
| Divergent `.health` | Source Serif 4 italic | more distinctive than Lora italic |

### Typography Rules

- Serif is for brand voice, hero copy, and logo expression.
- Sans is for controls, tables, metadata, and dense application UI.
- Final shipped product surfaces should prefer self-hosted fonts because Tauri
  CSP and offline support are hard requirements.

## myRadOne Logo

Selected direction: `v10 #07`

- Font family: Lora
- `myRad`: Lora 400, `#F08C00`
- `One`: Lora 500, `#C4BFB3`
- Tagline: Inter 400, `#A09B8F`
- Tagline text: `One place for all your medical imaging`
- Preferred tagline gap: `1.5rem` / `24px`
- Preferred background: `#FFF8F3`
- Dark variant: `myRad` stays amber; `One` shifts to `rgba(255,255,255,0.4)`

### Asset Rule

Final app-facing logo assets should be outlined SVG paths rather than SVG text.
This avoids runtime font-loading failures in WKWebView / Tauri contexts.

## Divergent Health Logo

Selected direction:

- `DIVERGENT`: Inter 500, uppercase, `rgba(107,102,96,0.6)`
- `.`: upright Inter dot, amber, pulled left by `-0.08em`
- `health`: Source Serif 4 italic 400, amber, `0.08em` after the dot

Associated taglines explored:

- `We think differently`
- `So we can make a real difference for your health.`

## App Icon Direction

The app icon direction is narrowed but not final:

- amber or amber-gradient background only
- light foreground only
- Lora-based `mR` / `myR` letterform family with an Inter `1`
- the numeral must read clearly as `1`, not `l`

Dark icon backgrounds were explored and rejected.

## Folder Icon

Selected direction:

- fill: `rgba(240,140,0,0.15)`
- stroke: `rgba(240,140,0,0.55)` at `2px`
- tab: `rgba(240,140,0,0.65)`

The icon should feel like a product asset, not a generic emoji substitute.

## Implementation Constraints

- Desktop surfaces must tolerate Tauri CSP and offline mode.
- Self-hosted fonts are the target even if some exploration files still load
  Google Fonts.
- Durable design documentation in this directory outranks old CSS values when
  the code has not caught up yet.

## Known Migration Gaps

- The current repo still contains older blue / navy styling in checked-in CSS.
- The font strategy in code has not fully caught up to the self-hosted target,
  and some surfaces still fall back to system fonts.
- Some selected brand assets still have both committed and local exploration
  homes that should be rationalized over time.

Those gaps are implementation debt, not unresolved brand direction.
