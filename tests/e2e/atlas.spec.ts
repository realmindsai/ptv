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

  // v2 shell: pill starts in edit state (JS transitions from "empty" HTML attr to "edit").
  await expect(page.locator('#from-to-pill')).toHaveAttribute('data-state', 'edit');

  // v2 shell: FAB geolocate (renamed from #geolocate-from).
  await expect(page.locator('#fab-geolocate')).toBeVisible();

  // v2 shell: trip chips toolbar.
  await expect(page.locator('#trip-chips')).toBeVisible();
  await expect(page.locator('#trip-chips .chip[data-chip]')).toHaveCount(4);

  // v2 shell: no old plan-btn or CTA button.
  await expect(page.locator('#plan-btn')).toHaveCount(0);
  await expect(page.locator('.btn--cta')).toHaveCount(0);

  // Results sheet (unified sheet — check by id and data-snap).
  await expect(page.locator('section.sheet#sheet')).toBeVisible();
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'peek');

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

test('plan error responses are rendered into #results (atlas.js JS path)', async ({ page }) => {
  // atlas.js intercepts form submit and posts JSON to /api/plan. A 5xx response
  // triggers renderResultsError(), which writes a .error div. Verify user sees it.
  await page.route('**/api/plan', async (route) => {
    await route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'simulated planner failure' } }),
    });
  });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Set origin and destination on the state machine, then fire the plan via import.
  await page.evaluate(() => {
    const sm = (window as any).__atlas.sm;
    sm.setState({
      origin:      { lat: -37.64, lon: 145.19 },
      destination: { lat: -37.86, lon: 144.89 },
    });
  });

  // Trigger firePlan via the exported function (atlas.js is a module; dynamic import
  // returns the same module record so exports are accessible).
  await page.evaluate(async () => {
    const mod = await import('/static/atlas.js');
    await (mod as any).firePlan((window as any).__atlas.sm);
  });

  await expect(page.locator('#results .error')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#results .error')).toContainText('simulated planner failure');
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
  // atlas.js auto-fires JSON to /api/plan when both endpoints are set and the user
  // interacts with the v3 unified sheet. Capture the JSON body and verify depart is present.
  let capturedJsonBody = '';
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const ct = route.request().headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) {
      // HTMX form-encoded fallback — return empty result so it doesn't interfere.
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    }
    capturedJsonBody = route.request().postData() ?? '';
    const fake = {
      query: {},
      itineraries: [{
        labels: ['recommended'], totalTimeMin: 30, bikeKm: 10, bikeMin: 30,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 }, km: 10, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Pre-populate origin+destination so the auto-fire has both endpoints when the sheet is used.
  await page.evaluate(() => {
    (window as any).__atlas.sm.setState({
      origin:      { lat: -37.64, lon: 145.19 },
      destination: { lat: -37.86, lon: 144.89 },
    });
  });

  // Click the "when" chip → sheet should snap to full, when accordion opens + active
  await page.evaluate(() => document.getElementById('chip-when')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#acc-when')).toHaveAttribute('open', '');
  await expect(page.locator('#acc-when')).toHaveAttribute('data-acc-active', '');
  await expect(page.locator('#chip-when')).toHaveAttribute('data-active', '');

  // Pick depart-at, type 08:00, then close by tapping the chip again
  await page.locator('#acc-when-body [data-when="depart"]').click();
  await page.locator('#acc-when-body #ps-time').fill('08:00');
  // Tapping the active chip again collapses the accordion + snaps to peek
  await page.evaluate(() => document.getElementById('chip-when')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'peek');

  // Fire the plan explicitly (no auto-fire on close in v3).
  // wireFormSubmitGuard blocks requestSubmit(); use syncParamsFromHiddenInputs
  // which reads the hidden #param-* inputs into state and then calls firePlan.
  await page.evaluate(async () => {
    const mod = await import('/static/atlas.js');
    (mod as any).syncParamsFromHiddenInputs((window as any).__atlas.sm);
  });
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });

  const parsed = JSON.parse(capturedJsonBody);
  expect(parsed.depart).toBe('08:00');
});

// ---------------------------------------------------------------------------
// Phase 2: click-to-route, URL load, clear, geolocate, form submit (JS path)
// ---------------------------------------------------------------------------

test('click-to-route: two map clicks fire a plan', async ({ page }) => {
  // Stub /api/plan to a deterministic result so the test doesn't depend on
  // a live planner. This isolates the client-side wiring.
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 30,
        bikeKm: 10.5,
        bikeMin: 30,
        trainKm: 0,
        trainMin: 0,
        waitMin: 0,
        transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 10.5, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(BASE);
  await page.waitForSelector('#map', { state: 'visible' });
  // Wait for atlas.js bootstrap.
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Two map clicks (rough pixel coords inside the map div).
  const map = page.locator('#map');
  const box = await map.boundingBox();
  if (!box) throw new Error('map not laid out');
  await map.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await map.click({ position: { x: box.width * 0.7, y: box.height * 0.6 } });

  // Results sheet should populate.
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.itinerary-card__label')).toContainText('recommended');

  // URL should now have ?from=...&to=...
  await expect.poll(() => page.url()).toMatch(/\?from=.+&to=.+/);
});

test('URL load: ?from=...&to=... auto-fires the plan', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 25, bikeKm: 8, bikeMin: 25,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 8, min: 25 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(`${BASE}/?from=-37.78,144.96&to=-37.86,144.92`);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Plan fires automatically.
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('#origin-query')).toHaveValue(/-37\.78/);
  await expect(page.locator('#destination-query')).toHaveValue(/-37\.86/);
});

test('clear button removes pins, results, and URL state', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'], totalTimeMin: 30, bikeKm: 10, bikeMin: 30,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 10, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(`${BASE}/?from=-37.78,144.96&to=-37.86,144.92`);
  await page.waitForFunction(() => !!(window as any).__atlas);
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });

  await page.locator('#clear-trip').click();
  await expect(page.locator('#results .itinerary-card')).toHaveCount(0);
  await expect(page.locator('#origin-query')).toHaveValue('');
  await expect.poll(() => page.url()).not.toMatch(/\?from=/);
});

test('geolocation button fills origin with stubbed position', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -37.81, longitude: 144.96 });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // v2: renamed from #geolocate-from to #fab-geolocate.
  // The unified sheet in peek state can intercept pointer events over the FAB,
  // so dispatch the click programmatically to bypass hit-testing.
  await page.evaluate(() => document.getElementById('fab-geolocate')?.click());

  await expect(page.locator('#origin-query')).toHaveValue(/-37\.81/, { timeout: 3000 });
  await expect.poll(() => page.url()).toMatch(/\?from=-37\.81/);
});

test('typed coords + state dispatch produces a plan', async ({ page }) => {
  // Regression: the JS path (state machine + firePlan) still works without a Plan
  // button. Drive through typed coords → sm.setState → firePlan export.
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'], totalTimeMin: 30, bikeKm: 10, bikeMin: 30,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 10, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Type raw coords (skipping geocode-suggest).
  await page.locator('#origin-query').fill('-37.78, 144.96');
  await page.locator('#destination-query').fill('-37.86, 144.92');

  // v2: no #plan-btn — dispatch via state machine + exported firePlan.
  await page.evaluate(async () => {
    const mod = await import('/static/atlas.js');
    const { parseDecimalCoord, firePlan } = mod as any;
    const sm = (window as any).__atlas.sm;
    const origin = parseDecimalCoord(
      (document.getElementById('origin-query') as HTMLInputElement).value,
    );
    const destination = parseDecimalCoord(
      (document.getElementById('destination-query') as HTMLInputElement).value,
    );
    sm.setState({ origin, destination });
    await firePlan(sm);
  });

  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// v3 unified-sheet: chip+accordion param flow
// ---------------------------------------------------------------------------

test('v3 chip+accordion: chip-goal → max-path → syncParams fires plan with goal in body', async ({ page }) => {
  let capturedBody = '';
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const ct = route.request().headers()['content-type'] ?? '';
    if (!ct.includes('application/json')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    }
    capturedBody = route.request().postData() ?? '';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        query: {},
        itineraries: [{
          labels: ['recommended'], totalTimeMin: 30, bikeKm: 10, bikeMin: 30,
          trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [{ mode: 'bike', from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 }, km: 10, min: 30 }],
        }],
      }),
    });
  });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Pre-populate origin+destination so firePlan has both endpoints when syncParams is called.
  await page.evaluate(() => {
    (window as any).__atlas.sm.setState({
      origin:      { lat: -37.64, lon: 145.19 },
      destination: { lat: -37.86, lon: 144.89 },
    });
  });

  await page.evaluate(() => document.getElementById('chip-goal')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#acc-goal')).toHaveAttribute('open', '');

  // Select max-path and verify the hidden input updated
  await page.locator('#acc-goal-body input[name="ps-goal"][value="max-path"]').check();
  await expect(page.locator('#param-goal')).toHaveValue('max-path');

  // Tap the chip again to close (replaces the old "done" button)
  await page.evaluate(() => document.getElementById('chip-goal')?.click());
  await expect(page.locator('#acc-goal')).not.toHaveAttribute('open', '');

  // Fire the plan explicitly.
  // wireFormSubmitGuard blocks requestSubmit(); use syncParamsFromHiddenInputs
  // which reads the hidden #param-* inputs into state and then calls firePlan.
  await page.evaluate(async () => {
    const mod = await import('/static/atlas.js');
    (mod as any).syncParamsFromHiddenInputs((window as any).__atlas.sm);
  });
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });

  const parsed = JSON.parse(capturedBody);
  expect(parsed.goal).toBe('max-path');
});

test('handle cycles peek → mid → full → peek', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);
  const sheet = page.locator('section.sheet#sheet');
  // Initial state can vary (full if empty recents flow; peek if loaded with state).
  // Force peek by clicking the handle until we land there.
  for (let i = 0; i < 3; i++) {
    if (await sheet.getAttribute('data-snap') === 'peek') break;
    await page.locator('#sheet-handle').click();
  }
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
  await page.locator('#sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'mid');
  await page.locator('#sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'full');
  await page.locator('#sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
});

test('clear-trip × snaps sheet to full and opens recents accordion', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);
  // Put the pill in a "set" state so the × button is in the DOM and clickable
  await page.evaluate(() => {
    (window as any).__atlas.sm.setState({
      origin:      { lat: -37.64, lon: 145.19 },
      destination: { lat: -37.86, lon: 144.89 },
    });
  });
  await page.evaluate(() => document.getElementById('clear-trip')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#acc-recents')).toHaveAttribute('open', '');
  await expect(page.locator('#chip-recents')).toHaveAttribute('data-active', '');
});

test('accordions are independent — opening one does not close another', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);
  await page.evaluate(() => document.getElementById('chip-when')?.click());
  await expect(page.locator('#acc-when')).toHaveAttribute('open', '');
  await page.evaluate(() => document.getElementById('chip-goal')?.click());
  // Both should now be open; only the most-recent one is "active"
  await expect(page.locator('#acc-when')).toHaveAttribute('open', '');
  await expect(page.locator('#acc-goal')).toHaveAttribute('open', '');
  await expect(page.locator('#acc-goal')).toHaveAttribute('data-acc-active', '');
  await expect(page.locator('#acc-when')).not.toHaveAttribute('data-acc-active', '');
});
