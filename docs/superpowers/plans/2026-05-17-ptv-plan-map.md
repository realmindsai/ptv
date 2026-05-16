# PTV `plan` v1.4 — Map Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the silent bike-leg geometry bug and add a `--html` flag that writes a self-contained Leaflet map and auto-opens it.

**Architecture:** Three additive changes — type-shape fix for `BikeLeg.geometry`, hub coordinate enrichment on `HUBS` and `TrainLeg`, and a new `src/plan/map.ts` module that produces inlined Leaflet HTML.

**Tech Stack:** TypeScript 5.x strict, vitest, commander 14, Leaflet (loaded from CDN by the generated HTML).

**Spec:** `docs/superpowers/specs/2026-05-17-ptv-plan-map.md` (commit `63be769`).

---

## File Map

**Create:**
- `src/plan/map.ts` — `writeMapHtml()` function with inlined Leaflet template
- `tests/unit/plan/map.test.ts` — unit tests for the writer

**Modify:**
- `src/plan/types.ts` — `GeoJsonLineString` type, `BikeLeg.geometry` shape change, `TrainLeg.fromLat/fromLon/toLat/toLon` optional fields
- `src/plan/external.ts` — pass `--overview full --geometries geojson` to `osrm-au route`
- `src/plan/hubs.ts` — add `lat` and `lon` to each `HUBS` entry; export `hubCoord()`
- `src/plan/orchestrator.ts` — populate train-leg coordinates from access/egress candidates and `hubCoord()`
- `src/commands/plan.ts` — add `--html <path>` option
- `tests/unit/plan/external.test.ts` — geometry shape tests
- `tests/unit/plan/hubs.test.ts` — `hubCoord` tests
- `tests/unit/plan/orchestrator.test.ts` — train-leg coordinate assertions
- `tests/e2e/plan.test.ts` — `--html` e2e

---

## Task 1: Fix bike-leg geometry capture

**Files:**
- Modify: `src/plan/types.ts`
- Modify: `src/plan/external.ts`
- Modify: `src/plan/orchestrator.ts` (type flow through)
- Modify: `tests/unit/plan/external.test.ts`

This task corrects a silent v1.0 bug: `osrm-au route` is called without `--overview full --geometries geojson`, so geometry is empty for every bike leg ever produced.

- [ ] **Step 1: Update `src/plan/types.ts`**

Add `GeoJsonLineString` type and change `BikeLeg.geometry` shape.

Find the `BikeLeg` type (around lines 11-19):

```ts
export type BikeLeg = {
  mode: 'bike';
  from: LatLon;
  to: LatLon;
  km: number;
  min: number;
  kmOnPath?: number | null;
  geometry?: string;
};
```

Replace with:

```ts
export type GeoJsonLineString = {
  type: 'LineString';
  coordinates: [number, number][];  // [lon, lat] pairs (GeoJSON convention)
};

export type BikeLeg = {
  mode: 'bike';
  from: LatLon;
  to: LatLon;
  km: number;
  min: number;
  kmOnPath?: number | null;
  geometry?: GeoJsonLineString | null;
};
```

- [ ] **Step 2: Write failing tests**

Edit `tests/unit/plan/external.test.ts`.

The existing file currently tests `parseGhRoute`. We need to add tests for `osrmRoute`. Since `osrmRoute` shells out via `spawnSync`, we'll mock the binary by intercepting `child_process.spawnSync` with vi.mock.

Add to the top of the file (after existing imports):

```ts
import { vi } from 'vitest';
```

If `vi` is already imported, this is a no-op.

Then add new tests inside a new `describe` block at the bottom of the file:

```ts
describe('osrmRoute()', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns geometry as a GeoJSON LineString object when osrm-au includes it', async () => {
    vi.doMock('child_process', () => ({
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({
          routes: [{
            distance: 1500,
            duration: 360,
            geometry: { type: 'LineString', coordinates: [[144.96, -37.78], [144.97, -37.79]] },
          }],
        }),
        stderr: '',
      }),
    }));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.km).toBeCloseTo(1.5);
    expect(r.min).toBeCloseTo(6);
    expect(r.geometry).toEqual({
      type: 'LineString',
      coordinates: [[144.96, -37.78], [144.97, -37.79]],
    });
  });

  it('returns geometry: null when osrm-au omits the geometry field', async () => {
    vi.doMock('child_process', () => ({
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({
          routes: [{ distance: 1500, duration: 360 }],
        }),
        stderr: '',
      }),
    }));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.geometry).toBeNull();
  });
});
```

Note: if `beforeEach` is not already imported, add it to the vitest import line at the top of the file.

- [ ] **Step 3: Run; verify FAIL**

```bash
npx vitest run tests/unit/plan/external.test.ts -t "osrmRoute"
```
Expected: FAIL — currently `osrmRoute`'s return value has `geometry: ''` (a string, not a GeoJSON object).

If the test runs with the actual binary (not the mock), the mock isn't working. Verify `vi.doMock('child_process', ...)` is placed BEFORE the dynamic `await import('../../../src/plan/external')` — the dynamic import is intentional so the mock applies.

- [ ] **Step 4: Update `src/plan/external.ts`**

Find the existing `osrmRoute` function (lines 55-76):

```ts
export async function osrmRoute(
  profile: 'bicycle' | 'foot',
  from: LatLon,
  to: LatLon,
): Promise<{ km: number; min: number; geometry: string }> {
  // --json returns native OSRM format: routes[0].distance in meters, duration in seconds.
  const data = runJson(OSRM_BIN, [
    'route', '--profile', profile,
    osrmPointArg(from),
    osrmPointArg(to),
    '--json',
  ]) as { routes?: Array<{ distance?: number; duration?: number; geometry?: unknown }> };
  const route = data.routes?.[0];
  if (route?.distance === undefined || route?.duration === undefined) {
    throw new Error('osrm-au route response missing distance/duration');
  }
  return {
    km: route.distance / 1000,
    min: route.duration / 60,
    geometry: typeof route.geometry === 'string' ? route.geometry : '',
  };
}
```

Replace entirely with:

```ts
import type { GeoJsonLineString } from './types';

export async function osrmRoute(
  profile: 'bicycle' | 'foot',
  from: LatLon,
  to: LatLon,
): Promise<{ km: number; min: number; geometry: GeoJsonLineString | null }> {
  // --json returns native OSRM format: routes[0].distance in meters, duration in seconds.
  // --overview full + --geometries geojson asks for the full route shape as a GeoJSON LineString.
  const data = runJson(OSRM_BIN, [
    'route', '--profile', profile,
    osrmPointArg(from),
    osrmPointArg(to),
    '--overview', 'full',
    '--geometries', 'geojson',
    '--json',
  ]) as { routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: GeoJsonLineString | string;
  }> };
  const route = data.routes?.[0];
  if (route?.distance === undefined || route?.duration === undefined) {
    throw new Error('osrm-au route response missing distance/duration');
  }
  const geom = route.geometry && typeof route.geometry === 'object'
    ? (route.geometry as GeoJsonLineString)
    : null;
  return {
    km: route.distance / 1000,
    min: route.duration / 60,
    geometry: geom,
  };
}
```

Add the `GeoJsonLineString` import at the top of the file, next to the existing `import type { LatLon } from './types';` line:

```ts
import type { LatLon, GeoJsonLineString } from './types';
```

Remove the old `import type { LatLon } from './types';` (replaced).

- [ ] **Step 5: Update orchestrator type flow**

In `src/plan/orchestrator.ts`, find the `RouteResult` type alias (around line 36):

```ts
type RouteResult = { km: number; min: number; geometry: string };
```

Replace with:

```ts
type RouteResult = { km: number; min: number; geometry: GeoJsonLineString | null };
```

Then add `GeoJsonLineString` to the type imports at the top:

```ts
import type {
  PlanRequest, PlanResult, Itinerary, AccessCandidate, Leg, GeoJsonLineString,
} from './types';
```

The orchestrator's bike-leg construction lines `geometry: bikeOut.geometry` and `geometry: bikeIn.geometry` are unchanged — the types now correctly flow `GeoJsonLineString | null`.

- [ ] **Step 6: Run tests; verify PASS**

```bash
npx vitest run tests/unit/plan/external.test.ts
```
Expected: 9 tests pass (7 v1.1 + 2 new).

Then full unit suite:
```bash
npm run test:unit
```
Expected: 59 unit tests pass (57 after v1.3 + 2 new). One existing v1.2/v1.3 orchestrator test may need updating if it asserts `geometry: ''` specifically — search for that and verify no test fails on the assertion.

If a test fails because it expected `geometry: ''` and now gets `null`, update that single assertion to `expect(...).toBeNull()` or `expect(...geometry).toBeNull()`.

- [ ] **Step 7: Build to verify TypeScript**

```bash
npm run build
```
Expected: exit 0. If TypeScript complains about a downstream consumer of `BikeLeg.geometry` expecting a string, follow the error to update the consumer's type.

- [ ] **Step 8: Commit**

```bash
git add src/plan/types.ts src/plan/external.ts src/plan/orchestrator.ts tests/unit/plan/external.test.ts
git commit -m "feat(plan): capture full bike-leg geometry from osrm-au"
```

## Context for Task 1

- cwd: `/Users/dewoller/code/personal/ptv`
- v1.3 final state: commit `c5ecb21` on `main`.
- The schema change from `geometry: string` (defaulting to `''`) to `geometry: GeoJsonLineString | null` is breaking ONLY for consumers that check `geometry === ''`. Inside this codebase no such consumer exists. External JSON consumers must adapt — this is acceptable because v1 always emitted empty strings.
- The `--geometries geojson` flag asks OSRM for a GeoJSON `LineString` object (lon,lat pairs) instead of the default polyline-encoded string. This avoids needing a polyline decoder in v1.4.
- Commit to `main`. No `--no-verify`.

---

## Task 2: Hub coordinates + train-leg coordinate fields

**Files:**
- Modify: `src/plan/types.ts` — add `TrainLeg.fromLat/fromLon/toLat/toLon`
- Modify: `src/plan/hubs.ts` — add `lat`/`lon` to `HUBS`, export `hubCoord`
- Modify: `src/plan/orchestrator.ts` — populate train-leg coordinate fields
- Modify: `tests/unit/plan/hubs.test.ts`
- Modify: `tests/unit/plan/orchestrator.test.ts`

- [ ] **Step 1: Fetch hub coordinates from PTV**

Build first if needed: `npm run build`

Run this lookup script to get the 13 hub coordinates:

```bash
node -e "
const { ptv } = require('./dist/client');
const targets = [
  { name: 'Flinders Street',   stopId: 1071 },
  { name: 'Southern Cross',    stopId: 1181 },
  { name: 'Melbourne Central', stopId: 1120 },
  { name: 'Parliament',        stopId: 1155 },
  { name: 'Flagstaff',         stopId: 1068 },
  { name: 'Richmond',          stopId: 1162 },
  { name: 'South Yarra',       stopId: 1180 },
  { name: 'North Melbourne',   stopId: 1144 },
  { name: 'Footscray',         stopId: 1072 },
  { name: 'Caulfield',         stopId: 1036 },
  { name: 'Dandenong',         stopId: 1049 },
  { name: 'Clifton Hill',      stopId: 1041 },
  { name: 'Sunshine',          stopId: 1218 },
];
(async () => {
  const results = [];
  for (const t of targets) {
    const data = await ptv('/v3/stops/' + t.stopId + '/route_type/0', {});
    const s = data.stop;
    if (!s) { console.error('NOT FOUND:', t); results.push({ ...t, lat: null, lon: null }); continue; }
    const gps = s.stop_location?.stop_gps ?? s;
    const lat = gps.latitude ?? s.stop_latitude;
    const lon = gps.longitude ?? s.stop_longitude;
    results.push({ ...t, lat, lon });
  }
  console.log(JSON.stringify(results, null, 2));
})();
"
```

Expected: 13 entries, each with `lat` and `lon` as numbers in the Melbourne range (lat ≈ -37.x, lon ≈ 144.x or 145.x). If any return null, STOP and report BLOCKED.

If PTV credentials are missing, report NEEDS_CONTEXT.

Save the JSON output — you'll paste the lat/lon values in step 3.

- [ ] **Step 2: Add `fromLat`/`fromLon`/`toLat`/`toLon` to `TrainLeg`**

Edit `src/plan/types.ts`. Find the `TrainLeg` type (around line 21-33):

```ts
export type TrainLeg = {
  mode: 'train';
  routeId: number;
  routeType: RouteTypeBikeable;
  routeName: string;
  fromStopId: number;
  toStopId: number;
  fromStopName: string;
  toStopName: string;
  departUtc: string;
  arriveUtc: string;
  runRef: string;
};
```

Replace with:

```ts
export type TrainLeg = {
  mode: 'train';
  routeId: number;
  routeType: RouteTypeBikeable;
  routeName: string;
  fromStopId: number;
  toStopId: number;
  fromStopName: string;
  toStopName: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  departUtc: string;
  arriveUtc: string;
  runRef: string;
};
```

- [ ] **Step 3: Update `src/plan/hubs.ts`**

Replace the entire file with the version below. Paste the lat/lon values from step 1 into the appropriate positions.

```ts
// Melbourne metropolitan transfer hubs. These 13 stations cover ~95% of
// useful K=2 trips by being on at least two distinct train lines or by
// serving as inter-modal interchanges (V/Line ↔ metro).
//
// stop_ids, names, and coords fetched from the live PTV API.

export const HUBS: ReadonlyArray<{
  stopId: number; name: string; lat: number; lon: number;
}> = [
  { stopId: 1071, name: 'Flinders Street Station',  lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1181, name: 'Southern Cross Station',    lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1120, name: 'Melbourne Central Station', lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1155, name: 'Parliament Station',        lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1068, name: 'Flagstaff Station',         lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1162, name: 'Richmond Station',          lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1180, name: 'South Yarra Station',       lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1144, name: 'North Melbourne Station',   lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1072, name: 'Footscray Station',         lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1036, name: 'Caulfield Station',         lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1049, name: 'Dandenong Station',         lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1041, name: 'Clifton Hill Station',      lat: <FILL_IN>, lon: <FILL_IN> },
  { stopId: 1218, name: 'Sunshine Station',          lat: <FILL_IN>, lon: <FILL_IN> },
];

export const HUB_STOP_IDS: number[] = HUBS.map((h) => h.stopId);

const HUB_SET = new Set(HUB_STOP_IDS);
const HUB_NAME_BY_ID = new Map(HUBS.map((h) => [h.stopId, h.name] as const));
const HUB_COORD_BY_ID = new Map(HUBS.map((h) => [h.stopId, { lat: h.lat, lon: h.lon }] as const));

export function isHub(stopId: number): boolean {
  return HUB_SET.has(stopId);
}

export function hubName(stopId: number): string {
  return HUB_NAME_BY_ID.get(stopId) ?? '';
}

export function hubCoord(stopId: number): { lat: number; lon: number } | null {
  return HUB_COORD_BY_ID.get(stopId) ?? null;
}
```

Replace each `<FILL_IN>` with the corresponding `lat` or `lon` number from your step 1 JSON output. Do not leave any `<FILL_IN>` placeholders; the build will fail with TS errors if you do.

- [ ] **Step 4: Write failing tests for `hubCoord`**

Edit `tests/unit/plan/hubs.test.ts`. Update the import line at the top:

```ts
import { HUB_STOP_IDS, isHub, hubName, hubCoord } from '../../../src/plan/hubs';
```

Add two tests inside the existing `describe('hubs', ...)` block:

```ts
  it('hubCoord returns coords in Melbourne range for each HUB_STOP_ID', () => {
    for (const id of HUB_STOP_IDS) {
      const c = hubCoord(id);
      expect(c).not.toBeNull();
      expect(c!.lat).toBeGreaterThan(-39);
      expect(c!.lat).toBeLessThan(-36);
      expect(c!.lon).toBeGreaterThan(144);
      expect(c!.lon).toBeLessThan(146);
    }
  });

  it('hubCoord returns null for unknown stop_id', () => {
    expect(hubCoord(0)).toBeNull();
    expect(hubCoord(99999999)).toBeNull();
  });
```

- [ ] **Step 5: Run; verify FAIL**

```bash
npx vitest run tests/unit/plan/hubs.test.ts
```
Expected: FAIL — `hubCoord` is not exported yet.

- [ ] **Step 6: Update orchestrator to populate train-leg coords**

Edit `src/plan/orchestrator.ts`. Update the hubs import to include `hubCoord`:

Find:
```ts
import { isHub, hubName } from './hubs';
```

Replace with:
```ts
import { isHub, hubName, hubCoord } from './hubs';
```

Then locate the K=1 TrainLeg construction inside `planK1`. Find:

```ts
      { mode: 'train', routeId: t.routeId, routeType: t.access.routeType,
        routeName: t.routeName,
        fromStopId: t.access.stopId, toStopId: t.egress.stopId,
        fromStopName: t.access.stopName, toStopName: t.egress.stopName,
        departUtc: t.departUtc, arriveUtc: t.arriveUtc, runRef: t.runRef },
```

Replace with:

```ts
      { mode: 'train', routeId: t.routeId, routeType: t.access.routeType,
        routeName: t.routeName,
        fromStopId: t.access.stopId, toStopId: t.egress.stopId,
        fromStopName: t.access.stopName, toStopName: t.egress.stopName,
        fromLat: t.access.coord.lat, fromLon: t.access.coord.lon,
        toLat: t.egress.coord.lat, toLon: t.egress.coord.lon,
        departUtc: t.departUtc, arriveUtc: t.arriveUtc, runRef: t.runRef },
```

Then locate the K=2 TrainLeg constructions inside `planK2Hubs`. Find:

```ts
      { mode: 'train', routeId: t.routeId1, routeType: t.access.routeType,
        routeName: t.routeName1,
        fromStopId: t.access.stopId, toStopId: t.hubStopId,
        fromStopName: t.access.stopName, toStopName: hubName(t.hubStopId),
        departUtc: t.depart1Utc, arriveUtc: t.arrive1Utc, runRef: t.run1Ref },
      { mode: 'train', routeId: t.routeId2, routeType: t.egress.routeType,
        routeName: t.routeName2,
        fromStopId: t.hubStopId, toStopId: t.egress.stopId,
        fromStopName: hubName(t.hubStopId), toStopName: t.egress.stopName,
        departUtc: t.depart2Utc, arriveUtc: t.arrive2Utc, runRef: t.run2Ref },
```

Replace with (and add a helper variable for the hub coord — it's used twice):

```ts
      ];
      // Compute hub coord once per tuple
      const hub = hubCoord(t.hubStopId);
      const hubLat = hub?.lat;
      const hubLon = hub?.lon;
      legs.push(
        { mode: 'train', routeId: t.routeId1, routeType: t.access.routeType,
          routeName: t.routeName1,
          fromStopId: t.access.stopId, toStopId: t.hubStopId,
          fromStopName: t.access.stopName, toStopName: hubName(t.hubStopId),
          fromLat: t.access.coord.lat, fromLon: t.access.coord.lon,
          toLat: hubLat, toLon: hubLon,
          departUtc: t.depart1Utc, arriveUtc: t.arrive1Utc, runRef: t.run1Ref },
        { mode: 'train', routeId: t.routeId2, routeType: t.egress.routeType,
          routeName: t.routeName2,
          fromStopId: t.hubStopId, toStopId: t.egress.stopId,
          fromStopName: hubName(t.hubStopId), toStopName: t.egress.stopName,
          fromLat: hubLat, fromLon: hubLon,
          toLat: t.egress.coord.lat, toLon: t.egress.coord.lon,
          departUtc: t.depart2Utc, arriveUtc: t.arrive2Utc, runRef: t.run2Ref },
      );
```

Hmm wait — the existing K=2 code constructs `legs` as a single array literal with all four legs. Pushing into an array would require restructuring. Let me give a cleaner replacement.

Actually, the cleanest restructure is to keep the array-literal form and compute the hub coord BEFORE the literal:

```ts
    // Compute hub coord once per tuple (may be null if not in our HUBS list)
    const hub = hubCoord(t.hubStopId);
    const hubLat = hub?.lat;
    const hubLon = hub?.lon;

    const legs: Leg[] = [
      { mode: 'bike', from: s.req.from, to: t.access.coord,
        km: bikeOut.km, min: bikeOut.min, geometry: bikeOut.geometry },
      { mode: 'train', routeId: t.routeId1, routeType: t.access.routeType,
        routeName: t.routeName1,
        fromStopId: t.access.stopId, toStopId: t.hubStopId,
        fromStopName: t.access.stopName, toStopName: hubName(t.hubStopId),
        fromLat: t.access.coord.lat, fromLon: t.access.coord.lon,
        toLat: hubLat, toLon: hubLon,
        departUtc: t.depart1Utc, arriveUtc: t.arrive1Utc, runRef: t.run1Ref },
      { mode: 'train', routeId: t.routeId2, routeType: t.egress.routeType,
        routeName: t.routeName2,
        fromStopId: t.hubStopId, toStopId: t.egress.stopId,
        fromStopName: hubName(t.hubStopId), toStopName: t.egress.stopName,
        fromLat: hubLat, fromLon: hubLon,
        toLat: t.egress.coord.lat, toLon: t.egress.coord.lon,
        departUtc: t.depart2Utc, arriveUtc: t.arrive2Utc, runRef: t.run2Ref },
      { mode: 'bike', from: t.egress.coord, to: s.req.to,
        km: bikeIn.km, min: bikeIn.min, geometry: bikeIn.geometry },
    ];
```

Place the `const hub = ...` lines immediately before the `const legs: Leg[] = [` line. The existing `const legs: Leg[] = [...]` array literal becomes the version shown above.

- [ ] **Step 7: Update orchestrator tests to assert train-leg coords**

Edit `tests/unit/plan/orchestrator.test.ts`. Find the existing K=1 happy-path test (`'returns one itinerary for a single train segment'`). Add coordinate assertions at the end of its body (before its closing `});`):

```ts
    const trainLeg = it.legs[1];
    if (trainLeg.mode === 'train') {
      // K=1 train leg has access stop coord at fromLat/Lon and egress at toLat/Lon
      expect(typeof trainLeg.fromLat).toBe('number');
      expect(typeof trainLeg.fromLon).toBe('number');
      expect(typeof trainLeg.toLat).toBe('number');
      expect(typeof trainLeg.toLon).toBe('number');
    }
```

(Add this immediately after the existing `expect(trainLeg.routeName).toBe('Frankston');` assertion in that test.)

Then find the K=2 test (`'K=2 fallback: returns itinerary with transfers=1 and 4 legs when K=1 has no shared route'`). Add coordinate assertions inside its existing `if (l1.mode === 'train' && l2.mode === 'train')` block:

```ts
    if (l1.mode === 'train' && l2.mode === 'train') {
      expect(l1.toStopId).toBe(l2.fromStopId);
      expect(l1.toStopName).toBe('Flinders Street Station');
      expect(l2.fromStopName).toBe('Flinders Street Station');
      // Hub coord populated on both inner-leg endpoints
      expect(typeof l1.toLat).toBe('number');
      expect(typeof l1.toLon).toBe('number');
      expect(l2.fromLat).toBe(l1.toLat);
      expect(l2.fromLon).toBe(l1.toLon);
    }
```

- [ ] **Step 8: Run tests; verify PASS**

```bash
npx vitest run tests/unit/plan/hubs.test.ts tests/unit/plan/orchestrator.test.ts
```
Expected: hubs 8/8 (6 v1.3 + 2 new); orchestrator 9/9 (assertions added to existing tests, no count change).

Then full unit suite:
```bash
npm run test:unit
```
Expected: 61 unit tests pass (59 after Task 1 + 2 new in hubs).

- [ ] **Step 9: Build to verify TypeScript**

```bash
npm run build
```
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/plan/types.ts src/plan/hubs.ts src/plan/orchestrator.ts \
        tests/unit/plan/hubs.test.ts tests/unit/plan/orchestrator.test.ts
git commit -m "feat(plan): add hub coordinates and propagate stop coords to train legs"
```

## Context for Task 2

- Task 1 just committed. The `geometry` shape change is in place.
- `HUB_STOP_IDS` is now derived from `HUBS` (via `.map((h) => h.stopId)`). Existing callers (`isHub`, etc.) work unchanged.
- The 13 hub coords from step 1 must be the live values from PTV. Do not invent coordinates.
- For K=2 itineraries, both train legs share the hub coord (it's the same physical station). The orchestrator computes it once per tuple and reuses.
- Commit to `main`. No `--no-verify`.

---

## Task 3: `--html` flag + map module + auto-open

**Files:**
- Create: `src/plan/map.ts`
- Create: `tests/unit/plan/map.test.ts`
- Modify: `src/commands/plan.ts`
- Modify: `tests/e2e/plan.test.ts`

- [ ] **Step 1: Create `src/plan/map.ts`**

Create the file with this exact content. The HTML template is a single string constant; do not modify it.

```ts
import { writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import type { PlanResult } from './types';

const HTML_TEMPLATE = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>ptv plan</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html,body,#map { height: 100%; margin: 0; }
    .legend { background: white; padding: 6px 10px; font: 12px sans-serif; }
    .legend .bike  { color: #2a7; }
    .legend .train { color: #c33; }
  </style>
</head><body>
  <div id="map"></div>
  <script>
    const data = __INJECT_DATA__;
    const map = L.map('map');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const layers = {};
    const allBounds = [];

    for (const it of data.itineraries) {
      const group = L.featureGroup();
      for (const leg of it.legs) {
        if (leg.mode === 'bike') {
          const coords = leg.geometry && leg.geometry.coordinates
            ? leg.geometry.coordinates.map(c => [c[1], c[0]])
            : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
          const line = L.polyline(coords, { color: '#2a7', weight: 4 });
          let popup = 'bike: ' + leg.km.toFixed(1) + ' km, ' + leg.min.toFixed(0) + ' min';
          if (typeof leg.kmOnPath === 'number') {
            popup += ' (' + leg.kmOnPath.toFixed(1) + ' on paths)';
          }
          line.bindPopup(popup);
          group.addLayer(line);
          coords.forEach(c => allBounds.push(c));
        } else {
          const fromCoord = (typeof leg.fromLat === 'number' && typeof leg.fromLon === 'number')
            ? [leg.fromLat, leg.fromLon] : null;
          const toCoord = (typeof leg.toLat === 'number' && typeof leg.toLon === 'number')
            ? [leg.toLat, leg.toLon] : null;
          if (fromCoord && toCoord) {
            const line = L.polyline([fromCoord, toCoord], { color: '#c33', weight: 4, dashArray: '8,6' });
            line.bindPopup('train: ' + leg.routeName + '<br>'
              + leg.fromStopName + ' → ' + leg.toStopName + '<br>'
              + leg.departUtc + ' → ' + leg.arriveUtc);
            group.addLayer(line);
            L.circleMarker(fromCoord, { radius: 5, color: '#c33', fillOpacity: 1 })
              .bindPopup(leg.fromStopName).addTo(group);
            L.circleMarker(toCoord, { radius: 5, color: '#c33', fillOpacity: 1 })
              .bindPopup(leg.toStopName).addTo(group);
            allBounds.push(fromCoord);
            allBounds.push(toCoord);
          }
        }
      }
      L.marker([data.query.from.lat, data.query.from.lon])
        .bindPopup('Origin').addTo(group);
      L.marker([data.query.to.lat, data.query.to.lon])
        .bindPopup('Destination').addTo(group);

      const label = it.labels.join(', ') || 'unlabeled';
      layers[label + ' — ' + it.totalTimeMin.toFixed(0) + ' min'] = group;
    }

    const recommendedKey = Object.keys(layers).find(k => k.includes('recommended'));
    if (recommendedKey) {
      layers[recommendedKey].addTo(map);
    } else if (Object.keys(layers).length > 0) {
      layers[Object.keys(layers)[0]].addTo(map);
    }

    L.control.layers(null, layers, { collapsed: false }).addTo(map);

    if (allBounds.length > 0) {
      map.fitBounds(allBounds);
    } else {
      map.setView([data.query.from.lat, data.query.from.lon], 11);
    }

    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = '<b>Legend</b><br>'
        + '<span class="bike">━━</span> bike<br>'
        + '<span class="train">┄┄</span> train<br>';
      return div;
    };
    legend.addTo(map);
  </script>
</body></html>`;

export function writeMapHtml(path: string, result: PlanResult): void {
  const fullPath = resolve(path);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    throw new Error(`cannot write to ${path}: directory does not exist`);
  }
  const labeled = result.itineraries.filter((i) => i.labels.length > 0);
  labeled.sort((a, b) => a.totalTimeMin - b.totalTimeMin);
  const data = { query: result.query, itineraries: labeled };
  const html = HTML_TEMPLATE.replace('__INJECT_DATA__', JSON.stringify(data));
  writeFileSync(fullPath, html, 'utf8');
  try {
    spawnSync('open', [fullPath], { stdio: 'ignore' });
  } catch {
    // non-macOS or open command unavailable — silently skip
  }
}
```

- [ ] **Step 2: Create `tests/unit/plan/map.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { writeMapHtml } from '../../../src/plan/map';
import { readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PlanResult } from '../../../src/plan/types';

function fakeResult(): PlanResult {
  return {
    query: {
      from: { lat: -37.78, lon: 144.96 },
      to:   { lat: -37.65, lon: 144.95 },
      minBikeKm: 0, maxBikeKm: 10, maxTransfers: 1,
      enrich: false, preferBikePath: false,
    },
    itineraries: [
      {
        labels: ['recommended', 'fastest'],
        totalTimeMin: 60,
        bikeKm: 4, bikeMin: 15,
        trainKm: 10, trainMin: 20, waitMin: 5,
        transfers: 0,
        legs: [
          {
            mode: 'bike',
            from: { lat: -37.78, lon: 144.96 },
            to:   { lat: -37.77, lon: 144.96 },
            km: 2, min: 8,
            geometry: {
              type: 'LineString',
              coordinates: [[144.96, -37.78], [144.96, -37.77]],
            },
          },
          {
            mode: 'train',
            routeId: 6, routeType: 0, routeName: 'Frankston',
            fromStopId: 1071, toStopId: 1077,
            fromStopName: 'A', toStopName: 'B',
            fromLat: -37.77, fromLon: 144.96,
            toLat: -37.65, toLon: 144.95,
            departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
            runRef: 'R1',
          },
          {
            mode: 'bike',
            from: { lat: -37.65, lon: 144.95 },
            to:   { lat: -37.65, lon: 144.95 },
            km: 0, min: 0,
            geometry: null,
          },
        ],
      },
    ],
  };
}

describe('writeMapHtml()', () => {
  it('writes a file containing injected JSON and Leaflet markup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptv-map-'));
    const path = join(dir, 'trip.html');
    writeMapHtml(path, fakeResult());
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('leaflet@1.9.4');
    expect(contents).toContain('recommended');
    expect(contents).toContain('Frankston');
    expect(contents).toContain('"lat":-37.78');
    unlinkSync(path);
  });

  it('throws when target directory does not exist', () => {
    const path = '/nonexistent-directory-aaa/trip.html';
    expect(() => writeMapHtml(path, fakeResult())).toThrow(/directory does not exist/);
  });

  it('handles empty itineraries without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptv-map-'));
    const path = join(dir, 'empty.html');
    writeMapHtml(path, {
      query: fakeResult().query,
      itineraries: [],
    });
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('leaflet@1.9.4');
    unlinkSync(path);
  });
});
```

- [ ] **Step 3: Run; verify FAIL**

```bash
npx vitest run tests/unit/plan/map.test.ts
```
Expected: FAIL with "Failed to resolve import" or similar — `src/plan/map.ts` doesn't exist yet (you just created it in Step 1, so this should actually PASS the import; the tests should run). If tests pass on first run that's fine since you wrote the implementation before the tests above.

Actually — since step 1 created the file before step 2 wrote tests, this is a "tests passing on first run" case. Verify:

```bash
npx vitest run tests/unit/plan/map.test.ts
```
Expected: 3 tests pass.

If a test fails (e.g. the file content doesn't contain expected strings), debug the template before proceeding.

- [ ] **Step 4: Wire `--html` into `src/commands/plan.ts`**

Edit `src/commands/plan.ts`. Find the option block (around lines 40-47). Add `--html` as the LAST option, after `--prefer-bike-path` and before `--raw`:

```ts
    .option('--prefer-bike-path', 'Recommend itineraries with more bike-path km')
    .option('--html <path>', 'Write a Leaflet HTML map to <path> and open it')
    .option('--raw', 'Reserved; no-op in v1')
```

Then locate the `.action(...)` callback's body. Currently the last line before the closing `});` is:

```ts
      const result = await plan(req);
      console.log(JSON.stringify(result, null, 2));
    });
```

Replace with:

```ts
      const result = await plan(req);
      console.log(JSON.stringify(result, null, 2));
      if (opts.html) {
        const { writeMapHtml } = await import('../plan/map');
        writeMapHtml(opts.html, result);
      }
    });
```

The dynamic import keeps the map module out of the load path when `--html` isn't used.

- [ ] **Step 5: Add an e2e test**

Edit `tests/e2e/plan.test.ts`. Add this test inside the existing `describe.skipIf(SKIP)('e2e: plan command', ...)` block (before its closing `});`):

```ts
  it('--html writes a file containing Leaflet markup', () => {
    const tmpDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ptv-e2e-'));
    const htmlPath = require('path').join(tmpDir, 'trip.html');
    const { code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--max-bike-km', '8', '--no-enrich', '--html', htmlPath,
    ]);
    expect(code).toBe(0);
    const contents = require('fs').readFileSync(htmlPath, 'utf8');
    expect(contents).toContain('leaflet@1.9.4');
    expect(contents).toContain('data');
    require('fs').unlinkSync(htmlPath);
  }, 60_000);
```

The 60-second timeout matches the other live-API e2e tests.

- [ ] **Step 6: Build and run tests**

```bash
npm run build
```
Expected: exit 0.

```bash
npm run test:unit
```
Expected: 64 unit tests pass (61 after Task 2 + 3 new map tests).

```bash
npm run test:e2e
```
Expected: 13 e2e tests pass (12 v1.3 + 1 new). The `open` command may fail silently on non-macOS — the test only checks exit 0 and file contents.

- [ ] **Step 7: Smoke-test the map output**

```bash
node dist/index.js plan -37.7656,144.9614 -37.648,144.946 \
  --max-bike-km 8 --no-enrich --html /tmp/ptv-smoke-map.html
```

This should print JSON to stdout, write `/tmp/ptv-smoke-map.html`, and run `open` on it (macOS will open the system default browser).

Verify by:
- File exists: `ls -la /tmp/ptv-smoke-map.html`
- HTML contains Leaflet: `grep -c leaflet@1.9.4 /tmp/ptv-smoke-map.html` (expect >= 1)
- Map renders: visually confirm in the browser that polylines and markers appear

If the map renders correctly with the bike polylines following actual roads (not straight lines), the geometry fix from Task 1 is confirmed working end-to-end.

- [ ] **Step 8: Commit**

```bash
git add src/plan/map.ts src/commands/plan.ts tests/unit/plan/map.test.ts tests/e2e/plan.test.ts
git commit -m "feat(plan): add --html flag with Leaflet map output and auto-open"
```

## Context for Task 3

- Tasks 1-2 committed. Do not modify their files.
- The HTML template is a constant string with `__INJECT_DATA__` as a single placeholder. The JSON-stringified data is substituted at write time. Do not template-escape — the data is trusted (it came from this codebase).
- The Leaflet CDN URLs (`unpkg.com/leaflet@1.9.4`) are pinned; if a future version changes the API, update the version and the markup as a separate commit.
- `process.stderr.write` and other non-stdout output from `plan(req)` (the candidates truncation warning) still goes to the terminal as expected.
- Commit to `main`. No `--no-verify`.

---

## Self-Review

**Spec coverage check:**

- Item 1 (bike-leg geometry fix): Task 1 covers types change, external.ts fix, orchestrator type flow, unit tests ✓
- Item 2 (HTML map output): Task 3 covers map module, CLI flag, auto-open, unit + e2e tests ✓
- Hub coords + TrainLeg coord fields (required for map rendering of train legs): Task 2 ✓
- Schema change `geometry: string` → `geometry: GeoJsonLineString | null`: Task 1 step 1 ✓
- `--overview full --geometries geojson` args: Task 1 step 4 ✓
- Train-leg straight line between stops: Task 2 step 6 (TrainLeg gets fromLat/fromLon/toLat/toLon); Task 3 step 1 (template draws polyline between them) ✓
- Auto-open via `spawnSync('open', ...)`: Task 3 step 1 ✓
- Itinerary selection (labeled only, max 5): Task 3 step 1 (`writeMapHtml` filters by `labels.length > 0`) ✓
- Empty-itineraries handling: Task 3 step 2 (test asserts no throw) ✓

**Placeholder scan:** Step 3 in Task 2 has `<FILL_IN>` placeholders that the implementer MUST replace with values from step 1's PTV fetch. This is explicitly called out as a required action, not a "TODO." The plan's instructions are clear: replace each placeholder; the build will fail if any remain. Acceptable as a structured fill-in step.

**Type consistency:**
- `GeoJsonLineString` defined in types.ts (Task 1 step 1), imported by external.ts (Task 1 step 4), imported by orchestrator.ts (Task 1 step 5), used implicitly in BikeLeg through `geometry?: GeoJsonLineString | null`.
- `TrainLeg.fromLat/fromLon/toLat/toLon` added in types.ts (Task 2 step 2), populated in orchestrator.ts (Task 2 step 6), consumed in map.ts (Task 3 step 1).
- `hubCoord` exported from hubs.ts (Task 2 step 3), imported by orchestrator.ts (Task 2 step 6), exposed for unit tests (Task 2 step 4).
- `writeMapHtml` exported from map.ts (Task 3 step 1), dynamically imported by plan.ts (Task 3 step 4), tested in map.test.ts (Task 3 step 2).

No type drift, no missing dependencies.

---

## Out of Scope (deferred to v1.5 / v2)

- Full train pattern polylines (every intermediate stop) — currently train legs render as straight lines
- `--geojson <path>` flag for raw GeoJSON export
- Custom Leaflet tile providers / dark mode / offline tiles
- K=3 transfers
- `--bike-profile bike_quiet | bike_balanced`
- Disruption overlays on the map
