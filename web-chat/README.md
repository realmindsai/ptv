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

The container mounts `~/.claude` read-only. Seed the volume from totoro's host
filesystem (where `claude login` must have already been run):

```bash
docker volume create claude-creds
docker run --rm \
  -v claude-creds:/dst \
  -v $HOME/.claude:/src:ro \
  alpine sh -c "cp -r /src/. /dst/"
```

Re-run this when subscription tokens refresh. Open follow-up bead to automate
this via a sidecar that re-syncs daily.

### 2. Build + start the container

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
