# Bug Tracking

Known issues, bugs, and their resolution status.

---

## Open Bugs

*No open bugs currently tracked.*

---

## Resolved Bugs

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

*Last updated: 2026-02-01*
