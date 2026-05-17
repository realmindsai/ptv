/**
 * Playwright e2e for the Atlas shell.
 *
 * Setup (one-time): `npx playwright install chromium`
 * Run: `npm run test:e2e:browser`
 *
 * This is NOT part of `npm test` because it requires a browser binary (Chromium).
 * The separate `test:e2e:browser` script invokes `playwright test` directly.
 */
import { test, expect } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let proc: ChildProcessWithoutNullStreams;
const PORT = 18086;
const BASE = `http://127.0.0.1:${PORT}`;

test.beforeAll(async () => {
  proc = spawn('node', ['dist/index.js', 'serve', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'pipe',
    env: { ...process.env, NOMINATIM_URL: 'http://x', REDIS_URL: '' },
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve did not boot in 10s')), 10000);
    const onData = (b: Buffer) => {
      if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
  });
}, 15000);

test.afterAll(() => proc?.kill('SIGTERM'));

test('Atlas shell renders core structure', async ({ page }) => {
  // Register before navigation so initial-document asset failures are captured.
  const failedRequests: string[] = [];
  page.on('requestfailed', (req) => failedRequests.push(req.url()));

  await page.goto(BASE);

  // Map container present.
  await expect(page.locator('#map')).toBeVisible();

  // Floating from/to pill present with inputs.
  await expect(page.locator('.from-to-pill')).toBeVisible();
  await expect(page.locator('input[name="from-query"]')).toBeVisible();
  await expect(page.locator('input[name="to-query"]')).toBeVisible();

  // Bottom sheet + Plan button.
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('button.btn--cta[type="submit"]')).toBeVisible();

  // Vendored assets actually load (no failed /static/ requests).
  await page.waitForLoadState('networkidle');
  expect(failedRequests.filter((u) => u.includes('/static/'))).toEqual([]);
});

test('Atlas shell has no console errors on initial load', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  // Allow Leaflet warnings about CSS image paths since we haven't vendored marker icons,
  // but no real JS errors.
  expect(consoleErrors.filter((e) => !/marker-icon|leaflet image/i.test(e))).toEqual([]);
});
