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

**Description:**
Playwright tests were timing out because the first slice in MRI MPR reconstructions is often blank (uniform pixel values used as padding). The test mode waited for W/L display to show values, but blank slices don't set `state.baseWindowLevel`, causing an infinite wait.

**Root Cause:**
`renderDicom()` returns early with `isBlank: true` for uniform slices, skipping the W/L calculation. The test's `waitForViewerReady()` function waited for "C:" in the W/L display text, which never appeared.

**Fix:**
1. Added auto-advance logic in test mode to skip past blank slices (up to 50) to find displayable content
2. Updated two tests to use relative slice positions instead of hardcoded values

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

**Description:**
What happens and how to reproduce.

**Root Cause:**
Why it happens (if known).

**Fix:**
How it was fixed (if resolved).

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
