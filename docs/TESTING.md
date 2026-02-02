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

### Current Coverage (41 tests)

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
| Series Switching | 4 | View reset, sample CT button, visual verification |

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

---

### Helper Functions: Detailed Reference

#### waitForViewerReady(page)

Waits for the DICOM viewer to be fully initialized and ready for interaction.

**What it waits for:**
1. Canvas element (`#imageCanvas`) is visible in the DOM
2. Window/Level display (`#wlDisplay`) contains valid values (matches pattern `C: <number>`)
3. A 500ms settling delay for final render completion

**Why W/L display is used as the ready indicator:**

The W/L display is populated only after:
- DICOM file is fully loaded and parsed
- Pixel data is decoded (including decompression if needed)
- Image is rendered to canvas
- Window/level values are calculated and applied

This makes it a reliable proxy for "viewer is fully ready" without needing to inspect internal state or canvas pixels.

**Timing assumptions:**
- 30-second timeout for canvas visibility (handles slow DICOM loading)
- 30-second timeout for W/L population (handles large series)
- 500ms post-ready delay (allows pending renders to complete)

**Edge case: Blank slices and auto-advance:**

In test mode, the viewer may auto-advance past blank slices (slices with no meaningful pixel data, common at the edges of CT/MRI volumes). This means:
- Initial slice number may not be 1
- Tests should use relative slice positions, not absolute
- The `getSliceInfo()` function returns the actual current slice, which may differ from expectations

```javascript
// Good: Use relative navigation
const initialSlice = await getSliceInfo(page);
await page.keyboard.press('ArrowRight');
const newSlice = await getSliceInfo(page);
expect(newSlice.current).toBe(initialSlice.current + 1);

// Bad: Assume slice 1 is initial
expect(initialSlice.current).toBe(1);  // May fail if auto-advanced
```

---

#### getCanvasTransform(page)

Parses the CSS transform matrix applied to the canvas element to extract pan and zoom values.

**How it works:**
1. Gets the computed style `transform` property from the canvas element
2. If `transform` is `'none'`, returns default values (scale=1, translate=0,0)
3. Otherwise, parses the `matrix(a, b, c, d, tx, ty)` format

**CSS Transform Matrix Format:**

The 2D transform matrix has 6 values: `matrix(a, b, c, d, tx, ty)`

| Position | Value | Meaning |
|----------|-------|---------|
| a (values[0]) | scaleX | Horizontal scale factor |
| b (values[1]) | skewY | Vertical skew (0 for our usage) |
| c (values[2]) | skewX | Horizontal skew (0 for our usage) |
| d (values[3]) | scaleY | Vertical scale factor |
| tx (values[4]) | translateX | Horizontal offset in pixels |
| ty (values[5]) | translateY | Vertical offset in pixels |

**What values it returns:**

```javascript
{
  scale: number,      // From 'a' value; assumes uniform scaling (scaleX = scaleY)
  translateX: number, // Horizontal pan offset in pixels
  translateY: number  // Vertical pan offset in pixels
}
```

**Assumptions:**
- Uniform scaling (uses only the `a` value, assumes `a === d`)
- No rotation or skew applied to the canvas
- Transform origin is default (center of element)

**Usage example:**

```javascript
const initial = await getCanvasTransform(page);
expect(initial.scale).toBe(1);  // No zoom initially

await zoomIn(page);
const zoomed = await getCanvasTransform(page);
expect(zoomed.scale).toBeGreaterThan(1);
```

---

#### performDrag(page, startX, startY, endX, endY, steps)

Simulates a mouse drag operation from one point to another.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| startX | number | Starting X coordinate |
| startY | number | Starting Y coordinate |
| endX | number | Ending X coordinate |
| endY | number | Ending Y coordinate |
| steps | number | Number of intermediate move events (default: 10) |

**How it works:**
1. Moves mouse to starting position
2. Presses mouse button down
3. Moves to ending position in `steps` intermediate steps
4. Releases mouse button

**How the `steps` parameter affects drag smoothness:**

The `steps` value controls how many `mousemove` events are fired between start and end:

| Steps | Behavior | Use Case |
|-------|----------|----------|
| 1 | Single jump from start to end | Testing final position only |
| 5-10 | Moderate smoothness | Standard tool testing |
| 20+ | Very smooth, gradual movement | Testing real-time updates during drag |

Higher step counts:
- More accurately simulate real user behavior
- Allow testing of incremental updates (W/L display during drag)
- Take longer to execute
- Generate more events for the application to process

**Coordinate system:**

Coordinates are relative to the **viewport** (visible browser area), not the canvas element. To drag within the canvas, first get canvas bounds:

```javascript
const bounds = await getCanvasBounds(page);
const centerX = bounds.x + bounds.width / 2;  // Viewport X of canvas center
const centerY = bounds.y + bounds.height / 2; // Viewport Y of canvas center

// Drag from center 100px to the right
await performDrag(page, centerX, centerY, centerX + 100, centerY);
```

The `bounds` object contains:
- `x`, `y`: Top-left corner in viewport coordinates
- `width`, `height`: Element dimensions

---

### Blank Slice Handling in Tests

DICOM volumes often have blank slices at the edges (slices containing only air or padding). The viewer handles these specially in test mode.

**Why tests use relative slice positions:**

When running in test mode, the viewer may auto-advance past blank slices to show meaningful content immediately. This means:

1. **Initial slice is unpredictable**: Could be slice 1, or could be slice 15 if slices 1-14 are blank
2. **Slice count is fixed**: Total slice count remains accurate
3. **Navigation is relative**: ArrowRight/ArrowLeft always move by 1 slice

```javascript
// Correct approach: relative assertions
const initialSlice = await getSliceInfo(page);
// Don't assume initialSlice.current === 1

await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');

const afterNav = await getSliceInfo(page);
expect(afterNav.current).toBe(initialSlice.current + 2);  // Relative check
```

**Auto-advance behavior in test mode:**

When test mode loads a series:
1. Scans slices to detect blank content
2. Advances to first non-blank slice automatically
3. Updates slice counter to reflect actual position

This mimics what a user would do (scroll past empty slices) and ensures tests start with renderable content.

**How to write tests that work regardless of initial slice:**

1. **Capture initial state first:**
   ```javascript
   const initialSlice = await getSliceInfo(page);
   ```

2. **Use relative assertions:**
   ```javascript
   // After navigating forward 2 slices
   expect(newSlice.current).toBe(initialSlice.current + 2);
   ```

3. **Test edge behavior carefully:**
   ```javascript
   // Navigate to end
   for (let i = 0; i < sliceInfo.total - sliceInfo.current; i++) {
     await page.keyboard.press('ArrowRight');
   }
   // Now at last slice
   ```

4. **Don't assume slice 1 has content:**
   ```javascript
   // Bad: Assumes slice 1 is valid
   await navigateToSlice(page, 1);
   await verifyCanvasHasContent(page);

   // Good: Use whatever slice loaded initially
   await waitForViewerReady(page);
   await verifyCanvasHasContent(page);
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

## Visual Verification: 9-Region Sampling

We use a custom visual verification approach to test that images actually render.

### How It Works

1. Divide the canvas into a 3x3 grid (9 regions)
2. Sample a random pixel from each region (using deterministic seed for reproducibility)
3. If all 9 pixels have the same value (±2) → flag for **manual check**
4. If pixels have variation → **pass**

### Why This Approach

Real medical images have anatomical variation across space. A broken render (blank, solid color, corrupted) won't. We test for the *property* of being a real image rather than specific pixel values.

**Compared to alternatives:**
- **Canvas content check** (any non-zero pixel): Would pass a solid white rectangle
- **Visual regression** (screenshot comparison): Requires maintaining baselines, brittle to intentional changes
- **Fixed pixel sampling**: Position-dependent, requires knowing expected values

### Helper Functions

```javascript
// Sample 9 regions with optional seed for reproducibility
const { pixels, width, height } = await sample9Regions(page, seed);

// Full verification: dimensions, grayscale, variation, value range
const { valid, needsManualCheck, issues, samples } = await verifyCanvasContent(page, seed);
```

### Manual Check Protocol

When a test throws `MANUAL_CHECK_REQUIRED`:
1. Test stops (does not auto-pass or auto-fail)
2. Human reviews the screenshot
3. Human determines if the image is valid or indicates a bug

This acknowledges that edge cases exist where automatic verification isn't sufficient.

---

## Known Limitations of Visual Verification

### What It Catches
- Blank canvas (nothing rendered)
- Solid color fills (rendering bug)
- Partial renders (some regions blank)
- Non-grayscale output (color rendering bug)

### What It Misses

1. **Wrong image passes** - If the viewer displays the wrong image entirely (wrong patient, wrong slice, wrong series), the test passes as long as that image has variation. It verifies "an image rendered" not "the correct image rendered."

2. **Legitimate images trigger manual check** - Some valid medical images are mostly uniform:
   - Edge slices (mostly air/black)
   - Scout/localizer images
   - Slices through uniform anatomy

3. **Rendering errors that preserve variation** - These would still pass:
   - Image at wrong scale
   - Image offset/cropped
   - Inverted contrast
   - Wrong window/level applied

4. **Manual check dependency** - Slows CI/CD if no human available; human judgment can be inconsistent.

5. **Grayscale assumption** - Color medical images (color Doppler ultrasound, PET-CT fusion) would fail the R=G=B check even when correct.

6. **Small content missed** - If actual image content is small, random sampling within large regions might miss it entirely.

### Future Improvements

- [ ] Add "correct image" verification using DICOM metadata comparison
- [ ] Handle color medical imaging modalities (US Doppler, PET-CT)
- [ ] Detect common rendering errors (scale, offset, inversion)
- [ ] Reduce manual check triggers for legitimately uniform slices
- [ ] Add center-weighted sampling for small image content

---

## Known Test Limitations

1. **Performance benchmarks** - No automated performance regression tests yet
2. **Multi-browser** - Currently only testing Chromium (Chrome/Edge required for File System Access API anyway)
3. **Visual verification** - See detailed section above for limitations

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
