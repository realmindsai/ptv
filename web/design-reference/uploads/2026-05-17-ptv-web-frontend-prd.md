# ptv web frontend — PRD

**Bead:** `ptv-t3x` (epic), `ptv-t3x.1`, `ptv-t3x.2`
**Date:** 2026-05-17
**Status:** design-free; a design doc can be generated from this independently
**Companion design:** `2026-05-17-ptv-web-frontend-design.md`

> This document captures **what** and **why**. It deliberately contains no architecture, file layouts, framework choices, or API shapes. Any of those decisions could be made differently while still satisfying this PRD.

## Problem

`ptv plan` is currently a CLI tool. To use it I have to be at a terminal with the repo built, with credentials in env vars, and willing to copy lat/lon pairs around. That kills its usefulness in the moment — on a phone, standing at a station, deciding whether to ride.

## Goals

1. **Plan a trip from a phone or browser** without touching the CLI, anywhere I can reach the tailnet.
2. **Express origin/destination by place name** (e.g. "Hurstbridge", "Williamstown"), not coordinates.
3. **See the result on a map**, not as raw JSON, with the same routing options the CLI exposes today (`--goal`, `--mode`, `--hill-weight`, `--min-on-path-fraction`, `--max-transfers`, depart/arrive-by, etc.).
4. **Click two points on a map to plan between them** (Phase 2) — the natural mobile UX for the "where to ride" question.
5. **Install to phone home screen** (Phase 2) and have it feel like an app: launches into the map, remembers the last trip, works offline enough to be useful while signal is patchy.

## Non-goals

- Public/internet hosting. Tailnet-only is fine and removes auth/rate-limiting/credential-leak risk.
- A web UI for other PTV subcommands (`departures`, `disruptions`, `stops`, etc.). Only `plan` warrants a UI.
- Replacing the CLI. CLI stays the source of truth; the web UI is a thin alternative surface.
- Trip history sync across devices.
- Turn-by-turn live navigation or "you've deviated from your route" re-routing (that's the `--gpx` export path in bead `ptv-0dm`).
- A polished design system. Functional > pretty.

## Users

One user: me (Doctor Dee). On laptop in my study, on phone at home, on phone outside the house when on the tailnet (Tailscale runs on my devices). No other users now or planned.

## Success criteria

The Phase 1 ship is successful when:
- I can open a URL on my phone (on tailnet), type "Hurstbridge" and "Williamstown", pick a goal, hit Plan, and see the route on a map within ~5 seconds of submit.
- All routing options exposed by the CLI today are reachable from the form (even if some live behind an "advanced" toggle).
- Re-planning the same trip is fast (cached).
- Nothing in the deploy story requires me to manually run anything other than `docker compose up -d` on totoro.

The Phase 2 ship is successful when, additionally:
- I can tap two spots on the map, and a trip plan appears without me typing anything.
- "Use my current location" works on the phone.
- A trip URL is shareable / bookmarkable — sending it to myself or pasting it into a note round-trips.
- The app is installed to my phone's home screen and opens to the map.
- The shell loads even when my phone has bad signal (PTV data still requires connectivity, but the app doesn't show a white-screen-of-death).

## Constraints

1. **Tailnet-hosted.** Access is already gated by Tailscale. The app can assume the user is trusted.
2. **Runs on totoro.** Totoro's existing conventions (Docker, magic-DNS hostnames, the running Nominatim + GraphHopper + Redis services) should be reused, not duplicated.
3. **Credentials don't leave the server.** The browser must never see `PTV_DEV_ID` or `PTV_API_KEY`.
4. **Repo style.** Minimal dependencies. Pristine test output. TS. No `--no-verify`. Existing patterns (commander subcommand factory, trimmed JSON output, `vi.stubGlobal`/`vi.doMock` for external deps) should extend naturally.
5. **No public CDNs at runtime.** The page must work on the tailnet even when the totoro box has no public-internet egress.
6. **The orchestrator stays authoritative.** Web and CLI must produce identical plans for identical inputs — no parallel routing logic. (Practically: the web layer calls the same plan code the CLI does.)
7. **Phase 2 must be additive.** Phase 1 should not paint itself into a corner that requires rewriting to ship Phase 2.

## Functional requirements

### Phase 1

- F1. Place-name input. User types text in `from` and `to` fields; the app resolves them to coordinates. Out-of-Victoria queries are de-prioritized.
- F2. Coordinate fallback. User can paste `lat,lon` (including negative coords) directly into either field and skip geocoding.
- F3. Trip parameters. Form exposes: depart-time OR arrive-by time (mutually exclusive), `mode` (bike-only / bike-train), `goal` (commute / day-ride / max-path), `prefer-bike-path` toggle, numeric `hill-weight`, numeric `min-on-path-fraction`, numeric `max-transfers`, numeric `min/max bike km`. Defaults match the CLI.
- F4. Results display. Multiple itineraries shown with their labels (e.g. "fastest", "recommended"), key metrics (total time, bike km, on-path km, transfers, ascend).
- F5. Map render. Each itinerary's geometry rendered as a toggleable Leaflet layer on a shared map, matching what `--html` produces today.
- F6. Error handling. Geocode failures, planner failures, and credential failures all produce human-readable error messages in the page (not stack traces, not blank screens).
- F7. Repeat-plan performance. Identical or trivially-different plan requests are served from cache (sub-100 ms response) within a short staleness window.
- F8. Deployment artifact. The app ships as a container that can be run alongside the other services on totoro with one config file change.

### Phase 2 (additive)

- F9. Map click-to-route. Clicking the map drops `from`, then `to`; a plan auto-fires when both pins exist. Pins are draggable; dragging re-fires the plan.
- F10. Geolocation. A button uses the browser's geolocation API to fill `from`.
- F11. Shareable trip URLs. The current trip's parameters are encoded in the URL such that pasting the URL into another browser session reproduces the trip. Browser back/forward traverses prior trips.
- F12. Reverse geocoding. Dropped pins show a human-readable label (street/suburb), not just coords.
- F13. Installable. The app meets the technical criteria a modern browser uses to offer "Install to home screen" / "Add to dock".
- F14. Offline shell. With no network, opening the installed app shows the UI shell (not a network-error page). It does not need to serve cached plan results offline; failing the plan with a clear "no network" message is acceptable.

## Non-functional requirements

- N1. **Latency budget.** A cold plan (no cache hit) for a typical Melbourne-metro trip completes end-to-end (form submit → results visible) in under 10 seconds on a phone over LAN Wi-Fi. A cache hit completes in under 1 second.
- N2. **No build step in the browser path that requires Node tooling end-users don't have.** Acceptable: a server-side build for the container image. Not acceptable: requiring me to `npm install` before opening the page.
- N3. **Test pyramid.** Unit, integration, and e2e tests for every behavior in F1–F14. No regressions in existing CLI tests.
- N4. **Single source of truth.** No duplication of routing parameters, defaults, or labels between CLI and web. If `--goal` gains a value tomorrow, the form gains it automatically (or the duplication is small enough to be one obvious line to change).
- N5. **Observability.** The server logs each plan request (params, cache hit/miss, total ms, outcome). Logs go to stdout in a format `docker logs` and any future log aggregator can ingest.

## External dependencies (assumed available on totoro)

These are *known existing services* on totoro that the design SHOULD prefer rather than re-host. If for any reason a future design decides not to use one of them, that's a tradeoff worth documenting — not a forbidden choice.

- A geocoder (forward + reverse) for Australian addresses and places.
- An OSM-style routing service for bike (path-aware) and car (basic).
- A key-value store with TTL semantics for caching.

## Open questions (for the design to resolve)

These are deliberately left for the design phase — they're choices, not requirements:

- Q1. Server framework / language / runtime.
- Q2. Server-rendered HTML, SPA, or hybrid.
- Q3. Cache implementation (in-memory, shared store, layered).
- Q4. How routing-engine subprocesses (currently `osrm-au`, `gh-route`) work inside a container — bake binaries, or call existing LAN services.
- Q5. URL/state encoding scheme for shareable trip links.
- Q6. PWA offline depth — shell only, or also cached last-N-trips.
- Q7. Whether the docker-compose definition lives in this repo or in a totoro-side infra repo.

## Risks

- R1. **Stale PTV data via aggressive caching.** Cache TTLs must respect that departure boards move.
- R2. **Geocoder gaps.** OSM may not have an entry for every station ("Hurstbridge Station" → empty was observed). The UX must handle zero-results, and the coord-fallback (F2) is a hard requirement.
- R3. **Subprocess routing in containers.** `osrm-au` and `gh-route` are currently spawned as local binaries. Either they get baked into the image (slower iteration, larger image) or the orchestrator gets switched to LAN HTTP services. This is the single biggest unknown for Phase 1 deploy.
- R4. **Scope creep into Phase 2 during Phase 1.** Click-to-route is tempting; resist until Phase 1 ships.
- R5. **Phone-Tailscale flakiness.** Out of scope to fix, but the UX should fail clearly when the tailnet is unreachable rather than hanging.

## Out-of-scope reminders

Pulled from the bead, repeated for reading:

- Public hosting; auth; per-IP rate limits.
- React/Svelte/etc. — overkill for a single-user tool.
- Other subcommands' UIs.
- Live re-routing / turn-by-turn.
- Trip history sync.
