// @ts-check
// Copyright (c) 2026 Divergent Health Technologies
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for DICOM Viewer tests
 *
 * Key design decisions:
 * - Single browser (Chromium) because File System Access API is Chrome/Edge only
 * - Extended timeouts to accommodate DICOM file scanning on server startup
 * - Test data endpoint verification ensures server is fully ready before tests run
 *
 * CI Support:
 * - Set DICOM_TEST_DATA env var to point to test data directory
 * - CI runs use test-fixtures/ directory with minimal DICOM data
 * - Local dev can use larger test data for comprehensive testing
 *
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: 'list',

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: 'http://127.0.0.1:5001',

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    /* Record video on failure */
    video: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Timeout settings */
  timeout: 60000, // 60 seconds per test - DICOM rendering can be slow with large files
  expect: {
    timeout: 10000, // 10 seconds for expect assertions - allows for image decode latency
  },

  /* Start Flask server before tests
   *
   * Why /api/test-data/info endpoint?
   * - This endpoint only returns success after the server has finished scanning
   *   all DICOM files in the test-data directories. Checking the root URL would
   *   return 200 immediately, but tests would fail because test data isn't ready.
   *
   * Why 60000ms timeout?
   * - Initial server startup includes scanning test DICOM directories to build
   *   the test data index. With many files or slow disk I/O, this can take time.
   *
   * Why reuseExistingServer is conditional on CI?
   * - Local development: Reuse existing server for faster iteration (developer
   *   often has server running in another terminal)
   * - CI environment: Always start fresh to ensure clean, reproducible state
   */
  webServer: {
    command: './venv/bin/flask run --host=127.0.0.1 --port=5001',
    url: 'http://127.0.0.1:5001/api/test-data/info',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
