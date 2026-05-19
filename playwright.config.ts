import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8186',
    actionTimeout: 5000,
    navigationTimeout: 10000,
  },
  webServer: {
    command: 'node dist/index.js chat-serve --port 8186 --host 127.0.0.1',
    url: 'http://127.0.0.1:8186/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
