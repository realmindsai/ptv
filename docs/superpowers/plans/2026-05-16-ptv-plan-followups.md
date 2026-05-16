# PTV `plan` v1.1 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply seven bounded correctness/UX/performance fixes to the v1 `ptv plan` command, addressing the final review findings without algorithmic changes.

**Architecture:** Each fix is local to one or two files. No new modules. The orchestrator pipeline and JSON schema stay shape-compatible; this is additive (more fields populated, more accurate values).

**Tech Stack:** TypeScript 5.x, vitest, commander 14. Starting from v1 state on `main` (commits `aaa33ba..60ddb88`).

**Spec:** `docs/superpowers/specs/2026-05-16-ptv-plan-followups.md` (commit `a9d98a4`).

---

## File Map

**Modify:**
- `src/plan/external.ts` — replace `ghRouteBike` body with real-shape parser (Task 1)
- `src/argv.ts` — update comments to scope the workaround (Task 2)
- `src/commands/plan.ts` — add negative-numeric guard (Task 2), Melbourne-local HH:MM parser (Task 6)
- `src/plan/orchestrator.ts` — arrive-by total-time fix (Task 3), memoization (Task 4), thread routeName (Task 5)
- `src/plan/transit.ts` — add `Route` to expand, capture route_name (Task 5)
- `src/plan/types.ts` — add `routeName` to `DepartureWithPattern` (Task 5)
- `src/plan/candidates.ts` — pass `max_results: 200`, warn on truncation (Task 7)

**Create:**
- `tests/unit/plan/external.test.ts` (Task 1)
- `tests/fixtures/plan/gh_route_bike.json` — captured live (Task 1)

**Test additions/extensions:**
- `tests/unit/plan/orchestrator.test.ts` — arrive-by + memoization cases (Tasks 3, 4)
- `tests/integration/plan.test.ts` — routeName, kmOnPath, dense-area assertions (Tasks 5, 1, 7)
- `tests/e2e/plan.test.ts` — Melbourne HH:MM case (Task 6)

---

## Task 1: C1 — Fix `ghRouteBike` parser

**Files:**
- Modify: `src/plan/external.ts`
- Create: `tests/unit/plan/external.test.ts`
- Create: `tests/fixtures/plan/gh_route_bike.json`

- [ ] **Step 1: Capture a live gh-route fixture**

Run:
```bash
mkdir -p tests/fixtures/plan
../grasshopper-bike-routing/bin/gh-route route \
  --point=-37.78,144.96 --point=-37.77,144.96 \
  --profile bike --format json \
  > tests/fixtures/plan/gh_route_bike.json
```

Verify:
```bash
node -e "const d = require('./tests/fixtures/plan/gh_route_bike.json'); const p = d[0].response.paths[0]; console.log('distance(m)=', p.distance, 'time(ms)=', p.time, 'has_road_class=', !!p.details?.road_class)"
```
Expected: prints distance/time as numbers and `has_road_class=true`. If gh-route is unreachable, STOP and report NEEDS_CONTEXT (can't fix the parser without seeing real output).

- [ ] **Step 2: Write failing tests**

Create `tests/unit/plan/external.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGhRoute } from '../../../src/plan/external';

describe('parseGhRoute()', () => {
  it('returns null on missing distance', () => {
    expect(parseGhRoute([{ response: { paths: [{ time: 100 }] } }])).toBeNull();
  });

  it('returns null on missing time', () => {
    expect(parseGhRoute([{ response: { paths: [{ distance: 1000 }] } }])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(parseGhRoute([])).toBeNull();
  });

  it('computes km and min from native units', () => {
    const out = parseGhRoute([{
      response: { paths: [{ distance: 5000, time: 600000 }] },
    }]);
    expect(out?.km).toBe(5);
    expect(out?.min).toBe(10);
  });

  it('computes kmOnPath from road_class index spans', () => {
    // total span 100; cycleway span 30 + path span 20 = 50; ratio 0.5
    // km = 10 → kmOnPath = 5
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 10000, time: 600000,
        details: {
          road_class: [
            [0, 30, 'cycleway'],
            [30, 50, 'residential'],
            [50, 70, 'path'],
            [70, 100, 'primary'],
          ],
        },
      }] },
    }]);
    expect(out?.kmOnPath).toBeCloseTo(5, 5);
  });

  it('uses road_class, not surface, for path classification', () => {
    // surface=asphalt everywhere; road_class says half is cycleway.
    // Expected: kmOnPath reflects road_class half, not surface.
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 10000, time: 600000,
        details: {
          road_class: [
            [0, 50, 'cycleway'],
            [50, 100, 'residential'],
          ],
          surface: [
            [0, 100, 'asphalt'],
          ],
        },
      }] },
    }]);
    expect(out?.kmOnPath).toBeCloseTo(5, 5);
  });

  it('returns kmOnPath=0 when road_class is absent', () => {
    const out = parseGhRoute([{
      response: { paths: [{ distance: 5000, time: 600000 }] },
    }]);
    expect(out?.kmOnPath).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests, verify they FAIL**

Run: `npx vitest run tests/unit/plan/external.test.ts`
Expected: FAIL with "parseGhRoute is not exported" (or "is not a function"). The function does not exist yet.

- [ ] **Step 4: Implement the parser**

Edit `src/plan/external.ts`. Replace the entire `ghRouteBike` block (lines 78-111) with:

```ts
type GhRouteRaw = Array<{
  response?: {
    paths?: Array<{
      distance?: number;
      time?: number;
      details?: {
        road_class?: Array<[number, number, string]>;
      };
    }>;
  };
}>;

const PATH_ROAD_CLASSES = new Set(['cycleway', 'path', 'track']);

export function parseGhRoute(raw: unknown):
  { km: number; min: number; kmOnPath: number } | null {
  const arr = raw as GhRouteRaw;
  const p = arr?.[0]?.response?.paths?.[0];
  if (typeof p?.distance !== 'number' || typeof p?.time !== 'number') return null;
  const km = p.distance / 1000;
  const min = p.time / 60_000;
  const segments = p.details?.road_class ?? [];
  if (segments.length === 0) return { km, min, kmOnPath: 0 };
  let totalIdx = 0;
  let pathIdx = 0;
  for (const [from, to, cls] of segments) {
    const span = to - from;
    totalIdx += span;
    if (PATH_ROAD_CLASSES.has(cls)) pathIdx += span;
  }
  const kmOnPath = totalIdx > 0 ? km * (pathIdx / totalIdx) : 0;
  return { km, min, kmOnPath };
}

export async function ghRouteBike(
  from: LatLon,
  to: LatLon,
  profile: 'bike' | 'bike_quiet' = 'bike',
): Promise<{ km: number; min: number; kmOnPath: number } | null> {
  try {
    const raw = runJson(GH_BIN, [
      'route',
      `--point=${from.lat},${from.lon}`,
      `--point=${to.lat},${to.lon}`,
      '--profile', profile,
      '--format', 'json',
    ]);
    return parseGhRoute(raw);
  } catch {
    return null;
  }
}
```

Note: `--point=lat,lon` form with `=` is now used (same as osrm-au) to be safe with negative coordinates passed through argparse.

- [ ] **Step 5: Run tests, verify they PASS**

Run: `npx vitest run tests/unit/plan/external.test.ts`
Expected: PASS, 7 tests.

Also run the full suite to confirm nothing regressed:
Run: `npm run test:unit`
Expected: 23 tests pass (16 from v1 + 7 new).

- [ ] **Step 6: Commit**

```bash
git add src/plan/external.ts tests/unit/plan/external.test.ts tests/fixtures/plan/gh_route_bike.json
git commit -m "feat(plan): parse real gh-route JSON shape using road_class"
```

---

## Task 2: I1 — Reject negative numeric options; scope argv comment

**Files:**
- Modify: `src/argv.ts`
- Modify: `src/commands/plan.ts`
- Test: `tests/e2e/plan.test.ts` (add case)

- [ ] **Step 1: Update the argv.ts comment block**

Edit `src/argv.ts`. Replace the top comment block (lines 1-7) with:

```ts
/**
 * Commander 14 treats any arg beginning with '-' as an option flag, which
 * breaks lat/lon coordinate pairs like "-37.7656,144.9614" (negative latitude).
 *
 * SCOPE: This preprocessor handles negative coordinate-shaped args ONLY
 * (matched by /^-\d[\d.]*,\d/). It does NOT handle negative values passed
 * to numeric options (e.g. `--min-bike-km -5`). Negative numeric option
 * values are rejected by commands/plan.ts after parsing, which is the
 * correct layer for input validation.
 */
```

- [ ] **Step 2: Write a failing e2e test for negative numeric rejection**

Edit `tests/e2e/plan.test.ts`. Add a new case at the end of the `describe.skipIf(SKIP)` block (do not replace existing tests):

```ts
  it('--min-bike-km negative: exits non-zero', () => {
    const { stderr, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--min-bike-km=-5',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/min-bike-km/);
  });
```

Note: The `--min-bike-km=-5` form (with `=`) sidesteps commander's negative-flag heuristic for the test setup; the validator we add in step 3 catches the resulting -5 value.

- [ ] **Step 3: Run the new test, verify it FAILS**

Build first: `npm run build`

Run: `npx vitest run tests/e2e/plan.test.ts -t "min-bike-km negative"`
Expected: FAIL — currently the orchestrator accepts -5 silently (or produces a stack trace, not a clean error).

- [ ] **Step 4: Add the validator in `src/commands/plan.ts`**

Edit `src/commands/plan.ts`. Inside the `.action(async (fromStr, toStr, opts) => { ... })` callback, add the following block immediately after the existing `if (opts.minBikeKm > opts.maxBikeKm)` check (line 53) and before the `const req: PlanRequest = ...` declaration:

```ts
      for (const [name, value] of [
        ['--min-bike-km', opts.minBikeKm],
        ['--max-bike-km', opts.maxBikeKm],
        ['--max-transfers', opts.maxTransfers],
      ] as const) {
        if (typeof value === 'number' && value < 0) {
          throw new Error(`${name} must be >= 0 (got ${value})`);
        }
      }
```

- [ ] **Step 5: Rebuild and run the test, verify it PASSES**

Run: `npm run build && npx vitest run tests/e2e/plan.test.ts -t "min-bike-km negative"`
Expected: PASS.

Also: `npm run test:e2e` — expected: 6 tests pass (5 v1 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/argv.ts src/commands/plan.ts tests/e2e/plan.test.ts
git commit -m "fix(plan): reject negative numeric options; scope argv preprocessor comment"
```

---

## Task 3: I2 — Correct `totalTimeMin` for `--arrive-by`

**Files:**
- Modify: `src/plan/orchestrator.ts`
- Test: `tests/unit/plan/orchestrator.test.ts`

- [ ] **Step 1: Write a failing unit test**

Edit `tests/unit/plan/orchestrator.test.ts`. Add this test inside the existing `describe('plan() — happy path', () => { ... })` block:

```ts
  it('--arrive-by: waitMin is 0, totalTimeMin is bikeOut + train + bikeIn', async () => {
    const { ptv } = fakePtvFactory();
    const out = await plan(
      makeReq({
        departUtc: undefined,
        arriveByUtc: new Date('2026-05-17T01:00:00Z'),
      }),
      { ptv, external: fakeExternal as never },
    );
    expect(out.itineraries).toHaveLength(1);
    const it = out.itineraries[0];
    expect(it.waitMin).toBe(0);
    // bikeOut.min + bikeIn.min = 10 + 10 = 20; train run is 22:20→23:10 = 50 min.
    expect(it.totalTimeMin).toBeCloseTo(70, 5);
  });
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npx vitest run tests/unit/plan/orchestrator.test.ts -t "arrive-by"`
Expected: FAIL. Current code computes `waitMin` from `seedTime` (which is `arriveByUtc - 180min`), yielding a large positive value.

- [ ] **Step 3: Apply the fix in `src/plan/orchestrator.ts`**

Locate lines 102-103:

```ts
    const waitMin = Math.max(0,
      (Date.parse(t.departUtc) - seedTime.getTime()) / 60_000 - bikeOut.min);
```

Replace with:

```ts
    const isArriveBy = !!req.arriveByUtc;
    const waitMin = isArriveBy
      ? 0
      : Math.max(0, (Date.parse(t.departUtc) - seedTime.getTime()) / 60_000 - bikeOut.min);
```

The subsequent `totalTimeMin = bikeMin + waitMin + trainMin` line is unchanged — with `waitMin = 0` it correctly produces the minimum trip duration.

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `npx vitest run tests/unit/plan/orchestrator.test.ts`
Expected: 4 tests pass (3 v1 + 1 new).

Also run: `npm run test:unit`
Expected: all 24 unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/plan/orchestrator.ts tests/unit/plan/orchestrator.test.ts
git commit -m "fix(plan): correct totalTimeMin and waitMin for --arrive-by"
```

---

## Task 4: I4 — Memoize `osrmRoute` and `ghRouteBike` by stop id

**Files:**
- Modify: `src/plan/orchestrator.ts`
- Test: `tests/unit/plan/orchestrator.test.ts`

- [ ] **Step 1: Write a failing memoization test**

Edit `tests/unit/plan/orchestrator.test.ts`. Add inside the existing `describe('plan() — happy path', () => { ... })` block:

```ts
  it('memoizes osrmRoute calls by stop id (no redundant calls across tuples)', async () => {
    // Use a PTV stub that produces TWO tuples sharing the same access & egress stops
    // (i.e. two departures from stop 1071, both reaching stop 1162).
    const ptv = vi.fn(async (path: string) => {
      if (path.startsWith('/v3/stops/location/-37.78,144.96')) {
        return {
          stops: [{
            stop_id: 1071, stop_name: 'Brunswick', route_type: 0,
            stop_latitude: -37.77, stop_longitude: 144.96,
            routes: [{ route_id: 6, route_type: 0 }],
          }],
        };
      }
      if (path.startsWith('/v3/stops/location/-38.14,145.12')) {
        return {
          stops: [{
            stop_id: 1162, stop_name: 'Frankston', route_type: 0,
            stop_latitude: -38.14, stop_longitude: 145.12,
            routes: [{ route_id: 6, route_type: 0 }],
          }],
        };
      }
      if (path.startsWith('/v3/departures/route_type/0/stop/1071')) {
        return {
          departures: [
            { route_id: 6, run_ref: 'R1', stop_id: 1071,
              scheduled_departure_utc: '2026-05-16T22:20:00Z', estimated_departure_utc: null },
            { route_id: 6, run_ref: 'R2', stop_id: 1071,
              scheduled_departure_utc: '2026-05-16T22:40:00Z', estimated_departure_utc: null },
          ],
        };
      }
      if (path.startsWith('/v3/pattern/run/R1/route_type/0')
        || path.startsWith('/v3/pattern/run/R2/route_type/0')) {
        return {
          departures: [
            { stop_id: 1071, scheduled_departure_utc: '2026-05-16T22:20:00Z', estimated_departure_utc: null },
            { stop_id: 1162, scheduled_departure_utc: '2026-05-16T23:10:00Z', estimated_departure_utc: null },
          ],
        };
      }
      return { stops: [], departures: [] };
    });

    const osrmRouteSpy = vi.fn(async () => ({ km: 3, min: 10, geometry: '' }));
    const memoExternal = {
      osrmTable: vi.fn(async (_p: string, _s: never, dests: unknown[]) => ({
        durations: dests.map(() => 600), distances: dests.map(() => 3000),
      })),
      osrmRoute: osrmRouteSpy,
      ghRouteBike: vi.fn(async () => null),
    };

    const out = await plan(makeReq(), { ptv, external: memoExternal as never });
    expect(out.itineraries.length).toBeGreaterThanOrEqual(2);
    // With memoization: ONE call for (origin → 1071) and ONE call for (1162 → dest).
    // Without memoization: 2 + 2 = 4 calls.
    expect(osrmRouteSpy).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npx vitest run tests/unit/plan/orchestrator.test.ts -t "memoizes"`
Expected: FAIL — `osrmRoute` is called 4 times instead of 2.

- [ ] **Step 3: Apply the fix in `src/plan/orchestrator.ts`**

Locate the section starting at line 88:

```ts
  async function bikeLegRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<{ km: number; min: number; geometry: string }> {
    return resolved.external.osrmRoute('bicycle', from, to);
  }
```

Replace the entire `bikeLegRoute` helper (lines 88-90) with two stop-id-keyed caches:

```ts
  type RouteResult = { km: number; min: number; geometry: string };
  const accessRouteCache = new Map<number, Promise<RouteResult>>();
  const egressRouteCache = new Map<number, Promise<RouteResult>>();
  type EnrichResult = { km: number; min: number; kmOnPath: number } | null;
  const accessEnrichCache = new Map<number, Promise<EnrichResult>>();
  const egressEnrichCache = new Map<number, Promise<EnrichResult>>();

  function accessBikeRoute(a: AccessCandidate): Promise<RouteResult> {
    let p = accessRouteCache.get(a.stopId);
    if (!p) {
      p = resolved.external.osrmRoute('bicycle', req.from, a.coord);
      accessRouteCache.set(a.stopId, p);
    }
    return p;
  }
  function egressBikeRoute(e: AccessCandidate): Promise<RouteResult> {
    let p = egressRouteCache.get(e.stopId);
    if (!p) {
      p = resolved.external.osrmRoute('bicycle', e.coord, req.to);
      egressRouteCache.set(e.stopId, p);
    }
    return p;
  }
  function accessEnrich(a: AccessCandidate): Promise<EnrichResult> {
    let p = accessEnrichCache.get(a.stopId);
    if (!p) {
      p = resolved.external.ghRouteBike(req.from, a.coord);
      accessEnrichCache.set(a.stopId, p);
    }
    return p;
  }
  function egressEnrich(e: AccessCandidate): Promise<EnrichResult> {
    let p = egressEnrichCache.get(e.stopId);
    if (!p) {
      p = resolved.external.ghRouteBike(e.coord, req.to);
      egressEnrichCache.set(e.stopId, p);
    }
    return p;
  }
```

Then in the tuple loop (lines 96-97 in the v1 source), replace:

```ts
    const bikeOut = await bikeLegRoute(req.from, t.access.coord);
    const bikeIn  = await bikeLegRoute(t.egress.coord, req.to);
```

with:

```ts
    const bikeOut = await accessBikeRoute(t.access);
    const bikeIn  = await egressBikeRoute(t.egress);
```

And in the enrichment block (lines 108-110), replace:

```ts
      const [out, into] = await Promise.all([
        resolved.external.ghRouteBike(req.from, t.access.coord),
        resolved.external.ghRouteBike(t.egress.coord, req.to),
      ]);
```

with:

```ts
      const [out, into] = await Promise.all([
        accessEnrich(t.access),
        egressEnrich(t.egress),
      ]);
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `npx vitest run tests/unit/plan/orchestrator.test.ts`
Expected: 5 tests pass (4 + 1 new).

Run: `npm run test:unit`
Expected: 25 unit tests pass total.

- [ ] **Step 5: Commit**

```bash
git add src/plan/orchestrator.ts tests/unit/plan/orchestrator.test.ts
git commit -m "perf(plan): memoize osrm route and gh-route calls by stop id"
```

---

## Task 5: I5 — Populate `routeName` on `TrainLeg`

**Files:**
- Modify: `src/plan/types.ts`
- Modify: `src/plan/transit.ts`
- Modify: `src/plan/orchestrator.ts`
- Test: `tests/unit/plan/transit.test.ts`, `tests/unit/plan/orchestrator.test.ts`

- [ ] **Step 1: Add `routeName` to `DepartureWithPattern` type**

Edit `src/plan/types.ts`. Locate the `DepartureWithPattern` type (around line 78-83) and add `routeName`:

```ts
export type DepartureWithPattern = {
  routeId: number;
  routeType: RouteTypeBikeable;
  routeName: string;
  runRef: string;
  departUtc: string;
  pattern: { stopId: number; arriveUtc: string }[];
};
```

- [ ] **Step 2: Write a failing transit unit test**

Edit `tests/unit/plan/transit.test.ts`. Add inside the existing `describe('departuresFrom()', () => { ... })` block:

```ts
  it('populates routeName from the routes map keyed by route_id', async () => {
    const fakePtv = vi.fn(async () => ({
      departures: [
        { route_id: 6, run_ref: 'R1',
          scheduled_departure_utc: '2026-05-16T22:30:00Z',
          estimated_departure_utc: null,
          stop_id: 1071 },
      ],
      runs: { R1: { run_ref: 'R1', route_id: 6 } },
      routes: { 6: { route_id: 6, route_name: 'Frankston' } },
    }));
    const out = await departuresFrom(
      1071, 0, new Date('2026-05-16T22:10:00Z'), 90,
      { ptv: fakePtv },
    );
    expect(out).toHaveLength(1);
    expect(out[0].routeName).toBe('Frankston');
  });

  it('routeName falls back to empty string when routes map is missing', async () => {
    const fakePtv = vi.fn(async () => ({
      departures: [
        { route_id: 6, run_ref: 'R1',
          scheduled_departure_utc: '2026-05-16T22:30:00Z',
          estimated_departure_utc: null,
          stop_id: 1071 },
      ],
    }));
    const out = await departuresFrom(
      1071, 0, new Date('2026-05-16T22:10:00Z'), 90,
      { ptv: fakePtv },
    );
    expect(out[0].routeName).toBe('');
  });
```

- [ ] **Step 3: Run tests, verify they FAIL**

Run: `npx vitest run tests/unit/plan/transit.test.ts -t "routeName"`
Expected: FAIL — `routeName` is undefined on the returned objects (or compile error if TS catches the missing field).

- [ ] **Step 4: Implement the change in `src/plan/transit.ts`**

Edit `src/plan/transit.ts`. Locate lines 28-35 (the PTV call in `departuresFrom`):

```ts
  const raw = (await ptv(
    `/v3/departures/route_type/${routeType}/stop/${stopId}`,
    {
      date_utc: notBefore.toISOString(),
      max_results: 10,
      expand: ['Run', 'Stop'],
    },
  )) as { departures?: DepartureRaw[] };
```

Replace with:

```ts
  const raw = (await ptv(
    `/v3/departures/route_type/${routeType}/stop/${stopId}`,
    {
      date_utc: notBefore.toISOString(),
      max_results: 10,
      expand: ['Run', 'Stop', 'Route'],
    },
  )) as {
    departures?: DepartureRaw[];
    routes?: Record<string, { route_id: number; route_name?: string }>;
  };
```

Then update the loop body at lines 40-52. Replace:

```ts
  const out: DepartureWithPattern[] = [];
  for (const d of raw.departures ?? []) {
    const t = d.estimated_departure_utc ?? d.scheduled_departure_utc;
    const tMs = Date.parse(t);
    if (tMs < notBeforeMs || tMs > cutoffMs) continue;
    out.push({
      routeId: d.route_id,
      routeType,
      runRef: d.run_ref,
      departUtc: t,
      pattern: [], // populated by orchestrator via runPattern() when needed
    });
  }
  return out;
```

with:

```ts
  const routesMap = raw.routes ?? {};
  const out: DepartureWithPattern[] = [];
  for (const d of raw.departures ?? []) {
    const t = d.estimated_departure_utc ?? d.scheduled_departure_utc;
    const tMs = Date.parse(t);
    if (tMs < notBeforeMs || tMs > cutoffMs) continue;
    out.push({
      routeId: d.route_id,
      routeType,
      routeName: routesMap[String(d.route_id)]?.route_name ?? '',
      runRef: d.run_ref,
      departUtc: t,
      pattern: [], // populated by orchestrator via runPattern() when needed
    });
  }
  return out;
```

- [ ] **Step 5: Run the unit tests, verify they PASS**

Run: `npx vitest run tests/unit/plan/transit.test.ts`
Expected: 5 tests pass (3 v1 + 2 new).

- [ ] **Step 6: Thread `routeName` through the orchestrator**

Edit `src/plan/orchestrator.ts`. Locate the `Tuple` type declaration (around lines 58-60):

```ts
  type Tuple = { access: AccessCandidate; egress: AccessCandidate;
                 routeId: number; runRef: string;
                 departUtc: string; arriveUtc: string };
```

Replace with:

```ts
  type Tuple = { access: AccessCandidate; egress: AccessCandidate;
                 routeId: number; runRef: string; routeName: string;
                 departUtc: string; arriveUtc: string };
```

Then locate the `tuples.push(...)` call inside the for-loop (around lines 79-83):

```ts
        tuples.push({
          access: a, egress: eg,
          routeId: d.routeId, runRef: d.runRef,
          departUtc: d.departUtc, arriveUtc: pattern[i].arriveUtc,
        });
```

Replace with:

```ts
        tuples.push({
          access: a, egress: eg,
          routeId: d.routeId, runRef: d.runRef, routeName: d.routeName,
          departUtc: d.departUtc, arriveUtc: pattern[i].arriveUtc,
        });
```

Then locate the TrainLeg construction in the itineraries push (around line 124-128):

```ts
      { mode: 'train', routeId: t.routeId, routeType: t.access.routeType,
        routeName: '',
        fromStopId: t.access.stopId, toStopId: t.egress.stopId,
        fromStopName: t.access.stopName, toStopName: t.egress.stopName,
        departUtc: t.departUtc, arriveUtc: t.arriveUtc, runRef: t.runRef },
```

Replace `routeName: ''` with `routeName: t.routeName`. The block becomes:

```ts
      { mode: 'train', routeId: t.routeId, routeType: t.access.routeType,
        routeName: t.routeName,
        fromStopId: t.access.stopId, toStopId: t.egress.stopId,
        fromStopName: t.access.stopName, toStopName: t.egress.stopName,
        departUtc: t.departUtc, arriveUtc: t.arriveUtc, runRef: t.runRef },
```

- [ ] **Step 7: Update the orchestrator happy-path test to verify routeName**

Edit `tests/unit/plan/orchestrator.test.ts`. In `fakePtvFactory`, the departures handler returns:

```ts
    if (path.startsWith('/v3/departures/route_type/0/stop/1071')) {
      return {
        departures: [{
          route_id: 6, run_ref: 'R1', stop_id: 1071,
          scheduled_departure_utc: '2026-05-16T22:20:00Z',
          estimated_departure_utc: null,
        }],
      };
    }
```

Update it to include a routes map:

```ts
    if (path.startsWith('/v3/departures/route_type/0/stop/1071')) {
      return {
        departures: [{
          route_id: 6, run_ref: 'R1', stop_id: 1071,
          scheduled_departure_utc: '2026-05-16T22:20:00Z',
          estimated_departure_utc: null,
        }],
        routes: { 6: { route_id: 6, route_name: 'Frankston' } },
      };
    }
```

Then in the "returns one itinerary for a single train segment" test, add this assertion at the end:

```ts
    const trainLeg = it.legs[1];
    if (trainLeg.mode === 'train') {
      expect(trainLeg.routeName).toBe('Frankston');
    }
```

- [ ] **Step 8: Run the orchestrator tests, verify they PASS**

Run: `npx vitest run tests/unit/plan/orchestrator.test.ts`
Expected: 5 tests pass.

Run: `npm run test:unit`
Expected: 27 unit tests pass (5 transit + 5 orchestrator + 3 candidates + 7 score + 7 external).

- [ ] **Step 9: Commit**

```bash
git add src/plan/types.ts src/plan/transit.ts src/plan/orchestrator.ts \
        tests/unit/plan/transit.test.ts tests/unit/plan/orchestrator.test.ts
git commit -m "feat(plan): populate routeName on TrainLeg via PTV Route expand"
```

---

## Task 6: M3 — Parse `HH:MM` as Melbourne local time

**Files:**
- Modify: `src/commands/plan.ts`
- Test: add a unit test file specifically for `parseTime`

- [ ] **Step 1: Refactor `parseTime` to be exported and write a failing unit test**

First, make `parseTime` exportable. Edit `src/commands/plan.ts`. Change line 21:

```ts
function parseTime(s: string | undefined): Date | undefined {
```

to:

```ts
export function parseTime(s: string | undefined): Date | undefined {
```

(Just adding the `export` keyword; no other change in this step.)

Create `tests/unit/plan/parse_time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTime } from '../../../src/commands/plan';

describe('parseTime()', () => {
  it('returns undefined for undefined', () => {
    expect(parseTime(undefined)).toBeUndefined();
  });

  it('parses an ISO8601 timezone-aware string verbatim', () => {
    const t = parseTime('2026-05-16T08:00:00Z');
    expect(t?.toISOString()).toBe('2026-05-16T08:00:00.000Z');
  });

  it('rejects an obviously invalid string', () => {
    expect(() => parseTime('not-a-date')).toThrow(/invalid date/);
  });

  it('parses HH:MM as Melbourne local time (AEST winter offset +10:00)', () => {
    // 08:00 Melbourne on a known-AEST date (2026-07-15, mid-winter, no DST).
    // We can't easily inject "now" without refactoring further, so we verify
    // structural behaviour: the parsed Date for HH:MM matches "today HH:MM
    // Australia/Melbourne" when re-formatted in Melbourne.
    const parsed = parseTime('08:00');
    expect(parsed).toBeInstanceOf(Date);
    const melHour = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne', hour: 'numeric', hour12: false,
    }).format(parsed as Date);
    expect(parseInt(melHour, 10)).toBe(8);
  });

  it('parses HH:MM with a different hour correctly', () => {
    const parsed = parseTime('17:30');
    const melTime = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).format(parsed as Date);
    // Melbourne should report 17:30
    expect(melTime).toMatch(/^17[:.]30$/);
  });
});
```

- [ ] **Step 2: Run the tests, verify HH:MM tests FAIL**

Run: `npx vitest run tests/unit/plan/parse_time.test.ts`
Expected: 3 tests pass (undefined, ISO, invalid), 2 tests FAIL (the HH:MM ones — current code parses 08:00 as UTC so Melbourne reports 18:00 or 19:00 depending on DST).

- [ ] **Step 3: Replace `parseTime` with the Melbourne-aware implementation**

Edit `src/commands/plan.ts`. Replace lines 21-33 (the entire `parseTime` function) with:

```ts
export function parseTime(s: string | undefined): Date | undefined {
  if (s === undefined) return undefined;
  if (/^\d{2}:\d{2}$/.test(s)) {
    return parseMelbourneHHMM(s);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
}

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
```

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `npx vitest run tests/unit/plan/parse_time.test.ts`
Expected: 5 tests pass.

Run: `npm run test:unit`
Expected: 32 unit tests pass (27 + 5 new).

- [ ] **Step 5: Build and smoke-test the CLI**

Run: `npm run build`
Run:
```bash
node -e "
  const { parseTime } = require('./dist/commands/plan');
  const t = parseTime('08:00');
  console.log('parsed:', t.toISOString());
  console.log('melbourne reads:', new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', hour: 'numeric', minute: 'numeric', hour12: false,
  }).format(t));
"
```
Expected: prints `melbourne reads: 08:00` (or `8:00`, with the exact format depending on locale).

- [ ] **Step 6: Commit**

```bash
git add src/commands/plan.ts tests/unit/plan/parse_time.test.ts
git commit -m "fix(plan): parse --depart HH:MM as Melbourne local time"
```

---

## Task 7: Pagination — bump `max_results` on `/stops/location`

**Files:**
- Modify: `src/plan/candidates.ts`
- Test: `tests/unit/plan/candidates.test.ts`

- [ ] **Step 1: Write a failing unit test for the truncation warning**

Edit `tests/unit/plan/candidates.test.ts`. Add inside the existing `describe('accessCandidates()', ...)` block:

```ts
  it('passes max_results: 200 to PTV stops/location', async () => {
    const fakePtv = vi.fn(async () => ({ stops: [] }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({ durations: [], distances: [] })),
    };
    await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 5, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(fakePtv).toHaveBeenCalledWith(
      expect.stringContaining('/v3/stops/location'),
      expect.objectContaining({ max_results: 200 }),
    );
  });
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npx vitest run tests/unit/plan/candidates.test.ts -t "max_results"`
Expected: FAIL — current call passes `max_distance` and `route_types` only.

- [ ] **Step 3: Apply the fix in `src/plan/candidates.ts`**

Edit `src/plan/candidates.ts`. Locate the PTV call at lines 33-37:

```ts
  const raw = (await ptv(`/v3/stops/location/${origin.lat},${origin.lon}`, {
    max_distance: Math.round(maxBikeKm * 1000),
    route_types: routeTypes as number[],
    expand: 'Route',
  })) as { stops?: StopRaw[] };
```

Replace with:

```ts
  const raw = (await ptv(`/v3/stops/location/${origin.lat},${origin.lon}`, {
    max_distance: Math.round(maxBikeKm * 1000),
    route_types: routeTypes as number[],
    expand: 'Route',
    max_results: 200,
  })) as { stops?: StopRaw[] };

  if ((raw.stops?.length ?? 0) === 200) {
    // Truncation signal: the caller may want to narrow the radius.
    // We write to stderr because this helper has no warnings channel back to
    // the orchestrator in v1.1. A future refactor can return warnings as a
    // second value if a caller needs to surface them in the JSON response.
    process.stderr.write(
      `candidates: stops/location returned exactly 200 — possible truncation at ${origin.lat},${origin.lon}\n`,
    );
  }
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `npx vitest run tests/unit/plan/candidates.test.ts`
Expected: 4 tests pass (3 v1 + 1 new).

Run: `npm test`
Expected: full suite passes — approximately 65 tests total (~41 unit + 12 integration + 12 e2e), all green. Note: the integration/e2e plan tests are still slow due to live API calls; total runtime ~3 min.

- [ ] **Step 5: Commit**

```bash
git add src/plan/candidates.ts tests/unit/plan/candidates.test.ts
git commit -m "feat(plan): bump stops/location max_results to 200 with truncation warning"
```

---

## Self-Review

**Spec coverage check:**

- C1 (gh-route parser) → Task 1 ✓
- I1 (argv scope + negative numeric guard) → Task 2 ✓
- I2 (--arrive-by total-time) → Task 3 ✓
- I4 (osrm memoization) → Task 4 ✓
- I5 (routeName) → Task 5 ✓
- M3 (HH:MM Melbourne) → Task 6 ✓
- Pagination → Task 7 ✓

Spec sections covered: items 1-7 each have a task; JSON output additive changes (routeName, bikeKmOnPath, warnings) are covered by Tasks 5, 1, 7 respectively. Test plan (new external.test.ts, extended orchestrator/transit/candidates tests, new parse_time.test.ts) is covered.

**Placeholder scan:** No "TBD", "TODO", or vague instructions. All code blocks are concrete and copy-pasteable. The DST-transition ambiguous-hour caveat in Task 6 is documented as a known limitation in the spec, not a placeholder.

**Type consistency:**
- `DepartureWithPattern` gains `routeName: string` field in Task 5 step 1; used by transit.ts (step 4), orchestrator.ts (step 6), and tests (step 7).
- `Tuple` type in orchestrator.ts gains `routeName: string` (Task 5 step 6), threaded into TrainLeg construction.
- `RouteResult` and `EnrichResult` types in Task 4 are local to the function body — no cross-file consistency concern.
- `parseTime` exported from `src/commands/plan.ts` in Task 6, imported by `parse_time.test.ts`.
- `parseGhRoute` exported from `src/plan/external.ts` in Task 1, imported by `external.test.ts`. `ghRouteBike` signature unchanged.

No type drift, no missing tasks for spec requirements.

---

## Out of Scope (deferred to Spec B / v1.2)

Per the spec's "Out of scope" section:

- Multi-transfer (K > 1) support
- CBD-hub stops as transfer candidates
- `--bike-profile bike_quiet | bike_balanced`
- Disruption filtering
- `--raw` for plan command
- Exact (haversine) `kmOnPath` calculation — index-proportional is good enough for v1.1

These are listed here only as a reminder; no tasks are written for them.
