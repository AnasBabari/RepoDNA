import { defineConfig } from '@playwright/test';

const requestedPort = Number(process.env.REPODNA_E2E_PORT ?? '3000');
const e2ePort = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536 ? requestedPort : 3000;
const e2eBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${e2ePort}`;
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: `npm run dev -- --port ${e2ePort}`,
      url: e2eBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
    };

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: e2eBaseURL,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
    trace: 'retain-on-failure',
  },
  webServer,
});
