import { defineConfig, devices } from '@playwright/test';
import { e2eGhlKey } from './e2e/ghl-key';

const PORT = 3100;
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';
// prepare-db.ts recreates this database from migrations and the fake seed before every run.
// The same test-only master key as prepare-db.ts (a fixed fake, never a real key).
const E2E_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
const E2E_DATABASE_URL = Object.assign(new URL(ADMIN_URL), { pathname: '/rswim_e2e' }).toString();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    // Pixel 7-sized Chromium; the owner and instructors live on their phones.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grepInvert: /@desktop/ },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } }, grep: /@desktop/ },
  ],
  webServer: {
    command: `pnpm exec tsx e2e/prepare-db.ts && pnpm build && pnpm exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      RSWIM_DEV_AUTH: '1',
      RSWIM_COPILOT_FAKE: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL: E2E_DATABASE_URL,
      RSWIM_MASTER_KEY: E2E_MASTER_KEY,
      GHL_WEBHOOK_PUBLIC_KEY: e2eGhlKey().publicKey,
    },
  },
});
