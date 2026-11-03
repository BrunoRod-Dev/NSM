import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4300', channel: 'chrome', headless: true, viewport: { width: 1440, height: 950 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node --import tsx --env-file=.env scripts/e2e-server.ts', url: 'http://127.0.0.1:4300/api/health', reuseExistingServer: false, timeout: 30000 },
});
