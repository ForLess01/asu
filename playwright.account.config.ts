import { defineConfig, devices } from '@playwright/test';
import type {} from './tests/hosted/automatic-sync.spec';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
const baseURL = process.env.ASU_ACCOUNT_ORIGIN ?? 'http://127.0.0.1:5186';
if (!['http://127.0.0.1:5186', 'https://asu-forless01.pages.dev'].includes(baseURL)) throw new Error('Unsupported account-verification origin');
export default defineConfig({
  testDir: './tests/hosted', testMatch: 'automatic-sync.spec.ts', timeout: 180000, globalTimeout: 240000,
  workers: 1, retries: 0, reporter: 'list', outputDir: '/tmp/asu-account-verification', preserveOutput: 'never',
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15000, navigationTimeout: 30000 },
  projects: [{ name: 'account-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: baseURL.startsWith('http:') ? { command: 'npm run dev -- --host 127.0.0.1 --port 5186', url: baseURL, reuseExistingServer: false } : undefined,
});
