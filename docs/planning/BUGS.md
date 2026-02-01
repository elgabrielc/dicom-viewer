# Bug Tracking

Known issues, bugs, and their resolution status.

---

## Open Bugs

*No open bugs currently tracked.*

---

## Resolved Bugs

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
