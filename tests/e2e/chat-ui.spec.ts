import { test, expect, type Route } from '@playwright/test';

const events = [
  { type: 'turn_start' },
  { type: 'text_delta', delta: 'Looking up Hurstbridge.' },
  { type: 'tool_call', id: 't1', name: 'geocode', args: { query: 'Hurstbridge' } },
  { type: 'tool_result', id: 't1', ok: true, summary: '-37.74,145.19' },
  {
    type: 'path_add', pathId: 'p1', label: 'commute', color: '#e6194b',
    itinerary: {
      legs: [{
        mode: 'bike',
        geometry: {
          type: 'LineString',
          coordinates: [[144.96, -37.8], [145.19, -37.74]],
        },
      }],
    },
  },
  { type: 'text_delta', delta: ' Done — pick a route.' },
  { type: 'turn_end' },
];

async function mockChatRoute(route: Route) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body,
  });
}

test.beforeEach(async ({ context }) => {
  // Ensure clean localStorage for each test
  await context.clearCookies();
});

test('user sends a message, sees streamed reply and a clickable path', async ({ page }) => {
  await page.route('**/api/chat', mockChatRoute);

  await page.goto('/');
  await page.fill('#send-input', 'plan a trip to Hurstbridge');
  await page.click('button[type=submit]');

  await expect(page.locator('.msg--user')).toHaveText(/plan a trip/);
  await expect(page.locator('.msg--assistant').last())
    .toContainText('Done — pick a route');
  const chip = page.locator('.chip[data-path-id="p1"]');
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(chip).toHaveAttribute('data-active', 'true');
});

test('tool-call log toggles via the trace button', async ({ page }) => {
  await page.route('**/api/chat', mockChatRoute);

  await page.goto('/');
  await page.fill('#send-input', 'x');
  await page.click('button[type=submit]');
  // wait for the SSE events to settle
  await expect(page.locator('.msg--assistant').last()).toContainText('Done');

  await page.click('#toggle-log');
  await expect(page.locator('#log')).toBeVisible();
  await expect(page.locator('.log__entry .name').first()).toHaveText('geocode');
});

test('reload preserves chat messages from localStorage', async ({ page }) => {
  await page.route('**/api/chat', mockChatRoute);

  await page.goto('/');
  await page.fill('#send-input', 'remember me');
  await page.click('button[type=submit]');
  await expect(page.locator('.msg--user')).toHaveText('remember me');
  // wait for turn to finish so the buffered assistant message is also persisted
  await expect(page.locator('.msg--assistant').last()).toContainText('Done');

  await page.reload();
  await expect(page.locator('.msg--user')).toHaveText('remember me');
  await expect(page.locator('.msg--assistant').last()).toContainText('Done');
});
