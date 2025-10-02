import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for BitBonsai Frontend E2E Tests
 *
 * Features:
 * - Multiple browsers (Chromium, Firefox, WebKit)
 * - Parallel test execution
 * - Automatic retries on failure
 * - Video and screenshot capture on failure
 * - Dev server integration
 * - CI/CD optimizations
 */

export default defineConfig({
  // Test directory
  testDir: './apps/frontend/e2e',

  // Maximum time one test can run
  timeout: 30 * 1000,

  // Test expectations timeout
  expect: {
    timeout: 5000,
  },

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['junit', { outputFile: 'playwright-report/junit.xml' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for all tests
    baseURL: process.env.BASE_URL || 'http://localhost:4200',

    // Collect trace on failure
    trace: 'on-first-retry',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure
    video: 'retain-on-failure',

    // Viewport size
    viewport: { width: 1280, height: 720 },

    // Emulate timezone
    timezoneId: 'America/New_York',

    // Emulate locale
    locale: 'en-US',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile browsers
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },

    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },

    // Tablet
    {
      name: 'iPad',
      use: { ...devices['iPad Pro'] },
    },
  ],

  // Run local dev server before starting tests
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run start:frontend',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});
