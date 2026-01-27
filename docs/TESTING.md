# DICOM Viewer - Testing Documentation

This document covers testing practices specific to the DICOM Viewer project.

**Global testing principles:** See `~/.claude/TESTING_PROCESS.md`

---

## Quick Reference

```bash
# Run all tests
cd "/Users/gabriel/claude 0/dicom-viewer"
npx playwright test

# Run with visible browser
npx playwright test --headed

# Run specific test file
npx playwright test tests/viewing-tools.spec.js

# Run tests matching pattern
npx playwright test -g "W/L"

# Show detailed output
npx playwright test --reporter=list
```

---

## Test Environment Setup

### Prerequisites
1. Node.js installed
2. Flask server running on port 5001
3. Test data available

### First-Time Setup
```bash
cd "/Users/gabriel/claude 0/dicom-viewer"
npm install
npx playwright install chromium
```

### Starting the Server
```bash
source venv/bin/activate
python app.py
```

---

## Test Mode

The viewer supports a **test mode** that bypasses the File System Access API folder drop requirement.

### How It Works

| URL | Behavior |
|-----|----------|
| `http://127.0.0.1:5001/` | Normal mode - requires folder drop |
| `http://127.0.0.1:5001/?test` | Test mode - auto-loads test data |

### Test Mode Architecture

```
Normal Mode:
  Browser ──► File System Access API ──► DICOM files

Test Mode:
  Browser ──► /api/test-data/studies ──► Server scans test folder
          ──► /api/test-data/dicom/... ──► Server serves DICOM bytes
```

### Test Data Location
```
~/claude 0/MRI sample for debug 1/
```

To use different test data, modify `TEST_DATA_FOLDER` in `app.py`.

---

## Test Suites

### Current Coverage (38 tests)

| Suite | Tests | Description |
|-------|-------|-------------|
| Toolbar & Initial State | 3 | Visibility, default tool, W/L display |
| Window/Level | 5 | Drag directions, diagonal, value changes |
| Pan | 4 | Selection, keyboard, drag operations |
| Zoom | 6 | Selection, drag, scroll, limits |
| Reset | 2 | Button and keyboard reset |
| Keyboard Shortcuts | 3 | Tool shortcuts, case sensitivity |
| UI State | 2 | Button states, toolbar visibility |
| Edge Cases | 3 | Rapid switching, real-time updates |
| Combined Operations | 2 | Multi-tool workflows |
| Transform Verification | 3 | Actual scale/translate values |
| Slice Navigation | 3 | Persistence, counter updates |
| Cursor Feedback | 1 | Cursor changes per tool |
| Series Switching | 1 | View reset on series change |

### Test Files
- `tests/viewing-tools.spec.js` - Phase 1 viewing tools
- `TEST_PLAN_VIEWING_TOOLS.md` - Detailed test plan

---

## Writing Tests for This Project

### Selectors Reference

```javascript
// Canvas and viewport
const CANVAS_SELECTOR = '#imageCanvas';
const TOOLBAR_SELECTOR = '.viewer-toolbar';

// Tool buttons
const WL_BUTTON_SELECTOR = '[data-tool="wl"]';
const PAN_BUTTON_SELECTOR = '[data-tool="pan"]';
const ZOOM_BUTTON_SELECTOR = '[data-tool="zoom"]';
const RESET_BUTTON_SELECTOR = '#resetViewBtn';

// Displays
const WL_DISPLAY_SELECTOR = '#wlDisplay';
const SLICE_INFO_SELECTOR = '#sliceInfo';

// Panels
const SERIES_LIST_SELECTOR = '.series-list';
const METADATA_PANEL_SELECTOR = '.metadata-panel';
```

### Helper Functions Available

```javascript
// Wait for viewer to fully load
await waitForViewerReady(page);

// Get current W/L values
const { center, width } = await getWLValues(page);

// Get canvas transform (pan/zoom)
const { scale, translateX, translateY } = await getCanvasTransform(page);

// Get slice information
const { current, total } = await getSliceInfo(page);

// Check button active state
const isActive = await isButtonActive(page, selector);

// Get cursor style
const cursor = await getCanvasCursor(page);

// Perform drag operation
await performDrag(page, startX, startY, endX, endY, steps);
```

### Test Template

```javascript
test('Feature - Action - Expected Result', async ({ page }) => {
  // Navigate to test mode
  await page.goto('http://127.0.0.1:5001/?test');
  await waitForViewerReady(page);

  // Get initial state
  const initialValue = await getSomeValue(page);

  // Perform action
  await page.click(SOME_BUTTON);
  // or
  await performDrag(page, x1, y1, x2, y2);

  // Wait for update
  await page.waitForTimeout(100);

  // Verify result
  const newValue = await getSomeValue(page);
  expect(newValue).toBeGreaterThan(initialValue);
});
```

---

## Adding Tests for New Features

When implementing new features, follow this process:

### 1. Update Test Plan
Add test cases to `TEST_PLAN_VIEWING_TOOLS.md` (or create new plan file):
```markdown
### T[X].[Y]: [Feature Name]
**Steps:**
1. ...
2. ...

**Expected:**
- ...
```

### 2. Write Automated Tests
Add to appropriate test suite in `tests/viewing-tools.spec.js` or create new file.

### 3. Run and Verify
```bash
npx playwright test -g "new feature name"
```

### 4. Think Like the User
After tests pass, ask:
- What would a radiologist actually do here?
- What if they're in a hurry and click things fast?
- What if they have 500 slices instead of 50?
- Are we testing what users do, or just what we expect?

---

## Issues Caught Before Users

Track bugs and gaps found through testing (before users hit them):

| Date | Change | Discovered By |
|------|--------|---------------|
| 2026-01-27 | Fixed cursor not set on initial load | T6.3 Cursor Feedback test |
| 2026-01-27 | Added transform verification tests | Test review |
| 2026-01-27 | Added slice persistence tests | Test plan gap analysis |

---

## Known Test Limitations

1. **Visual verification** - Tests don't compare actual pixel output, only state values
2. **Performance benchmarks** - No automated performance regression tests yet
3. **Multi-browser** - Currently only testing Chromium (Chrome/Edge required for File System Access API anyway)

---

## Future Test Additions

Planned tests for upcoming features:

### Phase 2: W/L Presets
- [ ] Preset buttons appear
- [ ] Clicking preset changes W/L values
- [ ] Correct values for CT Bone, Soft Tissue, Lung
- [ ] Custom preset creation

### Phase 3: Measurements
- [ ] Length tool draws line
- [ ] Distance calculated correctly
- [ ] Angle tool works
- [ ] ROI statistics displayed

### Phase 4: Display Enhancements
- [ ] CLUT color mapping
- [ ] Flip/rotate operations
- [ ] Invert grayscale

---

## Troubleshooting

### Tests fail with "timeout waiting for selector"
- Ensure Flask server is running on port 5001
- Check test data folder exists and has DICOM files
- Try increasing timeout in `waitForViewerReady()`

### Tests pass locally but fail in CI
- Ensure CI has Chromium installed
- Check for timing issues (add `waitForTimeout` if needed)
- Verify test data is available in CI environment

### Flaky tests
- Add explicit waits after actions
- Use `waitForFunction` instead of fixed timeouts
- Check for race conditions in async operations

---

*See also: `~/.claude/TESTING_PROCESS.md` for global testing principles*
