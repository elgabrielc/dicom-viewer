# Test Plan: Phase 1 Viewing Tools

## Overview
Comprehensive test plan for Window/Level, Pan, Zoom, and Reset functionality in the DICOM viewer.

**Test Environment:**
- URL: http://127.0.0.1:5001
- Browser: Chrome or Edge (required for File System Access API)
- Test Data: Any DICOM folder with CT and/or MRI series

---

## Pre-Test Setup

### Setup Steps
1. Open http://127.0.0.1:5001 in Chrome/Edge
2. Drop a DICOM folder onto the upload zone
3. Wait for scanning to complete
4. Click on a study row to expand series list
5. Click on a series to open the viewer

### Expected Initial State
- Toolbar visible above the image with buttons: W/L, Pan, Zoom, Reset
- W/L button should be highlighted (active) by default
- W/L display on right side of toolbar shows "C: [number] W: [number]"
- Image displayed at 1:1 zoom, centered, no pan offset
- Slice controls visible below the image

---

## Test Suite 1: Window/Level Tool

### T1.1: W/L Tool Selection
**Steps:**
1. Observe the toolbar on viewer load

**Expected:**
- W/L button has active styling (blue background)
- Other tool buttons have inactive styling (dark background)
- Cursor over canvas should be crosshair

### T1.2: W/L Drag - Horizontal (Window Width)
**Steps:**
1. Ensure W/L tool is active
2. Click and drag horizontally to the RIGHT on the image
3. Observe the image and W/L display

**Expected:**
- Image contrast INCREASES (brighter whites, darker blacks)
- W value in toolbar display INCREASES
- C value remains approximately the same

### T1.3: W/L Drag - Horizontal (Window Width Decrease)
**Steps:**
1. Ensure W/L tool is active
2. Click and drag horizontally to the LEFT on the image

**Expected:**
- Image contrast DECREASES (more gray, less dynamic range)
- W value in toolbar display DECREASES
- W value should not go below 1

### T1.4: W/L Drag - Vertical (Window Center)
**Steps:**
1. Ensure W/L tool is active
2. Click and drag UPWARD on the image

**Expected:**
- Image gets BRIGHTER overall
- C value in toolbar display DECREASES (drag up = decrease center)

### T1.5: W/L Drag - Vertical (Window Center - Down)
**Steps:**
1. Ensure W/L tool is active
2. Click and drag DOWNWARD on the image

**Expected:**
- Image gets DARKER overall
- C value in toolbar display INCREASES

### T1.6: W/L Diagonal Drag
**Steps:**
1. Ensure W/L tool is active
2. Click and drag diagonally (up-right)

**Expected:**
- Both C and W values change simultaneously
- Image shows combined effect (brighter + more contrast)

### T1.7: W/L Persistence Across Slices
**Steps:**
1. Adjust W/L to a noticeably different setting
2. Navigate to a different slice using arrow keys or scroll
3. Observe the image

**Expected:**
- New slice renders with the SAME W/L settings
- W/L display shows same values
- User's adjustment is preserved

### T1.8: W/L on MRI vs CT
**Steps:**
1. Load a CT series, note the default W/L values
2. Adjust W/L, observe behavior
3. Switch to an MRI series
4. Observe default W/L values and adjust

**Expected:**
- CT typically has higher values (e.g., C:40 W:400 for soft tissue)
- MRI uses auto-calculated values based on pixel statistics
- Both should respond to W/L drag adjustments

---

## Test Suite 2: Pan Tool

### T2.1: Pan Tool Selection via Button
**Steps:**
1. Click the "Pan" button in toolbar

**Expected:**
- Pan button becomes active (blue)
- W/L button becomes inactive (dark)
- Cursor over canvas changes to "grab" hand

### T2.2: Pan Tool Selection via Keyboard
**Steps:**
1. Press 'P' key

**Expected:**
- Pan button becomes active
- Same cursor change as T2.1

### T2.3: Pan Drag
**Steps:**
1. Select Pan tool
2. Click and drag on the image

**Expected:**
- Image moves with the mouse
- Cursor changes to "grabbing" during drag
- Image position updates in real-time (smooth)

### T2.4: Pan in All Directions
**Steps:**
1. Select Pan tool
2. Drag left, right, up, down, and diagonally

**Expected:**
- Image moves correctly in all directions
- No jitter or jumping
- Movement is 1:1 with mouse movement

### T2.5: Pan Persistence Across Slices
**Steps:**
1. Pan the image to an offset position
2. Navigate to a different slice

**Expected:**
- Pan offset is PRESERVED
- New slice appears at same position

### T2.6: Pan Beyond Viewport
**Steps:**
1. Pan the image significantly off-screen

**Expected:**
- Image can be panned beyond viewport edges
- No crashes or errors
- Can pan back to center

### T2.7: Pan Cursor on Mouse Leave
**Steps:**
1. Select Pan tool
2. Start dragging
3. Move mouse outside the canvas while dragging

**Expected:**
- Drag operation ends cleanly
- No stuck drag state
- Cursor returns to normal "grab" when back over canvas

---

## Test Suite 3: Zoom Tool

### T3.1: Zoom Tool Selection via Button
**Steps:**
1. Click the "Zoom" button in toolbar

**Expected:**
- Zoom button becomes active (blue)
- Other buttons become inactive
- Cursor over canvas changes to "zoom-in"

### T3.2: Zoom Tool Selection via Keyboard
**Steps:**
1. Press 'Z' key

**Expected:**
- Zoom button becomes active
- Same cursor change as T3.1

### T3.3: Zoom Drag - Zoom In
**Steps:**
1. Select Zoom tool
2. Click and drag UPWARD on the image

**Expected:**
- Image ZOOMS IN (gets larger)
- Zoom is centered on canvas center
- Smooth scaling animation

### T3.4: Zoom Drag - Zoom Out
**Steps:**
1. Select Zoom tool
2. Click and drag DOWNWARD on the image

**Expected:**
- Image ZOOMS OUT (gets smaller)
- Minimum zoom level is 0.1x (10%)
- Image doesn't disappear completely

### T3.5: Zoom via Scroll Wheel (Zoom Tool Active)
**Steps:**
1. Select Zoom tool
2. Scroll UP on the image
3. Scroll DOWN on the image

**Expected:**
- Scroll UP = zoom IN
- Scroll DOWN = zoom OUT
- Incremental zoom steps (~10% per scroll tick)

### T3.6: Scroll Wheel with Non-Zoom Tool
**Steps:**
1. Select W/L or Pan tool
2. Scroll on the image

**Expected:**
- Scroll navigates SLICES (not zoom)
- Scroll down = next slice
- Scroll up = previous slice

### T3.7: Zoom Limits
**Steps:**
1. Select Zoom tool
2. Zoom in as far as possible
3. Zoom out as far as possible

**Expected:**
- Maximum zoom: 10x (1000%)
- Minimum zoom: 0.1x (10%)
- Zoom stops at limits, doesn't wrap or error

### T3.8: Zoom Persistence Across Slices
**Steps:**
1. Zoom to 2x or 3x
2. Navigate to a different slice

**Expected:**
- Zoom level is PRESERVED
- New slice appears at same zoom level

### T3.9: Combined Pan and Zoom
**Steps:**
1. Zoom in to 2x
2. Switch to Pan tool
3. Pan the zoomed image

**Expected:**
- Pan works correctly on zoomed image
- Both transforms combine correctly
- No visual glitches

---

## Test Suite 4: Reset Function

### T4.1: Reset via Button
**Steps:**
1. Adjust W/L to non-default values
2. Pan the image off-center
3. Zoom to 2x
4. Click the "Reset" button

**Expected:**
- Image returns to center (pan = 0,0)
- Zoom returns to 1x (100%)
- W/L returns to original DICOM/auto values
- W/L display updates to show original values

### T4.2: Reset via Keyboard
**Steps:**
1. Make various adjustments (W/L, pan, zoom)
2. Press 'R' key

**Expected:**
- Same reset behavior as T4.1

### T4.3: Reset Preserves Slice Position
**Steps:**
1. Navigate to slice 50 (or middle of series)
2. Make adjustments
3. Click Reset

**Expected:**
- View resets
- Still on slice 50 (slice position NOT affected)

### T4.4: Reset After Series Switch
**Steps:**
1. Adjust W/L on Series A
2. Switch to Series B
3. Observe initial state

**Expected:**
- Series B loads with DEFAULT view (no carried-over adjustments)
- Pan = 0, Zoom = 1x, W/L = DICOM/auto values for Series B

---

## Test Suite 5: Keyboard Shortcuts

### T5.1: Tool Shortcuts
**Steps:**
1. Press 'W' key
2. Press 'P' key
3. Press 'Z' key

**Expected:**
- 'W' activates W/L tool
- 'P' activates Pan tool
- 'Z' activates Zoom tool
- Corresponding button highlights

### T5.2: Reset Shortcut
**Steps:**
1. Make adjustments
2. Press 'R' key

**Expected:**
- View resets (same as Reset button)

### T5.3: Shortcuts Case Insensitive
**Steps:**
1. Press 'w' (lowercase)
2. Press 'W' (uppercase)

**Expected:**
- Both work identically

### T5.4: Shortcuts Don't Interfere with Navigation
**Steps:**
1. Press Arrow Left/Right/Up/Down

**Expected:**
- Slice navigation still works
- No tool changes on arrow keys

### T5.5: Shortcuts Disabled in Input Fields
**Steps:**
1. Click on a comment input field (in library view)
2. Type 'w', 'p', 'z', 'r'

**Expected:**
- Letters appear in input field
- Tools do NOT change
- Shortcuts only work when not focused on input

---

## Test Suite 6: UI State & Visual Feedback

### T6.1: Active Button Styling
**Steps:**
1. Click each tool button in sequence

**Expected:**
- Active button: blue background (#4a6fa5), lighter border
- Inactive buttons: dark background (#2a2a4a), dark border
- Only ONE button active at a time (except Reset which has no active state)

### T6.2: W/L Display Updates
**Steps:**
1. Load a series
2. Drag to adjust W/L
3. Navigate slices
4. Reset

**Expected:**
- W/L display shows current values at all times
- Format: "C: [integer] W: [integer]"
- Updates in real-time during drag

### T6.3: Cursor Feedback
| Tool | Cursor (idle) | Cursor (dragging) |
|------|---------------|-------------------|
| W/L | crosshair | ns-resize |
| Pan | grab | grabbing |
| Zoom | zoom-in | ns-resize |

**Steps:**
1. Select each tool, observe cursor
2. Drag with each tool, observe cursor change

### T6.4: Toolbar Visibility
**Steps:**
1. Open viewer with a series

**Expected:**
- Toolbar visible between header and canvas
- All buttons visible and clickable
- Separator line between tool buttons and Reset
- W/L display on far right

---

## Test Suite 7: Edge Cases & Error Handling

### T7.1: Rapid Tool Switching
**Steps:**
1. Rapidly click between W/L, Pan, Zoom buttons

**Expected:**
- Tool switches correctly each time
- No visual glitches
- No console errors

### T7.2: Drag During Slice Load
**Steps:**
1. Start dragging (any tool)
2. While dragging, press arrow key to change slice

**Expected:**
- Slice changes
- Drag state handled gracefully (either continues or ends cleanly)

### T7.3: Very Small Image
**Steps:**
1. Load a series with small image dimensions (e.g., 64x64)
2. Test all tools

**Expected:**
- All tools work correctly
- Zoom works (can zoom in to see detail)

### T7.4: Very Large Image
**Steps:**
1. Load a series with large image dimensions (e.g., 1024x1024 or larger)
2. Test all tools

**Expected:**
- All tools work correctly
- Performance remains acceptable

### T7.5: Blank Slice Handling
**Steps:**
1. Load the MRI MPR series with blank first slice
2. Navigate to slice 1 (blank)
3. Test W/L drag

**Expected:**
- Blank slice displays as black
- W/L drag doesn't crash (may have no visible effect on black image)
- Can navigate away and back

### T7.6: Multiple Browser Tabs
**Steps:**
1. Open viewer in two tabs with different series
2. Adjust tools in each independently

**Expected:**
- Each tab maintains independent state
- No cross-tab interference

### T7.7: Browser Refresh
**Steps:**
1. Load a series, make adjustments
2. Refresh the browser

**Expected:**
- Page reloads to library view
- No console errors
- State is cleared (expected - no persistence)

---

## Test Suite 8: Performance

### T8.1: W/L Drag Smoothness
**Steps:**
1. Select W/L tool
2. Drag continuously in circles for 5 seconds

**Expected:**
- Image updates smoothly during drag
- No significant lag or frame drops
- No memory leaks (check browser dev tools)

### T8.2: Pan Smoothness
**Steps:**
1. Select Pan tool
2. Drag image around rapidly

**Expected:**
- Image follows mouse with minimal lag
- Smooth movement (CSS transform is GPU-accelerated)

### T8.3: Zoom Smoothness
**Steps:**
1. Select Zoom tool
2. Drag up and down rapidly

**Expected:**
- Zoom updates smoothly
- No flickering or jumping

### T8.4: Large Series Navigation with Adjustments
**Steps:**
1. Load a series with 200+ slices
2. Adjust W/L
3. Rapidly scroll through slices

**Expected:**
- Slices load with W/L applied
- No significant slowdown
- Preloading still works

---

## Test Results Template

| Test ID | Description | Pass/Fail | Notes |
|---------|-------------|-----------|-------|
| T1.1 | W/L Tool Selection | | |
| T1.2 | W/L Drag Right | | |
| T1.3 | W/L Drag Left | | |
| T1.4 | W/L Drag Up | | |
| T1.5 | W/L Drag Down | | |
| T1.6 | W/L Diagonal | | |
| T1.7 | W/L Persistence | | |
| T1.8 | W/L MRI vs CT | | |
| T2.1 | Pan Button | | |
| T2.2 | Pan Keyboard | | |
| T2.3 | Pan Drag | | |
| T2.4 | Pan All Directions | | |
| T2.5 | Pan Persistence | | |
| T2.6 | Pan Beyond Viewport | | |
| T2.7 | Pan Mouse Leave | | |
| T3.1 | Zoom Button | | |
| T3.2 | Zoom Keyboard | | |
| T3.3 | Zoom Drag In | | |
| T3.4 | Zoom Drag Out | | |
| T3.5 | Zoom Scroll (Zoom Active) | | |
| T3.6 | Scroll (Non-Zoom Tool) | | |
| T3.7 | Zoom Limits | | |
| T3.8 | Zoom Persistence | | |
| T3.9 | Pan + Zoom Combined | | |
| T4.1 | Reset Button | | |
| T4.2 | Reset Keyboard | | |
| T4.3 | Reset Preserves Slice | | |
| T4.4 | Reset on Series Switch | | |
| T5.1 | Tool Shortcuts | | |
| T5.2 | Reset Shortcut | | |
| T5.3 | Case Insensitive | | |
| T5.4 | Arrow Keys Work | | |
| T5.5 | Shortcuts in Input | | |
| T6.1 | Button Styling | | |
| T6.2 | W/L Display | | |
| T6.3 | Cursor Feedback | | |
| T6.4 | Toolbar Visibility | | |
| T7.1 | Rapid Tool Switch | | |
| T7.2 | Drag During Load | | |
| T7.3 | Small Image | | |
| T7.4 | Large Image | | |
| T7.5 | Blank Slice | | |
| T7.6 | Multiple Tabs | | |
| T7.7 | Browser Refresh | | |
| T8.1 | W/L Smoothness | | |
| T8.2 | Pan Smoothness | | |
| T8.3 | Zoom Smoothness | | |
| T8.4 | Large Series Perf | | |

---

## Notes for AI Testing Agent

1. **Browser Automation**: Use Puppeteer or Playwright for browser control
2. **Mouse Events**: Must simulate actual mousedown/mousemove/mouseup sequences, not just clicks
3. **Drag Simulation**: Calculate dx/dy deltas for drag operations
4. **Visual Verification**: Screenshot comparison or canvas pixel sampling for W/L changes
5. **State Verification**: Check toolbar button classes for active state
6. **Console Monitoring**: Watch for JavaScript errors during all tests
7. **Timing**: Add small delays between operations for rendering to complete
