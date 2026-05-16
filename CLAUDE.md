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
  [--max-transfers <n>] [--no-enrich]
```

The `plan` command returns labeled JSON itineraries combining bike (via `osrm-au`) and train (via PTV departures), with optional bike-path enrichment via `gh-route`. v1 supports K=1 (single train segment). Coords use `lat,lon`. Negative coords are auto-handled — pass `-37.78,144.96` directly without escaping.

## Credentials

Requires two env vars (throw `MissingCredentialsError` if absent):

```
PTV_DEV_ID=<your-dev-id>
PTV_API_KEY=<your-api-key>
```

Register at: https://www.ptv.vic.gov.au/footer/data-and-reporting/datasets/ptv-timetable-api/

## Build & Test

```
npm run build          # tsc → dist/
npm test               # all suites (unit + integration + e2e)
npm run test:unit
npm run test:integration
npm run test:e2e
```

E2e tests run against the compiled binary at `dist/index.js`. Build first.

## Related tooling

### osrm-au

OSRM routing service running on totoro. `~/bin/osrm-au` is a symlink to the CLI in the repo.

```
osrm-au describe                                          # show host + profiles
osrm-au route --profile car --point=<lat,lon> --point=<lat,lon>
osrm-au route --profile bicycle --point=<lat,lon> --point=<lat,lon>
osrm-au route --profile foot --point=<lat,lon> --point=<lat,lon>
```

CLI takes `lat,lon` (matches `gh-route`, `ptv nearby`, Google Maps); flips to OSRM's wire `lon,lat` internally. Use `--point=…` (with `=`) so argparse doesn't read leading `-` as a flag.

Profiles: `car` (port 5001), `bicycle` (5002), `foot` (5003) on `totoro.magpie-inconnu.ts.net`.
Returns `distance_km`, `duration_min`, `weight`.

- **Repo:** `git@github.com:realmindsai/osrm-au.git`
- **Local clone:** `~/code/realmindsai/active_services/osrm-au` (CLI at `scripts/osrm_cli.py`)
- **Totoro deploy:** `/tank/services/active_services/osrm-au` (git checkout tracking origin/main — `git pull` to update)

### gh-route

GraphHopper bike-routing CLI. Source repo: `../grasshopper-bike-routing/`, binary: `../grasshopper-bike-routing/bin/gh-route`.

```
gh-route info                                           # server version, profiles
gh-route route --point <lat,lon> --point <lat,lon> --profile bike_quiet
gh-route route --place HOME --place WORK --profile bike --profile bike_quiet
gh-route places ...                                     # manage places.yml lookup
```

Profiles: `bike`, `bike_quiet`, `bike_balanced`. Server: `http://graphhopper.magpie-inconnu.ts.net:8989` (override with `GH_BASE_URL`). Waypoints use `lat,lon` order (matches `osrm-au` and `ptv nearby`). Output: `--format pretty|json|geojson`; multi-`--profile` produces a comparison table.

## Architecture

Three layers in `src/`:

- `client.ts` — single `ptv(path, params)` helper. Builds query string, appends `devid`, HMAC-SHA1-signs the full path-with-devid (uppercase hex), and fetches against `https://timetableapi.ptv.vic.gov.au`. Throws `MissingCredentialsError` (caught in `index.ts` for a clean stderr message) when env vars are missing; non-2xx responses throw `Error` with a JSON-stringified `{error}` payload.
- `commands/*.ts` — one file per subcommand. Each exports a `xxxCommand()` factory returning a `commander.Command`. The handler calls `ptv(...)` and prints `JSON.stringify(trimmed, null, 2)` unless `--raw` is passed.
- `trim.ts` — per-endpoint projection functions (`trimDepartures`, `trimRoutes`, `trimStops`, …) that pull only the fields agents typically need. Default output is trimmed; `--raw` bypasses trimming.

`index.ts` is the entry point, wires the subcommands into one `Command`, and is the binary registered via `package.json#bin`.

## Adding a new command

1. Create `src/commands/<name>.ts` exporting `<name>Command()` that returns a `Command`.
2. If trimming is desired, add a `trim<Name>` to `src/trim.ts`.
3. Register with `program.addCommand(<name>Command())` in `src/index.ts`.
4. Add cases to `tests/integration/commands.test.ts` and `tests/e2e/cli.test.ts`.

## Conventions

- CLI arg order may differ from URL path order — e.g. `departures <stop-id> <route-type>` maps to `/v3/departures/route_type/{rt}/stop/{id}`. Don't "fix" by reordering args; the CLI order is user-facing.
- `buildQueryString` only accepts `string | number | number[]` — never pass booleans/undefined (caller is responsible for filtering).
- Repeatable options use commander's `.option('--route-types <n>', '...', collect, [])` pattern where applicable.

## Testing

- `npm test -- <pattern>` to run a single test file or pattern (vitest).
- Unit tests cover HMAC signing and query building — no credentials required.
- Integration tests hit the live PTV API and `it.skipIf(!process.env.PTV_DEV_ID)` themselves when creds are absent.
- E2e tests spawn `node dist/index.js` — they require both a fresh `npm run build` and credentials.
