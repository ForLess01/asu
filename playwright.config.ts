import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', outputDir: '/tmp/asu-playwright-results',
  fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5184', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 375, height: 812 } } },
  ],
  // Existing guest tests deliberately run without cloud/network; auth tests supply a mock service.
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5184', url: 'http://127.0.0.1:5184', reuseExistingServer: false, env: { VITE_NEON_AUTH_URL: '', VITE_NEON_DATA_API_URL: '' } },
});
