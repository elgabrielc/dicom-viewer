# Research: How Todoist Handles In-App Updates on macOS

## Summary

Todoist uses **Electron with Squirrel.Mac** for its direct-download macOS app, providing silent background downloads with a gentle restart prompt. It also ships via the **Mac App Store**, where Apple handles updates natively. The dual-distribution model is a pragmatic approach worth studying.

## Technology Stack

Todoist's macOS desktop app is built with **Electron**, using an optimized shell with custom native bridges in Swift/Objective-C for macOS-specific features (global keyboard shortcuts, Spotlight indexing). The app packages resources in Electron's `.asar` format and bundles native modules like `keytar` for credential management.

## Update Mechanism: Squirrel.Mac (Direct Download)

For the version downloaded from todoist.com:

### How It Works

1. **Electron's `autoUpdater`** module is built on top of **Squirrel.Mac**, a Cocoa framework for seamless macOS app updates
2. The app checks a server endpoint for a `RELEASES.json` file containing the latest version metadata
3. If a newer version is available, the update is **downloaded automatically in the background**
4. The app does NOT interrupt the user during download

### RELEASES.json Format

Squirrel.Mac reads a JSON manifest:
```json
{
  "url": "https://server/path/to/release.zip",
  "name": "Release Name",
  "notes": "Release notes HTML",
  "pub_date": "2026-03-28T00:00:00Z"
}
```

For static hosting (no server needed), the app points to a URL that serves this JSON. For dynamic servers, returning 204 No Content means "no update available."

### Requirements
- The app **must be code-signed** for Squirrel.Mac to work
- Updates are distributed as `.zip` files containing the full `.app` bundle
- No delta updates -- full replacement each time

## User Experience Flow

### Visual Notification
1. Update downloads silently in the background
2. An **orange dot** appears on the user's avatar in the app
3. Clicking the avatar reveals a **green line/banner** saying "Restart to update"
4. User clicks to restart -- app quits, installs update (~10 seconds), relaunches

### Key UX Decisions
- **No modal dialog** interrupting work
- **No forced updates** -- user chooses when to restart
- **Subtle visual indicator** (dot on avatar) rather than alert/notification
- Update is pre-downloaded by the time the user sees the dot
- Installation happens on quit, not on launch (no slow startup)

## Mac App Store Distribution (Alternative)

Todoist is also available on the Mac App Store (app ID: 585829637). For this version:
- Apple handles all updates automatically via the App Store
- Users get updates through System Settings > App Store preferences
- No Squirrel/Electron updater involved -- Apple's infrastructure handles everything
- Updates may lag behind the direct-download version

### Dual Distribution Tradeoffs

| Aspect | Direct Download | Mac App Store |
|--------|----------------|---------------|
| Update speed | Immediate (self-controlled) | Apple review delay |
| Update mechanism | Squirrel.Mac (self-managed) | Apple-managed |
| Sandboxing | Not required | Required |
| Revenue | No Apple cut | 30% Apple commission |
| Discovery | Website/SEO | App Store search |
| Trust signal | Code signing + notarization | App Store badge |

## Relevance to DICOM Viewer

### What to learn from Todoist:
- **Silent background download + subtle restart prompt** is the gold standard UX
- The orange-dot-on-avatar pattern is non-intrusive and effective
- **Dual distribution** (direct + App Store) maximizes reach but doubles maintenance
- Full `.zip` replacement (no delta) works fine for reasonably-sized apps
- Static JSON manifest on a CDN is all you need -- no dynamic server required

### Comparison to Tauri's Updater

Tauri's built-in updater plugin follows an almost identical pattern to Squirrel.Mac:

| Feature | Squirrel.Mac (Todoist) | Tauri Updater |
|---------|----------------------|---------------|
| Manifest format | `RELEASES.json` | Custom JSON endpoint |
| Signature verification | Code signing | Ed25519 |
| Download format | `.zip` of full `.app` | `.tar.gz` of update |
| Background download | Yes | Yes |
| Restart to apply | Yes | Yes |
| Static hosting | Supported | Supported (GitHub Releases) |

### Recommendation
Tauri's updater gives us Todoist-equivalent UX with less effort:
- Host the update manifest on GitHub Releases
- The app checks on launch, downloads in background
- Show a subtle "Update available -- restart" indicator in the UI
- No Mac App Store needed initially (adds sandboxing complexity)

## Sources

- https://www.todoist.com/help/articles/update-todoist-to-the-latest-version-G8Oa5yeHV
- https://www.electronjs.org/docs/latest/api/auto-updater/
- https://www.electronjs.org/docs/latest/tutorial/updates
- https://github.com/electron/Squirrel.Mac
- https://www.electron.build/auto-update.html
- https://apps.apple.com/us/app/todoist-to-do-list-calendar/id585829637
