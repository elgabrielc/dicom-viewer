# Research: How Microsoft Word Handles In-App Updates on macOS

## Summary

Microsoft Word uses **Microsoft AutoUpdate (MAU)**, a dedicated standalone updater application shared across all Microsoft 365 apps. MAU is an industrial-grade update system with background daemon checks, three tiers of delta updates, enterprise configurability, and CDN-backed distribution. It is vastly more complex than what an indie app needs, but its architecture reveals best practices.

## Architecture

### Separate Updater Application

MAU is its own app (`/Library/Application Support/Microsoft/MAU2.0/Microsoft AutoUpdate.app`), installed alongside Office. It runs independently of Word/Excel/etc. This is the opposite of the Sparkle model (embedded framework) or Tauri's model (built-in plugin).

### Background Daemon

- MAU registers as a **macOS Login Item** (System Settings > Login Items & Extensions)
- A background daemon checks for updates **every 12 hours**
- It examines a **version number in an XML manifest** hosted on Microsoft's CDN
- Compares the manifest version against the locally installed app version
- Communication between the CLI tool (`msupdate`) and the daemon uses **native XPC**

### CDN and Manifest Structure

Microsoft hosts manifests on a public CDN:
```
https://res.public.onecdn.static.microsoft/mro1cdnstorage/C1297A47-86C4-4C1F-97FA-950631F94777/MacAutoupdate/
```

Manifest URL pattern: `<ChannelURL>/0409<AppID><extension>`
Extensions: `.xml`, `-chk.xml`, `.cat`, `-history.xml`

Channels: Current, Preview, Beta, CurrentThrottle (Outlook only)

Enterprises can override the manifest server and update cache to serve from local HTTPS servers.

## Three Tiers of Updates

| Type | Description | Size | Speed |
|------|-------------|------|-------|
| **Full** | Complete app replacement | ~1-2 GB | Medium |
| **File Delta** | Only changed files between versions | Medium | Fastest |
| **Binary Delta** | Byte-level diffs within files | Smallest | Slowest (CPU-intensive) |

### Delta Update Rules

- Delta updates are generated from the **3 most recent releases** per channel
- If the installed version is older than 3 releases back, only full updates are offered
- Binary delta can fail if security software modifies installed app files
- **Automatic fallback**: if binary delta fails, MAU falls back to file delta, then full

### Selection Logic

MAU chooses update type based on:
1. Whether the app supports smaller updates (only core Office apps do)
2. The `UpdaterOptimization` preference (`Bandwidth`, `CPU`, or `None`)
3. Availability of delta packages for the installed version
4. Available disk space

## User Experience Flow

### Automatic Mode (default)
1. Background daemon detects new version via manifest XML
2. Update downloads silently in the background
3. When ready, MAU shows a notification (newer versions use "badge" notifications instead of OS alerts)
4. If the app is open, MAU prompts the user to close it
5. Update applies, app restarts
6. Some updates require system restart (MAU notifies)

### Manual Mode
1. User opens MAU or clicks "Check for Updates" in Word > Help menu
2. MAU window shows available updates with "Update" button
3. User clicks Update, download begins with progress bar
4. Same close-app-and-apply flow as above

### Enterprise Mode
- Admins can set **deadlines** for updates (force install by date)
- Updates can be sourced from internal servers instead of Microsoft CDN
- Per-app channel configuration (e.g., Word on Current, Teams on Preview)
- `msupdate` CLI for scripted/MDM-driven updates

## Relevance to DICOM Viewer

### What to learn from MAU:
- **Manifest-based version checking** is the universal pattern (Sparkle uses appcast XML, MAU uses manifest XML, Tauri uses JSON endpoint)
- **Delta updates** save bandwidth but add complexity; worth it at scale, not for a small app
- **Background checking** is expected -- users shouldn't have to manually check
- **Graceful app-close flow** is important when updates need the app to restart
- **Fallback to full update** is essential resilience

### What NOT to copy:
- MAU is a separate application -- overkill for a single-product company
- Enterprise channel management, per-app settings, MDM integration -- not relevant yet
- Binary delta generation pipeline -- requires significant infrastructure

### Recommendation for DICOM Viewer:
Tauri's built-in updater plugin follows the same conceptual model as MAU but at indie scale:
- JSON manifest on a static host (GitHub Releases or S3)
- Ed25519 signature verification (like MAU's `.cat` catalog files)
- Background check on launch
- Download + apply flow with app restart
- Full updates only (no delta) -- fine for a ~150MB app

## Sources

- https://learn.microsoft.com/en-us/microsoft-365-apps/mac/updater-types-used-by-microsoft-autoupdate
- https://learn.microsoft.com/en-us/microsoft-365-apps/mac/mau-configure-organization-specific-updates
- https://learn.microsoft.com/en-us/microsoft-365-apps/mac/mau-preferences
- https://learn.microsoft.com/en-us/microsoft-365-apps/mac/update-office-for-mac-using-msupdate
- https://support.microsoft.com/en-us/office/allow-microsoft-autoupdate-to-run-in-the-background-on-macos-93b5dd2a-2395-4780-80b6-00811b774f06
