# PTV `plan` v1.2 — Multi-Transfer Support Spec

## Purpose

Generalize `plan` from K=1 (single train segment) to K≤2 (up to one transfer) via a hub-based fallback. When the v1.1 K=1 search produces no feasible itinerary, retry using a curated list of Melbourne transfer hubs to find a two-train route. Also fix the candidate-set top-N capping that v1.1's pagination exposed.

This builds directly on v1.1 (commits `ffdf6c2..93a609c`). The existing K=1 codepath is unchanged for queries where it already returns feasible itineraries — there is no overhead added to the common case.

K=3 (two transfers — e.g. V/Line → metro → metro chains) is explicitly deferred to v1.3.

---

## User-facing surface

```
ptv plan <from> <to>
  [--depart <iso|HH:MM> | --arrive-by <iso|HH:MM>]
  [--min-bike-km <n>] [--max-bike-km <n>]
  [--max-transfers <n>]        # default 1; v1.2 supports 0 or 1
  [--no-enrich] [--raw]
```

Behaviour by `--max-transfers` value:

| value | behaviour |
|---|---|
| `0` | K=1 only (v1.1 behaviour). No hub fallback. |
| `1` (default) | K=1 first; if no feasible itinerary, fall back to hub-based K=2. |
| `≥2` | Rejected with "not yet implemented in v1.2" error (deferred). |

The default `--max-transfers` changes from `0` (v1.1 hardcoded) to `1`. Users who want only direct trains pass `--max-transfers 0` explicitly.

---

## Architecture

Three local changes; no new top-level modules:

```
src/plan/
  hubs.ts             # NEW: HUB_STOP_IDS constant + getHubStops()
  candidates.ts       # ADD: top-N cap after filter
  orchestrator.ts     # ADD: planK2Hubs() helper + dispatch logic
```

The `hubs.ts` module is intentionally minimal — a constant `HUB_STOP_IDS: number[]` and a helper `isHub(stopId): boolean`. No PTV lookup at module load; the constant is the source of truth.

The orchestrator gains a new helper `planK2Hubs(req, deps)` that runs the K=2 hub-based search, and the top-level `plan(req)` dispatches between K=1 and K=2 based on the K=1 result. The K=2 helper reuses the same `accessCandidates`, `departuresFrom`, `runPattern`, and `labelAndSort` building blocks — no algorithmic primitives are introduced.

---

## Hub list

Hardcoded in `src/plan/hubs.ts`. Thirteen Melbourne stations chosen because:
- City Loop stations: every metro line passes through at least one of them
- Suburban junctions: cover line-branching transfers (Caulfield, Clifton Hill, South Yarra)
- V/Line interchange: Sunshine, Footscray, Southern Cross
- Outer terminus junctions: Dandenong

The spec mandates the **station names** below. The implementer fetches the correct numeric `stop_id` values via `node dist/index.js search <name>` against the live PTV API during the first implementation task and writes them into the constant. Names must match the official PTV `stop_name` exactly.

```
Flinders Street
Southern Cross
Melbourne Central
Parliament
Flagstaff
Richmond
South Yarra
North Melbourne
Footscray
Caulfield
Dandenong
Clifton Hill
Sunshine
```

```ts
// src/plan/hubs.ts (after implementer fetches stop_ids)
export const HUB_STOP_IDS: number[] = [
  /* exactly 13 entries, one per station above */
];

const HUB_SET = new Set(HUB_STOP_IDS);
export function isHub(stopId: number): boolean {
  return HUB_SET.has(stopId);
}
```

`isHub(stopId)` is a single `Set.has()` lookup; the `Set<number>` is built once at module load.

---

## Algorithm

### Dispatch (top-level `plan(req)`)

```
if (req.maxTransfers >= 2) throw new Error('--max-transfers >= 2 not yet implemented in v1.2');
if (req.maxTransfers < 0) throw new Error('--max-transfers must be >= 0');

const k1 = await planK1(req, deps);

if (req.maxTransfers === 0) return k1;
if (hasFeasibleItineraries(k1)) return k1;

// Fall back to K=2 via hubs
const k2 = await planK2Hubs(req, deps);

// Merge: if K=2 produced anything, use it; otherwise return K=1's near-miss
if (k2.itineraries.length > 0) {
  return mergeResults(k1, k2);
}
return k1;
```

`hasFeasibleItineraries(result)` returns true if `result.itineraries` is non-empty AND no itinerary carries `constraintsViolated`.

`mergeResults` unions itineraries from both, re-runs `labelAndSort` to assign labels across the combined set, and concatenates warnings (deduped).

### K=2 hub-based search (`planK2Hubs(req, deps)`)

```
access = accessCandidates(req.from, req.maxBikeKm, BIKEABLE, deps)
egress = accessCandidates(req.to,   req.maxBikeKm, BIKEABLE, deps)
if (access.empty || egress.empty) return empty

egressByStopId = Map(egress, e => e.stopId → e)
hubSet         = new Set(HUB_STOP_IDS)
patternCache   = new Map<runRef, Pattern>()

// Round 1: from each access stop, find departures that reach a hub
hubArrivals: Array<{ hub: PatternStop; viaAccess: AccessCandidate;
                      run1Ref: string; routeId1: number; depart1Utc: string }> = []

for a in access (parallel):
  deps = departuresFrom(a.stopId, a.routeType, seedTime + a.bikeMin, lookahead=60min)
  for dep in deps where a.routeIds.includes(dep.routeId):
    pattern = patternCache.getOrFetch(dep.runRef)
    aIdx = pattern.findIndex(p => p.stopId === a.stopId)
    for i = aIdx+1 to pattern.length-1:
      if hubSet.has(pattern[i].stopId):
        push hubArrivals {hub: pattern[i], viaAccess: a, run1Ref: dep.runRef,
                          routeId1: dep.routeId, depart1Utc: dep.departUtc}

// Round 2: from each hubArrival, find departures that reach an egress stop
tuples: Array<{ access, egress, run1, run2, hubStopId, ...times }> = []
TRANSFER_BUFFER_MIN = 5

for ha in hubArrivals (parallel, deduped by (hubStopId, depart1Utc)):
  notBefore = Date.parse(ha.hub.arriveUtc) + TRANSFER_BUFFER_MIN minutes
  for rt in [0, 3]:
    hubDeps = departuresFrom(ha.hub.stopId, rt, notBefore, lookahead=60min)
    for hubDep in hubDeps:
      hubPattern = patternCache.getOrFetch(hubDep.runRef)
      hIdx = hubPattern.findIndex(p => p.stopId === ha.hub.stopId)
      for j = hIdx+1 to hubPattern.length-1:
        eg = egressByStopId.get(hubPattern[j].stopId)
        if eg:
          push tuples {access: ha.viaAccess, egress: eg,
                       run1: ha.run1Ref, run2: hubDep.runRef,
                       hubStopId: ha.hub.stopId,
                       depart1Utc: ha.depart1Utc, arrive1Utc: ha.hub.arriveUtc,
                       depart2Utc: hubDep.departUtc, arrive2Utc: hubPattern[j].arriveUtc}

// Build itineraries: each tuple becomes one Itinerary with 4 legs
for t in tuples:
  bikeOut = cachedAccessRoute(t.access)
  bikeIn  = cachedEgressRoute(t.egress)
  // legs: [bike, train, train, bike]
  // The transfer is implicit: legs[1].toStopId === legs[2].fromStopId === hubStopId
  totalTime = bikeOut.min
            + waitForRun1
            + (run1 in-vehicle time)
            + dwell-at-hub (≈ TRANSFER_BUFFER_MIN)
            + (run2 in-vehicle time)
            + bikeIn.min
  transfers = 1
  push itinerary

return labelAndSort(itineraries, req)
```

Memoization from v1.1 (`accessRouteCache`, `egressRouteCache`, `accessEnrichCache`, `egressEnrichCache`) carries over and applies identically; the K=2 path reuses the same caches the K=1 path warmed.

To make these caches reachable from `planK2Hubs`, the implementer hoists the cache-helper definitions out of the K=1 block into the top of `plan()`, with the K=1 search and the K=2 search both calling the same `accessBikeRoute` / `egressBikeRoute` / `accessEnrich` / `egressEnrich` closures. Pattern caching (`patternCache: Map<runRef, Pattern>`) is similarly shared between rounds.

After the round-1 expansion, apply the `MAX_HUB_FANOUT` ceiling:

```
if (hubArrivals.length > MAX_HUB_FANOUT) {
  hubArrivals.sort((a, b) => Date.parse(a.hub.arriveUtc) - Date.parse(b.hub.arriveUtc));
  hubArrivals.length = MAX_HUB_FANOUT;
}
```

This is a defensive guard for queries where many access stops share the same hub-bearing lines — without it, a high-frequency corridor (e.g. Werribee → CBD) could expand to hundreds of round-1 hub arrivals before round 2 begins.

### Top-N candidate capping (`candidates.ts`)

After the existing `for` loop that builds the `AccessCandidate[]`, before `return out`:

```ts
const TOP_N_CANDIDATES = 30;
if (out.length > TOP_N_CANDIDATES) {
  out.sort((a, b) => a.bikeMin - b.bikeMin);
  out.length = TOP_N_CANDIDATES;
}
return out;
```

Sort by `bikeMin` ascending (closest stops first) and truncate. This prevents the 200-candidate blowup that v1.1's `max_results: 200` enables in dense areas. The cap is per-end (access or egress), so the maximum tuple count is 30 × 30 = 900 in the K=1 case, and 30 × |hubs| × 30 ≈ 12,000 *before pruning* in the K=2 case. Pruning via `Promise.all` deduplication and `patternCache` keeps actual work bounded.

---

## JSON output

Schema is structurally unchanged. Itineraries can now have 4 legs instead of 3 when `transfers === 1`:

```json
{
  "labels": ["recommended", "fastest"],
  "totalTimeMin": 65,
  "bikeKm": 6.4, "bikeMin": 22, "bikeKmOnPath": 2.7,
  "trainKm": 28.1, "trainMin": 38,
  "waitMin": 5,
  "transfers": 1,
  "legs": [
    { "mode": "bike", "from": {...}, "to": {...stop A coord...},
      "km": 3.2, "min": 11, "kmOnPath": 1.2, "geometry": "..." },
    { "mode": "train", "routeId": 7, "routeType": 0, "routeName": "Hurstbridge",
      "fromStopId": 1011, "toStopId": 1071, "fromStopName": "Rosanna",
      "toStopName": "Flinders Street",
      "departUtc": "2026-05-17T22:00:00Z",
      "arriveUtc": "2026-05-17T22:25:00Z",
      "runRef": "954-V" },
    { "mode": "train", "routeId": 11, "routeType": 0, "routeName": "Cranbourne",
      "fromStopId": 1071, "toStopId": 1049,
      "fromStopName": "Flinders Street", "toStopName": "Dandenong",
      "departUtc": "2026-05-17T22:32:00Z",
      "arriveUtc": "2026-05-17T23:05:00Z",
      "runRef": "1102-R" },
    { "mode": "bike", "from": {...stop B coord...}, "to": {...},
      "km": 3.2, "min": 11, "kmOnPath": 1.5, "geometry": "..." }
  ]
}
```

The transfer is *implicit*: `legs[1].toStopId === legs[2].fromStopId === <hub stopId>`. Consumers reading `transfers` know to expect 4 legs when `transfers === 1`, 3 when `transfers === 0`.

The `trainKm` and `trainMin` fields aggregate across both train legs. `waitMin` is the initial wait before run 1 (does NOT include the transfer dwell at the hub, which is fixed at `TRANSFER_BUFFER_MIN` and shows up in `totalTimeMin` minus the leg-sum).

`legs[i].mode === 'train'` stays as `'train'`. No new mode is added.

---

## Constants

In `src/plan/types.ts`:

```ts
export const TRANSFER_BUFFER_MIN = 5;    // min time at a hub between trains
export const TOP_N_CANDIDATES = 30;      // candidate-set cap per end
export const MAX_HUB_FANOUT = 50;        // pre-pruning ceiling for round-1 hub arrivals
```

`MAX_HUB_FANOUT` is a defensive ceiling: if more than 50 distinct (hub, depart1Utc) pairs are produced in round 1, sort by earliest arrival and keep the top 50. Protects against `Pattern × Hubs` blow-up in pathological cases.

---

## Tests

### New unit tests

`tests/unit/plan/hubs.test.ts`:
- `isHub` returns true for IDs in `HUB_STOP_IDS`, false otherwise.
- `HUB_STOP_IDS` has at least 10 entries (sanity, not a hard count).

`tests/unit/plan/orchestrator.test.ts` (extend):
- `planK2Hubs returns itineraries with transfers=1 and 4 legs` — fake PTV with two routes via Flinders St; assert one (Rosanna → FSS → Dandenong)-shaped itinerary.
- `K=2 fallback is skipped when K=1 returns feasible itineraries` — fake PTV with both K=1 and K=2 paths; assert only K=1 result is returned.
- `K=2 fallback runs when K=1 returns empty` — fake PTV with no shared K=1 route; assert K=2 result emerges.
- `--max-transfers=0 forces K=1 only even if K=2 would succeed`.
- `--max-transfers>=2 throws "not yet implemented in v1.2"`.

`tests/unit/plan/candidates.test.ts` (extend):
- `accessCandidates caps result at TOP_N_CANDIDATES (30) when more pass filter` — fake PTV returning 50 stops, all within radius; expect 30 returned, sorted by `bikeMin` ascending.

### New integration test

`tests/integration/plan.test.ts` (extend):
- Rosanna (-37.7390, 145.0682) → Dandenong (-37.9871, 145.2113). Single-train route does not exist; assert at least one K=2 itinerary with `transfers === 1` and `legs.length === 4`, with the hub stop being one of the 13 hubs.

### Updated e2e test

`tests/e2e/plan.test.ts`:
- Add a case spawning `ptv plan -37.7390,145.0682 -37.9871,145.2113 --no-enrich`. Assert exit 0 and JSON contains an itinerary with `transfers === 1`.

### Regression

All existing v1.1 tests must continue to pass. The default `--max-transfers` change from `0` to `1` means the e2e "`--max-transfers > 0`" rejection test from v1 needs to be updated: it now rejects `--max-transfers 2` instead of `1`.

---

## Commit order

1. `feat(plan): add transfer-hub constant module` — `hubs.ts` + unit tests
2. `feat(plan): cap candidate set at top 30 by bikeMin` — `candidates.ts` + unit test
3. `feat(plan): hub-based K=2 fallback when K=1 is infeasible` — `orchestrator.ts` + unit tests
4. `feat(plan): bump default --max-transfers to 1` — `commands/plan.ts` + e2e tests update
5. `test(plan): integration test for cross-line K=2 trip` — `tests/integration/plan.test.ts`

Each commit is independently revertable; 1 and 2 add no behavior change to the K=1 path; 3 adds the hub-fallback logic but is no-op when `--max-transfers === 0`; 4 changes the default and updates one e2e assertion.

---

## Behavioural changes (additive vs breaking)

| Change | Type |
|---|---|
| Itineraries may have 4 legs instead of 3 when `transfers === 1` | additive |
| `transfers: 1` may appear in output (was always 0 in v1.1) | additive |
| Candidate set capped at 30 per end (was up to 200 in v1.1) | breaking only for queries that depended on >30 candidates — none in practice |
| Default `--max-transfers` changes from `0` to `1` | behavioural change visible to existing users — most will get *more* itineraries than before, never fewer |

No JSON fields are renamed or removed.

---

## Out of scope (deferred to v1.3 / v2)

- K=3 (two transfers) — needed for rare V/Line ↔ metro ↔ metro chains
- Walking egress (bike-on-train when transferring to a tram/bus at the hub)
- Non-hub transfers (small interchange stations like Westgarth, Ringwood)
- Time-band peak-hour bike restrictions on Metro Trains (none currently enforced; PTV API doesn't expose them)
- `--bike-profile bike_quiet | bike_balanced` flag
- Disruption filtering (`--avoid-disrupted`)
- Configurable hub list (JSON file or CLI flag)
- Pareto front of itineraries with different transfer counts (currently we just `labelAndSort` the union; if K=2 produces faster results than K=1, the labels reflect that correctly, but we don't surface "fastest 0-transfer" vs "fastest 1-transfer" as separate labels)
