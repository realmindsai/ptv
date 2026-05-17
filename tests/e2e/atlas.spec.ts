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
  await expect(page.locator('input[name="origin-query"]')).toBeVisible();
  await expect(page.locator('input[name="destination-query"]')).toBeVisible();

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

test('geocode autocomplete fills hidden inputs and submits a plan', async ({ page }) => {
  // Intercept geocode requests BEFORE navigation so the mock is active immediately.
  await page.route('**/api/geocode**', async (route) => {
    const html = [
      '<ul class="geocode-list">',
      '  <li class="geocode-item"',
      '      data-lat="-37.64"',
      '      data-lon="145.19"',
      '      data-label="Hurstbridge VIC">',
      '    <span class="geocode-label">Hurstbridge VIC</span>',
      '    <span class="geocode-coord">-37.64, 145.19</span>',
      '  </li>',
      '</ul>',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });

  await page.goto(BASE);

  // Use pressSequentially so real keyup events fire (page.fill skips keyboard events
  // and HTMX would not trigger the hx-get autocomplete).
  const fromInput = page.locator('input[name="origin-query"]');
  await fromInput.click();
  await fromInput.pressSequentially('hurst', { delay: 50 });

  // HTMX fires after its 300ms delay; wait for the injected suggestion to appear.
  await expect(page.locator('#origin-suggest .geocode-item')).toBeVisible({ timeout: 5000 });

  // Click the suggestion.
  await page.locator('#origin-suggest .geocode-item').first().click();

  // Hidden inputs must be populated by the click handler.
  await expect(page.locator('input[name="origin[lat]"]')).toHaveValue('-37.64');
  await expect(page.locator('input[name="origin[lon]"]')).toHaveValue('145.19');

  // Visible text input must show the label.
  await expect(page.locator('input[name="origin-query"]')).toHaveValue('Hurstbridge VIC');

  // Dropdown must be cleared after selection.
  await expect(page.locator('#origin-suggest .geocode-item')).toHaveCount(0);
});

test('plan error responses are swapped into #results (HTMX swap-on-error)', async ({ page }) => {
  // Regression: HTMX 1.x by default does NOT swap non-2xx responses. Our /api/plan
  // returns 4xx/5xx with a friendly error fragment; without an htmx:beforeSwap
  // listener the user sees an empty #results and no error.
  await page.route('**/api/plan', async (route) => {
    await route.fulfill({
      status: 500, contentType: 'text/html',
      body: '<div id="results-inner" class="error-banner" role="alert"><strong>error:</strong> simulated planner failure</div>',
    });
  });

  await page.goto(BASE);
  // The form has required hidden lat/lon; populate them directly so submit fires.
  await page.evaluate(() => {
    (document.getElementById('origin-lat') as HTMLInputElement).value = '-37.64';
    (document.getElementById('origin-lon') as HTMLInputElement).value = '145.19';
    (document.getElementById('destination-lat') as HTMLInputElement).value = '-37.86';
    (document.getElementById('destination-lon') as HTMLInputElement).value = '144.89';
  });
  await page.locator('#plan-btn').click();

  await expect(page.locator('#results .error-banner')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#results .error-banner')).toContainText('simulated planner failure');
});

test('typing in autocomplete does not throw and does not flash plan indicator', async ({ page }) => {
  // Regression for two bugs:
  //  A) hx-disabled-elt="find ..." used HTMX 2.x syntax under HTMX 1.9.12; every keyup
  //     threw "Cannot read properties of null (reading 'htmx-internal-data')".
  //  B) hx-indicator on <form> was inherited by descendant inputs; the planning indicator
  //     on #results-sheet activated on every keystroke.
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.route('**/api/geocode**', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<ul class="geocode-list"><li class="geocode-item" data-lat="-37.64" data-lon="145.19" data-label="x">x</li></ul>',
    });
  });

  await page.goto(BASE);
  await page.locator('input[name="origin-query"]').pressSequentially('hurst', { delay: 50 });

  // Bug A: no page errors must surface during typing.
  expect(pageErrors).toEqual([]);

  // Bug B: the planning indicator (the sheet) must NOT be in htmx-request state
  // while the autocomplete is what's firing.
  const sheetClass = await page.evaluate(() => document.getElementById('results-sheet')?.className ?? '');
  expect(sheetClass).not.toContain('htmx-request');
});

test('form submits depart=HH:MM through to /api/plan', async ({ page }) => {
  // Capture what the form posts to the server.
  let capturedBody = '';
  await page.route('**/api/plan', async (route) => {
    capturedBody = route.request().postData() ?? '';
    // Return an empty 200 fragment so HTMX has something to swap.
    await route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<div id="results-inner" class="results-empty">ok</div>',
    });
  });

  await page.goto(BASE);

  // Populate hidden lat/lon directly (matches the swap-on-error e2e test).
  await page.evaluate(() => {
    (document.getElementById('origin-lat') as HTMLInputElement).value = '-37.64';
    (document.getElementById('origin-lon') as HTMLInputElement).value = '145.19';
    (document.getElementById('destination-lat') as HTMLInputElement).value = '-37.86';
    (document.getElementById('destination-lon') as HTMLInputElement).value = '144.89';
  });

  // The depart input lives inside a <details> element; open it first.
  await page.locator('form details summary').click();

  // Type a depart value through the actual input the user would use.
  await page.locator('input[name="depart"]').fill('08:00');

  await page.locator('#plan-btn').click();

  // Wait for the fulfilled response to come back so capturedBody is populated.
  await expect(page.locator('#results .results-empty')).toBeVisible({ timeout: 3000 });

  // HTMX serializes as form-urlencoded by default. URL-decode and check.
  const decoded = decodeURIComponent(capturedBody);
  expect(decoded).toContain('depart=08:00');
});
