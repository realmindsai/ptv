# PTV `plan` Command — Design Spec

## Purpose

A new subcommand `ptv plan <from> <to>` that returns multi-modal trip itineraries combining cycling (via `osrm-au` and `gh-route`) with Melbourne metropolitan train and V/Line services (via the existing PTV client). The user always travels with their bicycle: every leg is either `bike` or `train`. Itineraries are returned as JSON, labeled by which criterion they win.

This is the 9th subcommand in the existing CLI. The 8 existing commands and the `client.ts`/`trim.ts` infrastructure are unchanged.

---

## User-facing surface

```
ptv plan <from-lat,lon> <to-lat,lon>
  [--depart <iso> | --arrive-by <iso>]   # default: depart now; mutually exclusive
  [--min-bike-km <n>]                    # default 0
  [--max-bike-km <n>]                    # default 20
  [--max-transfers <n>]                  # default 0 in v1 (K=1 hardcoded)
  [--no-enrich]                          # skip gh-route enrichment of bike_km_on_path
  [--raw]                                # honored, mostly a no-op in v1
```

Coordinates use `lat,lon` order — matches `gh-route` and `osrm-au` (the latter accepts `lat,lon` on its CLI surface, matching "human/Google Maps order"). No internal coordinate conversion is needed at the CLI boundary.

Constraint scope (resolved during brainstorming):

- `--min-bike-km` and `--max-bike-km` apply to the **total** bike distance across all legs, not per-leg.
- v1 hardcodes `K=1` (one train segment, two bike legs). `--max-transfers` is parsed and validated but rejected with a "not yet implemented" error if > 0.

Bikeable route_types: `0` (Metro Train) and `3` (V/Line). All other route_types are excluded from candidate routes — bike-on-tram and bike-on-bus are disallowed by PTV's rules, and the user confirmed both bikeable types are unconditionally OK.

---

## Architecture

**Approach:** Inline orchestrator with focused helpers — six small modules under `src/plan/`, plus one new file in `src/commands/`. Mirrors the existing `commands/` + `client.ts` + `trim.ts` pattern.

```
src/
  commands/
    plan.ts                # commander wiring + handler (≤80 LOC)
  plan/
    types.ts               # PlanRequest, Itinerary, Leg, PlanResult
    orchestrator.ts        # the 9-step pipeline; the only public entry
    candidates.ts          # access-set / egress-set construction
    transit.ts             # PTV /departures → (run, pattern) edges
    score.ts               # Pareto + label assignment + near-miss
    external.ts            # shell-out to osrm-au and gh-route binaries
```

Each module ≤200 LOC. `orchestrator.ts` is the only file that ties them together. `client.ts` and `trim.ts` are unused additions — `plan` calls `ptv()` from `client.ts` directly, but does not pass results through `trim.ts` (the plan response is already trimmed-by-design).

Alternative approaches considered:

- **Library-first** (export `plan(req)` as a public function with CLI as a 20-line shim) — rejected as YAGNI. Easy to refactor later if a programmatic consumer materializes.
- **Heavy shell-out** (spawn `ptv departures` etc. as child processes from the orchestrator) — rejected. Spawning ~15 PTV child processes per query adds 200-500 ms of pure process overhead and complicates testing. The in-process `Promise.all` over `client.ts` is faster and simpler.

---

## Data flow

For `ptv plan <from> <to> --depart <t> [--min-bike-km m] [--max-bike-km M]`:

1. **Parse**
   - Validate `lat,lon` coords.
   - Resolve `--depart` vs `--arrive-by`. For `--arrive-by`, set the search seed to `arriveByUtc - MAX_PLAUSIBLE_TOTAL_MIN`, where `MAX_PLAUSIBLE_TOTAL_MIN = 180` is an internal constant for v1 (not a flag). After step 7, drop itineraries whose `arriveUtc > arriveByUtc`.
   - Reject if both `--depart` and `--arrive-by` are set, or if `min-bike-km > max-bike-km`.

2. **Access candidates** (PTV + osrm-au)
   - `ptv /v3/stops/location/{lat,lon}?max_distance=<maxBikeKm·1000>&route_types=0,3`
   - One `osrm-au table` call: `profile=bicycle`, `sources=0`, `destinations=1..N`, `annotations=duration,distance` → duration *and* distance vectors. (OSRM's Table API supports both annotations in a single call; `osrm-au describe` lists "pairwise distances/durations matrix" as the core output.)
   - Filter to stops where `bike_km ≤ maxBikeKm` (using the distance vector directly — no per-stop `/route` needed at this stage).
   - Keep top ~20 by a union of two rankings: shortest bike time *and* largest bike_km (the latter preserves the `--min-bike-km` candidates).

3. **Egress candidates** (PTV + osrm-au)
   Same as step 2 with origin = `to`. Profile is also `bicycle` (the user has their bike at the destination — bike-on-train applies on both ends).

4. **Join by route** (PTV)
   For each `(access_stop, egress_stop)` pair sharing at least one route_id in the same direction:
   - `ptv /v3/departures/route_type/{rt}/stop/{access_stop}?date_utc=<seed>&expand=run,stop_pattern&max_results=10`
   - Filter departures whose `estimated_departure_utc ?? scheduled_departure_utc` is `≥ now + access.bike_min`.
   - For each surviving departure, look up egress arrival from the `stop_pattern`. Drop if the run does not serve the egress stop after the departure stop.
   - Batched with `Promise.all`; cache repeats by `access_stop`.

5. **Assemble itineraries**
   For each `(access, departure, egress)` triple, construct:
   ```
   { totalTimeMin, bikeKm, bikeMin, trainKm, trainMin, waitMin,
     transfers: 0, legs: [bike, train, bike] }
   ```
   `trainKm` is computed as the haversine distance between the boarding and alighting stop coordinates. This is a straight-line approximation, not the actual track distance — the PTV API doesn't expose route geometry. The field is informational; it does not feed into scoring or constraint checks.

6. **Enrich** (gh-route, optional)
   For surviving itineraries, parallel calls to `gh-route route --profile bike` on each bike leg to populate `bikeKmOnPath`. On gh-route failure, leave `null` and add a top-level warning. Skipped entirely when `--no-enrich` is set.

7. **Score and label**
   - Sort by `totalTimeMin` ascending.
   - Assign label tags:
     - `fastest` → min `totalTimeMin`
     - `most-bike` → max `bikeKm` among itineraries satisfying `minBikeKm`
     - `fewest-transfers` → min `transfers` (always 0 in v1)
     - `recommended` → min generalized cost (= `totalTimeMin + transferPenaltyMin · transfers`; transfer penalty is 0 in v1 since `K=1`, so `recommended = fastest`)
   - Dedupe identical itineraries; merge their label arrays.
   - For `--arrive-by`: also drop itineraries arriving after the deadline.

8. **Infeasibility handling**
   If no itinerary satisfies `min_bike_km`/`max_bike_km`:
   - Return the single closest-by-cost infeasible itinerary.
   - Tag it with `constraintsViolated: ["min_bike_km"]` (or similar).
   - Add a top-level `warnings` entry describing the miss.
   - Exit 0. Callers parse `warnings` or `constraintsViolated` to detect.

9. **Emit JSON** to stdout.

**Typical external-call count per query:**
- PTV: 2 (stops/location) + 5-15 (departures) ≈ 15
- osrm-au: 2 (table) + up to 6 (route, for geometry on returned itineraries)
- gh-route: 0-6 (one per bike leg per kept itinerary)

≈ 25 calls, fully parallelizable, expected wall time < 2 s.

---

## Module contracts

```ts
// src/plan/types.ts
export type LatLon = { lat: number; lon: number };

export type PlanRequest = {
  from: LatLon;
  to: LatLon;
  departUtc?: Date;
  arriveByUtc?: Date;
  minBikeKm: number;
  maxBikeKm: number;
  maxTransfers: number;
  enrich: boolean;
};

export type Leg =
  | { mode: 'bike'; from: LatLon; to: LatLon; km: number; min: number;
      kmOnPath?: number | null; geometry?: string }
  | { mode: 'train'; routeId: number; routeType: 0 | 3; routeName: string;
      fromStopId: number; toStopId: number;
      fromStopName: string; toStopName: string;
      departUtc: string; arriveUtc: string; runRef: string };

export type ItineraryLabel = 'recommended' | 'fastest' | 'most-bike' | 'fewest-transfers';

export type Itinerary = {
  labels: ItineraryLabel[];
  totalTimeMin: number;
  bikeKm: number; bikeMin: number; bikeKmOnPath?: number | null;
  trainKm: number; trainMin: number;
  waitMin: number; transfers: number;
  legs: Leg[];
  constraintsViolated?: ('min_bike_km' | 'max_bike_km' | 'max_transfers')[];
};

export type PlanResult = {
  query: PlanRequest;
  itineraries: Itinerary[];
  warnings?: string[];
};

// src/plan/candidates.ts
export async function accessCandidates(
  origin: LatLon, maxKm: number, routeTypes: (0 | 3)[]
): Promise<AccessCandidate[]>;

// src/plan/transit.ts
export async function departuresFrom(
  stopId: number, routeType: 0 | 3, notBefore: Date, lookaheadMin: number
): Promise<DepartureWithPattern[]>;

// src/plan/orchestrator.ts
export async function plan(req: PlanRequest, deps?: Partial<Deps>): Promise<PlanResult>;

// src/plan/score.ts
export function labelAndSort(items: Itinerary[], req: PlanRequest): Itinerary[];

// src/plan/external.ts
export async function osrmTable(
  profile: 'bicycle' | 'foot', source: LatLon, destinations: LatLon[]
): Promise<number[]>;
export async function osrmRoute(
  profile: 'bicycle' | 'foot', from: LatLon, to: LatLon
): Promise<{ km: number; min: number; geometry: string }>;
export async function ghRouteBike(
  from: LatLon, to: LatLon, profile: 'bike' | 'bike_quiet'
): Promise<{ km: number; min: number; kmOnPath: number } | null>;
```

The optional `deps` parameter on `plan()` is the dependency-injection seam for unit tests:

```ts
type Deps = {
  ptv: typeof import('../client').ptv;
  external: typeof import('./external');
};
```

Default `deps` resolves to the real modules. Tests pass fakes that read from fixture JSON. The public CLI surface is unchanged.

---

## Error handling

| Failure | Response |
|---|---|
| `MissingCredentialsError` (no PTV creds) | Re-throw — caught in `index.ts` per existing convention. Exit 1. |
| osrm-au unreachable / non-2xx | Throw `Error('osrm-au unreachable: <detail>')`. Exit 1 — cannot plan without it. |
| gh-route unreachable / non-2xx | Catch in `external.ghRouteBike`, return `null`. Add warning `"gh-route unavailable; bike_km_on_path omitted"`. Plan still succeeds. |
| PTV `/departures` returns no runs for a stop | Drop the access candidate. No warning. |
| All access/egress candidates filtered out | Empty `itineraries` array plus `diagnostics` field. Exit 0. |
| `--depart` and `--arrive-by` both set | Print error to stderr, exit 2. Enforced by commander custom action. |
| Coords fail to parse | stderr + exit 2. |
| `minBikeKm > maxBikeKm` | stderr + exit 2. |
| `--max-transfers > 0` in v1 | stderr `"--max-transfers not yet implemented in v1"`, exit 2. |
| All candidates violate min/max bike constraints | Per the brainstorming answer: return the closest near-miss itinerary, set `constraintsViolated`, add a top-level warning, exit 0. |

`client.ts` is unchanged. `external.ts` is the only place adding new error semantics.

---

## JSON output schema

Full example for a single-train Brunswick → Frankston query:

```json
{
  "query": {
    "from": {"lat": -37.7795, "lon": 144.9633},
    "to": {"lat": -38.1413, "lon": 145.1228},
    "departUtc": "2026-05-16T22:30:00Z",
    "arriveByUtc": null,
    "minBikeKm": 8,
    "maxBikeKm": 15,
    "maxTransfers": 0,
    "enrich": true
  },
  "itineraries": [
    {
      "labels": ["recommended", "fastest", "fewest-transfers"],
      "totalTimeMin": 51,
      "bikeKm": 8.4, "bikeMin": 28, "bikeKmOnPath": 3.1,
      "trainKm": 41.2, "trainMin": 47,
      "waitMin": 6, "transfers": 0,
      "legs": [
        {"mode": "bike",
         "from": {"lat": -37.7795, "lon": 144.9633},
         "to": {"lat": -37.7656, "lon": 144.9614},
         "km": 3.2, "min": 11, "kmOnPath": 1.2,
         "geometry": "<encoded polyline>"},
        {"mode": "train",
         "routeId": 6, "routeType": 0, "routeName": "Frankston",
         "fromStopId": 1071, "toStopId": 1162,
         "fromStopName": "Brunswick", "toStopName": "Frankston",
         "departUtc": "2026-05-16T22:50:00Z",
         "arriveUtc": "2026-05-16T23:37:00Z",
         "runRef": "954-V"},
        {"mode": "bike",
         "from": {"lat": -38.1428, "lon": 145.1221},
         "to": {"lat": -38.1413, "lon": 145.1228},
         "km": 5.2, "min": 17, "kmOnPath": 1.9,
         "geometry": "<encoded polyline>"}
      ]
    },
    {
      "labels": ["most-bike"],
      "totalTimeMin": 71,
      "bikeKm": 14.2, "bikeMin": 47, "bikeKmOnPath": 5.8,
      "trainKm": 28.5, "trainMin": 23,
      "waitMin": 1, "transfers": 0,
      "legs": [/* ... */]
    }
  ],
  "warnings": []
}
```

Infeasibility example (`--min-bike-km 12` but max achievable is 6.2):

```json
{
  "query": {/* ... */},
  "itineraries": [
    {
      "labels": ["fastest", "recommended"],
      "totalTimeMin": 38,
      "bikeKm": 6.2,
      "constraintsViolated": ["min_bike_km"],
      "legs": [/* ... */]
    }
  ],
  "warnings": ["no itinerary met --min-bike-km=12; showing best near-miss (bike_km=6.2)"]
}
```

---

## Testing

Per project convention: unit, integration, e2e — all three required.

**Unit (`tests/unit/plan/*.test.ts`):**
- `candidates.test.ts` — fixed PTV + osrm-au fixtures, assert candidate shape and filter behavior.
- `score.test.ts` — pure function tests: label assignment, dedupe, near-miss selection, sort stability. No I/O.
- `transit.test.ts` — fixed `/departures` JSON, assert edge construction and pattern lookup.

**Integration (`tests/integration/plan.test.ts`):**
- `it.skipIf(!process.env.PTV_DEV_ID)` per existing pattern; also skips if osrm-au is unreachable.
- Two queries: a Brunswick-area → Frankston-area happy path (expect ≥ 1 itinerary, no warnings) and a query that should return only a near-miss (expect `constraintsViolated` present).
- Schema asserted with hand-rolled checks (no new dependency).

**E2e (`tests/e2e/plan.test.ts`):**
- Spawns `node dist/index.js plan ...` and parses stdout JSON.
- Cases: depart-now, `--arrive-by`, `--min-bike-km` infeasibility, `--no-enrich`.
- Asserts exit codes (0, 0, 0, 0).

**Fixtures (`tests/fixtures/plan/`):**
- `stops_brunswick.json`, `departures_brunswick.json`, `osrm_table_access.json`, `osrm_table_egress.json`, `gh_route_bike.json`.
- Captured from live calls once, committed.

**TDD order:**
1. `score.ts` (pure, easy to TDD).
2. `candidates.ts` with fake `external` + `ptv`.
3. `transit.ts` against the captured fixture.
4. `orchestrator.ts` wiring; first the happy path, then near-miss, then `--arrive-by`.
5. `commands/plan.ts` CLI shim once orchestrator is green.
6. Integration test against the live APIs.
7. E2e against the compiled binary.

---

## Out of scope for v1

Deferred to future iterations, listed here so the v1 surface stays small:

- `--max-transfers > 0` (multi-round RAPTOR). The module shapes are designed to accommodate it: `orchestrator.ts` will gain a `for k in 1..K` loop, and the candidate-set type already supports "reached at time T via run R" labels.
- `bike_quiet` / `bike_balanced` profile selection. `external.ghRouteBike` already takes a profile arg.
- Disruption filtering (`--avoid-disrupted`). Easy add via `ptv /v3/disruptions/route/{id}`.
- Walking egress / foot-only legs. The system has no `walk` mode in v1 — bike is mandatory.
- Trams and buses (route_types 1, 2, 4). Hardcoded out of the candidate filter.
- `--raw` returning nested PTV departure JSON.
- Caching of `/stops/location` results across invocations.
