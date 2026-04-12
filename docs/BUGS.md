# Bug Tracking

Known issues, bugs, and their resolution status.

---

## Open Bugs

*No open bugs currently tracked.*

---

## Resolved Bugs

### BUG-011: Desktop release build blocked by missing signing key and stale DMG mounts

| Field | Value |
|-------|-------|
| **Status** | Resolved (operational) |
| **Priority** | Medium |
| **Found** | 2026-04-09 |
| **Resolved** | 2026-04-09 |
| **Scope** | Build environment, not shipped code |

**How Encountered:**
During a local macOS release build of the myradone desktop app, `npm run tauri build`
compiled cleanly and produced the `.app` bundle, but the full release pipeline failed
in two separate places in quick succession:

1. **Tauri updater signing step** halted with a missing `TAURI_SIGNING_PRIVATE_KEY`
   environment variable. The signing key for the updater tarball is only present on
   the dedicated signing host; the local build machine does not have it.
2. After switching to the `--skip-build` path (which wraps an already-built `.app`
   into a plain DMG without needing the updater key), `hdiutil create` failed with a
   permission error because a stale volume from a previous aborted DMG build was
   still mounted at `/Volumes/myradone 1`. The ` 1` suffix is macOS's automatic rename
   when a volume with the same name is already mounted, and `hdiutil` refuses to
   overwrite or reuse the conflicting mount.

Neither failure is a compile error or a code defect. Both are build-environment
conditions that any future release from a non-primary host can hit again.

**Root Cause:**
- **Missing signing key**: Tauri's full release flow bundles *two* artifacts: the
  signed `.app` and an updater tarball (`.app.tar.gz`) with a detached signature that
  the in-app updater uses to verify future updates. The tarball signing step is
  gated on `TAURI_SIGNING_PRIVATE_KEY`. On a host that does not have that key, the
  release flow aborts even though the `.app` itself is already written to disk.
- **Stale DMG mount**: macOS pseudo-mounts DMG contents under `/Volumes/<volname>`
  whenever a DMG is opened. Unclean exits (crashed builds, interrupted `hdiutil`
  runs, Finder windows left open) can leave the mount in place. On the next DMG
  build with the same `volname`, `hdiutil` hits the conflict and emits a misleading
  permission error instead of a clear "volume in use" diagnostic.

**Solution:**
Two complementary fixes: one immediate, one preventative.

Immediate (operational workaround, repeatable):
- Use the repo's existing `--skip-build` packaging path for hosts without the
  signing key:
  ```
  npm run build:plain-dmg -- --skip-build
  ```
  This consumes the already-built `.app` from
  `desktop/src-tauri/target/release/bundle/macos/` and wraps it in a plain DMG. No
  updater signing is required because plain DMGs are not signed update artifacts --
  they are standalone distributable installers. Updater signing is only needed for
  the in-app auto-update path.
- Before retrying `--skip-build`, detach any stale DMG mounts:
  ```
  hdiutil detach "/Volumes/myradone 1" -force
  ```
  (Replace the path if the volume suffix is different.) `ls /Volumes` lists all
  current mounts.

Preventative (proposed, not yet committed):
- Add a pre-packaging step to `desktop/scripts/build-plain-dmg.sh` that detects
  and detaches any existing mount whose volume name matches `PRODUCT_NAME` before
  calling `hdiutil create`. This converts the gotcha into silent self-healing.

**Why This Solution:**
Alternatives considered:
- *Require `TAURI_SIGNING_PRIVATE_KEY` on every build host* - Rejected. The key
  must stay on the signing host only; distributing it to every dev machine defeats
  the purpose. The `--skip-build` path is the correct separation: code builds
  anywhere, signing happens on the signing host.
- *Rename the DMG volume name per build* - Rejected. The volume name is the user-
  visible label when the DMG is mounted; rotating it degrades the install UX.
- *Fail loudly in `build-plain-dmg.sh` on mount conflict instead of auto-detaching* -
  Partially considered. A loud failure is better than the current opaque `hdiutil`
  error, but auto-detach is strictly better because it fixes the common case
  without manual intervention.

**Prevention Controls:**
- Documented in `docs/planning/PLAN-tauri-release.md` under "Known gotchas" so
  future release sessions can find the workaround without re-deriving it.
- Proposed hardening of `desktop/scripts/build-plain-dmg.sh` to auto-detach stale
  mounts (pending implementation -- track as follow-up if the gotcha recurs).
- Anyone running the release from a new machine should know: compile errors come
  from the Rust/Tauri build phase; post-build errors about signing or `hdiutil` are
  environmental and have documented workarounds in this entry.

**Files Changed:**
- `docs/BUGS.md` (this entry)
- `docs/planning/PLAN-tauri-release.md` (added "Known gotchas" section)

### BUG-010: "Error loading sample: undefined" on sample CT/MRI buttons

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | High |
| **Found** | 2026-04-09 |
| **Resolved** | 2026-04-09 |
| **Commit** | 576a95b |

**How Encountered:**
User Jake Powell (Android, RCS screenshot) reported that clicking either the "CT Scan"
or "MRI Scan" sample button on the library view produced an alert dialog reading
literally:

```
myradone
Error loading sample: undefined
OK
```

Gabriel also reproduced on desktop. The sample buttons are the single most important
demo-mode feature -- the first thing new visitors interact with -- so this broke the
primary onboarding path.

**Root Cause:**
Two layered defects, plus one flawed test-plan assumption that almost shipped a useless
regression test:

1. **`docs/js/app/main.js:189`** did `alert(\`Error loading sample: ${err.message}\`)`
   unconditionally. When the caught value was not a standard `Error` instance
   (`DOMException` with empty message, bare string from `throw "..."`, plain object),
   `err.message` evaluated to JavaScript `undefined`, and template literal interpolation
   stringified that to the literal word `"undefined"` -- which is exactly what the user
   saw. The same pattern existed in three other handlers in the same file
   (`handleDroppedFolder`, two `handleTauriDrop` paths), all with the same latent bug.

2. **`docs/js/app/sources.js` `loadSampleStudies`** fetched all 188 (CT) or 241 (MRI)
   sample files via unbounded `fileNames.map() + Promise.all()`. Peak memory was
   ~96MB (CT) / ~240MB (MRI) because every blob was held in the `files` array through
   a separate parse phase. Neither the manifest fetch nor the per-file fetch checked
   `res.ok`, so a 404 (stale CDN cache, wrong deployment target, deploy in flight) would
   produce a downstream `SyntaxError` from `manifestRes.json()` or a zero-byte blob from
   `res.blob()` that later failed inside `parseDicomMetadata` with an unpredictable
   error shape. Those unpredictable errors fed directly into bug #1 above and surfaced
   as `"undefined"`.

**Solution:**
- Added `app.utils.getErrorMessage(error)` in `docs/js/app/utils.js`, promoted from two
  byte-identical duplicates that already existed in `sources.js` and `import-pipeline.js`.
  Handles `string`, `error.message`, `error.exception`, and falls back to the constructor
  name instead of `[object Object]` for plain objects.
- Fixed all four `alert(...${err.message})` sites in `main.js`. Each handler now does:
  `AbortError` early-return (matching the existing `handleTauriDrop` guard), shared
  helper for message extraction, `console.error` so the original error object is
  preserved in devtools.
- Added `res.ok` checks to both fetches in `loadSampleStudies`, matching the existing
  correct pattern at `sources.js:904`. Error messages include the full URL and HTTP
  status so the alert will identify exactly which file failed.
- Replaced the two-phase "fetch everything, then parse everything" loop with a
  fetch-and-parse-per-batch loop at `SAMPLE_FETCH_BATCH_SIZE = 20` (the exact batch size
  recommended in `docs/planning/REMEDIATION-PLAN.md` DBG-MEDIUM-9). Each batch's blobs
  go out of scope before the next batch's fetches fire, so peak memory drops from
  ~96MB (CT) / ~240MB (MRI) to ~3MB transient + retained renderable slices.
- Deleted the two duplicate helpers in `sources.js` and `import-pipeline.js` now that
  `app.utils.getErrorMessage` is the single source of truth.

**Why This Solution:**
Alternatives considered:
- *Fix only `handleSampleLoad` and leave the other three handlers* -- Rejected. The
  hardener audit showed the same `${err.message}` pattern in 4 places. Fixing one
  guarantees the next `Error: undefined` ticket lands in a different handler.
- *Inline the message-extraction logic in `main.js`* -- Rejected. Two verbatim copies
  of the helper already existed elsewhere in the codebase. Promoting to `app.utils`
  removed duplication and established the single-source discipline.
- *Wrap every fetch error inside `loadSampleStudies` in a new `Error`* -- Rejected by
  Codex during review. Wrapping destroys the original error's stack trace and type
  information. Instead, let the real error bubble through the data layer unchanged
  and only format it at the UI boundary (`main.js` catch block). This is the correct
  error-handling discipline: format at the edge, not in the middle.
- *Use `DESKTOP_PATH_SCAN_CONCURRENCY = 10` for the batch size* -- Rejected. That
  constant is semantically "native file reads over Tauri IPC," not network fetches.
  The repo's `REMEDIATION-PLAN.md` already documented batches of 20 for this exact
  code path (DBG-MEDIUM-9), so we used the repo-local anchor.
- *Simple batched loop with `files.push(...batch)` accumulation* -- Rejected. The
  original draft plan had this shape, but it would have reduced fan-out without
  actually lowering peak memory, because all blobs would still be held in the `files`
  array through the parse phase. Codex caught this. The final loop is fetch-parse-discard
  per batch so non-renderable blobs go out of scope each iteration.

**Prevention Controls:**
Flawed regression test avoided: the first draft of the regression test patched
`window.app.sources.loadSampleStudies` at runtime, but `main.js` captures that
function by destructuring at app boot, so the button handler holds a private reference
to the original. A runtime patch on `app.sources` would have silently tested the happy
path while appearing to test the error path. The committed test instead targets a seam
the button handler actually calls at runtime. Lesson recorded here: always identify the
exact reference path the production code uses before choosing a mock seam.

**Files Changed:**
- `docs/js/app/utils.js` (+ `getErrorMessage` helper, export on `app.utils`)
- `docs/js/app/main.js` (4 error handlers: defensive extraction + `console.error` +
  `AbortError` guard where missing)
- `docs/js/app/sources.js` (delete `getDesktopScanParseErrorMessage`, add `res.ok`
  checks, fetch-and-parse batching at size 20)
- `docs/js/app/import-pipeline.js` (delete `getImportParseErrorMessage`)
- `tests/library-and-navigation.spec.js` (regression test at correct mock seam)

### BUG-009: macOS dock icon not updated after app update

| Field | Value |
|-------|-------|
| **Status** | Resolved |
| **Priority** | Medium |
| **Found** | 2026-04-07 |
| **Resolved** | 2026-04-08 |
| **PR** | #73 |

**How Encountered:**
After a packaged macOS updater install changed the app icon, Finder and the Dock could
continue showing the stale rendered bitmap even though the updated `.icns` was already
present inside the new app bundle.

**Root Cause:**
macOS Icon Services caches rendered bitmaps separately from LaunchServices metadata.
Tauri's updater currently replaces the bundle and runs `touch`, which updates the
bundle timestamp but does not reliably invalidate Icon Services' cached icon bitmap.

**Solution:**
- Added a macOS-only startup helper in `desktop/src-tauri/src/main.rs` that resolves
  packaged `.app` bundles, then schedules `lsregister -f` on a background thread so
  the app window is not blocked during launch.
- Kept the existing per-version success gate in `$APPDATA/.last_lsregister_version`.
- Added a per-version retry cap in `$APPDATA/.lsregister_attempt_state.json` so a
  future permanent failure will stop retrying after three attempts.

**Why This Solution:**
Alternatives considered:
- *Run `lsregister` inline during startup* - Rejected; it fixes the cache issue but can
  stall first launch after an update.
- *Retry on every launch until success* - Rejected; a future macOS restriction could
  turn that into unbounded startup work forever.

Chose a background best-effort refresh with capped retries because it preserves the
validated icon fix while keeping launch responsive and failure mode bounded.

**Verification:**
- Validated with a real packaged in-app update from a disposable `0.3.0` QA app
  (amber `A` icon) to `0.3.1` (blue `B` icon) over an HTTPS updater feed.
- Finder showed the new icon after the updated app launched.
- `.last_lsregister_version` advanced to `0.3.1`.
- The version-gate marker timestamp stayed unchanged on the following launch, proving
  the helper did not re-run after a successful refresh.

**Follow-up:**
- Replace the `lsregister` shell-out with `LSRegisterURL` FFI so the app uses the
  public CoreServices API directly.

**Files Changed:**
- `desktop/src-tauri/src/main.rs`
- `docs/BUGS.md`

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
