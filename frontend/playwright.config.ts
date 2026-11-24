import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the REAL stack: Angular dev server → FastAPI → Ollama + Piper.
 * Both servers are started if they are not already running (reuseExistingServer).
 * Ollama must be running with the model pulled, and the voices downloaded.
 *
 *   npx playwright test            # headless
 *   npx playwright test --ui       # watch it run
 *
 * To test a running deployment instead (Docker, a demo server), point at it; no servers are started:
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test
 */
const target = process.env['E2E_BASE_URL'];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false, // one local LLM: run turns one after another
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: target ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    // Safari (WebKit) and Firefox, for the core flows: CROSS_BROWSER=1 npx playwright test
    ...(process.env['CROSS_BROWSER'] ? [
      { name: 'safari', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, launchOptions: { args: [] } },
        testMatch: /(app|gaze|gestures|early-speech|your-data)\.spec\.ts/ },
      // Firefox takes no Chrome flags: allow audio without a click through its own preference instead.
      { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 },
          launchOptions: { args: [], firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } } },
        testMatch: /(app|gaze|gestures|early-speech|your-data)\.spec\.ts/ },
    ] : []),
  ],
  webServer: target ? [] : [
    {
      // The suite sends many messages a minute from one address, so rate limits are off here.
      command: 'RATE_LIMITS=false ../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --port 8000',
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run start -- --port 4200',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
