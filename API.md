# PTV CLI — Programmatic API

How to consume this repo's functionality from another app or another language. Three options:

- **[Option A — shell out to the CLI](#option-a--shell-out-to-the-cli)** — easiest, language-agnostic, JSON to stdout.
- **[Option B — import the TypeScript modules](#option-b--import-the-typescript-modules)** — if you're in a Node/TS project.
- **[Option C — raw HTTP to the PTV Timetable API](#option-c--raw-http-to-the-ptv-timetable-api)** — if you don't want this repo as a dependency at all.

There's also a long-running **[chat/server HTTP API](#chatserver-http-api)** if you'd rather POST to a running container.

## Surface

| Capability | Module | CLI subcommand |
|---|---|---|
| Signed PTV Timetable API call | `src/client.ts` → `ptv()` | most subcommands |
| Multimodal planner (bike + train) | `src/plan/orchestrator.ts` → `plan()` | `ptv plan` |
| OSRM routing (foot or bicycle) | `src/plan/external.ts` → `osrmRoute()` | — |
| GraphHopper routing (bike, with metrics) | `src/plan/external.ts` → `ghRouteBike()` / `ghRouteCustom()` | — |
| Photon geocoding (Melbourne-biased, AU-filtered) | `src/server/photon.ts` → `Photon` | — |
| Nominatim geocoding (fallback) | `src/server/nominatim.ts` → `Nominatim` | — |

Geocoding and standalone routing have no CLI subcommand yet — use Option B or hit the server's HTTP routes.

## Credentials & environment

Required for any PTV access:

```
PTV_DEV_ID=<your-dev-id>
PTV_API_KEY=<your-api-key>
```

Register at https://www.ptv.vic.gov.au/footer/data-and-reporting/datasets/ptv-timetable-api/.

Optional, for `plan` and geocoding:

| Var | Purpose | Default | Totoro value (docker DNS) |
|---|---|---|---|
| `OSRM_AU_HOST` | LAN host for OSRM (bicycle:5002, foot:5003) | `totoro.magpie-inconnu.ts.net` | — |
| `OSRM_AU_BICYCLE_URL` | Full bicycle base URL override | — | `http://osrm-au-bicycle:5000` |
| `OSRM_AU_FOOT_URL` | Full foot base URL override | — | `http://osrm-au-foot:5000` |
| `GH_ROUTE_BIN` | Path to local `gh-route` binary | `../grasshopper-bike-routing/bin/gh-route` | — |
| `GH_REST_URL` | GraphHopper REST endpoint (used by `--goal day-ride`/`max-path`) | `http://graphhopper.magpie-inconnu.ts.net:8989/route` | `http://graphhopper-vic-bike:8989/route` |
| `NOMINATIM_URL` | Nominatim base URL | `http://localhost:8094` (dev only) | `http://nominatim:8080` |
| `PHOTON_URL` | Photon base URL; unset = Photon disabled, Nominatim only | (unset) | `http://photon:2322` |
| `PTV_CHAT_PG_URL` | Postgres connection string for chat conversation logging (optional) | — | (in `.env.sops`) |

All chat-stack peers (Nominatim, Photon, osrm-au, GraphHopper) live on totoro and are reached by docker-DNS hostnames inside the `nominatim_default` network. See `docker-compose.chat.snippet.yml`.

## Option A — shell out to the CLI

```bash
cd /path/to/ptv
npm install && npm run build
export PTV_DEV_ID=... PTV_API_KEY=...

node dist/index.js route-types
node dist/index.js search flinders
node dist/index.js nearby -37.78,144.96
node dist/index.js plan -37.78,144.96 -37.81,145.00 --depart 08:00 --html /tmp/trip.html
```

Every subcommand writes trimmed JSON to stdout — parse it directly. See the project [README](./README.md) or `CLAUDE.md` for the full `plan` flag list.

## Option B — import the TypeScript modules

```ts
import { ptv } from '<repo>/src/client';
import { plan } from '<repo>/src/plan/orchestrator';
import { osrmRoute } from '<repo>/src/plan/external';
import { Photon } from '<repo>/src/server/photon';
import { Nominatim } from '<repo>/src/server/nominatim';

// 1. Raw signed PTV call
await ptv('/v3/route_types');
await ptv('/v3/search/flinders', { route_types: [0, 1] });

// 2. Multimodal planner
const itins = await plan({
  from: { lat: -37.78, lon: 144.96 },
  to:   { lat: -37.81, lon: 145.00 },
  departAt: new Date(),
  mode: 'bike-train',
  goal: 'commute',
  enrich: true,
});

// 3. Walking / cycling routing
const walk = await osrmRoute(
  { lat: -37.78, lon: 144.96 },
  { lat: -37.81, lon: 145.00 },
  'foot',     // 'bicycle' | 'foot'
);
// → { distanceM, durationS, geometry: [[lat,lon], ...] }

// 4. Geocoding
const photon = new Photon('http://photon:2322');
await photon.search('flinders street');     // → PhotonHit[]

const nom = new Nominatim('http://nominatim:8080');
await nom.search('flinders street');        // → GeocodeResult[]
```

Same env vars apply.

## Option C — raw HTTP to the PTV Timetable API

If you don't want this repo as a dependency, you can sign requests yourself. PTV uses **HMAC-SHA1** of the *request path including query string and devid*, hex-encoded **uppercase**, appended as `&signature=...`.

```
base_url   = https://timetableapi.ptv.vic.gov.au
raw_path   = /v3/<endpoint>?<params>           # params may be empty
with_devid = raw_path + ("&" or "?") + "devid=" + DEV_ID
signature  = HMAC_SHA1(key=API_KEY, msg=with_devid).hexdigest().upper()
final_url  = base_url + with_devid + "&signature=" + signature
```

Key rules:

- Sign the **path + query**, NOT the full URL (no scheme/host).
- `devid` is part of the signed string; `signature` is appended *after* signing.
- URL-encode query values before signing.
- Repeated params (e.g. `route_types=0&route_types=1`) are signed in the order you send them.

### Python

```python
import os, hmac, hashlib, requests
from urllib.parse import urlencode

BASE = "https://timetableapi.ptv.vic.gov.au"
DEV_ID  = os.environ["PTV_DEV_ID"]
API_KEY = os.environ["PTV_API_KEY"]

def ptv(path, params=None):
    qs = urlencode(params or {}, doseq=True)
    p  = f"{path}?{qs}" if qs else path
    p  = f"{p}&devid={DEV_ID}" if "?" in p else f"{p}?devid={DEV_ID}"
    sig = hmac.new(API_KEY.encode(), p.encode(), hashlib.sha1).hexdigest().upper()
    r = requests.get(f"{BASE}{p}&signature={sig}")
    r.raise_for_status()
    return r.json()

print(ptv("/v3/route_types"))
print(ptv("/v3/search/flinders", {"route_types": [0, 1]}))
```

### curl

```bash
DEV_ID=...; API_KEY=...
PATH_Q="/v3/route_types?devid=$DEV_ID"
SIG=$(printf '%s' "$PATH_Q" | openssl dgst -sha1 -hmac "$API_KEY" | awk '{print toupper($2)}')
curl "https://timetableapi.ptv.vic.gov.au$PATH_Q&signature=$SIG"
```

### Node / TS

See `src/client.ts` — the reference implementation in this repo.

### Useful v3 endpoints

| Endpoint | Purpose |
|---|---|
| `/v3/route_types` | route_type enum (0=Train, 1=Tram, 2=Bus, 3=V/Line, 4=Night Bus) |
| `/v3/routes` | all routes; filter `?route_types=0&route_name=...` |
| `/v3/stops/location/{lat},{lon}` | nearby stops (`?max_distance=`, `?route_types=`) |
| `/v3/stops/{stop_id}/route_type/{route_type}` | stop details |
| `/v3/departures/route_type/{rt}/stop/{stop_id}` | next departures (`?max_results=`, `?date_utc=`) |
| `/v3/departures/route_type/{rt}/stop/{id}/route/{route_id}` | departures filtered to one route |
| `/v3/pattern/run/{run_ref}/route_type/{rt}` | full stopping pattern for a run (`?expand=Stop,Run,Route`) |
| `/v3/disruptions` | current disruptions (filterable) |
| `/v3/search/{term}` | global search across stops/routes/outlets |
| `/v3/directions/route/{route_id}` | inbound/outbound direction IDs |

Full Swagger: https://timetableapi.ptv.vic.gov.au/swagger/ui/index.

### Common gotchas

- **`403 Forbidden`** = bad signature. Almost always because you signed the wrong string — e.g. signed without `devid`, signed the full URL, or forgot to URL-encode a param.
- `date_utc` must be ISO8601 UTC (`2026-05-23T08:00:00Z`); local times silently shift the window.
- Repeatable params: send `route_types=0&route_types=1`, not `route_types=0,1`.
- Rate limits aren't published; in practice a few req/sec is fine — back off on 429.
- Don't bake the API key into a client app; the signature still requires the secret, so all calls must go through your server.

## Chat/server HTTP API

The `src/server/` (Fastify web UI "Atlas") and `src/chat/` (Claude Agent SDK chat) apps expose their own HTTP routes. If you're integrating with the *running* containers rather than the library code:

- **`src/server/routes/geocode.ts`** — `GET /geocode?q=<term>` returns merged Photon + Nominatim results.
- **`src/chat/routes/`** — chat conversation endpoints (SSE stream, conversation history). Production deploy: `https://bike-rail.realmindsai.com.au/`.

For container-internal URLs and how the chat container reaches Photon/Nominatim/OSRM/GraphHopper, see `docker-compose.chat.snippet.yml` and `web-chat/README.md`.

## Geocoding notes

Two backends, both running on totoro from the same OSM data:

- **Nominatim** — token-level matching. Typing "rosa" will NOT find "Rosanna" — you must type the full token (bead `ptv-987`).
- **Photon** — substring/typeahead matching on top of the Nominatim Postgres. Use when you want the user to type a prefix. Caveats: ranks fuzzy name-match above feature type, so "Flinders Street Station" can return a hotel (bead `ptv-q97`); needs periodic re-import from Nominatim (bead `ptv-7wy`).

If you only set `NOMINATIM_URL`, Photon is silently disabled and the geocode tool falls back to Nominatim only.
