import { defineConfig, devices } from '@playwright/test';
import publicCloud from './apps/web/src/cloud-public.json' with { type: 'json' };
// Include the opt-in suite in the existing no-emission typecheck without widening tsconfig.
import type {} from './tests/hosted/neon.spec';

// Playwright's automatic failure DOM snapshot can contain an account email or form value.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Neon Auth trust and Data API CORS are origin-specific; never silently substitute a host/port.
const host = process.env.ASU_HOSTED_HOST ?? 'localhost';
const port = process.env.ASU_HOSTED_PORT ?? '5186';
if (host !== 'localhost' && host !== '127.0.0.1') throw new Error('ASU_HOSTED_HOST must be localhost or 127.0.0.1.');
if (port !== '5186' && port !== '5174') throw new Error('ASU_HOSTED_PORT must be 5186 or 5174.');
const origin = `http://${host}:${port}`;

export default defineConfig({
  testDir: './tests/hosted', testMatch: 'neon.spec.ts',
  timeout: 240_000, globalTimeout: 300_000, expect: { timeout: 30_000 },
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list',
  outputDir: `/tmp/asu-neon-hosted-${host}-${port}`, preserveOutput: 'never',
  use: { baseURL: origin, trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10_000, navigationTimeout: 30_000 },
  projects: [{ name: 'hosted-chromium', use: { ...devices['Desktop Chrome'] } }],
  // Never start, stop, or adopt a process on the normal app port. The test verifies Asu HTML
  // before touching an existing 5174 server. Isolated 5186 runs never reuse another server.
  webServer: port === '5186' ? {
    command: `npm run dev -- --host ${host} --port ${port}`,
    url: origin, reuseExistingServer: false,
    env: { VITE_NEON_AUTH_URL: publicCloud.authUrl, VITE_NEON_DATA_API_URL: publicCloud.dataApiUrl },
  } : undefined,
});
