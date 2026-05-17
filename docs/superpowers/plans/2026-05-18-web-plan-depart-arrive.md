# Web /api/plan depart/arrive-by parsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `depart` and `arriveBy` form fields on `/api/plan` through to the planner using the existing Melbourne-local-time parser (ptv-6yf).

**Architecture:** Extract `parseTime` and `parseMelbourneHHMM` from `src/commands/plan.ts` into a shared `src/plan/parse_time.ts` module. Add a `parseOptionalTime(raw, field)` helper in `src/server/routes/plan.ts` that turns blank/missing into `undefined` and rethrows malformed input with a field-qualified message. Reject requests that supply both fields non-empty. All bad-input paths flow through the existing 400 + `error.html` branch.

**Tech Stack:** TypeScript, Fastify, vitest (unit + integration), Playwright (e2e). No new dependencies.

**Reference:** `docs/superpowers/specs/2026-05-18-web-plan-depart-arrive-design.md`

---

## Pre-flight

The working tree has four uncommitted files containing independent fixes already vetted in the conversation that produced the spec:

- `src/server/routes/plan.ts` — coerces `maxTransfers` to 0 when `mode === 'bike-only'`
- `src/server/templates/page.html` — `htmx:beforeSwap` listener so error fragments render
- `tests/integration/server/plan.test.ts` — integration test covering the maxTransfers coercion
- `tests/e2e/atlas.spec.ts` — e2e test covering HTMX swap-on-error

Land them first so the new work starts from a clean baseline. These are NOT part of ptv-6yf and should land in their own commits.

### Task 0: Land pending in-flight fixes

**Files:**
- Modify (already changed in working tree): `src/server/routes/plan.ts`, `src/server/templates/page.html`, `tests/integration/server/plan.test.ts`, `tests/e2e/atlas.spec.ts`

- [ ] **Step 1: Verify the diff is what we expect**

Run: `git diff --stat`
Expected: 4 files, +50ish lines. No other modifications.

- [ ] **Step 2: Run the test suites to confirm green**

Run: `npm run test:unit && npm run test:integration`
Expected: all pass. (E2e requires a built `dist/` and Chromium — not part of `npm test`; skip here.)

- [ ] **Step 3: Commit the route + integration test together**

```bash
git add src/server/routes/plan.ts tests/integration/server/plan.test.ts
git commit -m "fix(server): coerce maxTransfers to 0 in bike-only mode

The plan orchestrator throws when mode=bike-only and maxTransfers>0.
The route now coerces rather than passing through, so the form can
default to bike-only without exposing the invariant to the client."
```

- [ ] **Step 4: Commit the page + e2e test together**

```bash
git add src/server/templates/page.html tests/e2e/atlas.spec.ts
git commit -m "fix(server): swap HTMX non-2xx responses into #results

HTMX 1.x ignores 4xx/5xx by default; /api/plan returns friendly error
fragments with non-2xx status, so the user saw an empty #results on
failure. Add an htmx:beforeSwap listener that opts those responses in."
```

- [ ] **Step 5: Confirm tree is clean**

Run: `git status -sb`
Expected: only untracked `.beads/`, `test-results/`, `AGENTS.md`, `docs/.DS_Store` etc. — no `M` lines.

---

## Task 1: Extract parse_time module

Mechanical move. No behavior change. Keeps `commands/` from being a producer of helpers that `server/` consumes.

**Files:**
- Create: `src/plan/parse_time.ts`
- Modify: `src/commands/plan.ts` (delete `parseTime` + `parseMelbourneHHMM`, add import)
- Modify: `tests/unit/plan/parse_time.test.ts` (one import-path line)

- [ ] **Step 1: Create the new module with the helpers verbatim**

Create `src/plan/parse_time.ts`:

```ts
/**
 * Parse "HH:MM" as today's Melbourne local time, returning the equivalent UTC Date.
 *
 * Melbourne observes AEST (UTC+10) and AEDT (UTC+11). The offset for "today
 * HH:MM Melbourne" depends on whether DST is active. We use a 2-step probe:
 * 1. Format "today" in Melbourne to get the calendar date there.
 * 2. Construct a probe Date assuming AEST (+10:00), then ask Intl whether
 *    that Date falls inside AEDT in Melbourne; if so, re-construct with +11:00.
 *
 * Caveat: at the ambiguous hour of DST transition (02:00 local, twice a year)
 * the chosen offset may be off by one hour. The user can pass an ISO8601
 * timezone-aware string to disambiguate.
 */
function parseMelbourneHHMM(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // en-CA gives "YYYY-MM-DD" cleanly.
  const ymd = dateFmt.format(now);
  const local = `${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const probe = new Date(`${local}+10:00`);
  const tzFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', timeZoneName: 'short',
  });
  const tzName = tzFmt.formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const offset = tzName === 'AEDT' ? '+11:00' : '+10:00';
  return new Date(`${local}${offset}`);
}

export function parseTime(s: string | undefined): Date | undefined {
  if (s === undefined) return undefined;
  if (/^\d{2}:\d{2}$/.test(s)) {
    return parseMelbourneHHMM(s);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
}
```

- [ ] **Step 2: Update CLI to import from the new module**

In `src/commands/plan.ts`:

1. Add this import near the top, beside the existing `import type { LatLon, ... }`:

```ts
import { parseTime } from '../plan/parse_time';
```

2. Delete the existing `parseTime` function (lines 21-29) and the `parseMelbourneHHMM` function (lines 31-61) including their doc comment.

The `.option('--depart <iso>', ...)` Commander wiring keeps calling `parseTime` — now from the import. Nothing else in this file changes.

- [ ] **Step 3: Update the unit test's import path**

In `tests/unit/plan/parse_time.test.ts`, change the import on line 2 from:

```ts
import { parseTime } from '../../../src/commands/plan';
```

to:

```ts
import { parseTime } from '../../../src/plan/parse_time';
```

- [ ] **Step 4: Run the unit tests and TypeScript build to confirm the move is clean**

Run: `npm run test:unit && npm run build`
Expected: all unit tests pass (5 cases in `parse_time.test.ts`). `tsc` produces no errors.

If TypeScript complains about the import in `commands/plan.ts`, you forgot to delete the local function — it'll be a duplicate-export error. Delete the local copy and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/plan/parse_time.ts src/commands/plan.ts tests/unit/plan/parse_time.test.ts
git commit -m "refactor(plan): extract parseTime into src/plan/parse_time (ptv-6yf)

Move parseTime and parseMelbourneHHMM out of the CLI command module so
the web /api/plan route can import them too. No behavior change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire depart parsing into /api/plan (TDD happy-path)

Red test → minimal implementation that also covers empty-string and malformed cases (handler is small enough that incremental TDD per case is overkill; we write three tests then implement once).

**Files:**
- Modify: `tests/integration/server/plan.test.ts` (add 3 cases for depart)
- Modify: `src/server/routes/plan.ts` (import parseTime, add `parseOptionalTime`, wire it)

- [ ] **Step 1: Write the three failing integration tests**

Append to `tests/integration/server/plan.test.ts`, inside the existing `describe('POST /api/plan', () => { ... })` block, after the `coerces maxTransfers` test:

```ts
  it('parses depart=HH:MM as Melbourne local time and passes it to planFn', async () => {
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: '08:00' },
    });
    expect(res.statusCode).toBe(200);
    const calledWith = planFn.mock.calls[0][0] as { departUtc?: Date; arriveByUtc?: Date };
    expect(calledWith.departUtc).toBeInstanceOf(Date);
    expect(calledWith.arriveByUtc).toBeUndefined();
    const melHour = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne', hour: 'numeric', hour12: false,
    }).format(calledWith.departUtc as Date);
    expect(parseInt(melHour, 10)).toBe(8);
    await app.close();
  });

  it('treats depart="" (empty string from form) as undefined, not as an error', async () => {
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: '', arriveBy: '' },
    });
    expect(res.statusCode).toBe(200);
    const calledWith = planFn.mock.calls[0][0] as { departUtc?: Date; arriveByUtc?: Date };
    expect(calledWith.departUtc).toBeUndefined();
    expect(calledWith.arriveByUtc).toBeUndefined();
    await app.close();
  });

  it('returns 400 with "invalid time" when depart is malformed', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: 'garbage' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_INPUT');
    expect(res.json().error.message).toMatch(/depart: invalid time/);
    expect(planFn).not.toHaveBeenCalled();
    await app.close();
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npm run test:integration -- plan.test.ts`
Expected:
- `parses depart=HH:MM ...` FAILS: `expected undefined to be an instance of Date` (the route currently stubs `departUtc: undefined`).
- `treats depart="" ...` PASSES (current code stubs `undefined` regardless of input — this case will go green-on-arrival but is necessary regression coverage).
- `returns 400 ... when depart is malformed` FAILS: status is 200, planFn was called (current code ignores `depart` entirely).

If the first test passes, you missed updating the route to call `planFn` with a fresh-derived request — re-read step 3 below.

- [ ] **Step 3: Update `PlanBody` type, import parseTime, and wire it via `parseOptionalTime`**

In `src/server/routes/plan.ts`:

1. Add the import near the top, with the other plan imports:

```ts
import { parseTime } from '../../plan/parse_time';
```

2. Inside `resolveRequest()` (currently lines 88-113), replace the body so it parses the time fields and returns them on the `PlanRequest`. Full replacement of the function:

```ts
async function resolveRequest(body: PlanBody, nom: Nominatim): Promise<PlanRequest> {
  const from = await resolvePoint(body.origin,      nom, 'origin');
  const to   = await resolvePoint(body.destination, nom, 'destination');
  const mode = body.mode ?? 'bike-train';
  // The orchestrator forbids maxTransfers > 0 in bike-only mode (there are no trains
  // to transfer between). Coerce rather than error so the form can default to
  // bike-only without the user knowing about the invariant.
  const maxTransfers = mode === 'bike-only' ? 0 : toNumber(body.maxTransfers, 1);
  const departUtc   = parseOptionalTime(body.depart,    'depart');
  const arriveByUtc = parseOptionalTime(body.arriveBy,  'arriveBy');
  return {
    from, to,
    departUtc,
    arriveByUtc,
    minBikeKm: toNumber(body.minBikeKm, 0),
    maxBikeKm: toNumber(body.maxBikeKm, 20),
    maxTransfers,
    enrich: body.enrich ?? true,
    preferBikePath: body.preferBikePath ?? false,
    hillWeight: toNumber(body.hillWeight, 0),
    goal: (body.goal ?? 'commute'),
    mode,
    minOnPathFraction: body.minOnPathFraction !== undefined
      ? toNumber(body.minOnPathFraction, 0)
      : undefined,
  };
}
```

3. Add this helper at the bottom of the file, after `toNumber`:

```ts
function parseOptionalTime(raw: unknown, field: string): Date | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (s === '') return undefined;
  try { return parseTime(s); }
  catch { throw new Error(`${field}: invalid time (use HH:MM or ISO8601)`); }
}
```

Note: `parseTime` is currently typed as `(s: string | undefined) => Date | undefined`. Since we've already handled `undefined` and empty-string before calling it, the return is always a `Date`. The cast happens implicitly via the `try`/`catch` — no extra annotation needed.

- [ ] **Step 4: Run the integration tests and confirm green**

Run: `npm run test:integration -- plan.test.ts`
Expected: all three new tests pass. The five pre-existing tests in the file still pass.

If the malformed test still says status 200, the `parseOptionalTime` call is being short-circuited — check that you didn't accidentally leave `body.depart` typed as something other than `string | undefined` in `PlanBody` (it should be unchanged from current).

- [ ] **Step 5: Run the full test suite to catch regressions in adjacent files**

Run: `npm test`
Expected: all unit + integration green.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/plan.ts tests/integration/server/plan.test.ts
git commit -m "feat(server): parse depart/arriveBy in /api/plan PlanBody (ptv-6yf)

Wire the shared parseTime helper into resolveRequest so the form's
depart and arriveBy fields actually plan against the requested time
instead of always 'now'. Empty strings (from HTML form submits) stay
undefined; malformed values surface as 400 BAD_INPUT.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: arriveBy happy-path coverage

The previous task already implements arriveBy via the same `parseOptionalTime` call — this task is regression coverage only. Pure additive tests; should go green-on-arrival.

**Files:**
- Modify: `tests/integration/server/plan.test.ts`

- [ ] **Step 1: Add the arriveBy happy-path test**

Append inside the same `describe` block in `tests/integration/server/plan.test.ts`:

```ts
  it('parses arriveBy=HH:MM and passes only arriveByUtc to planFn', async () => {
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', arriveBy: '17:30' },
    });
    expect(res.statusCode).toBe(200);
    const calledWith = planFn.mock.calls[0][0] as { departUtc?: Date; arriveByUtc?: Date };
    expect(calledWith.departUtc).toBeUndefined();
    expect(calledWith.arriveByUtc).toBeInstanceOf(Date);
    const melHour = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).format(calledWith.arriveByUtc as Date);
    // Allow both "17:30" and "17.30" locale variants — see the unit test for the same pattern.
    expect(melHour).toMatch(/^17[:.]30$/);
    await app.close();
  });
```

- [ ] **Step 2: Run and confirm green**

Run: `npm run test:integration -- plan.test.ts`
Expected: the new test passes; all prior tests still pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/server/plan.test.ts
git commit -m "test(server): cover arriveBy=HH:MM happy path on /api/plan (ptv-6yf)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Mutually-exclusive depart + arriveBy (TDD)

The route currently lets a client submit both fields. The CLI implicitly treats them as exclusive flags. Add a server-side check.

**Files:**
- Modify: `tests/integration/server/plan.test.ts`
- Modify: `src/server/routes/plan.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe` block:

```ts
  it('returns 400 when both depart and arriveBy are non-empty', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: '08:00', arriveBy: '09:00' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_INPUT');
    expect(res.json().error.message).toMatch(/either depart or arriveBy/);
    expect(planFn).not.toHaveBeenCalled();
    await app.close();
  });
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm run test:integration -- plan.test.ts`
Expected: FAIL. Status will be 200 (both fields currently parse cleanly and the orchestrator gets both).

- [ ] **Step 3: Add the check in `resolveRequest`**

In `src/server/routes/plan.ts`, inside `resolveRequest()`, immediately after the two `parseOptionalTime` calls and before the `return`:

```ts
  if (departUtc && arriveByUtc) {
    throw new Error('specify either depart or arriveBy, not both');
  }
```

The final shape of that section becomes:

```ts
  const departUtc   = parseOptionalTime(body.depart,    'depart');
  const arriveByUtc = parseOptionalTime(body.arriveBy,  'arriveBy');
  if (departUtc && arriveByUtc) {
    throw new Error('specify either depart or arriveBy, not both');
  }
  return {
    /* ... */
  };
```

- [ ] **Step 4: Run and confirm green**

Run: `npm run test:integration -- plan.test.ts`
Expected: the new test passes; all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/plan.ts tests/integration/server/plan.test.ts
git commit -m "feat(server): reject /api/plan with both depart and arriveBy (ptv-6yf)

The CLI treats --depart and --arrive-by as mutually-exclusive flags;
the web route now enforces the same invariant rather than letting both
flow through to the orchestrator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: E2e form submission with depart field

End-to-end coverage that the form actually sends `depart=08:00` when the user types it. We don't assert on planner correctness here — that's integration's job. We assert on the request body the server receives.

**Files:**
- Modify: `tests/e2e/atlas.spec.ts`

- [ ] **Step 1: Add the e2e test**

Append at the bottom of `tests/e2e/atlas.spec.ts`, after the existing `typing in autocomplete does not throw` test:

```ts
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

  // Type a depart value through the actual input the user would use.
  await page.locator('input[name="depart"]').fill('08:00');

  await page.locator('#plan-btn').click();

  // Wait for the fulfilled response to come back so capturedBody is populated.
  await expect(page.locator('#results .results-empty')).toBeVisible({ timeout: 3000 });

  // HTMX serializes as form-urlencoded by default. URL-decode and check.
  const decoded = decodeURIComponent(capturedBody);
  expect(decoded).toContain('depart=08:00');
});
```

- [ ] **Step 2: Build and run e2e**

Run: `npm run build && npm run test:e2e:browser -- atlas.spec.ts`
Expected: the new test passes. All existing atlas e2e tests still pass.

If `npm run test:e2e:browser` isn't defined, check `package.json` for the actual script name (likely `test:e2e` for Playwright + a separate one for the vitest e2e). The atlas spec uses Playwright; the script that runs Playwright is the right one.

If the route mock fires but `capturedBody` is empty, HTMX may have serialized as JSON. In that case the assertion changes to `expect(JSON.parse(capturedBody).depart).toBe('08:00')` — but the current form uses HTMX's default form-urlencoded serialization, so the form-encoded path is expected.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/atlas.spec.ts
git commit -m "test(e2e): form submits depart=HH:MM to /api/plan (ptv-6yf)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Close the bead

- [ ] **Step 1: Mark ptv-6yf closed**

Run: `bd close ptv-6yf -m "shipped: parseTime wired into /api/plan, mutual-exclusion enforced, e2e covers form submission"`
Expected: bd reports the issue closed.

- [ ] **Step 2: Final verification**

Run: `npm test && git log --oneline -10`
Expected: all tests green; the last ~5 commits are the Task 1-5 commits in order plus the Task 0 fixes.

- [ ] **Step 3: Ready to push (do not push without user confirmation)**

Report status to the user: "ptv-6yf shipped across 6 commits on `main` (5 ahead of origin). Ready to push?"

---

## Self-review notes (for the executor)

- Every `git commit` step assumes a clean tree apart from the staged files in that step. If you find unrelated changes in the diff, stop and surface them — do not let them ride along.
- Pre-commit hooks may run linting/typecheck. If they fail, follow the user's `~/.claude/rules/git.md` protocol: fix the underlying issue, do NOT pass `--no-verify`.
- Do not push to origin at any point. The last task explicitly defers that to user confirmation.
- If `parseTime`'s signature has changed since this plan was written (it's currently `(s: string | undefined) => Date | undefined`), update `parseOptionalTime` accordingly — but the plan's contract (blank → undefined, malformed → throw with field-qualified message) is what to preserve.
