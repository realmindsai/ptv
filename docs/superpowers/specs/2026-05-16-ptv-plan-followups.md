# PTV `plan` v1.1 — Follow-up Fix Spec

## Purpose

Address seven correctness, UX, and performance issues found in the final review of v1 (commits `aaa33ba..60ddb88`). Each is a bounded, locally-scoped fix with no algorithmic change. Multi-transfer support (K > 1) is deferred to v1.2 (Spec B, separate document).

This spec follows v1.0 (`2026-05-16-ptv-plan-design.md`, commit `f4959de`) and assumes its module layout, command surface, and JSON schema as the baseline.

---

## Items

### 1. C1 — Fix `ghRouteBike` parser

**Problem:** `src/plan/external.ts:78-111` reads fields `distance_km`, `time_min`, `surface_breakdown` that do not exist in `gh-route --format json`. The real shape is:

```json
[{"profile": "bike",
  "response": {"paths": [{
    "distance": 1738.161,             // metres
    "time": 370557,                   // milliseconds
    "details": {
      "surface": [[from_idx, to_idx, "asphalt"], ...],
      "road_class": [[from_idx, to_idx, "cycleway"], ...]
    }
  }]}}]
```

The function reliably returns `null` in v1, so every plan with `--enrich` (default on) produces a warning and `bikeKmOnPath: null`.

**Fix:** Replace the parser body with one that handles the real shape. Use `details.road_class` (not `details.surface`) for the on-path determination — `road_class: 'cycleway'` is semantically "dedicated bike infrastructure", whereas `surface: 'asphalt'` is ambiguous (both bike paths and roads can be asphalt).

Index-proportional km calculation is acceptable accuracy. The `details.road_class` array entries cover non-overlapping `[from_idx, to_idx)` spans of the path. Sum the index spans where `road_class ∈ {'cycleway', 'path', 'track'}`, divide by total spans, multiply by total distance.

```ts
function parseGhRoute(raw: unknown):
  { km: number; min: number; kmOnPath: number } | null {
  const arr = raw as Array<{ response?: { paths?: Array<{
    distance?: number; time?: number;
    details?: { road_class?: Array<[number, number, string]> };
  }> } }>;
  const p = arr?.[0]?.response?.paths?.[0];
  if (typeof p?.distance !== 'number' || typeof p?.time !== 'number') return null;
  const km = p.distance / 1000;
  const min = p.time / 60_000;
  const segments = p.details?.road_class ?? [];
  if (segments.length === 0) {
    return { km, min, kmOnPath: 0 };
  }
  const PATH_CLASSES = new Set(['cycleway', 'path', 'track']);
  let totalIdx = 0;
  let pathIdx = 0;
  for (const [from, to, cls] of segments) {
    const span = to - from;
    totalIdx += span;
    if (PATH_CLASSES.has(cls)) pathIdx += span;
  }
  const kmOnPath = totalIdx > 0 ? km * (pathIdx / totalIdx) : 0;
  return { km, min, kmOnPath };
}
```

Existing graceful-null behaviour on subprocess failure (`try/catch`) is preserved.

### 2. I1 — Scope the argv preprocessor and reject negative numeric options

**Problem:** `src/argv.ts` rewrites argv tokens matching `/^-\d[\d.]*,\d/` to a `__NEG__` sentinel so commander 14 doesn't treat negative lat,lon pairs as flags. The regex requires a comma, so `--min-bike-km -5` falls through to commander unchanged and is treated as `--min-bike-km` followed by an unknown flag `-5`.

**Fix:** Two changes.

(a) Update the comment block in `src/argv.ts` to scope the workaround explicitly: the preprocessor handles negative coordinate-shaped tokens only; it does not handle negative numeric option values.

(b) In `src/commands/plan.ts`, after parsing options, validate that all numeric inputs are non-negative:

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

### 3. I2 — Correct `totalTimeMin` for `--arrive-by`

**Problem:** `src/plan/orchestrator.ts:102-103` computes:

```
waitMin = max(0, (departUtc - seedTime)/60_000 - bikeOut.min)
totalTimeMin = bikeMin + waitMin + trainMin
```

When `--arrive-by` is set, `seedTime = arriveByUtc - 180min`. The wait calculation then treats `seedTime` as the user's *actual start time*, inflating `waitMin` (and therefore `totalTimeMin`) by the unused portion of the 180-minute search horizon. This breaks the `fastest` and `recommended` label assignments and presents nonsense times to the user.

**Fix:** When `req.arriveByUtc` is set, the user departs "just in time":

```ts
const isArriveBy = !!req.arriveByUtc;
const trainMin = (Date.parse(t.arriveUtc) - Date.parse(t.departUtc)) / 60_000;
const waitMin = isArriveBy
  ? 0
  : Math.max(0, (Date.parse(t.departUtc) - seedTime.getTime()) / 60_000 - bikeOut.min);
const totalTimeMin = bikeMin + waitMin + trainMin;
```

The semantic is: for depart-now queries, total time includes any platform wait; for arrive-by queries, total time is the minimum trip duration the user would experience (they choose their own departure).

### 4. I4 — Memoize bike legs by stop id

**Problem:** `src/plan/orchestrator.ts:93-99` calls `osrmRoute('bicycle', req.from, t.access.coord)` and `osrmRoute('bicycle', t.egress.coord, req.to)` inside a `for (const t of tuples)` loop. With ~20 access × ~20 egress stops generating up to ~400 tuples sharing only ~40 distinct stop coords, this performs hundreds of redundant `spawnSync` calls. The integration test runs at 78 s; the e2e suite at 108 s.

**Fix:** Two `Map<number, Promise<RouteResult>>` caches keyed by `access.stopId` and `egress.stopId`:

```ts
const accessRouteCache = new Map<number, Promise<RouteResult>>();
const egressRouteCache = new Map<number, Promise<RouteResult>>();

function cachedAccessRoute(a: AccessCandidate): Promise<RouteResult> {
  let p = accessRouteCache.get(a.stopId);
  if (!p) {
    p = resolved.external.osrmRoute('bicycle', req.from, a.coord);
    accessRouteCache.set(a.stopId, p);
  }
  return p;
}
// likewise for cachedEgressRoute
```

Same pattern for the `ghRouteBike` enrichment calls when `req.enrich` is on (two more caches, keyed identically).

The `Promise` is cached (not the awaited value) so concurrent tuples awaiting the same stop share a single in-flight call. Net effect: ≤40 osrm subprocess calls instead of ≤800.

### 5. I5 — Populate `routeName` from PTV `Route` expand

**Problem:** `src/plan/orchestrator.ts:125` emits `routeName: ''` because `departuresFrom` doesn't request route metadata. The spec example shows `"routeName": "Frankston"`.

**Fix:**

(a) `src/plan/transit.ts:departuresFrom` — add `'Route'` to the `expand` array passed to PTV:

```ts
expand: ['Run', 'Stop', 'Route'],
```

The response then includes a `routes` map keyed by route_id, with `route_name` etc. Update the `DepartureWithPattern` type to carry a `routeName: string` field and populate it from `raw.routes?.[d.route_id]?.route_name ?? ''`.

(b) `src/plan/orchestrator.ts` — set `routeName: t.routeName` (passed through from the matched departure) on the TrainLeg.

### 6. M3 — Parse `HH:MM` as Melbourne local time

**Problem:** `src/commands/plan.ts:23-29` interprets `--depart 08:00` as today UTC. The user is in Melbourne (AEST = UTC+10, AEDT = UTC+11 during DST). An 08:00 local input becomes either 18:00 (AEST) or 19:00 (AEDT) Melbourne — completely wrong for the search seed.

**Fix:** Construct the Date from a Melbourne local-time interpretation. Use `Intl.DateTimeFormat` to resolve the current Melbourne offset (handles DST automatically), then construct the UTC equivalent:

```ts
function parseHHMM(s: string): Date {
  const [h, m] = s.split(':').map(Number);
  const now = new Date();
  // Build a Date representing today HH:MM in Australia/Melbourne, then
  // express in UTC for the rest of the pipeline.
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  // Build an ISO-like string in Melbourne local form:
  const local = `${parts.year}-${parts.month}-${parts.day}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
  // Find Melbourne's offset for that local moment via a probe Date:
  const probe = new Date(`${local}+10:00`); // assume AEST first
  const tz = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', timeZoneName: 'short',
  }).format(probe);
  const offsetHours = tz.includes('AEDT') ? 11 : 10;
  const offsetStr = `+${String(offsetHours).padStart(2,'0')}:00`;
  return new Date(`${local}${offsetStr}`);
}
```

Note: this is a known-tricky DST-handling pattern. The 2-step (probe with AEST, ask Intl, finalize) handles the dual-offset case correctly for nearly all dates except the ambiguous hour at DST transition — acceptable for a CLI that's normally given times hours away from 02:00 anyway. Document the edge case in a comment.

ISO 8601 inputs (anything not matching `/^\d{2}:\d{2}$/`) continue to be parsed by `new Date(s)` and are timezone-explicit.

### 7. Pagination — bump `max_results` on `/stops/location`

**Problem:** `src/plan/candidates.ts:39` passes `max_distance` to PTV but not `max_results`. PTV defaults `max_results` to 30, so dense areas (e.g. the CBD) lose stops past the 30th, even if all 50+ are within bike radius.

**Fix:** Pass `max_results: 200` on the call. If the response stops array equals 200 exactly, log a warning (`'candidate stops truncated at max_results=200 — radius may need narrowing'`) — practical Melbourne queries should never hit this.

200 is chosen as a soft ceiling: it's well above any realistic count of bikeable train stops in a 20 km radius (Melbourne metro has ~218 total train stations; 20 km from the GPO covers most of them).

---

## JSON output changes (additive)

- `legs[*].mode === 'train'`: `routeName` is now populated (was always `""`).
- `itineraries[*].bikeKmOnPath`: now populated as a number when `--enrich` is on (was always `null` in v1).
- `warnings`: may include `"candidate stops truncated..."` in dense-area queries (new).
- Behaviour change for `--arrive-by`: `totalTimeMin` and `waitMin` are now the actual minimum trip duration (was inflated by up to 180 min in v1).

No fields are removed or renamed. Existing consumers expecting `routeName: ''` or `bikeKmOnPath: null` continue to function but get more useful data.

---

## Testing

### New unit tests

- `tests/unit/plan/external.test.ts` (new file):
  - `parseGhRoute` returns null on missing fields.
  - `parseGhRoute` correctly computes `km`, `min`, `kmOnPath` from a fixture matching the real gh-route shape.
  - On-path classification uses `road_class`, not `surface`.

- `tests/unit/plan/orchestrator.test.ts` (extend):
  - `--arrive-by` test: assert `waitMin === 0` and `totalTimeMin === bikeMin + trainMin`.
  - Memoization test: assert `osrmRoute` is called at most once per distinct stop id across multiple itineraries (use a vi.fn() spy with a counter).

- `tests/unit/plan/score.test.ts` is unchanged.

### New / updated integration tests

- `tests/integration/plan.test.ts`:
  - Extend the happy-path query to assert `legs[1].routeName` is a non-empty string (it should be the Upfield line for the Brunswick → Upfield test).
  - Add an enrichment-enabled case: `enrich: true`, assert `bikeKmOnPath` is a number > 0 when gh-route is reachable.

### Updated e2e tests

- `tests/e2e/plan.test.ts`:
  - Add a case that passes `--depart 08:00` and asserts the search seed is interpreted as Melbourne local (cannot assert UTC value precisely — instead, assert that the resulting itinerary's `legs[1].departUtc` is within a sensible range of Melbourne 08:00 ± a few hours, OR snapshot the timezone-aware date parsing).

### Fixtures

- `tests/fixtures/plan/gh_route_bike.json` (new): captured live output of `gh-route route --point=-37.78,144.96 --point=-37.77,144.96 --profile bike --format json`.

### Regression check

After each commit, run `npm test`. The full suite (47 tests in v1) must remain green; new tests bring the count to ~56.

---

## Commit order

Seven small commits, each independently revertable:

1. `feat(plan): parse real gh-route JSON shape using road_class` (C1)
2. `fix(plan): reject negative numeric options; scope argv preprocessor comment` (I1)
3. `fix(plan): correct totalTimeMin and waitMin for --arrive-by` (I2)
4. `perf(plan): memoize osrm route calls by stop id` (I4)
5. `feat(plan): populate routeName on TrainLeg via PTV Route expand` (I5)
6. `fix(plan): parse --depart HH:MM as Melbourne local time` (M3)
7. `feat(plan): bump stops/location max_results to 200 with truncation warning` (pagination)

Order is chosen so that each commit's tests can run without depending on a later commit's changes. C1 first because its test infrastructure (live fixture capture) gates several others' debugging. Pagination last because it affects integration-test candidate counts.

---

## Out of scope (deferred to Spec B / v1.2)

- Multi-transfer (K > 1) support
- CBD-hub stops as transfer candidates
- Bike-on-train route_type filtering changes
- `--bike-profile bike_quiet | bike_balanced` flag
- Disruption filtering
- `--raw` for plan command
- gh-route exact (haversine) `kmOnPath` calculation (current index-proportional is good enough for v1.1)
