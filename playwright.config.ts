import { defineConfig } from '@playwright/test';

const baseURL = process.env.ECHOSPEAK_TEST_URL ?? 'http://localhost:3000';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: process.env.ECHOSPEAK_TEST_URL ? undefined : { command: 'npm run dev', url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
