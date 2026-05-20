# ptv-chat — deployment

Standalone chat-driven trip planner. Sibling to ptv-web. Spec:
`docs/superpowers/specs/2026-05-19-ptv-chat-design.md`. Plan:
`docs/superpowers/plans/2026-05-19-ptv-chat.md`.

## Local development

```bash
npm run build
PTV_DEV_ID=... PTV_API_KEY=... \
  node dist/index.js chat-serve --port 8086 --host 127.0.0.1
# Open http://127.0.0.1:8086
```

The Claude Agent SDK reads subscription credentials from `~/.claude/` on the
host. Run `claude login` once on the dev box if you haven't already.

## Production deploy on totoro

### 1. One-time: seed the `claude-creds` Docker volume

The container mounts `~/.claude` **read-write** so the Agent SDK can persist
refreshed OAuth tokens (a read-only mount causes HTTP 401 the moment the
short-lived access token expires, ~30 min after first use). Seed the volume
from totoro's host filesystem (where `claude login` must have already been
run):

```bash
docker volume create claude-creds
docker run --rm \
  -v claude-creds:/dst \
  -v $HOME/.claude:/src:ro \
  alpine sh -c "cp -r /src/. /dst/"
```

After seeding, the SDK refreshes tokens autonomously. Re-seed only if the
refresh token itself is invalidated (e.g. after explicit `claude logout` or
session revoke) — follow-up bead `ptv-2er` tracks an auto-refresh sidecar.

### 2. (Optional) Photon geocoder

Nominatim is a token-matching search over OSM names — it misses places when
users say "CERES Environment Park" but OSM has it as "CERES Community Gardens".
Photon (`komoot/photon`, Elasticsearch-backed over the same OSM data) handles
fuzzy match, alt_name, and partial queries.

Build the Photon image and import from the existing Nominatim postgres:

```bash
# On totoro:
mkdir -p ~/docker/photon && cd ~/docker/photon
curl -fsSL -o photon.jar \
  https://github.com/komoot/photon/releases/download/1.1.0/photon-1.1.0.jar
cat > Dockerfile <<'EOF'
FROM eclipse-temurin:21-jre-alpine
WORKDIR /photon
COPY photon.jar /photon/photon.jar
RUN mkdir -p /photon/photon_data
EXPOSE 2322
ENTRYPOINT ["java","-jar","/photon/photon.jar"]
EOF
docker build -t ptv-photon:1.1.0 .

# One-shot import from Nominatim postgres (~10 min for Victoria-scope).
# Replace <password> with the nominatim postgres password
# (docker inspect nominatim | grep NOMINATIM_PASSWORD).
docker volume create photon-data
docker run --rm --name photon-import --network nominatim_default \
  -v photon-data:/photon/photon_data ptv-photon:1.1.0 \
  -data-dir /photon/photon_data -nominatim-import \
  -host nominatim -port 5432 -database nominatim \
  -user nominatim -password '<password>' -languages en
```

Serve compose (`~/docker/photon/docker-compose.yml`):

```yaml
services:
  photon:
    image: ptv-photon:1.1.0
    container_name: photon
    restart: unless-stopped
    networks: [nominatim_default]
    volumes: [photon-data:/photon/photon_data]
    command:
      - -data-dir
      - /photon/photon_data
      # REQUIRED — Photon's Javalin defaults to 127.0.0.1, which blocks
      # other containers on the same network from reaching it.
      - -listen-ip
      - 0.0.0.0
volumes:
  photon-data: { external: true }
networks:
  nominatim_default: { external: true }
```

`docker compose up -d`, then check `docker exec photon wget -qO- 'http://127.0.0.1:2322/api?q=CERES+Brunswick'`.

When wiring into ptv-chat, set `PHOTON_URL=http://photon:2322` — the geocode
tool falls back to Nominatim if Photon is unset or returns nothing.

### 3. Build + start the container

```bash
docker build -f Dockerfile.chat -t ptv-chat:latest .
docker compose -f docker-compose.chat.snippet.yml up -d
curl http://localhost:8086/healthz
```

Expected: `{"status":"ok","uptime":...}`.

### 3. Tailnet exposure

Add `ptv-chat` to the Tailscale sidecar's magic-DNS aliases. Reach it at
`http://ptv-chat.magpie-inconnu.ts.net:8086`. No TLS, no auth — tailnet provides
transport security.

## External networks (must already exist on totoro)

| Service       | Network              |
|---------------|----------------------|
| Nominatim     | `nominatim_default`  |
| OSRM AU       | `osrm-au_default`    |
| GraphHopper   | `graphhopper_default`|

`docker network ls` reveals the actual names if they differ.

## Architecture (at a glance)

- Browser SPA (`web-chat/`) bundled by esbuild into `src/chat/static-assets/`.
- Fastify app at `src/chat/` serves the SPA + a single SSE endpoint:
  `POST /api/chat`.
- Each user turn opens an SSE stream for the duration of one Agent SDK
  `query()` invocation. Five tools available to Claude:
  - `geocode`, `plan`, `bike_route`, `search_stops`, `nearby_stops`.
- Itinerary geometry is streamed to the browser as `path_add` events while
  Claude only sees compact summaries — token discipline.
- Conversation state lives in `localStorage`; server is stateless.

## Not yet shipped (open follow-up beads after v1)

- Multi-OD `plan` (single tool call for multi-leg trips).
- Conversation summarization / context compaction.
- Save / share a plan via URL hash.
- Strava popularity overlay on chat-generated paths.
- Voice input.
- Auto-refresh of mounted Claude creds.

## Conversation logging (production)

The deployed ptv-chat container writes every chat turn to the central Postgres
on totoro at `postgres.magpie-inconnu.ts.net:5433`, database `ptv_chat`. If
`PTV_CHAT_PG_URL` is unset the logger is a no-op (used for local dev and
tests).

### One-time setup on totoro

```bash
sudo -u postgres psql -p 5433 -c "CREATE DATABASE ptv_chat OWNER dewoller;"
sudo -u postgres psql -p 5433 -d ptv_chat -f src/chat/log/schema.sql
# Then rotate the placeholder password in schema.sql to a real one and
# store it in SOPS-encrypted .env.sops at the service root (see below).
```

### Secrets — SOPS + age (per infra-shared/STANDARDS.md §4)

- Create `.env.sops` at the service root with one line:
  `PTV_CHAT_PG_URL=postgres://ptv_chat_writer:<pw>@postgres.magpie-inconnu.ts.net:5433/ptv_chat?sslmode=disable`
  (Tailnet is already WireGuard-encrypted; node-postgres v8 treats
  `sslmode=prefer` as full verification which fails against the local PG17
  self-signed cert.)
- Encrypt with `sops-remediate.sh` against the standard age key
  (`/etc/age/keys.txt`). Commit the encrypted file.
- At deploy time, run `sops-decrypt-env ptv-chat` to produce
  `/run/secrets/ptv-chat/.env` (tmpfs).
- `docker-compose.chat.snippet.yml` consumes the decrypted env via
  `env_file: /run/secrets/ptv-chat/.env`.

### What is logged

| Event type        | Source                                  |
|-------------------|-----------------------------------------|
| user_msg          | user's text                             |
| assistant_msg     | full assistant text per turn            |
| tool_call         | tool name + args                        |
| tool_result       | ok flag + result summary string         |
| path_add          | full itinerary (legs, geometry, totals) |
| turn_end / error  | structural events                       |
| ip, user_agent    | request metadata                        |
| origin_lat/lon    | browser geolocation when granted        |

There is no user-facing PII beyond IP. Retention is unlimited for now.
