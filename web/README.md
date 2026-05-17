# ptv web frontend — deployment

Phase 1 of `ptv-t3x.1` — Fastify-served Atlas shell behind Tailscale, hosted on totoro.

## Local development

```bash
# In one terminal:
npm run build
node dist/index.js serve --port 8080 --host 127.0.0.1

# Then open http://127.0.0.1:8080
```

Required env vars when planning real trips (the `/healthz` and Atlas shell render without them):
- `PTV_DEV_ID`, `PTV_API_KEY` — PTV credentials (see top-level CLAUDE.md).

Optional env vars:
- `NOMINATIM_URL` (default `http://localhost:8094`) — Nominatim base URL for geocoding.
- `REDIS_URL` (unset = no cache) — Redis URL for plan + geocode caching.
- `GH_REST_URL` — GraphHopper REST endpoint for `--goal day-ride` and `max-path`.
- `LOG_LEVEL` (default `info`).
- `PORT` (default `8080`), `HOST` (default `0.0.0.0`).

## Production deploy on totoro

Totoro runs all services in Docker (see `~/.claude/skills/linux-servers/SKILL.md`).
Build + deploy flow:

```bash
# On totoro (or a workstation with docker context set to totoro):
docker build -t ptv-web:latest /path/to/this/repo

# Merge docker-compose.snippet.yml into your totoro compose stack
# (probably under ~/docker/ptv/docker-compose.yml or similar).
docker compose up -d ptv-web

# Verify:
curl http://localhost:8085/healthz
# {"status":"ok","uptime":12.34}
```

Once the magic-DNS alias is wired (Tailscale sidecar config), reach it at
`http://ptv.magpie-inconnu.ts.net:8085`.

## Known caveat: `osrm-au` subprocess

The orchestrator uses `osrm-au` (a local subprocess) for the default `--goal commute` bike-routing path. That binary is NOT in the container image. Inside the container, `--goal commute` plans will fail with `ENOENT: osrm-au`.

Workarounds for v1:
- Use `--goal day-ride` or `--goal max-path` exclusively; both go through GraphHopper REST (`GH_REST_URL`), which already runs on totoro as `graphhopper-vic-bike`.
- Or set `OSRM_AU_BIN` to a path that mounts an `osrm-au` binary into the container (volume bind).
- Tracking issue: cut a `bd` bead titled "migrate `osrm-au` subprocess to LAN REST" — gating issue for clean container deploy. The design spec already names this in its `Open follow-ups`.

## Network plumbing

The container needs to reach three peer services on totoro:
| Service | Docker network | Hostname |
|---|---|---|
| Nominatim | `nominatim_default` | `nominatim` |
| Redis (shared with Twenty) | `twenty_default` | `twenty-twenty-redis-1` |
| GraphHopper | `graphhopper_default` | `graphhopper-vic-bike` |

The compose snippet joins all three external networks. If the network names on your totoro differ, `docker network ls` will reveal the actual names; edit accordingly.

## What's deployed

- `GET /` — Atlas shell (single-page HTMX)
- `POST /api/plan` — wraps `orchestrator.plan()`; JSON or HTML fragment via Accept header
- `GET /api/geocode` — Nominatim proxy
- `GET /static/*` — vendored htmx, leaflet, fonts, app.css
- `GET /healthz` — Docker healthcheck endpoint

Not deployed (Phase 2 scope):
- Map click-to-route, geolocation, URL-hash state, PWA install, service worker.
