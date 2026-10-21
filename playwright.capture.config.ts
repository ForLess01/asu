import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  testMatch: '**/*.capture.ts', outputDir: '/tmp/asu-capture-results',
  projects: [{ name: 'report', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } }],
});
