# ptv web frontend — design spec

**Bead:** `ptv-t3x` (epic), `ptv-t3x.1` (Phase 1), `ptv-t3x.2` (Phase 2)
**Date:** 2026-05-17
**Status:** approved for implementation planning

## Goal

A web UI for `ptv plan` that runs on totoro behind Tailscale. Designed as one app delivered in two visible phases, but architected so Phase 2 is purely additive to Phase 1 — no rewrite, no second deployable.

Phase 1: HTMX + server-rendered fragments. Form (with Nominatim autocomplete) → results table + Leaflet map.
Phase 2: same page, click-to-route, geolocation, URL state, installable PWA.

## Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Approach | A — unified app, progressive enhancement | Smallest viable thing first; Phase 2 is additive. Matches the bead framing. |
| Server framework | Fastify | Async-first, schema validation, lighter than Express, better fit for JSON+HTML dual surface. |
| Geocoder | Nominatim already running on totoro (`http://totoro.magpie-inconnu.ts.net:8094`, mediagis/nominatim 4.5, AU data updated 2026-05-16) | Already deployed; no rate limits; tailnet-local. |
| Form UX | HTMX typeahead autocomplete (300 ms debounce, ≥3 chars) on from/to fields | Modern, matches map apps; HTMX makes it trivial. |
| Plan engine call | Direct in-process call to `orchestrator.plan()` | Avoid per-request subprocess cost. (osrm-au/gh-route subprocesses still happen inside the orchestrator.) |
| Deployment | Docker container, matches totoro's all-Docker pattern | No pm2 / no systemd Node services on totoro. |
| External routing | Migrate `osrm-au` and `gh-route` subprocess calls to existing GraphHopper REST + the LAN OSRM where possible | Removes binary copy from container; simpler image. |
| Hosting | Tailscale magic-DNS host `ptv.magpie-inconnu.ts.net:8085` (or `totoro.magpie-inconnu.ts.net:8085`) | RMAI convention; skips auth/PTV-cred exposure since access is tailnet-gated. |
| Cache | Redis (existing instance on totoro: `twenty-twenty-redis-1`) | Biggest single perf win. Survives container restarts; shared across replicas if we ever scale. |

## Architecture

```
src/
  server/
    index.ts          # Fastify app factory: registerRoutes(app); export start()
    routes/
      page.ts         # GET /            → renders shell HTML (form + empty #results + empty #map)
      plan.ts         # POST /api/plan   → content-negotiates HTML fragment OR JSON
      geocode.ts      # GET  /api/geocode?q=… → proxies + caches Nominatim search
      reverse.ts      # GET  /api/reverse?lat=…&lon=…  (Phase 2)
      health.ts       # GET  /healthz    → 200 ok (Docker healthcheck)
      static.ts       # GET  /static/*   → vendored Leaflet + htmx + app.css/app.js
    templates/
      page.html       # full shell; references htmx + leaflet from /static
      results.html    # fragment: results table + map-init <script>
      geocode-suggest.html  # HTMX dropdown fragment
      error.html      # red-banner fragment
    cache.ts          # ioredis client wrapping get/setex/del with `ptv:` namespace; graceful pass-through if Redis is down
    nominatim.ts      # search(q) + reverse(lat,lon) against NOMINATIM_URL env var
    types.ts          # request/response shapes shared with Phase-2 client JS
  commands/
    serve.ts          # registers `ptv serve [--port N] [--host H]`; calls server/index.start()
  plan/
    orchestrator.ts   # called DIRECTLY by routes/plan.ts (no subprocess)
    map.ts            # refactored — split into:
                      #   writeMapHtml(path, itineraries)         (existing behavior)
                      #   renderMapInit(itineraries): string      (new — returns <script> body for embedding)
```

**One refactor in `plan/map.ts`** — extract the Leaflet init-script generation so it can be embedded into a server-rendered fragment without producing a full HTML wrapper. The existing `--html` CLI flow keeps working via `writeMapHtml()`, which now calls `renderMapInit()` internally.

**The web app does NOT shell out to `ptv plan`.** `routes/plan.ts` imports `orchestrator.plan()` directly.

**`/api/geocode` proxies Nominatim** so the browser never talks to it directly. Avoids CORS, enables server-side caching, makes swapping the geocoder a one-file change.

## API surface

### `POST /api/plan`

Request body (JSON, or `application/x-www-form-urlencoded` from the HTMX form):

```jsonc
{
  "from": { "lat": -37.64, "lon": 145.19 },     // or { "query": "Hurstbridge" } — server resolves via geocode
  "to":   { "lat": -37.90, "lon": 144.66 },
  "depart": "08:00",       // optional, mutually exclusive with arriveBy
  "arriveBy": null,
  "mode": "bike-train",    // bike-only | bike-train
  "goal": "commute",       // commute | day-ride | max-path
  "minBikeKm": 0, "maxBikeKm": 20, "maxTransfers": 1,
  "preferBikePath": false, "hillWeight": 0, "minOnPathFraction": null,
  "enrich": true
}
```

Response — chosen by `Accept` header:
- `text/html` → `results.html` fragment: results table + `<script>` that calls `renderMapInit(...)` to re-initialize the Leaflet layers in-place. HTMX swaps this into `#results`.
- `application/json` → the same JSON shape the CLI emits today (`{ query, itineraries }`).

If `from`/`to` come in as `{ query: "..." }`, the handler resolves them server-side via `nominatim.search()` (first result with `place_rank ≤ 25`). If geocode returns zero results, the response is an error fragment / `{ error: { code: "GEOCODE_NO_MATCH", message, field } }`.

### `GET /api/geocode?q=<text>&limit=8`

Proxies internal Nominatim. Hardcoded `countrycodes=au` and Melbourne metro `viewbox` bias. Returns:

```jsonc
{ "results": [
  { "label": "Hurstbridge, Shire of Nillumbik, Victoria", "lat": -37.64, "lon": 145.19, "rank": 18 }
] }
```

- `Accept: application/json` → JSON above
- `Accept: text/html` → `geocode-suggest.html` fragment (a `<ul>` of clickable rows for the HTMX dropdown)

Client-side: 300 ms debounce, min 3 chars.

### `GET /api/reverse?lat=…&lon=…` (Phase 2)

Reverse-geocodes pin drops to a display label.

### `GET /healthz`

200 OK with `{ status: "ok", uptime }`. For Docker healthcheck.

### Errors

All routes return `{ error: { code, message, field? } }` on JSON requests, or an inline `error.html` fragment swapped into `#results` on HTML requests. PTV credential failures → 500 with a clear message. Geocode failures degrade silently — the form still accepts raw `lat,lon` strings (existing argv preprocessor logic in `src/argv.ts` already handles negative coords; reuse the same parser).

## UX

### Phase 1 page (`GET /`)

```
┌───────────────────────────────────────────────────────────────┐
│  ptv plan                                                     │
│  ┌─────────────────┐ ┌─────────────────┐                      │
│  │ From: [______]  │ │ To: [______]    │   ← typeahead each   │
│  │  └─ dropdown    │ │  └─ dropdown    │                      │
│  └─────────────────┘ └─────────────────┘                      │
│  Depart: [HH:MM] ⊙   Arrive-by: [HH:MM] ○                     │
│  Mode: (bike-train ▾)  Goal: (commute ▾)                      │
│  ▸ Advanced (collapsed: hill-weight, min-on-path, …)          │
│  [ Plan ]                                                     │
├───────────────────────────────────────────────────────────────┤
│  Results  (#results)                                          │
│  (table of itineraries, with labels: fastest / recommended)   │
├───────────────────────────────────────────────────────────────┤
│  Map  (#map — Leaflet, layer toggles per itinerary)           │
└───────────────────────────────────────────────────────────────┘
```

HTMX flow:
- Typing in `from`/`to` triggers `hx-get="/api/geocode" hx-trigger="keyup changed delay:300ms" hx-target="#from-suggest"`.
- Clicking a suggestion fills hidden `from.lat`/`from.lon` and the visible label.
- Form submit posts to `/api/plan` with `hx-post`, swaps response into `#results`. The fragment includes both the results table AND a `<script>` that initializes Leaflet on `#map`.

Form defaults mirror CLI defaults exactly (see `src/commands/plan.ts`).

### Phase 2 add-ons (same page, progressive enhancement)

- **Map click-to-route.** First click drops `from` pin (calls `/api/reverse` to fill label), second click drops `to` pin and auto-fires plan(). Pins are draggable; dragging refires plan().
- **"📍 Use my location"** button — `navigator.geolocation`, fills `from`.
- **URL hash state.** `#from=lat,lon&to=lat,lon&depart=08:00&goal=max-path` — restored on page load, updated on every successful plan. Browser back/forward replays previous trips.
- **PWA bits:**
  - `manifest.webmanifest` (name, theme color, icons 192/512) → installable to phone home screen.
  - `sw.js` service worker caches `/` shell + `/static/*` for offline shell load.
  - Service worker does **NOT** intercept `/api/plan` (would serve stale PTV departures).
  - Optional later: IndexedDB cache of the last N planned trips for offline replay.

## Caching

Single Redis instance on totoro (`twenty-twenty-redis-1`, image `redis:7-alpine`, already running). PTV is a **second tenant** on a shared redis — Twenty owns the eviction policy. PTV's working set is small (~hundreds of plan results, ~thousands of geocode entries), so coexistence is fine indefinitely. One client in `src/server/cache.ts` wrapping `ioredis`, all keys namespaced under `ptv:` to isolate from Twenty's keys and to make a future `SCAN ptv:*` cleanup possible.

**Verified:** no bare-metal redis on totoro (no `redis-server.service`, no host-installed `redis-cli`). The two listening sockets on `:6379` (tailnet IP + 127.0.0.1) are the same container bound to both interfaces — nothing to merge.

| Namespace | Key | Value | TTL |
|---|---|---|---|
| `ptv:plan:<sha1>` | sha1 of normalized request JSON | gzip'd JSON of `{ query, itineraries }` | 10 min |
| `ptv:geocode:<q>` | `q.toLowerCase().trim()` | JSON Nominatim results | 24 h |
| `ptv:reverse:<lat>,<lon>` | rounded coords (5 dp) | JSON Nominatim reverse | 7 d |

Eviction is Redis-native (TTL + LRU policy on the server). No size cap configured by us — Redis is shared with Twenty and uses its own `maxmemory-policy`.

Normalization for the plan-cache key:
- Sort object keys alphabetically.
- Lowercase string values.
- Round coords to 5 decimal places (~1 m precision; matches osrm-au tolerance).
- Drop `enrich` from the key when its value matches the default — trivial reordering still hits cache.

Plan TTL is short because PTV departures move; geocode TTL is long because OSM addresses don't.

**Connection details:** `REDIS_URL` env var. Compose joins the Twenty network so the host is `redis://twenty-twenty-redis-1:6379`. Graceful degrade: if Redis is unreachable, the cache layer logs a warning and operates as a pass-through — the app keeps working, just slower.

**Why namespaced under `ptv:`:** shared instance with Twenty; isolating prevents accidental key collisions and lets a future `FLUSHDB`-free cleanup target `ptv:*` via `SCAN`.

## Deployment

Matches totoro's all-Docker pattern (verified: nominatim, graphhopper-vic-bike, n8n, etc. all in Docker; no pm2; no systemd Node services).

- **`Dockerfile`** in repo root: multi-stage. Build stage compiles TS; runtime stage = `node:20-alpine` with `dist/`, prod-only `node_modules`, `src/server/templates/`, `src/server/static-assets/` (vendored htmx + leaflet).
- **`docker-compose.yml`** snippet for totoro: `ptv-web` service.
  - Env: `PTV_DEV_ID`, `PTV_API_KEY`, `NOMINATIM_URL=http://nominatim:8080`, `REDIS_URL=redis://twenty-twenty-redis-1:6379`, `GH_REST_URL=http://graphhopper-vic-bike:8989/route`. (Joins both the nominatim network and the twenty network.)
  - Healthcheck → `curl -f http://localhost:8080/healthz`.
  - `restart: unless-stopped`.
  - Publishes port `8085` (verified free in earlier `ss -tlnp`).
- Reachable at `http://ptv.magpie-inconnu.ts.net:8085` once the tailnet DNS alias is wired (`totoro.magpie-inconnu.ts.net:8085` works on day one).
- **`osrm-au` and `gh-route` binaries:** the orchestrator calls these as subprocesses today. For containerized deploy, migrate to GraphHopper REST + LAN OSRM REST where possible. The `--goal day-ride` path already uses `GH_REST_URL`; the `commute` path needs the same treatment for `osrm-au`. If a LAN OSRM REST isn't reachable, fall back to baking the binaries into the image (slower iteration, larger image).

## Testing

Mirrors the existing layout (`tests/unit`, `tests/integration`, `tests/e2e`).

- **Unit (`tests/unit/server/`):**
  - `cache.test.ts` — get/setex round-trip against a real `redis-memory-server` (or `ioredis-mock`); namespace prefix applied; pass-through behavior when client emits `error`.
  - `cache-key.test.ts` — normalization → same key for trivially-different requests.
  - `content-negotiation.test.ts` — `Accept` branching.
  - `nominatim.test.ts` — response → fragment HTML, `viewbox`/`countrycodes` params present.
  - `error-mapping.test.ts` — orchestrator throws → correct fragment / JSON shape.
  - Mock `orchestrator.plan` and global `fetch` for Nominatim.
- **Integration (`tests/integration/server/`):**
  - Boot Fastify in-process via `app.inject({ method, url, payload })`.
  - Stub PTV/osrm/gh-route at the network/subprocess layer (existing `vi.stubGlobal` + `vi.doMock` patterns).
  - Assert HTML fragment structure (cheerio) and JSON response shape.
- **E2e (`tests/e2e/server/`):**
  - Use `playwright-skill` to drive the form on a real browser against a server bound to a high port.
  - Phase 1: type → autocomplete → pick → submit → results table renders → map has N layers.
  - Phase 2: click two map points → plan fires → pins draggable → URL hash updated → reload restores trip.

Test output must stay pristine per global instructions (no Fastify "address in use" warnings, no unhandled-promise noise).

## Phasing — implementation cut-points

The implementation plan will split this into Phase 1 (must-haves) and Phase 2 (additive). Sketch:

**Phase 1 cut (ptv-t3x.1):**
- `src/server/` skeleton + Fastify + `ptv serve` command
- `cache.ts`, `nominatim.ts`
- `GET /`, `POST /api/plan` (HTML + JSON), `GET /api/geocode` (HTML + JSON), `GET /healthz`, `GET /static/*`
- `plan/map.ts` refactor (extract `renderMapInit`)
- Vendored htmx + leaflet under `src/server/static-assets/`
- `Dockerfile`, compose snippet
- Unit + integration + e2e tests for everything above

**Phase 2 cut (ptv-t3x.2):**
- `GET /api/reverse`
- Page-level JS: map-click handlers, geolocation button, URL-hash sync
- `manifest.webmanifest`, icons, `sw.js`
- E2e tests for click-to-route + URL state round-trip
- (Stretch) IndexedDB last-trips cache

## Out of scope

- Public/internet hosting (would need auth, PTV-cred proxying, per-IP rate limits)
- SPA build chain (Vite/esbuild) — vanilla JS is enough for the Phase 2 enhancements
- Other PTV subcommands (departures, disruptions) — plan is the only one worth a web UI
- Live re-routing if user deviates from a planned trip (see ptv-0dm GPX export for that path)
- Trip history sync across devices
- React/Svelte/etc.

## Open follow-ups (not blockers)

- The plan-cache key normalization should be small enough to land in Phase 1. Verify with `ptv-aw2` (kmOnPath inflation bug) — both involve canonicalizing plan inputs.
- If LAN OSRM REST isn't reachable, the `osrm-au` → REST migration becomes its own bead before Phase 1 can deploy cleanly.
- Decide whether the docker-compose snippet lives in this repo or in the totoro-side infra repo. Probably the latter; this repo ships only the Dockerfile.
