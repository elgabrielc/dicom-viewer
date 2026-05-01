# Research: How Horos Handles In-App Updates

## Summary

Horos uses a **minimal, notification-only update system** -- not a full auto-updater. It does not use Sparkle or any third-party update framework for the main application. Updates are distributed as DMG downloads from the Horos website and GitHub Releases.

## Findings

### 1. No Sparkle Framework

Despite being a mature macOS app, Horos does **not** use the Sparkle framework for auto-updates. The codebase (github.com/horosproject/horos) contains no references to Sparkle, SUUpdater, SPUStandardUpdaterController, appcast feeds, or SUFeedURL.

This is notable because Sparkle is the de facto standard for macOS app auto-updates, and OsiriX (the commercial fork Horos derives from) likely uses it in its commercial builds.

### 2. Update Check Mechanism

The codebase has a `checkForUpdates:` IBAction in `AppController.h`, conditionally compiled with `#ifndef MACAPPSTORE`. However, this appears to be a lightweight check (likely hitting a version endpoint) rather than a full download-and-install flow.

The update check is for **plugins only** by default:
- `checkForUpdatesPlugins` is a user preference (default: enabled)
- The plugin manager runs `checkForUpdates:` on a background thread at launch
- Users can manage plugins via Plugins > Manage Plugins > "Horos Plugins" tab

### 3. Distribution Model

- **Website**: horosproject.org/download/ hosts DMGs for Intel and Apple Silicon
- **GitHub Releases**: github.com/horosproject/horos/releases (43 releases, last: April 2024)
- **No auto-update**: Users manually download new versions
- **Notification only**: "Horos features a notification system that will alert you when new updates are available" (from FAQ)

### 4. User Experience Flow

1. Horos checks a remote endpoint (likely on launch) for the latest version number
2. If a newer version exists, the user sees a notification/alert
3. The user manually downloads the new DMG from the website
4. The user drags the new .app to /Applications, replacing the old one
5. No delta updates, no background downloads, no automatic installation

### 5. Why No Auto-Updater?

Likely reasons:
- Horos is a community/volunteer project with limited resources
- The app is large (~500MB+) with VTK, ITK, DCMTK bundled -- delta updates would be complex
- Medical software users tend to be conservative about updates (stability matters)
- The project has been in maintenance mode since ~2020 (last stable release: 3.3.6, Dec 2019)

## Relevance to DICOM Viewer

For our Tauri-based DICOM Viewer:
- Horos's approach (notify + manual download) is the simplest viable path
- But our app is much smaller (~150MB vs ~500MB), making auto-update more practical
- Tauri's built-in updater plugin provides delta-update support out of the box
- We should aim higher than Horos here -- Sparkle-style auto-update is standard UX for modern macOS apps

## Sources

- https://github.com/horosproject/horos
- https://horosproject.org/faqs/
- https://horosproject.org/download/
- https://github.com/horosproject/horos/releases
