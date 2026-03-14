# Remediation Plan: Security and Debugging Audit Findings

**Date**: 2026-03-10
**Author**: Gabriel Casalduc / Architect Agent
**Sources**: SECURITY-AUDIT.md (14 findings), DEBUGGER-AUDIT.md (37 findings)
**Total findings**: 51 (cross-referenced to ~40 unique action items after dedup)

---

## Guiding Principles

This plan is ordered by one question: **what matters most for a medical imaging viewer?**

1. **Image correctness** -- if the viewer shows the wrong image or wrong colors, nothing else matters. A radiologist (or any user) trusting what they see on screen is the entire value proposition.
2. **Viewer reliability** -- if the tool crashes, freezes, or silently stops responding to input during a viewing session, it erodes trust.
3. **Security proportional to deployment** -- the demo site is stateless (no PHI, no persistence). The personal app is localhost-only single-user. The desktop app is local-first. The cloud platform does not exist yet. Security hardening is important but must be sized to actual risk, not theoretical risk.
4. **Effort vs. compound value** -- fixes that prevent entire categories of future bugs (CSP, generation counters) are worth more than fixes for edge cases that require exotic conditions to trigger.

---

## Cross-Reference: Overlapping Findings

Several findings appear in both audits or are closely related:

| Theme | Security Audit | Debugger Audit | Notes |
|-------|---------------|----------------|-------|
| JPEG Baseline color rendering | -- | DBG-HIGH-1 | Current branch (`codex/fix-rgb-secondary-capture-rendering`) is working on this area but the `decodeJpegBaseline` red-channel-only bug is still present |
| Library config path traversal | SEC-HIGH-3 | DBG-LOW-9 | Same root cause: no path restriction on folder config endpoint |
| Flask auth + CSRF | SEC-HIGH-1, SEC-MEDIUM-1 | -- | Related: both concern unauthenticated access to Flask APIs |
| Report ID collision | SEC-LOW-7 | -- | IDOR on client-supplied report IDs |
| localStorage PHI | SEC-MEDIUM-4 | -- | Disclosure concern, not a code bug |
| `Math.random` UUID | SEC-LOW-4 | -- | Security-only finding; not duplicated in the debugger audit |

---

## Tier 1: Fix Now -- Image Correctness Bugs

**Rationale**: These produce visually wrong output on real DICOM files with no warning to the user. For a medical imaging viewer, displaying an incorrect image is the most severe category of defect. Every one of these is a rendering correctness bug that a user could encounter with real clinical data.

### 1.1 MONOCHROME1 inversion missing [DBG-MEDIUM-3]

**Impact**: Chest X-rays (CR), digital radiography (DX), and some mammography (MG) display with inverted polarity. Lungs appear white instead of dark. This is not a rare format -- CR/DX is one of the most common DICOM modalities.

**Fix**: Add a single `if` statement in the grayscale rendering loop in `rendering.js` (line ~758):
```javascript
if (decoded.photometricInterpretation === 'MONOCHROME1') {
    grayscaleValue = 255 - grayscaleValue;
}
```

**Effort**: 1 line of code + 1 test. Trivial.

**Test**: Load a MONOCHROME1 CR file; verify that a known bright pixel renders dark. The absence of this test (DBG-LOW-12) is why the bug exists. The test and fix should ship together.

**Grouped with**: DBG-LOW-12 (no MONOCHROME1 test).

### 1.2 JPEG Baseline color images rendered as grayscale [DBG-HIGH-1]

**Impact**: Color secondary captures, color ultrasound, color fluoroscopy screenshots lose all color information. Only the red channel survives. The image is degraded without any warning.

**Note**: The current branch (`codex/fix-rgb-secondary-capture-rendering`) is in this area but the `decodeJpegBaseline` function still extracts red-channel-only on the branch HEAD. The fix for uncompressed RGB secondary captures may already be merged, but the JPEG Baseline color path needs separate attention.

**Fix**: In `decodeJpegBaseline` (dicom.js line ~678), detect whether the decoded JPEG is grayscale (R=G=B for all pixels) or color. If color, return a full 3-channel `Uint8Array` with `samplesPerPixel: 3` and route through the existing RGB rendering path in `renderPixels`.

**Effort**: ~20 lines in `dicom.js` + adjustment in `rendering.js` where `isRgb` is handled (lines 489-496). Medium.

**Grouped with**: DBG-MEDIUM-4 (16-bit RGB normalization). Both are in the RGB rendering path. Fix both while the code is open.

### 1.3 16-bit RGB values not normalized [DBG-MEDIUM-4]

**Impact**: RGB images with `bitsAllocated = 16` (uncommon but valid) render as nearly solid white/black because `Uint8ClampedArray` clamps 16-bit values to 255.

**Fix**: Add normalization in the RGB branch of `renderPixels` (rendering.js line ~738):
```javascript
const maxVal = (1 << decoded.bitsAllocated) - 1;
const scale = decoded.bitsAllocated > 8 ? 255 / maxVal : 1;
```

**Effort**: 3 lines. Trivial.

### Tier 1 Summary

| ID | Description | Effort |
|----|-------------|--------|
| DBG-MEDIUM-3 + DBG-LOW-12 | MONOCHROME1 inversion + test | Small |
| DBG-HIGH-1 | JPEG Baseline color rendering | Medium |
| DBG-MEDIUM-4 | 16-bit RGB normalization | Small |

**Delivery**: These three can be a single PR ("Fix rendering correctness for MONOCHROME1, JPEG color, and 16-bit RGB").

---

## Tier 2: Fix Soon -- Viewer Reliability

**Rationale**: These cause the viewer to behave incorrectly during normal use (wrong slice displayed, tools stop working, confusing errors). They do not produce wrong images, but they break the viewing experience.

### 2.1 `loadSlice` race condition [DBG-HIGH-2]

**Impact**: Fast scrolling can display a stale slice. The canvas shows slice N while the UI says slice M. For a medical imaging tool, this is disorienting and could cause a user to misidentify anatomy.

**Fix**: Add a generation counter to `state` (one new integer property). Increment at the top of `loadSlice`. After each `await`, check if the generation is still current; if not, return early. The spinner should only be hidden when the current-generation load completes.

**Effort**: ~10 lines across `state.js` and `viewer.js`. Small.

**Grouped with**: DBG-LOW-15 (no test for this race). Write a test that scrolls rapidly and asserts the final displayed slice matches `state.currentSliceIndex`.

### 2.2 W/L drag no-op on cache miss [DBG-MEDIUM-5]

**Impact**: After heavy navigation that evicts the current slice from the LRU cache, the W/L tool silently stops working. The user drags to adjust contrast and nothing happens. No error, no feedback.

**Fix**: On cache miss in `reRenderCurrentSlice`, trigger `loadSlice(state.currentSliceIndex)` to re-fetch and re-render with current W/L settings.

**Effort**: 3 lines. Trivial.

**Related**: DBG-LOW-6 (desktop cache undersized at 24) is the root cause of frequent eviction on desktop. Consider bumping to 48 as part of this fix, but the cache-miss recovery is the real fix.

### 2.3 `scan_dicom_folder` PermissionError crash [DBG-MEDIUM-14]

**Impact**: On macOS, NAS mounts, or any directory tree with unreadable subdirectories, the entire library scan fails with a 500 error. The user sees no studies. This is a real-world scenario (macOS system directories, Time Machine volumes, etc.).

**Fix**: Wrap the `rglob` iteration in a try/except for `PermissionError`, logging and skipping unreadable paths.

**Effort**: 5 lines. Trivial.

### 2.4 Wheel event missing `{ passive: false }` [DBG-LOW-11]

**Impact**: In Chrome, `preventDefault()` inside a passive wheel listener is silently ignored. This means the page scrolls while the user is scrolling through slices. Every user on Chrome sees this.

**Fix**: Add `{ passive: false }` to the wheel event listener in `main.js`.

**Effort**: 1 line. Trivial.

**Note**: Despite being "Low" severity in the debugger audit, this is a user-facing annoyance on every session. Promoting it to Tier 2.

### 2.5 JPEG 2000 worker not terminated on viewer close [DBG-MEDIUM-8]

**Impact**: After viewing a JPEG 2000 series and returning to the library, the OpenJPEG WASM module (50-200MB) stays allocated. On memory-constrained devices this causes performance degradation.

**Fix**: Call `disposeJpeg2000Worker()` from `closeViewer()`.

**Effort**: 1 line. Trivial.

### Tier 2 Summary

| ID | Description | Effort |
|----|-------------|--------|
| DBG-HIGH-2 + DBG-LOW-15 | loadSlice generation counter + test | Small |
| DBG-MEDIUM-5 + DBG-LOW-6 | Cache miss recovery + bump desktop cache | Small |
| DBG-MEDIUM-14 | PermissionError handling in scan | Small |
| DBG-LOW-11 | Wheel event passive: false | Trivial |
| DBG-MEDIUM-8 | Dispose JPEG 2000 worker on close | Trivial |

**Delivery**: Can be one or two PRs. All are small, independent fixes.

---

## Tier 3: Fix This Month -- Security Hardening

**Rationale**: These are real security gaps, but the actual risk is low given current deployment modes. The demo site is stateless (no APIs, no persistence). The personal app is localhost. The desktop app is sandboxed by Tauri. None of these are exploitable by a remote attacker visiting the demo site. However, they should be fixed before any network-exposed or multi-user deployment, and the CSP fix provides defense-in-depth that protects all deployment modes.

### 3.1 Content Security Policy [SEC-HIGH-2]

**Impact**: No CSP on Flask or GitHub Pages means a future missed `escapeHtml` call becomes an exploitable XSS. The Tauri desktop shell already has a strong CSP, creating a disparity.

**Fix -- two parts**:
1. Add `Content-Security-Policy` header in Flask `_set_security_headers()`.
2. Add `<meta http-equiv="Content-Security-Policy">` in `docs/index.html` for GitHub Pages.

Recommended policy:
```
default-src 'self' data: blob:;
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
worker-src 'self' blob: 'wasm-unsafe-eval';
img-src 'self' data: blob:;
connect-src 'self';
frame-src blob:;
```

**Effort**: Medium. Needs testing to ensure WASM decode, blob URLs, and data URLs all still work.

**Grouped with**: SEC-LOW-1 (Tauri `unsafe-inline` in style-src). While adding CSP to Flask/GH Pages, audit whether `unsafe-inline` can be removed from the Tauri CSP as well.

### 3.2 Flask API authentication [SEC-HIGH-1 + SEC-MEDIUM-1]

**Impact**: Any local process can read/write clinical notes and upload reports. The CSRF bypass (headerless requests pass) compounds this.

**Actual risk assessment**: The personal app binds to `127.0.0.1` by default. An attacker would need to be running code on the same machine. If they are, they likely already have access to the SQLite database and localStorage files directly. The API key adds a layer of defense-in-depth but does not fundamentally change the threat model for a single-user localhost app.

**Fix**:
1. Generate a random API key on first run, store in `settings.json`.
2. Require it as `X-DICOM-API-Key` header on all state-modifying endpoints.
3. The web frontend reads it from a new `GET /api/auth/token` endpoint (localhost-only, no key required for this one endpoint).
4. Add a startup warning when `FLASK_HOST=0.0.0.0`.

**Effort**: Medium. Touches every API route (or add a before_request decorator).

**Grouped with**: SEC-MEDIUM-3 (rate limiting). While adding the auth middleware, add basic rate limiting (in-memory token bucket or Flask-Limiter) and comment length cap (10,000 chars).

### 3.3 Library config path restriction [SEC-HIGH-3 + DBG-LOW-9]

**Impact**: `POST /api/library/config` accepts any filesystem path including `/`. An unauthenticated caller (see 3.2) could scan the entire filesystem.

**Fix**: Restrict to paths within `Path.home()`. Add validation:
```python
resolved = Path(folder_path).resolve()
if not resolved.is_relative_to(Path.home()):
    return jsonify({'error': 'Library folder must be within your home directory'}), 400
```

**Effort**: 3 lines. Trivial. But should ship with or after 3.2 (auth) since auth is the primary defense.

### 3.4 Desktop report path validation [SEC-MEDIUM-2]

**Impact**: If localStorage is tampered with (requires XSS first), a stored `filePath` could point to an arbitrary file. The Tauri scope normally restricts this, but `persisted-scope` can expand over time.

**Fix**: In `getReportFileUrl`, reconstruct the expected path from the report ID instead of trusting the stored `filePath`:
```javascript
const expectedPath = await path.join(await path.appDataDir(), 'reports', `${reportId}.${ext}`);
```

**Effort**: Small. ~5 lines in `api.js`.

### Tier 3 Summary

| ID | Description | Effort | Dependency |
|----|-------------|--------|------------|
| SEC-HIGH-2 + SEC-LOW-1 | CSP on Flask + GH Pages + Tauri style audit | Medium | None |
| SEC-HIGH-1 + SEC-MEDIUM-1 + SEC-MEDIUM-3 | API auth + CSRF fix + rate limiting | Medium | None |
| SEC-HIGH-3 + DBG-LOW-9 | Library path restriction | Small | Ships with auth |
| SEC-MEDIUM-2 | Desktop report path validation | Small | None |

**Delivery**: CSP and API auth are independent and can be parallel PRs. Path restriction depends on auth.

---

## Tier 4: Fix When Convenient -- Robustness and Edge Cases

**Rationale**: These are real issues but either require exotic conditions to trigger, affect only non-production code paths, or are state hygiene improvements. Fix them during related work or in a dedicated cleanup sprint.

### 4.1 Tauri scope check on first launch [DBG-MEDIUM-13]

**Impact**: Confusing error message on first desktop launch. Functionally correct (JS fallback works) but bad UX.

**Fix**: After scope check fails, attempt to add the parent directory to scope and retry. ~10 lines of Rust.

### 4.2 `addComment` server ID race [DBG-MEDIUM-11]

**Impact**: If `displayStudies()` fires during the async gap after adding a comment, the comment retains its `local-XXXX` ID permanently. Server-side comment becomes undeletable from UI.

**Fix**: After the server responds, update the in-memory comment ID regardless of DOM state. The next `displayStudies` call will pick up the correct ID.

### 4.3 `getMetadataNumber` type cascade order [DBG-MEDIUM-2]

**Impact**: `uint16` tried before `uint32` could truncate 32-bit tag values. In practice, the string path catches most numeric tags, so this is theoretical.

**Fix**: Reorder: try `uint32`/`int32` before `uint16`/`int16`. ~10 lines shuffled.

### 4.4 Encapsulated frame bounds check [DBG-MEDIUM-1]

**Impact**: Truncated DICOM files get an opaque `RangeError` instead of a diagnostic message.

**Fix**: Add bounds validation before `Uint8Array` constructor. ~5 lines.

### 4.5 `loadSampleStudies` memory spike [DBG-MEDIUM-9]

**Impact**: Loading sample CT fetches all 188 slices in parallel (~96MB peak). Only affects demo/test mode.

**Fix**: Batch fetches in groups of 20. ~15 lines refactor.

### 4.6 `update_library_config` double-lock race [DBG-MEDIUM-15]

**Impact**: Concurrent POSTs to library config can corrupt global state. Requires two simultaneous requests from the same user -- extremely unlikely in single-user localhost.

**Fix**: Hold the lock for the entire operation. ~5 lines restructured.

### 4.7 Desktop runtime validation consolidation [DBG-LOW-18]

**Impact**: Different Tauri API checks produce inconsistent error messages.

**Fix**: Consolidate into a single `checkDesktopRuntime()` function.

### 4.8 Desktop `readSliceBuffer` runtime guard [DBG-MEDIUM-12]

**Impact**: If `window.__TAURI__` is unavailable during integration testing or a slow desktop startup, the current `kind: 'path'` code path throws an unhelpful `Cannot read properties of undefined (reading 'fs')` error instead of a clear desktop-runtime message.

**Fix**: Add a guard at the top of the `kind: 'path'` branch in `sources.js`:
```javascript
if (!window.__TAURI__?.fs?.readFile) {
    throw new Error('Desktop file API is not available. Please reopen the app.');
}
```

**Effort**: 3 lines. Trivial.

**Priority rationale**: This is a robustness/UX fix for desktop initialization edge cases, not a correctness bug. Track it, but do not let it block the higher-priority rendering and reliability work.

### 4.9 `getAllFileHandles` recursion depth [DBG-LOW-5]

**Impact**: Deeply nested directories (15+ levels) could overflow the call stack. File System Access API does not follow symlinks, so no cycle risk.

**Fix**: Convert to iterative with depth limit (match desktop path's `maxDepth = 20`).

### 4.10 Series panel composite key [DBG-MEDIUM-7]

**Impact**: Non-conformant UIDs with colons would break panel state tracking. DICOM UIDs by spec contain only digits and dots.

**Fix**: Use `Map<studyUid, Set<seriesUid>>` instead of colon-delimited keys.

### 4.11 Measurements not cleared on folder drop [DBG-MEDIUM-6]

**Impact**: State hygiene. UID collision probability is negligible.

**Fix**: Add `state.measurements.clear()` in `handleDroppedFolder`.

### 4.12 Stale W/L display on blank slices [DBG-LOW-4]

**Impact**: Blank slice metadata panel shows W/L values from previous non-blank slice. Cosmetic.

**Fix**: Clear `state.baseWindowLevel` when rendering a blank slice.

### Tier 4 Summary

| ID | Description | Effort |
|----|-------------|--------|
| DBG-MEDIUM-13 | Tauri first-launch scope fix | Small |
| DBG-MEDIUM-11 | Comment ID race | Small |
| DBG-MEDIUM-2 | Metadata number type order | Trivial |
| DBG-MEDIUM-1 | Encapsulated frame bounds check | Trivial |
| DBG-MEDIUM-9 | Sample study batch loading | Small |
| DBG-MEDIUM-15 | Double-lock fix | Trivial |
| DBG-LOW-18 | Desktop runtime consolidation | Small |
| DBG-MEDIUM-12 | Desktop `readSliceBuffer` runtime guard | Trivial |
| DBG-LOW-5 | Recursive file handle depth limit | Small |
| DBG-MEDIUM-7 | Series panel composite key | Small |
| DBG-MEDIUM-6 | Measurements clear on folder drop | Trivial |
| DBG-LOW-4 | Blank slice W/L display | Trivial |

---

## Tier 5: Accept As-Is -- Document and Move On

**Rationale**: These findings are valid observations but the cost of fixing outweighs the benefit, the risk is negligible given deployment context, or the fix introduces complexity disproportionate to the problem.

### Accept: Blank slice 10th-pixel sampling [DBG-LOW-1]

**Assessment**: Already documented as a known tradeoff. Reducing the sampling interval (e.g., every 5th pixel) doubles the cost for marginal gain. The false positive rate on real clinical data is extremely low. If a specific modality (angiography) triggers this, add a modality-aware override at that time.

**Action**: No code change. Document the tradeoff in code comments (already done).

### Accept: Zero-row/col files skipped silently [DBG-LOW-2]

**Assessment**: A DICOM file with zero rows/columns and valid pixel data is malformed by the DICOM standard. Silently skipping it is the correct behavior. Adding a user-visible warning for every malformed file would create noise.

**Action**: No change.

### Accept: PALETTE COLOR skipWindowLevel [DBG-LOW-3]

**Assessment**: PALETTE COLOR images are rare in clinical practice and require a lookup table that the viewer does not currently implement. The current behavior (showing palette indices as grayscale) is no worse than refusing to display the image. Implementing a full palette lookup table is a feature, not a bug fix.

**Action**: Add a code comment noting the limitation. If PALETTE COLOR support is needed, track it as a feature request.

### Accept: `Math.random` UUID [SEC-LOW-4]

**Assessment**: Both audits flag this. The risk is theoretical -- report IDs do not need to be cryptographically unpredictable in a single-user local app with no authentication. The server-side path already uses `uuid.uuid4()`.

**Action**: Replace with `crypto.randomUUID()` if touching the file for another reason. Do not make a dedicated PR for this.

**Update**: Grouping this as opportunistic. When any Tier 1-4 fix touches `utils.js`, make the one-line change.

### Accept: Flask development server [SEC-LOW-6]

**Assessment**: Single-user localhost. Werkzeug dev server is fine. If the user binds to `0.0.0.0`, they are choosing to expose the server. Adding a startup warning (part of Tier 3.2) is sufficient.

**Action**: No code change beyond the warning in Tier 3.2.

### Accept: GitHub Actions tag pinning [SEC-LOW-2]

**Assessment**: Valid supply-chain concern but low probability. The repository has no secrets beyond `GITHUB_TOKEN`. The blast radius of a compromised `actions/checkout` would be limited. SHA pinning creates maintenance overhead (Dependabot PRs for every action update).

**Action**: Consider pinning if/when the repo handles deployment secrets or cloud platform credentials. For now, accept the risk.

### Accept: Cargo semver ranges [SEC-LOW-3]

**Assessment**: `Cargo.lock` is committed (verified). Adding `--locked` to CI and `cargo audit` are good hygiene but low priority.

**Action**: Add `cargo audit` to CI when the desktop app has its own CI job. Not urgent.

### Accept: `help-viewer.js` innerHTML [SEC-LOW-5]

**Assessment**: The source is a static constant, not user input. Adding DOMPurify or an ESLint rule for this one file is overkill.

**Action**: Add a code comment: "SECURITY: section.content comes from static HELP_SECTIONS constant. Do not populate from external sources without escaping."

### Accept: localStorage PHI disclosure [SEC-MEDIUM-4]

**Assessment**: This is an inherent property of browser-based applications. localStorage is how web apps store data locally. On shared machines, OS-level user accounts provide isolation. Encrypting localStorage in JavaScript provides no real security (the decryption key would also be in JavaScript). The desktop app already uses Tauri app data, which benefits from OS-level encryption (FileVault on macOS).

**Action**: Add a brief notice in the app's about/help section: "Clinical annotations are stored locally in your browser. On shared computers, use separate browser profiles." Do not attempt JS-level encryption -- it provides false security.

### Accept: Report ID IDOR [SEC-LOW-7]

**Assessment**: In a single-user app with no authentication, IDOR is not meaningful -- the single user owns all resources. This becomes relevant only in a multi-user cloud deployment, which does not exist yet.

**Action**: When building the cloud platform, generate IDs server-side only. For now, accept.

### Accept: `migrate_notes` UID validation [DBG-LOW-19]

**Assessment**: The migration endpoint is called once per installation when upgrading from localStorage to SQLite. Malformed UIDs would only come from the user's own localStorage. Parameterized queries prevent injection.

**Action**: No change.

### Accept: Server-side slice deduplication [DBG-LOW-20]

**Assessment**: Hard links to DICOM files in the same scan directory are extremely unusual. The user would see duplicate slices, which is confusing but not dangerous.

**Action**: No change.

### Accept: `screenToImage` CSS margin assumption [DBG-LOW-10]

**Assessment**: The current CSS does not add padding or border to the canvas. The code comment in the audit itself acknowledges this is not a current bug. Adding margin-aware coordinate conversion would be over-engineering.

**Action**: No change.

### Accept: Test mode blank-slice error loop [DBG-MEDIUM-10 + DBG-LOW-17]

**Assessment**: This only affects CI test startup with datasets that have decode errors on every slice. The real fix is having good test data, not adding complexity to the blank-slice loop. The missing dedicated test for blank-slice auto-advance in error-heavy series (DBG-LOW-17) is part of the same issue and is accepted for the same reason.

**Action**: No change.

### Accept: `deleteReport` concurrent rebuild fragility [DBG-LOW-8]

**Assessment**: The audit itself notes the current path is correct; the concern is about a race with a concurrent `displayStudies` call. This is a theoretical fragility, not a bug.

**Action**: No change.

---

## Test Coverage Gaps (Addressed Across Tiers)

These test gaps from the debugger audit are addressed as part of their associated fixes:

| Test Gap | Addressed In |
|----------|-------------|
| DBG-LOW-12: No MONOCHROME1 test | Tier 1.1 |
| DBG-LOW-15: No loadSlice race test | Tier 2.1 |
| DBG-LOW-16: No W/L cache miss test | Tier 2.2 |
| DBG-LOW-17: No blank-slice auto-advance test for error slices | Accept with DBG-MEDIUM-10 |

Remaining test gaps to address when convenient:

| Test Gap | Priority |
|----------|----------|
| DBG-LOW-13: No multi-frame DICOM test | Needs test data; address when multi-frame support is a priority |
| DBG-LOW-14: Desktop native decode untested in CI | Requires Tauri in CI; defer until desktop CI pipeline exists |

---

## Delivery Sequence

```
Tier 1 (image correctness)     -- PR 1: MONOCHROME1 + JPEG color + 16-bit RGB
                                       Target: this week, before merging current RGB branch

Tier 2 (viewer reliability)    -- PR 2: Generation counter + cache miss recovery
                                  PR 3: PermissionError + wheel passive + worker cleanup
                                       Target: next 2 weeks

Tier 3 (security hardening)    -- PR 4: CSP on all deployment modes
                                  PR 5: API auth + rate limiting + path restriction
                                  PR 6: Desktop report path validation
                                       Target: this month

Tier 4 (robustness)            -- Pick off during related work or in a cleanup sprint
                                       Target: ongoing, no deadline

Tier 5 (accept)                -- No PRs. Document decisions in code comments where noted.
```

---

## Architectural Note

Several findings (DBG-HIGH-2, DBG-MEDIUM-5, DBG-MEDIUM-11) share a common root cause: the viewer has no concept of a **load request lifecycle**. `loadSlice` is fire-and-forget async with no cancellation, no generation tracking, and no way for dependent operations (W/L drag, comment save) to know whether the currently displayed slice matches the currently expected slice.

The generation counter (Tier 2.1) is the minimum viable fix, but the longer-term pattern should be a small `ViewerSession` or `LoadRequest` abstraction that tracks:
- Which slice was requested
- Whether it has been superseded
- Whether its data is in cache or in-flight
- Whether the current canvas content matches the current request

This does not need to happen now, but when the 3D volume rendering work begins (vtk.js integration), the same lifecycle management problem will appear in a more complex form. The generation counter is a stepping stone toward that.

---

## Summary Table

| Tier | Finding IDs | Count | Effort | Target |
|------|-------------|-------|--------|--------|
| 1 -- Image Correctness | DBG-M3, DBG-H1, DBG-M4, DBG-L12 | 4 | 1 PR, medium | This week |
| 2 -- Viewer Reliability | DBG-H2, DBG-M5, DBG-M14, DBG-L11, DBG-M8, DBG-L6, DBG-L15 | 7 | 2 PRs, small | 2 weeks |
| 3 -- Security Hardening | SEC-H1, SEC-H2, SEC-H3, SEC-M1, SEC-M2, SEC-M3, SEC-L1 | 7 | 3 PRs, medium | This month |
| 4 -- Robustness | DBG-M1, M2, M6, M7, M9, M11, M12, M13, M15, L5, L4, L18 | 12 | Ongoing | No deadline |
| 5 -- Accept As-Is | SEC-L2-L7, SEC-M4, DBG-L1-3, L8-10, L13-14, L17, L19-20, M10 | 18 | 0 | Documented |
| **Total** | | **48** | | |

*4 findings were deduplicated across the two audits (JPEG color, path traversal, UUID, PermissionError/path overlap).*
