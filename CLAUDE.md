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
npm run build          # tsc → dist/ + copies server/chat templates + bundles web-chat
npm test               # all suites (unit + integration + e2e)
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:browser   # Playwright (real browser) — for web-chat
```

E2e tests run against the compiled binary at `dist/index.js`. Build first. `build` also runs `web-chat/esbuild.config.mjs` to bundle the chat frontend into `dist/chat/static-assets/`.

## Programmatic access from other apps

See [API.md](./API.md) — covers shell-out, TS imports, raw HTTP signing for non-Node consumers, and the chat/server HTTP routes. When asked "how do I call PTV / plan / geocode from elsewhere", point users there rather than re-explaining.

## Chat + server apps

This repo now hosts three deliverables, all sharing the CLI's modules:

- **CLI** (`src/index.ts` → `dist/index.js`) — original subcommand surface.
- **`src/server/`** — Fastify web UI ("Atlas") with a map, geocode route (Photon + Nominatim), and click-to-route. Templates in `src/server/templates/`, static assets in `src/server/static-assets/`.
- **`src/chat/`** — OpenRouter-driven chat agent exposing PTV/plan/geocode as tools. The agent loop lives in `src/llm/openrouter.ts` (streaming chat-completions + parallel tool dispatch); `src/chat/agent.ts` is the thin adapter that preserves the `runTurn → AsyncGenerator<SseEvent>` contract used by the Fastify route. Frontend lives in `web-chat/` (esbuild-bundled into `dist/chat/static-assets/`). Conversation logging via batched fire-and-forget Postgres writer (`src/chat/log/`). Deployed at `bike-rail.realmindsai.com.au` as the `ptv-chat` container.
- **`src/chat-eval/` + `ptv chat-eval`** — dev-side eval harness. Three subcommands: `run <prompt>` (single prompt across N models), `suite <file.yaml>` (golden regressions, fans out across models), `replay <conversation-id>` (re-run a logged production conversation against a different model). Writes a local SQLite file (`./eval.db` by default) and optionally a self-contained HTML report. See `docs/superpowers/specs/2026-05-23-chat-eval-openrouter-design.md` for the design and `docs/superpowers/plans/2026-05-23-chat-eval-openrouter.md` for the implementation plan.

Env for the chat/server stack (in addition to PTV/OSRM/GH vars above):
- `OPENROUTER_API_KEY` — OpenRouter auth (required; lives in `.env.sops`).
- `OPENROUTER_BASE_URL` — override OpenRouter's `https://openrouter.ai/api/v1` (rarely needed).
- `MODEL` — OpenRouter slug consumed by both the live service and the eval CLI. Production default is `anthropic/claude-haiku-4.5`. Other verified tool-capable slugs: `google/gemini-3.5-flash`, `google/gemini-2.5-flash` (cheaper iteration model), `openai/gpt-5`, `deepseek/deepseek-v3.2`. Slugs drift as providers ship new revisions — run `curl -s 'https://openrouter.ai/api/v1/models?supported_parameters=tools' | jq -r '.data[].id'` to enumerate what's currently live before pasting a slug into config.
- `NOMINATIM_URL` — Nominatim base. Default `http://localhost:8094` is dev-only; in the totoro docker stack it's `http://nominatim:8080` (docker DNS via the `nominatim_default` network).
- `PHOTON_URL` — Photon base. Unset = Photon disabled, geocode tool falls back to Nominatim only. On totoro: `http://photon:2322` — same OSM data as Nominatim (Photon imports from the Nominatim Postgres), but does substring/typeahead matching, so "rosa" finds "Rosanna" where Nominatim won't (bead `ptv-987`). Beads `ptv-7wy` (weekly re-import) and `ptv-q97` (Photon over-ranks fuzzy name-match) are the live caveats.
- `PTV_CHAT_PG_URL` — Postgres connection string for conversation logging (optional; logging is fire-and-forget and degrades silently). Production uses `postgres.magpie-inconnu.ts.net:5433` — the docker container reaches it via an `extra_hosts` pin to totoro's tailscale IP (`100.108.0.26`); pure-tailscale-DNS lookups don't resolve inside the docker bridge.

All chat-stack peers (Nominatim, Photon, osrm-au bicycle/foot, GraphHopper) live on totoro and are reached by docker-DNS hostnames inside `nominatim_default`. See `docker-compose.chat.snippet.yml` for the canonical URLs.

### Local dev — tailscale-routed peer URLs

The docker-DNS names above only resolve **inside** totoro's docker network. From a laptop, hit the peers via totoro's tailscale MagicDNS:

| Service | Tailscale URL |
|---|---|
| Nominatim | `http://totoro.magpie-inconnu.ts.net:8094` |
| Photon | `http://totoro.magpie-inconnu.ts.net:2322` |
| GraphHopper REST | `http://totoro.magpie-inconnu.ts.net:8989/route` |
| OSRM-au (bicycle) | `http://totoro.magpie-inconnu.ts.net:5002` |
| OSRM-au (foot) | `http://totoro.magpie-inconnu.ts.net:5003` |

Quickstart from a laptop on the magpie-inconnu tailnet:

```bash
./scripts/decrypt-env.sh
set -a && source .env && set +a
source scripts/env-dev.sh             # override docker-DNS URLs with tailscale ones
node dist/index.js chat-eval run "your prompt" --models anthropic/claude-haiku-4.5 --html /tmp/out.html
open /tmp/out.html
```

Production ignores these overrides — the ptv-chat container's compose `environment:` block re-asserts the docker-DNS URLs at start.

## Secrets (SOPS + age)

Runtime secrets are committed encrypted as `.env.sops`. The `.sops.yaml` and `scripts/decrypt-env.sh` handle the workflow:

```bash
./scripts/decrypt-env.sh > .env       # produces a plaintext .env (gitignored)
sops .env.sops                        # interactive edit of the encrypted file
```

The age key lives outside the repo. `.env` is gitignored; never commit it. The Dockerfiles/compose snippets load the decrypted env at deploy time.

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
  server/               # Fastify web UI ("Atlas"): map + geocode + click-to-route
    photon.ts           # Photon geocoder client (Melbourne-biased, AU-filtered)
    nominatim.ts        # Nominatim geocoder client (fallback)
    routes/geocode.ts   # HTTP geocode endpoint
  chat/                 # OpenRouter-driven chat agent
    agent.ts            # runTurn(req, opts) → AsyncGenerator<SseEvent>; thin adapter over runAgentLoop
    tools/geocode.ts    # geocode tool exposed to the agent
    log/                # batched fire-and-forget Postgres conversation logger
  llm/                  # provider-agnostic agent loop primitives
    openrouter.ts       # streaming chat-completions + parallel tool dispatch; emits SseEvent
    tool_bridge.ts      # Zod schema → OpenAI function-calling shape; arg-parse + dispatch
    types.ts            # ToolFactory, OpenAIMessage, AgentLoopOptions
  chat-eval/            # dev-side eval harness (used by `ptv chat-eval`)
    runner.ts           # captures the SseEvent stream into structured turn records
    db.ts               # better-sqlite3 schema + writer
    suite.ts            # YAML suite loader with Zod validation
    replay.ts           # postgres event reconstruction → history + new turn
    renderers/          # terminal (marked-terminal) | jsonl | self-contained html
web-chat/               # esbuild-bundled chat frontend (Leaflet + SSE + GPX)
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
