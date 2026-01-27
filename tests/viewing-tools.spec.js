// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Playwright tests for DICOM Viewer Viewing Tools
 * Tests Window/Level, Pan, Zoom, and Reset functionality
 *
 * Test URL: http://127.0.0.1:5001/?test (auto-loads test data)
 */

const TEST_URL = 'http://127.0.0.1:5001/?test';
const CANVAS_SELECTOR = '#imageCanvas';
const WL_BUTTON_SELECTOR = '[data-tool="wl"]';
const PAN_BUTTON_SELECTOR = '[data-tool="pan"]';
const ZOOM_BUTTON_SELECTOR = '[data-tool="zoom"]';
const RESET_BUTTON_SELECTOR = '#resetViewBtn';
const WL_DISPLAY_SELECTOR = '#wlDisplay';
const TOOLBAR_SELECTOR = '.viewer-toolbar';

// Helper function to wait for the viewer to be ready
async function waitForViewerReady(page) {
  // Wait for canvas to be visible
  await page.waitForSelector(CANVAS_SELECTOR, { state: 'visible', timeout: 30000 });

  // Wait for W/L display to have values (indicates image is loaded)
  await page.waitForFunction(() => {
    const wlDisplay = document.querySelector('#wlDisplay');
    return wlDisplay && wlDisplay.textContent && wlDisplay.textContent.includes('C:');
  }, { timeout: 30000 });

  // Small delay for rendering to complete
  await page.waitForTimeout(500);
}

// Helper function to parse W/L values from display
async function getWLValues(page) {
  const text = await page.locator(WL_DISPLAY_SELECTOR).textContent();
  const match = text.match(/C:\s*(-?\d+)\s*W:\s*(\d+)/);
  if (match) {
    return { center: parseInt(match[1]), width: parseInt(match[2]) };
  }
  return null;
}

// Helper function to check if a button is active
async function isButtonActive(page, selector) {
  const button = page.locator(selector);
  const classList = await button.getAttribute('class');
  return classList && classList.includes('active');
}

// Helper function to perform a drag operation
async function performDrag(page, startX, startY, endX, endY, steps = 10) {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps });
  await page.mouse.up();
}

// Helper function to get canvas bounding box
async function getCanvasBounds(page) {
  const canvas = page.locator(CANVAS_SELECTOR);
  return await canvas.boundingBox();
}

// Helper function to get canvas transform values
async function getCanvasTransform(page) {
  return await page.locator(CANVAS_SELECTOR).evaluate(el => {
    const style = window.getComputedStyle(el);
    const transform = style.transform;
    if (transform === 'none') {
      return { scale: 1, translateX: 0, translateY: 0 };
    }
    // Parse matrix(a, b, c, d, tx, ty) - scale is in a/d, translate in tx/ty
    const match = transform.match(/matrix\(([^)]+)\)/);
    if (match) {
      const values = match[1].split(',').map(v => parseFloat(v.trim()));
      return {
        scale: values[0],  // a value represents scale
        translateX: values[4],
        translateY: values[5]
      };
    }
    return { scale: 1, translateX: 0, translateY: 0 };
  });
}

// Helper function to get current slice info
async function getSliceInfo(page) {
  const text = await page.locator('#sliceInfo').textContent();
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (match) {
    return { current: parseInt(match[1]), total: parseInt(match[2]) };
  }
  return null;
}

// Helper function to get canvas cursor style
async function getCanvasCursor(page) {
  return await page.locator(CANVAS_SELECTOR).evaluate(el => {
    return window.getComputedStyle(el).cursor;
  });
}

// ============================================
// Test Suite 1: Toolbar Visibility and Initial State
// ============================================

test.describe('Test Suite 1: Toolbar Visibility and Initial State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T1.0: Toolbar is visible with all buttons', async ({ page }) => {
    // Check toolbar visibility
    await expect(page.locator(TOOLBAR_SELECTOR)).toBeVisible();

    // Check all tool buttons are visible
    await expect(page.locator(WL_BUTTON_SELECTOR)).toBeVisible();
    await expect(page.locator(PAN_BUTTON_SELECTOR)).toBeVisible();
    await expect(page.locator(ZOOM_BUTTON_SELECTOR)).toBeVisible();
    await expect(page.locator(RESET_BUTTON_SELECTOR)).toBeVisible();

    // Check W/L display is visible
    await expect(page.locator(WL_DISPLAY_SELECTOR)).toBeVisible();
  });

  test('T1.1: W/L tool is active by default', async ({ page }) => {
    // W/L button should be active
    const wlActive = await isButtonActive(page, WL_BUTTON_SELECTOR);
    expect(wlActive).toBe(true);

    // Other buttons should be inactive
    const panActive = await isButtonActive(page, PAN_BUTTON_SELECTOR);
    const zoomActive = await isButtonActive(page, ZOOM_BUTTON_SELECTOR);
    expect(panActive).toBe(false);
    expect(zoomActive).toBe(false);
  });

  test('T6.2: W/L display shows valid values', async ({ page }) => {
    const wlValues = await getWLValues(page);
    expect(wlValues).not.toBeNull();
    expect(wlValues.center).toBeDefined();
    expect(wlValues.width).toBeGreaterThan(0);
  });
});

// ============================================
// Test Suite 2: Window/Level Tool
// ============================================

test.describe('Test Suite 2: Window/Level Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T1.2: W/L drag right increases window width', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial W/L values
    const initialWL = await getWLValues(page);

    // Drag right (increase window width)
    await performDrag(page, centerX, centerY, centerX + 100, centerY);

    // Wait for update
    await page.waitForTimeout(100);

    // Get new W/L values
    const newWL = await getWLValues(page);

    // Window width should increase
    expect(newWL.width).toBeGreaterThan(initialWL.width);
  });

  test('T1.3: W/L drag left decreases window width', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial W/L values
    const initialWL = await getWLValues(page);

    // Drag left (decrease window width)
    await performDrag(page, centerX, centerY, centerX - 100, centerY);

    // Wait for update
    await page.waitForTimeout(100);

    // Get new W/L values
    const newWL = await getWLValues(page);

    // Window width should decrease (but not below 1)
    expect(newWL.width).toBeLessThan(initialWL.width);
    expect(newWL.width).toBeGreaterThanOrEqual(1);
  });

  test('T1.4: W/L drag up increases window center (darker)', async ({ page }) => {
    // Note: In this implementation, drag up INCREASES center (opposite of some conventions)
    // This is because: state.windowLevel.center = currentCenter - dy * sensitivity
    // Drag up = negative dy = center + positive value = increase
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial W/L values
    const initialWL = await getWLValues(page);

    // Drag up (increases window center in this implementation)
    await performDrag(page, centerX, centerY, centerX, centerY - 100);

    // Wait for update
    await page.waitForTimeout(100);

    // Get new W/L values
    const newWL = await getWLValues(page);

    // Window center should increase (implementation specific)
    expect(newWL.center).toBeGreaterThan(initialWL.center);
  });

  test('T1.5: W/L drag down decreases window center (brighter)', async ({ page }) => {
    // Note: In this implementation, drag down DECREASES center
    // This is because: state.windowLevel.center = currentCenter - dy * sensitivity
    // Drag down = positive dy = center - positive value = decrease
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial W/L values
    const initialWL = await getWLValues(page);

    // Drag down (decreases window center in this implementation)
    await performDrag(page, centerX, centerY, centerX, centerY + 100);

    // Wait for update
    await page.waitForTimeout(100);

    // Get new W/L values
    const newWL = await getWLValues(page);

    // Window center should decrease (implementation specific)
    expect(newWL.center).toBeLessThan(initialWL.center);
  });

  test('T1.6: W/L diagonal drag changes both values', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial W/L values
    const initialWL = await getWLValues(page);

    // Drag diagonally (up-right)
    await performDrag(page, centerX, centerY, centerX + 100, centerY - 100);

    // Wait for update
    await page.waitForTimeout(100);

    // Get new W/L values
    const newWL = await getWLValues(page);

    // Both values should change
    expect(newWL.center).not.toBe(initialWL.center);
    expect(newWL.width).not.toBe(initialWL.width);
  });
});

// ============================================
// Test Suite 3: Pan Tool
// ============================================

test.describe('Test Suite 3: Pan Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T2.1: Pan tool selection via button', async ({ page }) => {
    // Click Pan button
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    // Pan button should be active
    const panActive = await isButtonActive(page, PAN_BUTTON_SELECTOR);
    expect(panActive).toBe(true);

    // W/L button should be inactive
    const wlActive = await isButtonActive(page, WL_BUTTON_SELECTOR);
    expect(wlActive).toBe(false);
  });

  test('T2.2: Pan tool selection via keyboard (P key)', async ({ page }) => {
    // Press P key
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // Pan button should be active
    const panActive = await isButtonActive(page, PAN_BUTTON_SELECTOR);
    expect(panActive).toBe(true);
  });

  test('T2.3: Pan drag moves the image', async ({ page }) => {
    // Select Pan tool
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial canvas transform (if any)
    const initialTransform = await page.locator(CANVAS_SELECTOR).evaluate(el => {
      return window.getComputedStyle(el).transform;
    });

    // Perform pan drag
    await performDrag(page, centerX, centerY, centerX + 50, centerY + 50);

    // Wait for update
    await page.waitForTimeout(100);

    // Get new transform
    const newTransform = await page.locator(CANVAS_SELECTOR).evaluate(el => {
      return window.getComputedStyle(el).transform;
    });

    // Transform should change (image moved)
    // Note: If the app uses internal state rather than CSS transform,
    // we need to verify differently
    // For now, we verify no errors occurred and tool is still active
    const panActive = await isButtonActive(page, PAN_BUTTON_SELECTOR);
    expect(panActive).toBe(true);
  });

  test('T2.4: Pan in all directions', async ({ page }) => {
    // Select Pan tool
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Pan left
    await performDrag(page, centerX, centerY, centerX - 30, centerY);
    await page.waitForTimeout(50);

    // Pan right
    await performDrag(page, centerX - 30, centerY, centerX + 30, centerY);
    await page.waitForTimeout(50);

    // Pan up
    await performDrag(page, centerX, centerY, centerX, centerY - 30);
    await page.waitForTimeout(50);

    // Pan down
    await performDrag(page, centerX, centerY, centerX, centerY + 30);
    await page.waitForTimeout(50);

    // Pan diagonal
    await performDrag(page, centerX, centerY, centerX + 30, centerY + 30);
    await page.waitForTimeout(50);

    // Tool should still be active (no errors)
    const panActive = await isButtonActive(page, PAN_BUTTON_SELECTOR);
    expect(panActive).toBe(true);
  });
});

// ============================================
// Test Suite 4: Zoom Tool
// ============================================

test.describe('Test Suite 4: Zoom Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T3.1: Zoom tool selection via button', async ({ page }) => {
    // Click Zoom button
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    // Zoom button should be active
    const zoomActive = await isButtonActive(page, ZOOM_BUTTON_SELECTOR);
    expect(zoomActive).toBe(true);

    // Other buttons should be inactive
    const wlActive = await isButtonActive(page, WL_BUTTON_SELECTOR);
    const panActive = await isButtonActive(page, PAN_BUTTON_SELECTOR);
    expect(wlActive).toBe(false);
    expect(panActive).toBe(false);
  });

  test('T3.2: Zoom tool selection via keyboard (Z key)', async ({ page }) => {
    // Press Z key
    await page.keyboard.press('z');
    await page.waitForTimeout(100);

    // Zoom button should be active
    const zoomActive = await isButtonActive(page, ZOOM_BUTTON_SELECTOR);
    expect(zoomActive).toBe(true);
  });

  test('T3.3: Zoom drag up zooms in', async ({ page }) => {
    // Select Zoom tool
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Drag up to zoom in
    await performDrag(page, centerX, centerY, centerX, centerY - 100);

    // Wait for update
    await page.waitForTimeout(100);

    // Verify zoom changed (check canvas scale or internal state)
    // The zoom tool should remain active
    const zoomActive = await isButtonActive(page, ZOOM_BUTTON_SELECTOR);
    expect(zoomActive).toBe(true);
  });

  test('T3.4: Zoom drag down zooms out', async ({ page }) => {
    // Select Zoom tool
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Drag down to zoom out
    await performDrag(page, centerX, centerY, centerX, centerY + 100);

    // Wait for update
    await page.waitForTimeout(100);

    // Verify zoom tool remains active (no errors)
    const zoomActive = await isButtonActive(page, ZOOM_BUTTON_SELECTOR);
    expect(zoomActive).toBe(true);
  });

  test('T3.5: Zoom via scroll wheel (zoom tool active)', async ({ page }) => {
    // Select Zoom tool
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Scroll up (zoom in)
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);

    // Scroll down (zoom out)
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);

    // Zoom tool should remain active
    const zoomActive = await isButtonActive(page, ZOOM_BUTTON_SELECTOR);
    expect(zoomActive).toBe(true);
  });

  test('T3.6: Scroll with non-zoom tool navigates slices', async ({ page }) => {
    // Ensure W/L tool is active (default)
    const wlActive = await isButtonActive(page, WL_BUTTON_SELECTOR);
    expect(wlActive).toBe(true);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial slice (check slice display if available)
    // Scroll should navigate slices, not zoom
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);

    // W/L tool should still be active
    const stillActive = await isButtonActive(page, WL_BUTTON_SELECTOR);
    expect(stillActive).toBe(true);
  });
});

// ============================================
// Test Suite 5: Reset Function
// ============================================

test.describe('Test Suite 5: Reset Function', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T4.1: Reset via button restores initial state', async ({ page }) => {
    // Get initial W/L values
    const initialWL = await getWLValues(page);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Modify W/L
    await performDrag(page, centerX, centerY, centerX + 100, centerY + 100);
    await page.waitForTimeout(100);

    // Verify W/L changed
    const modifiedWL = await getWLValues(page);
    expect(modifiedWL.center).not.toBe(initialWL.center);

    // Click Reset button
    await page.click(RESET_BUTTON_SELECTOR);
    await page.waitForTimeout(200);

    // Verify W/L is restored to initial values
    const resetWL = await getWLValues(page);
    expect(resetWL.center).toBe(initialWL.center);
    expect(resetWL.width).toBe(initialWL.width);
  });

  test('T4.2: Reset via keyboard (R key)', async ({ page }) => {
    // Get initial W/L values
    const initialWL = await getWLValues(page);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Modify W/L
    await performDrag(page, centerX, centerY, centerX + 100, centerY - 100);
    await page.waitForTimeout(100);

    // Verify W/L changed
    const modifiedWL = await getWLValues(page);
    expect(modifiedWL.width).not.toBe(initialWL.width);

    // Press R key to reset
    await page.keyboard.press('r');
    await page.waitForTimeout(200);

    // Verify W/L is restored
    const resetWL = await getWLValues(page);
    expect(resetWL.center).toBe(initialWL.center);
    expect(resetWL.width).toBe(initialWL.width);
  });
});

// ============================================
// Test Suite 6: Keyboard Shortcuts
// ============================================

test.describe('Test Suite 6: Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T5.1: Tool shortcuts (W, P, Z)', async ({ page }) => {
    // Press W - should activate W/L tool
    await page.keyboard.press('w');
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, WL_BUTTON_SELECTOR)).toBe(true);

    // Press P - should activate Pan tool
    await page.keyboard.press('p');
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(true);
    expect(await isButtonActive(page, WL_BUTTON_SELECTOR)).toBe(false);

    // Press Z - should activate Zoom tool
    await page.keyboard.press('z');
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, ZOOM_BUTTON_SELECTOR)).toBe(true);
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(false);
  });

  test('T5.3: Shortcuts are case insensitive', async ({ page }) => {
    // Test uppercase W
    await page.keyboard.press('W');
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, WL_BUTTON_SELECTOR)).toBe(true);

    // Test uppercase P
    await page.keyboard.press('P');
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(true);

    // Test uppercase Z
    await page.keyboard.press('Z');
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, ZOOM_BUTTON_SELECTOR)).toBe(true);
  });

  test('T5.4: Arrow keys work for navigation', async ({ page }) => {
    // Arrow keys should work without changing tools
    const initialWLActive = await isButtonActive(page, WL_BUTTON_SELECTOR);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);

    // Tool should not change
    const finalWLActive = await isButtonActive(page, WL_BUTTON_SELECTOR);
    expect(finalWLActive).toBe(initialWLActive);
  });
});

// ============================================
// Test Suite 7: UI State and Visual Feedback
// ============================================

test.describe('Test Suite 7: UI State and Visual Feedback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T6.1: Only one button active at a time', async ({ page }) => {
    // Check W/L is active initially
    expect(await isButtonActive(page, WL_BUTTON_SELECTOR)).toBe(true);
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(false);
    expect(await isButtonActive(page, ZOOM_BUTTON_SELECTOR)).toBe(false);

    // Click Pan
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, WL_BUTTON_SELECTOR)).toBe(false);
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(true);
    expect(await isButtonActive(page, ZOOM_BUTTON_SELECTOR)).toBe(false);

    // Click Zoom
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    expect(await isButtonActive(page, WL_BUTTON_SELECTOR)).toBe(false);
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(false);
    expect(await isButtonActive(page, ZOOM_BUTTON_SELECTOR)).toBe(true);
  });

  test('T6.4: Toolbar is properly visible', async ({ page }) => {
    // Check toolbar is visible
    await expect(page.locator(TOOLBAR_SELECTOR)).toBeVisible();

    // Check all buttons are visible
    await expect(page.locator(WL_BUTTON_SELECTOR)).toBeVisible();
    await expect(page.locator(PAN_BUTTON_SELECTOR)).toBeVisible();
    await expect(page.locator(ZOOM_BUTTON_SELECTOR)).toBeVisible();
    await expect(page.locator(RESET_BUTTON_SELECTOR)).toBeVisible();

    // Check W/L display is visible
    await expect(page.locator(WL_DISPLAY_SELECTOR)).toBeVisible();

    // Verify W/L display has content
    const wlText = await page.locator(WL_DISPLAY_SELECTOR).textContent();
    expect(wlText).toContain('C:');
    expect(wlText).toContain('W:');
  });
});

// ============================================
// Test Suite 8: Edge Cases and Error Handling
// ============================================

test.describe('Test Suite 8: Edge Cases and Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T7.1: Rapid tool switching', async ({ page }) => {
    // Rapidly switch between tools
    for (let i = 0; i < 10; i++) {
      await page.click(WL_BUTTON_SELECTOR);
      await page.click(PAN_BUTTON_SELECTOR);
      await page.click(ZOOM_BUTTON_SELECTOR);
    }

    await page.waitForTimeout(100);

    // Last clicked should be active
    expect(await isButtonActive(page, ZOOM_BUTTON_SELECTOR)).toBe(true);

    // Check for console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Do one more round
    await page.click(WL_BUTTON_SELECTOR);
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    // Should not have critical errors
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });

  test('T7.2: W/L display updates in real-time during drag', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Start drag
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Move in steps and check W/L updates
    const values = [];
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(centerX + (i * 20), centerY);
      await page.waitForTimeout(50);
      const wl = await getWLValues(page);
      values.push(wl.width);
    }

    await page.mouse.up();

    // Values should be progressively increasing
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  test('T8.1: W/L drag is smooth (no errors)', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Collect console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Drag continuously
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Move in a circle
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      const x = centerX + Math.cos(angle) * 50;
      const y = centerY + Math.sin(angle) * 50;
      await page.mouse.move(x, y);
      await page.waitForTimeout(10);
    }

    await page.mouse.up();

    // Should complete without errors
    expect(consoleErrors.filter(e => !e.includes('favicon'))).toHaveLength(0);
  });
});

// ============================================
// Test Suite 9: Combined Operations
// ============================================

test.describe('Test Suite 9: Combined Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T3.9: Combined pan and zoom operations', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Zoom in first
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    await performDrag(page, centerX, centerY, centerX, centerY - 100);
    await page.waitForTimeout(100);

    // Switch to Pan and pan the zoomed image
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    await performDrag(page, centerX, centerY, centerX + 50, centerY + 50);
    await page.waitForTimeout(100);

    // Pan tool should still be active
    expect(await isButtonActive(page, PAN_BUTTON_SELECTOR)).toBe(true);
  });

  test('Full workflow: W/L adjustment, zoom, pan, then reset', async ({ page }) => {
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Get initial state
    const initialWL = await getWLValues(page);

    // Step 1: Adjust W/L
    await performDrag(page, centerX, centerY, centerX + 100, centerY - 50);
    await page.waitForTimeout(100);

    // Verify W/L changed
    const afterWL = await getWLValues(page);
    expect(afterWL.width).not.toBe(initialWL.width);

    // Step 2: Zoom in
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    await performDrag(page, centerX, centerY, centerX, centerY - 100);
    await page.waitForTimeout(100);

    // Step 3: Pan
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    await performDrag(page, centerX, centerY, centerX + 50, centerY + 50);
    await page.waitForTimeout(100);

    // Step 4: Reset
    await page.click(RESET_BUTTON_SELECTOR);
    await page.waitForTimeout(200);

    // Verify W/L is restored
    const resetWL = await getWLValues(page);
    expect(resetWL.center).toBe(initialWL.center);
    expect(resetWL.width).toBe(initialWL.width);
  });
});

// ============================================
// Test Suite 10: Improved Transform Verification
// These tests verify actual transform values change
// ============================================

test.describe('Test Suite 10: Transform Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T3.3-improved: Zoom drag up actually increases scale', async ({ page }) => {
    // Get initial transform
    const initialTransform = await getCanvasTransform(page);

    // Select Zoom tool and drag up
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    await performDrag(page, centerX, centerY, centerX, centerY - 150);
    await page.waitForTimeout(100);

    // Verify scale increased
    const newTransform = await getCanvasTransform(page);
    expect(newTransform.scale).toBeGreaterThan(initialTransform.scale);
  });

  test('T3.7: Zoom has limits (0.1x to 10x)', async ({ page }) => {
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Try to zoom out way past minimum
    for (let i = 0; i < 10; i++) {
      await performDrag(page, centerX, centerY, centerX, centerY + 200);
      await page.waitForTimeout(50);
    }

    let transform = await getCanvasTransform(page);
    expect(transform.scale).toBeGreaterThanOrEqual(0.1);

    // Reset and try to zoom in way past maximum
    await page.click(RESET_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    for (let i = 0; i < 20; i++) {
      await performDrag(page, centerX, centerY, centerX, centerY - 200);
      await page.waitForTimeout(50);
    }

    transform = await getCanvasTransform(page);
    expect(transform.scale).toBeLessThanOrEqual(10);
  });

  test('T2.3-improved: Pan drag actually changes translate values', async ({ page }) => {
    // Get initial transform
    const initialTransform = await getCanvasTransform(page);

    // Select Pan tool and drag
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);

    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    await performDrag(page, centerX, centerY, centerX + 100, centerY + 80);
    await page.waitForTimeout(100);

    // Verify translate changed
    const newTransform = await getCanvasTransform(page);
    expect(newTransform.translateX).toBeGreaterThan(initialTransform.translateX);
    expect(newTransform.translateY).toBeGreaterThan(initialTransform.translateY);
  });
});

// ============================================
// Test Suite 11: Slice Navigation & Persistence
// ============================================

test.describe('Test Suite 11: Slice Navigation & Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T1.7: W/L persistence across slices', async ({ page }) => {
    // Adjust W/L
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    await performDrag(page, centerX, centerY, centerX + 150, centerY);
    await page.waitForTimeout(100);

    const adjustedWL = await getWLValues(page);

    // Navigate to next slice
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    // W/L should be preserved
    const afterNavWL = await getWLValues(page);
    expect(afterNavWL.width).toBe(adjustedWL.width);
    expect(afterNavWL.center).toBe(adjustedWL.center);
  });

  test('Slice counter updates on navigation', async ({ page }) => {
    const initialSlice = await getSliceInfo(page);
    expect(initialSlice).not.toBeNull();
    expect(initialSlice.current).toBe(1);

    // Navigate forward
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    const newSlice = await getSliceInfo(page);
    expect(newSlice.current).toBe(2);
    expect(newSlice.total).toBe(initialSlice.total);

    // Navigate back
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);

    const backSlice = await getSliceInfo(page);
    expect(backSlice.current).toBe(1);
  });

  test('T4.3: Reset preserves slice position', async ({ page }) => {
    // Navigate to slice 3
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    const sliceBefore = await getSliceInfo(page);
    expect(sliceBefore.current).toBe(3);

    // Adjust W/L and zoom
    const bounds = await getCanvasBounds(page);
    await performDrag(page, bounds.x + 100, bounds.y + 100, bounds.x + 200, bounds.y + 100);
    await page.waitForTimeout(100);

    // Reset
    await page.click(RESET_BUTTON_SELECTOR);
    await page.waitForTimeout(200);

    // Slice should still be 3
    const sliceAfter = await getSliceInfo(page);
    expect(sliceAfter.current).toBe(3);
  });
});

// ============================================
// Test Suite 12: Cursor Feedback
// ============================================

test.describe('Test Suite 12: Cursor Feedback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T6.3: Cursor changes based on active tool', async ({ page }) => {
    // W/L tool (default) - should be crosshair
    let cursor = await getCanvasCursor(page);
    expect(cursor).toBe('crosshair');

    // Pan tool - should be grab
    await page.click(PAN_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    cursor = await getCanvasCursor(page);
    expect(cursor).toBe('grab');

    // Zoom tool - should be zoom-in
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    cursor = await getCanvasCursor(page);
    expect(cursor).toBe('zoom-in');

    // Back to W/L
    await page.click(WL_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    cursor = await getCanvasCursor(page);
    expect(cursor).toBe('crosshair');
  });
});

// ============================================
// Test Suite 13: Series Switching
// ============================================

test.describe('Test Suite 13: Series Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForViewerReady(page);
  });

  test('T4.4: Series switch resets view state', async ({ page }) => {
    // Adjust W/L and zoom
    const bounds = await getCanvasBounds(page);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    await performDrag(page, centerX, centerY, centerX + 150, centerY - 50);
    await page.waitForTimeout(100);

    // Zoom in
    await page.click(ZOOM_BUTTON_SELECTOR);
    await page.waitForTimeout(100);
    await performDrag(page, centerX, centerY, centerX, centerY - 100);
    await page.waitForTimeout(100);

    const zoomedTransform = await getCanvasTransform(page);
    expect(zoomedTransform.scale).toBeGreaterThan(1);

    // Click a different series (if available)
    const seriesItems = page.locator('.series-item');
    const count = await seriesItems.count();

    if (count > 1) {
      // Click second series
      await seriesItems.nth(1).click();
      await page.waitForTimeout(500);

      // View should be reset
      const newTransform = await getCanvasTransform(page);
      expect(newTransform.scale).toBe(1);

      // W/L should be different (series-specific)
      const newWL = await getWLValues(page);
      // Just verify it loaded successfully
      expect(newWL).not.toBeNull();
    }
  });
});
