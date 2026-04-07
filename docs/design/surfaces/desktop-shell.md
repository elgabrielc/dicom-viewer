# Desktop Shell

## Role

The desktop shell turns the web core into a product. Branding here should feel
shipped, not improvised.

## Durable Direction

- app identity should ultimately align with `myRadOne`
- desktop icon should come from the approved amber lettermark family
- window chrome should stay minimal and let the app UI carry the personality
- bundled assets must respect Tauri CSP and offline use

## Current Technical Constraints

- `desktop/src-tauri/tauri.conf.json` still uses `DICOM Viewer` for
  `productName` and the main window title.
- Tauri CSP favors self-hosted fonts and local assets.
- Final desktop-facing marks should prefer outlined SVG or equivalent
  production-safe assets.

## Packaging Notes

- DMG styling, app icon, and shell metadata should be treated as one coherent
  branding pass rather than scattered follow-up tweaks.
- The desktop shell should never depend on live font CDNs.
