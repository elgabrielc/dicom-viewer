# Real Tauri Smoke Suite

This suite launches the actual debug Tauri desktop binary through the managed desktop launcher. It is a fidelity floor for desktop startup and channel isolation, not a replacement for browser-level Playwright tests.

## Why This Is A Launch Smoke

Tauri's official WebDriver support does not cover desktop macOS because WKWebView has no native WebDriver server. This repository's active desktop surface is macOS, so the first real-Tauri suite verifies what can be checked reliably without a WebDriver bridge:

- the managed desktop launcher starts the docs server
- the actual Rust/Tauri binary reaches startup
- the dev overlay compiles into the binary as `health.divergent.dicomviewer.dev`
- the app data directory resolves to the dev channel, not production
- bundled sample data is served by the desktop docs server

The dev overlay disables updater artifact creation, but it does not set `plugins.updater` to `null`: Tauri 2 rejects `null` plugin config during startup. The frontend update UI already skips updater checks in non-packaged dev builds, so leaving the base updater plugin config valid does not make this smoke hit the production update endpoint.

Full in-window interaction and rendered-slice assertions remain future work. They require either a supported WebDriver platform, app-side test instrumentation, or a separate automation strategy.

## Running Locally

```bash
npm run test:real-tauri
```

The test is macOS-only and uses the same `desktop/scripts/dev-desktop.sh` launcher that developers use. It writes diagnostics to `tests/real-tauri/diagnostics/`.

## Diagnostics Policy

Every run writes:

- `app-stdout.log`
- `app-stderr.log`
- `versions.txt`
- `startup.png` when `screencapture` is available
- `failure.png` when the test fails and `screencapture` is available

The Playwright project allows one runner-level retry. Do not add retry loops inside the test itself; startup hangs and launch failures should remain visible.

## Stability Policy

The GitHub workflow is nightly-only at first. Do not promote it to per-PR until it has five consecutive green scheduled runs across at least seven calendar days.
