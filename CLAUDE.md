# PTV CLI

Melbourne PTV API CLI — TypeScript/Node, built with `commander`.

This folder is the hub for all routing work. Related routing CLIs live alongside (see [Related tooling](#related-tooling)): `osrm-au` (car/bicycle/foot via OSRM) and `gh-route` (bike profiles via GraphHopper).

## Commands

```
ptv route-types
ptv routes [--type <n>] [--name <term>]
ptv departures <stop-id> <route-type>
ptv stops <search-term>
ptv disruptions
ptv search <term>
ptv nearby <lat> <lon>
ptv stop-details <stop-id> <route-type>
ptv plan <from-lat,lon> <to-lat,lon>
  [--depart <iso|HH:MM> | --arrive-by <iso|HH:MM>]
  [--min-bike-km <n>] [--max-bike-km <n>]
  [--max-transfers <n>]                          # default 1 (allows hub fallback)
  [--mode <bike-only|bike-train>]                # default bike-train
  [--goal <commute|day-ride|max-path>]           # default commute
  [--prefer-bike-path]                           # bias toward higher bikeKmOnPath
  [--hill-weight <n>]                            # signed bias: <0 flat, 0 neutral, >0 hills
  [--min-on-path-fraction <f>]                   # hard filter, f ∈ [0,1]
  [--no-enrich]                                  # skip gh-route bikeKmOnPath enrichment
  [--html <path>]                                # also write a Leaflet map and open it
```

`plan` returns labeled JSON itineraries combining bike + train + bike (or pure bike when `--mode bike-only`). Coords are `lat,lon`. Negative coords work directly: `-37.78,144.96` (handled by argv preprocessor in `src/argv.ts`).

### plan key behaviors

- **`--depart 08:00`** is parsed as Melbourne local time (handles AEST/AEDT). Use ISO8601 with explicit offset to disambiguate during DST transitions.
- **`--max-transfers`** defaults to 1, meaning the planner will fall back to a 2-train route via a known transfer hub (Flinders Street, Southern Cross, etc.; see `src/plan/hubs.ts` for the 13-station list) when no direct route exists. Pass `0` to force direct-only.
- **`--goal day-ride`** switches the bike-routing engine from `osrm-au` to a GraphHopper REST `custom_model` request that prefers cycleways and quiet residential roads over busy roads. Probe results: Lilydale → Hurstbridge with `day-ride` = 52 km / 46 km on dedicated path / 0 km on busy roads, vs `commute` = 31 km / 1.2 km on path / 17 km on busy.
- **`--goal max-path`** is more aggressive than `day-ride`. Uses `distance_influence: 10` and heavier residential penalty, accepting longer routes (often +10-40% distance) to maximize on-path mileage. Probe: Hurstbridge → Darebin at 98% on dedicated cycle paths (vs day-ride's 87%). Use when "best ride" is the goal, not "shortest reasonable."
- **`--mode bike-only`** skips the K=1/K=2 transit search and returns a single bike leg. Use for short same-suburb trips.
- **`--prefer-bike-path` and `--hill-weight`** modify the `recommended` label's cost function additively. `--hill-weight 0` (default) is neutral; `-1` mimics "prefer-flat"; `+1` rewards hilly routes (more ascend, less flat fraction).
- **`--min-on-path-fraction 0.5`** drops itineraries with less than 50% of bike distance on cycleway/path/track. Falls back to a near-miss when all itineraries fail.
- **`--html trip.html`** writes a self-contained Leaflet HTML map (OSM tiles, layer toggles per labeled itinerary) and runs `open <path>` afterward. Bike legs render along actual road geometry; train legs render as straight lines between station coords.
- **`--gpx <path>`** writes a GPX 1.1 file with one `<trk>` per labeled itinerary and `<wpt>` markers at transfer stations. Loads in OsmAnd, Locus, Gaia, Organic Maps, Mapy.cz. Push to phone via Syncthing (recommended), Tailscale Drop, or ad-hoc `python3 -m http.server`. Not a navigable route — for live re-routing use OsmAnd's own offline router.
- **`--raw`** is currently a no-op for `plan` (the JSON output is already trimmed-by-design). Reserved for future use.

## Credentials

Requires two env vars (throw `MissingCredentialsError` if absent):

```
PTV_DEV_ID=<your-dev-id>
PTV_API_KEY=<your-api-key>
```

Register at: https://www.ptv.vic.gov.au/footer/data-and-reporting/datasets/ptv-timetable-api/

Optional environment overrides:
- `OSRM_AU_HOST` — host for LAN OSRM REST services (default `totoro.magpie-inconnu.ts.net`; profiles on ports 5002/bicycle, 5003/foot)
- `OSRM_AU_BICYCLE_URL` — full base URL override for the bicycle profile (e.g. `http://osrm-au-bicycle:5000` inside the `osrm-au_default` docker network)
- `OSRM_AU_FOOT_URL` — full base URL override for the foot profile
- `GH_ROUTE_BIN` — path to the `gh-route` binary (default `../grasshopper-bike-routing/bin/gh-route`)
- `GH_REST_URL` — GraphHopper REST endpoint for `--goal day-ride` custom_model requests (default `http://graphhopper.magpie-inconnu.ts.net:8989/route`)

## Build & Test

```
npm run build          # tsc → dist/
npm test               # all suites (unit + integration + e2e)
npm run test:unit
npm run test:integration
npm run test:e2e
```

E2e tests run against the compiled binary at `dist/index.js`. Build first.

## Architecture

```
src/
  index.ts              # commander root + bin entry
  argv.ts               # argv preprocessor for negative-coord positional args
  client.ts             # ptv() helper: HMAC-SHA1 sign + fetch
  trim.ts               # per-endpoint JSON field projections
  commands/*.ts         # one file per subcommand; factory pattern
  plan/                 # the plan subcommand's logic, decomposed:
    types.ts            # PlanRequest/Itinerary/BikeLeg/TrainLeg + constants
    external.ts         # osrm-au (subprocess) + gh-route (subprocess + REST)
    hubs.ts             # 13 Melbourne transfer hub stop_ids + coords + names
    candidates.ts       # access/egress candidate-stop sets (top close + far)
    transit.ts          # PTV /departures + /pattern wrappers
    score.ts            # labelAndSort: feasibility filter + label assignment + cost
    orchestrator.ts     # plan() entry: dispatch to bike-only / K=1 / K=2 hub fallback
    map.ts              # writeMapHtml: self-contained Leaflet HTML output
```

**Core flows:**

- All 8 trivial subcommands (`route-types`, `routes`, etc.): `commands/*.ts` → `ptv()` → `trim*()` → stdout JSON.
- `plan` (more involved): `commands/plan.ts` → `orchestrator.plan()` which orchestrates `candidates`, `transit`, `external` (osrm-au + gh-route), and `score`, then optionally `map.writeMapHtml`.

**Two bike-routing engines:**
- `osrm-au` subprocess (`external.osrmRoute`) — fast, returns encoded polyline (decoded in `external.decodePolyline`)
- `gh-route` subprocess (`external.ghRouteBike`) — provides path/elevation/slope metrics via `parseGhRoute`
- GraphHopper REST (`external.ghRouteCustom`) — used for `--goal day-ride` with a custom_model body

When `--enrich` is on (default), `ghRouteBike` is called on each bike leg to populate `bikeKmOnPath`, `ascendM`, `descendM`, `maxSustainedGradePercent`, `maxSustainedGradeM`, `flatFraction`, `steepFraction` on the BikeLeg. These also aggregate per Itinerary.

## Adding a new command

1. Create `src/commands/<name>.ts` exporting `<name>Command()` that returns a `Command`.
2. If trimming is desired, add a `trim<Name>` to `src/trim.ts`.
3. Register with `program.addCommand(<name>Command())` in `src/index.ts`.
4. Add cases to `tests/integration/commands.test.ts` and `tests/e2e/cli.test.ts`.

## Conventions

- CLI arg order may differ from URL path order — e.g. `departures <stop-id> <route-type>` maps to `/v3/departures/route_type/{rt}/stop/{id}`. Don't "fix" by reordering args; the CLI order is user-facing.
- `buildQueryString` accepts `string | number | number[] | string[]` — never pass booleans/undefined.
- Repeatable options use commander's `.option('--route-types <n>', '...', collect, [])` pattern.
- Coords everywhere: `lat,lon` (matches gh-route, osrm-au, ptv nearby, Google Maps).
- For new bike-routing parameters that depend on gh-route data, gate behind `req.enrich` and degrade gracefully when gh-route returns null.
- JSON output: every new field on `BikeLeg` / `TrainLeg` / `Itinerary` should be optional (`?: T`) — keeps schema additive.

## Testing

- `npm test -- <pattern>` to run a single test file or pattern (vitest).
- Unit tests cover HMAC signing, query building, score/feasibility logic, parseGhRoute, hubs, map writer — no credentials required.
- Integration tests hit the live PTV API and `it.skipIf(!process.env.PTV_DEV_ID)` themselves when creds are absent.
- E2e tests spawn `node dist/index.js` — they require both a fresh `npm run build` and credentials.
- Tests mock external HTTP via `vi.stubGlobal('fetch', ...)`; subprocess calls via `vi.doMock('child_process', ...)`.

## Issue tracking

This repo uses [`bd`](https://github.com/beadsnz/beads) for local issue tracking (initialized 2026-05-17, prefix `ptv-`).

- `bd list` — open issues
- `bd ready` — unblocked work
- `bd show <id>` — full details
- `bd create "<title>" --type feature --labels v1.6` — new issue

When "Doctor Dee" says "add as a local bead", create a `bd` issue (not a memory entry). Specs and plans live under `docs/superpowers/`; small follow-up ideas live as beads.

## Out-of-scope reminders (open beads as of v1.5)

- `ptv-5fy` (P4): Strava popularity overlay
- K=3 transfers, full train pattern polylines on maps, `--custom-model-file FILE` escape hatch
