# ptv-chat — design

**Date**: 2026-05-19
**Status**: spec

A new web app that puts a chat interface in front of the PTV bike+train planner. The user types natural language; Claude (via the Agent SDK) loops through tools (`geocode`, `plan`, `bike_route`, `search_stops`, `nearby_stops`) and returns a set of color-coded itineraries the user can pick from on a Leaflet map. Standalone app — sibling to `ptv-web`, not a replacement.

## Goals

- Single-page chat UI: input → tool-using Claude turn → multiple selectable paths on a map.
- Stream tokens and tool events live (SSE).
- Tool-call trace overlay (on-demand) for transparency / debug.
- Deployed as a separate Docker container on totoro, reachable on tailnet only.
- Uses Claude Code **subscription** auth (no per-token API spend).

## Non-goals (v1)

- Multi-OD planning in a single tool call. Claude makes multiple `plan` calls for multi-leg trips.
- Server-side conversation persistence. Chat history is client-side per tab.
- Per-user auth. Tailnet exposure only.
- Voice input, save/share URLs, Strava overlay.

## Architecture

```
Browser (web-chat SPA)
  ├─ Leaflet map (full-bleed)
  ├─ Chat dock (right ~360px, collapsible)
  └─ Tool-call log (bottom-right overlay, on-demand)
        │ HTTP (SSE)
        ▼
ptv-chat container (Fastify, port 8086)
  ├─ POST /api/chat → Agent SDK query() loop
  │     tools:
  │       geocode       → src/server/nominatim.ts
  │       plan          → src/plan/orchestrator.ts
  │       bike_route    → src/plan/external.ts (osrm-au / gh-route / GH REST)
  │       search_stops  → src/client.ts (PTV)
  │       nearby_stops  → src/client.ts (PTV)
  ├─ GET  /            → SPA shell
  ├─ GET  /static/*    → bundle
  └─ GET  /healthz
```

Process model: single Fastify process, Agent SDK in-process. Each `POST /api/chat` opens an SSE stream for the duration of one user turn (entire tool loop). Server is stateless — request body carries full conversation.

## Repo layout

New code added in this PR; existing `src/plan/`, `src/server/`, `src/commands/` untouched.

```
src/chat/
  server.ts              # Fastify factory
  agent.ts               # runTurn() — Agent SDK wrapper
  sse.ts                 # SSE event types + writer helper
  tools/
    geocode.ts
    plan.ts
    bike_route.ts
    stops.ts             # search_stops + nearby_stops
  routes/
    chat.ts              # POST /api/chat
    health.ts            # GET /healthz
    page.ts              # GET / (SPA shell)
    static.ts            # GET /static/*
  static-assets/         # built frontend bundle (gitignored, populated by build)
  templates/
    page.html

web-chat/
  src/
    main.ts              # bootstrap
    chat.ts              # chat panel
    map.ts               # Leaflet wrapper
    log.ts               # tool-call log overlay
    state.ts             # turn lifecycle + localStorage
    sse.ts               # EventSource-flavoured POST/SSE client
    types.ts             # shared event + path shapes
  index.html
  app.css
  esbuild.config.mjs

docker/
  Dockerfile.chat
  docker-compose.chat.snippet.yml

docs/superpowers/specs/2026-05-19-ptv-chat-design.md   (this file)
```

`web-chat/` is built with esbuild (matching existing app's no-framework approach). Output goes to `src/chat/static-assets/`.

## Backend

### POST /api/chat

Request:

```ts
{
  messages: SDKMessage[],       // full conversation, client-owned
  model?: string,                // optional override
  origin?: { lat: number, lon: number },  // optional browser geolocation hint
}
```

Response: `text/event-stream`. Events (one JSON object per `data:` frame):

```ts
type SseEvent =
  | { type: 'turn_start' }
  | { type: 'text_delta',  delta: string }
  | { type: 'tool_call',   id: string, name: string, args: object }
  | { type: 'tool_result', id: string, ok: boolean, summary: string }
  | { type: 'path_add',    pathId: string, label: string, color: string, itinerary: Itinerary }
  | { type: 'turn_end' }
  | { type: 'error',       message: string }
```

`path_add` is a server-side side-channel: when the `plan` (or `bike_route`) tool succeeds, the server emits one `path_add` per returned itinerary **before** sending the tool_result back to Claude. The map renders immediately while Claude continues reasoning.

### Agent SDK loop

```ts
import { query, tool } from '@anthropic-ai/claude-agent-sdk'

export async function* runTurn(input, ctx) {
  const tools = [
    tool('geocode',       desc.geocode,      zGeocode,      geocodeImpl(ctx)),
    tool('plan',          desc.plan,         zPlan,         planImpl(ctx)),
    tool('bike_route',    desc.bikeRoute,    zBikeRoute,    bikeImpl(ctx)),
    tool('search_stops',  desc.searchStops,  zSearchStops,  searchStopsImpl(ctx)),
    tool('nearby_stops',  desc.nearbyStops,  zNearbyStops,  nearbyStopsImpl(ctx)),
  ]
  for await (const ev of query({
    prompt: input.messages,
    model: input.model ?? process.env.MODEL ?? 'claude-sonnet-4-6',
    systemPrompt: SYSTEM_PROMPT(input.origin),
    tools,
    maxTokens: 4096,
  })) {
    for (const sseEv of mapSdkEventToSse(ev, ctx)) yield sseEv
  }
}
```

### Tools

Each tool is implemented as a thin wrapper around existing code. The wrapper does two things:

1. Emits one or more `path_add` SSE events for any new itinerary/route geometry (side-channel to map).
2. Returns a **summary** (≤500 tokens) to Claude — never the full itinerary JSON. The full geometry stays on the browser side via `path_add`.

This is the key token-discipline rule: three `plan` calls would otherwise return ~30KB to Claude.

#### geocode

```ts
zGeocode = z.object({ query: z.string() })
// returns: { lat, lon, displayName } | { ok: false, error }
```

Calls existing Nominatim proxy. Melbourne-biased (existing setup).

#### plan

```ts
zPlan = z.object({
  from: z.union([z.string(), zLatLon]),    // place name or {lat,lon}
  to:   z.union([z.string(), zLatLon]),
  depart: z.string().optional(),            // ISO or HH:MM (Melbourne local)
  arriveBy: z.string().optional(),
  mode: z.enum(['bike-train', 'bike-only']).default('bike-train'),
  goal: z.enum(['commute', 'day-ride', 'max-path']).default('commute'),
  maxTransfers: z.number().int().min(0).max(2).default(1),
  preferBikePath: z.boolean().optional(),
  hillWeight: z.number().optional(),
})
// Place-name `from`/`to` are auto-geocoded inside the tool before delegation.
// Returns: { itineraryCount, summaries: [{label, distance, duration, transfers, on_path_pct}] }
```

Calls `orchestrator.plan()` from existing code path. Emits one `path_add` per returned itinerary as a side effect via `ctx.emit`.

#### bike_route

```ts
zBikeRoute = z.object({
  from: z.union([z.string(), zLatLon]),
  to:   z.union([z.string(), zLatLon]),
  goal: z.enum(['commute', 'day-ride', 'max-path']).default('commute'),
})
// returns: { distance_km, duration_min, on_path_km, ascend_m, descend_m }
```

Direct access to the bike-routing engines without going through PTV transit. Useful when Claude is doing pure-bike requests.

#### search_stops

```ts
zSearchStops = z.object({ term: z.string(), routeType: z.number().int().optional() })
// returns: array of {stop_id, name, suburb, route_type} — top 10
```

#### nearby_stops

```ts
zNearbyStops = z.object({ lat: z.number(), lon: z.number(), maxKm: z.number().optional() })
// returns: array of {stop_id, name, distance_km, route_type} — top 10
```

### System prompt

```
You help plan bike + train trips in Melbourne, Australia.

Available tools:
- geocode: text → lat,lon (Melbourne-biased)
- plan: bike+train (or bike-only) trip planner with goal/transfer/timing options
- bike_route: pure bicycle routing with goal=commute/day-ride/max-path
- search_stops: find PTV stops by name
- nearby_stops: find PTV stops near a coordinate

When the user describes a trip:
1. Geocode any place names that aren't already coordinates.
2. Call `plan` (or `bike_route` for pure-bike asks). You may call plan multiple times
   to compare goals (e.g. commute vs day-ride) or modes — each call adds candidate
   path(s) to the user's map.
3. End with a short summary of the paths found. Don't repeat the geometry; the user
   sees the polylines on the map. Name each path so they can pick one.

Today is {date}. Origin hint: {origin or "unknown"}.
Keep replies concise. Don't pre-explain — just call tools and report.
```

## Frontend

### Stack

Vanilla TypeScript + Leaflet. esbuild bundles to `src/chat/static-assets/app.js`. No React, no HTMX. ~30KB bundle target.

### Layout

Desktop:
- Leaflet map: 100% viewport.
- Chat dock: 360px right-anchored, collapsible to a 40px tab.
- Tool-call log: floating panel bottom-right, ~400×300, on-demand via "show trace" button in chat header.

Mobile (<768px):
- Chat collapses to a bottom sheet (peek/half/full snap, mirroring existing ptv-web pattern).
- Log overlay full-width above the sheet when toggled.

### State

```ts
type AppState = {
  messages: SDKMessage[]              // localStorage 'ptv-chat:messages'
  currentTurnPaths: Path[]            // cleared on user send
  activePathId: string | null
  logOpen: boolean
  logEntries: LogEntry[]              // cleared on user send
  origin: GeolocationCoordinates | null
}
type Path = {
  id: string
  label: string
  color: string
  itinerary: Itinerary
}
type LogEntry = {
  id: string
  name: string
  args: object
  result?: { ok: boolean, summary: string }
  startedAt: number
  finishedAt?: number
}
```

### Turn lifecycle

1. User submits text:
   - Push user message to `messages`, save to localStorage.
   - Clear `currentTurnPaths`, `logEntries`, active path. Clear map polylines.
2. Open SSE `POST /api/chat` (using `fetch` + `ReadableStream` since `EventSource` doesn't support POST).
3. On each event:
   - `text_delta` → append to current assistant bubble.
   - `tool_call` → push log entry.
   - `tool_result` → fill in log entry's result.
   - `path_add` → register path; assign color from palette; draw polyline on map; render chip in chat.
   - `turn_end` → finalize assistant message; save to localStorage.
   - `error` → render banner, allow retry.

### Path interaction

- Click polyline OR click chip → `activePathId = id`. Active: 5px stroke. Others: 2px @ 40% opacity.
- Click active again → deactivate.
- Chip shows: label, distance, duration, transfer count.

### Color palette

Six distinct hues, assigned in order: `#e6194b #3cb44b #4363d8 #f58231 #911eb4 #008080`. Cycles if >6 paths in a turn.

### LocalStorage keys

- `ptv-chat:messages` — full conversation history
- `ptv-chat:logOpen` — log popup pinned state
- `ptv-chat:dockCollapsed` — chat panel collapse state

"New chat" button clears `messages` only.

## Data flow example

User: *"bike to Hurstbridge, train to Belgrave, then bike home to Fitzroy"*

```
turn_start
text_delta  "Let me work out the legs."
tool_call   geocode { query: "Fitzroy" }
tool_result geocode → -37.798,144.978
tool_call   plan { from: -37.798,144.978, to: hurstbridge, mode: bike-only }
path_add    { label: "to Hurstbridge", color: red, itinerary: {...} }
tool_result plan → "1 itinerary, 18km, 1h05m"
tool_call   plan { from: hurstbridge, to: belgrave, mode: bike-train }
path_add    { label: "train leg", color: green, itinerary: {...} }
tool_result plan → "1 itinerary, 2 transfers, 1h20m"
tool_call   plan { from: belgrave, to: -37.798,144.978, mode: bike-only }
path_add    { label: "from Belgrave", color: blue, itinerary: {...} }
tool_result plan → "1 itinerary, 42km, 2h10m"
text_delta  "Three legs found — pick any to see details."
turn_end
```

## Deploy on totoro

### Dockerfile

Multi-stage build:
1. Stage 1: install all deps, build TS + frontend.
2. Stage 2: alpine + node, copy `dist/`, `node_modules` (prod only), `src/chat/static-assets/`.
3. EXPOSE 8086.
4. HEALTHCHECK uses `127.0.0.1` not `localhost` (lesson from ptv-dsz IPv6 fix).

### Compose snippet

```yaml
services:
  ptv-chat:
    image: ptv-chat:latest
    container_name: ptv-chat
    restart: unless-stopped
    ports:
      - "8086:8086"
    environment:
      PORT: 8086
      MODEL: claude-sonnet-4-6
      LOG_LEVEL: info
      NOMINATIM_URL: http://nominatim:8080
      GH_REST_URL: http://graphhopper-vic-bike:8989/route
      OSRM_AU_BICYCLE_URL: http://osrm-au-bicycle:5000
      OSRM_AU_FOOT_URL: http://osrm-au-foot:5000
      PTV_DEV_ID: ${PTV_DEV_ID}
      PTV_API_KEY: ${PTV_API_KEY}
    volumes:
      - claude-creds:/root/.claude:ro
    networks:
      - nominatim_default
      - graphhopper_default
      - osrm-au_default
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:8086/healthz"]
      interval: 30s
volumes:
  claude-creds:
    external: true
networks:
  nominatim_default:    { external: true }
  graphhopper_default:  { external: true }
  osrm-au_default:      { external: true }
```

### Subscription auth (one-time setup on totoro)

1. SSH to totoro. Ensure `claude login` has been run on the host once.
2. `docker volume create claude-creds`.
3. Seed the volume with host creds:
   ```bash
   docker run --rm -v claude-creds:/dst -v $HOME/.claude:/src:ro alpine \
     sh -c "cp -r /src/. /dst/"
   ```
4. Container mounts read-only. Tokens stay scoped to your Claude Max subscription.

On token refresh, re-run step 3. **Open follow-up bead**: sidecar that re-syncs daily.

### Tailnet exposure

Add `ptv-chat` to the existing Tailscale sidecar's magic-DNS aliases. Reachable at `http://ptv-chat.magpie-inconnu.ts.net:8086`. No TLS, no auth — tailnet provides transport security.

## Testing

### Unit (vitest)

- `geocodeImpl`, `planImpl`, `bikeImpl` with mocked external deps. Assert: emits expected `path_add` events; returns correct summary shape.
- `mapSdkEventToSse`: scripted SDK event sequence → expected SSE event sequence.
- State reducer: `turn_start` clears paths and log; `path_add` appends and assigns palette color; palette cycling when n>6.
- Color assignment deterministic given insertion order.

### Integration (vitest)

- Fastify in-process, mock Agent SDK `query()` to yield a scripted event iterator.
- Hit `POST /api/chat`, parse SSE response, assert byte-accurate event ordering.

### E2e (playwright)

- Open `/`, send a message, intercept `/api/chat` and stream a canned event sequence.
- Assert: chat bubbles render in order; polylines appear on map; clicking chip activates path (others dim); log popup toggles open and lists entries.
- Reload page after a turn: assistant message persists from localStorage; map starts empty.
- Mobile viewport (375×667): chat is bottom-sheet; map full-bleed underneath.

### Manual smoke after deploy

- `curl http://ptv-chat.magpie-inconnu.ts.net:8086/healthz` returns 200.
- Load `/` from laptop, type "bike to Camberwell station from Brunswick", expect path to appear within ~5s.

## Risks & open questions

- **Claude token refresh.** Subscription auth uses short-lived tokens; the read-only mount strategy needs a re-sync cadence. Tracking as a bead, not blocking v1.
- **Tool loop runaway.** No max-turn cap on Agent SDK loop. Add a hard `maxToolUses: 10` in `query()` config to bound a single chat turn.
- **Long conversations.** No summarization; history grows unbounded in localStorage and request body. Acceptable for v1 (typical session <20 turns).
- **Plan call latency.** Each `plan` is 2–5s; three calls is 10–15s of perceived wait. SSE streaming of text + tool events should make this feel responsive. Watch in practice.

## Out of scope — open beads after v1

- Multi-OD `plan` (one tool call for multi-leg trips).
- Conversation summarization / context compaction.
- Save / share a plan via URL hash.
- Strava popularity overlay on chat-generated paths (overlap with `ptv-5fy`).
- Voice input.
- Auto-refresh of mounted Claude creds.
