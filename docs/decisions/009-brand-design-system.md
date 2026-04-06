# ADR 009: Brand & Design System

**Status**: Accepted
**Date**: 2026-04-06
**Deciders**: Gabriel Casalduc

## Context

The app needed a cohesive visual identity spanning the product (myRadOne), the parent brand (Divergent Health Technologies), and all UI components. Design decisions were made iteratively through exploration of 100+ variants across logos, icons, colors, and typography.

## Decisions

### Brand Hierarchy

| Brand | Usage | Logo |
|-------|-------|------|
| **Divergent Health Technologies** | Parent company, landing page, legal | DIVERGENT.health |
| **myRadOne** | Product, app, desktop icon | myRadOne wordmark |

### Color System: Emerald Variant

Selected over the sage variant. Warm neutrals for the library, emerald-dark for the viewer.

**Neutrals (warm)**:
| Token | Hex | Name |
|-------|-----|------|
| `--color-light` | `#FFF8F3` | Light (primary bg) |
| `--color-dawn` | `#F2F0E2` | Dawn (secondary bg) |
| `--color-sand` | `#E5E0D4` | Sand (borders, muted bg) |
| `--color-stone` | `#C4BFB3` | Stone (muted elements) |
| `--color-drift` | `#A09B8F` | Drift (secondary text) |
| `--color-ash` | `#6B6660` | Ash (body text) |
| `--color-charcoal` | `#3D3A36` | Charcoal (primary text) |

**Accent**: Amber `#F08C00` (primary), emerald `#2D9B54` (success/status)

**Viewer dark mode**: `#0F1E14` bg, `#14281A` panels, emerald tint throughout

### Typography

| Role | Font | Notes |
|------|------|-------|
| UI / body | Inter | Sans-serif, self-hosted for Tauri CSP |
| Headings / brand | Lora | Serif, self-hosted |
| DH ".health" | Source Serif 4 italic | More slanted than Lora for the parent brand |

Fonts are self-hosted under `docs/fonts/` because Tauri's CSP blocks Google Fonts. The app must work offline.

### myRadOne Product Logo

**Selected**: v10 #07

| Part | Font | Weight | Color |
|------|------|--------|-------|
| "myRad" | Lora | 400 | `#F08C00` (amber) |
| "One" | Lora | 500 | `#C4BFB3` (stone) |
| Tagline | Inter | 400 | `#A09B8F` (drift) |

- Tagline: "One place for all your medical imaging"
- Tagline gap: 1.5rem (24px)
- Dark variant: "One" becomes `rgba(255,255,255,0.4)`
- Preferred background: `#FFF8F3` (light)
- App uses an outlined SVG (paths, not text) to avoid font-loading issues in WKWebView

### myRadOne App Icon Candidates

Explored extensively. Current favorites use amber gradient background with Lora "mR" + Inter superscript/inline "1" in white. Final selection pending.

### Divergent Health Logo

**Selected**: v11 #05

| Part | Font | Weight | Color |
|------|------|--------|-------|
| "DIVERGENT" | Inter | 500, uppercase | ash 60% `rgba(107,102,96,0.6)` |
| "." | Inter | 500 | `#F08C00` (amber), upright |
| "health" | Source Serif 4 | 400, italic | `#F08C00` (amber) |

- Kerning: dot pulled -0.08em toward DIVERGENT
- Dot-to-health spacing: 0.08em
- Tagline: "We think differently" / "So we can make a real difference for your health."

### Folder Icon

Amber tint SVG folder for the drop zone:
- Body fill: `rgba(240,140,0,0.15)` (15%)
- Stroke: `rgba(240,140,0,0.55)` (55%), 2px
- Tab: `rgba(240,140,0,0.65)` (65%)

### Key Rejected Alternatives

| What | Why rejected |
|------|-------------|
| Sage green palette | Too muted; chose vibrant emerald |
| Dark backgrounds for icons | User preference: light backgrounds only |
| SVG `<text>` for logo in app | WKWebView doesn't reliably load fonts in SVG; use outlined paths |
| Full charcoal (100%) for "One" | Too dark; stone is softer |
| Kalam handwriting for ".health" | Tested extensively but Source Serif 4 italic won for professionalism |

## Design Archive

Full iteration history (60+ variant files) is maintained in:
- `~/claude 0/colors/` -- exploration HTML files
- `~/claude 0/divergent-landing/brand-archive.html` -- tabbed archive with Current/Full History sections
- `~/claude 0/colors/logo-final/` -- final myRadOne logo assets and spec

## Consequences

- All UI components use the design token system (CSS custom properties)
- Fonts must be self-hosted for desktop app (no external CDN dependencies)
- Logo changes require Figma export to outlined SVG (text-based SVG is unreliable in Tauri)
- The design archive preserves rejected iterations for future reference
