# Bug Tracking

Known issues, bugs, and their resolution status.

---

## Open Bugs

*No open bugs currently tracked.*

---

## Resolved Bugs

### BUG-009: macOS dock icon not updated after app update

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | Medium |
| **Found** | 2026-04-07 |
| **Resolved** | 2026-04-08 |
| **Root Cause** | macOS Icon Services caches rendered bitmaps separately from LaunchServices metadata. Tauri updater currently replaces the bundle and runs `touch`, which does not reliably refresh the rendered icon cache. |
| **Fix** | Best-effort interim fix: run `lsregister -f` once per app version at startup, gated to packaged `.app` bundles, and retry on the next launch if the command fails. |
| **Follow-up** | Replace the `lsregister` shell-out with `LSRegisterURL` FFI so the app uses the public CoreServices API directly. |
| **Verification** | Validated with a real packaged in-app update from a disposable `0.3.0` QA app (amber `A` icon) to `0.3.1` (blue `B` icon) over an HTTPS updater feed. Finder showed the new icon after the updated app launched, `.last_lsregister_version` advanced to `0.3.1`, and the marker timestamp stayed unchanged on the following launch. |
| **Workaround** | `lsregister -f /Applications/myradone.app && killall Finder && killall Dock` |

**Notes:**
- The startup workaround skips dev-mode binaries automatically because it only runs for resolved `.app` bundle paths.
- `lsregister -f` is the strongest available best-effort signal today, but it still cannot guarantee an immediate Icon Services bitmap refresh on every macOS version.

### BUG-008: Desktop native decode bridge crashed on unaligned typed-array payloads

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | High |
| **Found** | 2026-03-30 |
| **Resolved** | 2026-03-30 |
| **Commit** | 50a4565 |

**How Encountered:**
PR #54 failed the Playwright validation job on `tests/desktop-native-decode.spec.js`
with `RangeError: start offset of Uint16Array should be a multiple of 2` and the
same error for `Int16Array`. The failure reproduced in both the unsigned and signed
desktop decode bridge tests.

**Root Cause:**
`decode_frame_with_pixels` returns a binary payload shaped as:

1. 4-byte little-endian JSON header length
2. JSON metadata bytes
3. raw pixel bytes

The frontend split out the pixel payload with `bytes.subarray(pixelOffset)` and then
constructed `Uint16Array`/`Int16Array` directly over that view. If the JSON header
length was odd, `pixelOffset` could be odd too, which violates typed-array alignment
requirements for 16-bit sample arrays.

**Solution:**
- Updated `docs/js/app/desktop-decode.js` so `coercePixelData(...)` copies the pixel
  bytes into a fresh aligned `Uint8Array` only when the incoming `byteOffset` is not
  compatible with the target typed-array element size.
- Kept the fast path for already aligned payloads.

**Why This Solution:**
Alternatives considered:
- *Pad the native payload* - Rejected; the binary protocol is otherwise correct and
  changing it would add unnecessary churn across the Rust/JS boundary.
- *Always copy pixel bytes* - Rejected; simpler, but it adds avoidable overhead on
  the common aligned case.

Chose conditional realignment because it fixes the crash without changing the bridge
contract or imposing a universal copy penalty.

**Prevention:**
- Playwright coverage now explicitly exercises both unsigned and signed 16-bit decode
  payloads through the combined binary response path.
- The desktop decode bridge test no longer assumes that `decode_frame_with_pixels`
  is the only startup-time `invoke` call, so unrelated desktop debug plumbing will
  not mask payload coercion regressions.

**Files Changed:**
- `docs/js/app/desktop-decode.js`
- `tests/desktop-native-decode.spec.js`

---

### BUG-007: Desktop XA scrubbing could apply stale W/L overrides across mixed-domain frames

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | High |
| **Found** | 2026-03-29 |
| **Resolved** | 2026-03-30 |
| **PR** | #54 |

**How Encountered:**
During desktop validation on a multi-frame XA study, aggressive slice scrubbing and
W/L drag could drive the image nearly black while the viewer continued to report a
valid slice number and modality. The issue showed up most clearly on XA series that
mixed larger 12/16-bit frames with smaller 8-bit frames.

**Root Cause:**
The viewer carried a user W/L override forward while scrubbing, but it did not keep a
stable notion of which slice defaults that override was anchored to. Two bad outcomes
followed:

1. A W/L override created on a 12/16-bit XA frame could be applied to a later 8-bit
   frame with a very different default W/L domain, making the image appear almost
   black.
2. Because `baseWindowLevel` was also being updated every frame, the reset heuristic
   compared the current frame against the immediately previous frame instead of the
   original override anchor.

**Solution:**
- Split the viewer state into:
  - `baseWindowLevel`: the current slice defaults for HUD/reset display
  - `windowLevelAnchor`: the slice defaults the active user override is anchored to
- Updated `renderPixels(...)` to clear a stale W/L override automatically when the
  next slice crosses into an obviously incompatible display domain.
- Added targeted desktop library tests covering both:
  - clearing a 12-bit XA override on an incompatible 8-bit frame
  - preserving an override across compatible XA frames

**Why This Solution:**
Alternatives considered:
- *Reset W/L on every scrub* - Rejected; this would make real user W/L adjustments
  feel broken for normal same-domain scrubbing.
- *Never reset automatically* - Rejected; it preserves user intent only until mixed
  bit-depth XA series produce unusable images.

Chose a frozen override anchor plus domain-shift reset because it preserves normal
W/L behavior while still protecting the viewer from clearly incompatible carryover.

**Prevention:**
- Added regression coverage for mixed-domain XA scrubbing behavior.
- Documented the `INCOMPATIBLE_WINDOW_WIDTH_RATIO` heuristic in `rendering.js`.
- Frontend decode trace logging remains available for desktop repros so future
  scrub/W/L regressions can be attributed quickly.

**Files Changed:**
- `docs/js/app/rendering.js`
- `docs/js/app/state.js`
- `docs/js/app/tools.js`
- `tests/desktop-library.spec.js`

---

### BUG-006: Desktop import could exhaust memory by fully reading duplicate and invalid files

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | Critical |
| **Found** | 2026-03-29 |
| **Resolved** | 2026-03-30 |
| **PR** | #54 |

**How Encountered:**
The Tauri desktop app reached roughly 14-16 GB of memory while importing a large
real-world folder. The failure was easiest to reproduce on import runs dominated by
duplicates, invalid files, and collision checks, where macOS eventually surfaced the
"system has run out of application memory" dialog.

**Root Cause:**
The desktop import pipeline parsed metadata by pulling full files across the Tauri
bridge too early:

1. Duplicate and invalid files still paid the cost of `fs.readFile(...)` before the
   pipeline knew whether they should be skipped.
2. Destination-path derivation depended on UIDs, but the staged header-read logic
   stopped as soon as `SOPInstanceUID` was present instead of waiting for
   `StudyInstanceUID`, `SeriesInstanceUID`, and `SOPInstanceUID`.
3. Size checks for existing destination paths sometimes required extra source reads
   instead of using the scan manifest's size metadata.

This created very large transient raw buffers during import-heavy runs even when the
final outcome was "skip", "invalid", or "collision".

**Solution:**
- Added header-first metadata probing with `read_scan_header` and staged reads before
  full-file import.
- Continued staged header expansion until all destination UIDs needed by
  `buildDestinationPath(...)` were available.
- Used manifest/source size metadata for duplicate-vs-collision checks where
  possible.
- Delayed the full `fs.readFile(...)` bridge transfer until the pipeline had
  confirmed that the file was a valid, new DICOM that actually needed to be copied.
- Added reusable desktop memory capture/report/session tooling so the team can
  validate memory plateaus with real studies instead of relying on anecdotal reports.

**Why This Solution:**
Alternatives considered:
- *Only shrink the viewer cache* - Rejected; it improved steady-state viewing memory
  but did not address import runs that never needed to decode images at all.
- *Raise cache limits or rely on GC* - Rejected; the problem was unnecessary bridge
  traffic and raw-buffer allocation, not just cache retention.

Chose staged header reads plus delayed full-file copies because that removes the
largest avoidable allocations at the source and makes duplicate-heavy imports cheap.

**Prevention:**
- Added Playwright coverage proving that duplicates and invalid files do not trigger
  full file reads.
- Kept the desktop memory dashboard and one-command capture session in-repo to make
  future memory regressions measurable.
- Added import header coverage ensuring staged reads continue until Study, Series,
  and SOP UIDs are all available.

**Files Changed:**
- `docs/js/app/import-pipeline.js`
- `scripts/desktop-memory-capture.py`
- `scripts/desktop-memory-report.py`
- `scripts/desktop-memory-session.sh`
- `tests/desktop-import.spec.js`

---

### BUG-005: Multi-agent cloud sync build dropped 460 lines of desktop code due to stale branch

| Field | Value |
|-------|-------|
| **Status** | Resolved (by Codex rewrite) |
| **Priority** | Critical |
| **Found** | 2026-03-25 |
| **Resolved** | 2026-03-26 |
| **PR** | #41 |

**How Encountered:**
PR #41 (cloud sync v1) passed 244 tests locally but failed 80 of 397 tests on CI.
Desktop persistence tests reported `initializeDesktopStorage is not a function`.
Sync protocol and E2E tests failed at `setupSyncUser()` due to status code mismatches.

**Root Cause:**
A cascading failure with three links:

1. **Stale branch.** The orchestrator started multi-agent work on `local/WIP`, which
   had diverged from `main` by 40 commits. Main's `docs/js/api.js` was 1548 lines.
   `local/WIP`'s was 739 lines -- missing the entire desktop persistence pipeline
   (migration, scan cache, library config, report storage) that was added by merged
   PRs after the branch diverged. The orchestrator never ran `git log HEAD..origin/main`
   to check.

2. **Split on stale code.** The Stage 1 client-split agent was told to split `api.js`
   into four modules. It correctly split the 739-line file it had. But the resulting
   modules were missing ~460 lines of desktop functions that existed on main. The agent
   reported "all tests pass" because it was true -- for the stale branch.

3. **Test exclusions masked the damage.** The orchestrator ran tests with
   `--grep-invert "Suite 35|Suite 36|..."` to skip known auth-test failures. This
   also excluded the desktop persistence tests that would have caught the missing
   functions. Every integration checkpoint reported 244/244 pass. The first time the
   full suite ran was on CI, where 80 tests failed.

Additionally:
- `tests/sync-helpers.js` asserted `toBe(200)` for signup and device registration,
  but the server returned 201. This cascaded through all 48 sync/E2E tests.
- Tombstone filtering in `loadNotes()` missed series-level comments and had field
  name mismatches (`deleted_at` vs `deletedAt`).
- Three review-fix cycles by Claude Code each introduced new issues (dual sync
  engine, stale token reads, localStorage instead of SQLite for outbox).

**Solution:**
Codex performed a clean rewrite of the affected modules, restoring the missing
desktop functions, fixing test assertions, and implementing proper user isolation
with separate cloud tables.

**Prevention Controls:**
1. **CLAUDE.md** and **AGENT_WORKTREES.md** now require a mandatory divergence check
   (`git log HEAD..origin/main`) before any multi-agent work. If diverged, rebase first.
2. **Never exclude failing tests.** `--grep-invert` to skip failures is prohibited.
   Every failure must be investigated. If pre-existing, verify on main.
3. **Memory entries** saved for future sessions:
   - `feedback_rebase-before-splitting.md` -- never split files that differ from main
   - `feedback_never-exclude-failing-tests.md` -- investigate failures, don't filter
   - `feedback_orchestrator-review-against-plan.md` -- verify architecture match
   - `feedback_check-divergence-at-preflight.md` -- check divergence before starting
   - `feedback_know-when-to-hand-off.md` -- hand off after repeated failures

---

### BUG-004: Packaged Tauri app hid desktop library UI and included non-image DICOM objects

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | High |
| **Found** | 2026-03-08 |
| **Resolved** | 2026-03-08 |
| **Commit** | 7f330b1 |

**How Encountered:**
In the packaged macOS Tauri app, the saved desktop library controls were missing at startup until a sample study was loaded. After the library became visible, one real XR study from `/Users/gabriel/Desktop/radiology all discs` showed bogus series entries with `No pixel data found`, and a valid JPEG 2000 image series showed `JPEG 2000 decode failed`.

**Root Cause:**
This was a combination of three desktop-only issues:
1. Packaged Tauri startup raced the plain-script frontend. The app could detect "desktop" before `window.__TAURI__` was ready, so desktop library initialization and native bridge setup were inconsistent.
2. Desktop folder scans admitted any parseable DICOM object with a study UID, including Structured Reports and other non-image objects that have no renderable pixel data.
3. JPEG 2000 decoding in packaged mode assumed a simple `js/<asset>` path for the WASM asset and manually read the first fragment instead of the full encapsulated frame, which was brittle for the packaged webview runtime.

**Solution:**
- Added a plain-script Tauri compatibility shim and startup readiness promise so packaged desktop mode waits for the runtime before initializing desktop-only features.
- Rendered the saved desktop library configuration immediately on startup while the background rescan continues.
- Tightened desktop scan admission to include only renderable image metadata (`study UID` + `pixel data` + non-zero `rows/cols`).
- Updated JPEG 2000 loading to resolve the WASM asset relative to the decoder script and read the encapsulated image frame through `dicomParser.readEncapsulatedImageFrame(...)`.
- Applied the same renderable-image filter to sample loading for consistency across sources.

**Why This Solution:**
Alternatives considered:
- *Only hide bad series in the viewer* - Rejected; non-image objects should be filtered out at ingest so library counts and series lists stay correct.
- *Hardcode another packaged asset path* - Rejected; brittle across local server, preview, and Tauri packaged origins.
- *Treat the startup issue as cosmetic* - Rejected; it made desktop configuration look unavailable and obscured whether persisted library state had loaded.

Chose a runtime-shim plus renderable-image admission model because it fixes the root contract mismatch between web and packaged desktop sources, instead of layering special cases on the viewer.

**Prevention:**
- Added Playwright coverage for packaged Tauri runtime detection and late-arriving `__TAURI_INTERNALS__`.
- Added Playwright coverage ensuring saved desktop library config is visible before a slow startup scan completes.
- Added a regression test for the renderable-image metadata helper so non-image DICOM objects stay excluded from library scans.
- Kept the full Playwright suite as the shared regression guard, then rebuilt the packaged macOS bundle from the fixed tree.

**Files Changed:**
- `docs/index.html`
- `docs/js/config.js`
- `docs/js/tauri-compat.js`
- `docs/js/app/main.js`
- `docs/js/app/desktop-library.js`
- `docs/js/app/dicom.js`
- `docs/js/app/sources.js`
- `tests/desktop-library.spec.js`
- `tests/desktop-runtime-compat.spec.js`

---

### BUG-003: Playwright tests fail when Flask server not running

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | High |
| **Found** | 2026-02-01 |
| **Resolved** | 2026-02-01 |
| **Commit** | cab5c31 |

**How Encountered:**
All 41 Playwright tests were timing out with "page.waitForSelector: Timeout 30000ms exceeded" waiting for the canvas to become visible. Error screenshots showed "Loading test data..." message stuck indefinitely, with "No studies loaded" in the studies table.

**Root Cause:**
Tests require the Flask server to be running on `http://127.0.0.1:5001` before they execute. The test infrastructure had no mechanism to start the server automatically - it was expected to be running in a separate terminal. When the server wasn't running, API calls to `/api/test-data/studies` failed silently, leaving the viewer stuck in loading state.

**Solution:**
Added Playwright `webServer` configuration to `playwright.config.js`:
```javascript
webServer: {
  command: './venv/bin/flask run --host=127.0.0.1 --port=5001',
  url: 'http://127.0.0.1:5001/api/test-data/info',
  reuseExistingServer: !process.env.CI,
  timeout: 60000,
}
```

Key details:
- Uses `./venv/bin/flask` (absolute path to venv) because Playwright spawns a shell without the activated venv
- Checks `/api/test-data/info` endpoint instead of root `/` - this ensures the test data scan completes before tests start (root responds immediately, but test data API may still be loading)
- `reuseExistingServer: !process.env.CI` - reuses running server locally (faster iteration), always starts fresh in CI
- 60s timeout allows for initial test data scan of ~2500 DICOM files

**Why This Solution:**
Alternatives considered:
- *npm pretest script* - Rejected; requires manual process management (backgrounding, waiting, cleanup) that Playwright webServer handles automatically
- *Document "start server first"* - Rejected; too easy to forget, causes confusing failures
- *Check only root URL* - Initially tried; caused race condition where tests started before test data API was ready

Chose Playwright webServer because it's purpose-built for this problem and handles startup, readiness checking, and cleanup automatically.

**Prevention:**
- Tests now automatically start the Flask server when needed
- CI will always start fresh, ensuring clean test environment
- Checking `/api/test-data/info` endpoint ensures test data is ready before tests begin

**Files Changed:**
- `playwright.config.js` - Added webServer configuration

---

### BUG-001: Test mode fails on series with blank first slices

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | High |
| **Found** | 2026-02-01 |
| **Resolved** | 2026-02-01 |
| **Commit** | b75f15e |

**How Encountered:**
All 41 Playwright tests were timing out with the same error: waiting for W/L display to show "C:" values. The viewer loaded, series list appeared, but canvas stayed black and no W/L values displayed.

**Root Cause:**
`renderDicom()` returns early with `isBlank: true` for uniform slices (common as padding in MPR reconstructions), skipping W/L calculation. The test's `waitForViewerReady()` waited for "C:" in W/L display text, which never appeared because `state.baseWindowLevel` was never set.

**Solution:**
1. Added auto-advance logic in test mode to skip past blank slices (up to 50) to find displayable content
2. Updated two tests to use relative slice positions instead of hardcoded values (initial slice may not be 1)

**Why This Solution:**
Alternatives considered:
- *Change test data to not start with blank slices* - Rejected; real MRI data has blank padding, tests should handle it
- *Set dummy W/L values for blank slices* - Rejected; would be misleading, blank slices genuinely have no meaningful W/L
- *Change waitForViewerReady to not require W/L* - Rejected; W/L presence is a good indicator that a real image loaded

Chose auto-advance because it mimics what a user would do (scroll to find content) and keeps tests realistic. Tradeoff: tests now start on slice 2 instead of 1, requiring relative assertions.

**Prevention:**
- Tests now use relative slice positions (`initialSlice.current + 1`) instead of hardcoded values, so they pass regardless of which slice auto-advance lands on
- Test data intentionally includes blank slices to ensure this edge case stays covered
- Added guideline: when writing slice navigation tests, always use relative positions

**Files Changed:**
- `docs/index.html` - Auto-advance past blank slices in test mode
- `tests/viewing-tools.spec.js` - Relative slice position assertions

---

### BUG-002: Git push fails with HTTP 400 on large commits

| Field | Value |
|-------|-------|
| **Status** | Resolved (workaround) |
| **Priority** | Low |
| **Found** | 2026-02-01 |
| **Resolved** | 2026-02-01 |

**Description:**
`git push` fails with "HTTP 400" and "unexpected disconnect while reading sideband packet" on commits with many lines changed.

**Root Cause:**
Default HTTP post buffer size too small for large diffs.

**Workaround:**
```bash
git config http.postBuffer 524288000
```

---

## Bug Template

Copy this template when adding new bugs:

```markdown
### BUG-XXX: Short description

| Field | Value |
|-------|-------|
| **Status** | Open / In Progress / Resolved |
| **Priority** | Critical / High / Medium / Low |
| **Found** | YYYY-MM-DD |
| **Resolved** | YYYY-MM-DD |
| **Commit** | (if resolved) |

**How Encountered:**
What were the symptoms? How was it discovered? Steps to reproduce.

**Root Cause:**
Why did this happen? What was the underlying issue?

**Solution:**
What was changed to fix it?

**Why This Solution:**
What alternatives were considered? Why was this approach chosen? Any tradeoffs?

**Prevention:**
What control was added to prevent recurrence? (test, code guideline, automated check)

**Files Changed:**
- List affected files
```

---

## Known Issues (Not Bugs)

Issues that are expected behavior or have acceptable workarounds.

### File System Access API browser requirement

Chrome 86+ or Edge 86+ required for drag-and-drop folder loading. Firefox and Safari not supported. This is by design (privacy: keep medical data client-side).

### Large DICOM series load slowly

Series with 500+ slices may take several seconds to parse. This is expected given client-side processing. Consider lazy loading for very large series in future.

---

*Last updated: 2026-03-08*
