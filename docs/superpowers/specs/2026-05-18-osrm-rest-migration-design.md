# OSRM subprocess → LAN REST migration

**Bead:** ptv-7qp (P1, v1.7, web)
**Date:** 2026-05-18
**Status:** Design approved; awaiting plan.

## Problem

`src/plan/external.ts` invokes `osrm-au` via `spawnSync` for bike routing
(`osrmTable`, `osrmRoute`). The web server is now containerised
(`Dockerfile`, `docker-compose.snippet.yml`), and the `node:20-alpine`
runtime image has no `osrm-au` binary. Result: `POST /api/plan` works
locally but breaks in-container, gating `--goal commute` from the
deployed web UI.

## Insight

`~/bin/osrm-au` is itself a thin Python HTTP wrapper around the standard
OSRM HTTP API. The LAN OSRM REST services already exist on totoro as
three docker containers:

| Profile | Host port | In-network host:port    |
| ------- | --------- | ----------------------- |
| car     | 5001      | `osrm-au-car:5000`      |
| bicycle | 5002      | `osrm-au-bicycle:5000`  |
| foot    | 5003      | `osrm-au-foot:5000`     |

All three are joined to the external docker network `osrm-au_default`.
There is nothing to deploy — we only need to replace the subprocess hop
with native `fetch`.

## Scope

In `src/plan/external.ts`, replace the two callers of `spawnSync` for
OSRM with native `fetch` to the OSRM HTTP API. Behaviour visible to the
rest of the codebase is unchanged: `osrmTable` and `osrmRoute` keep
their existing signatures and return shapes.

Only `bicycle` and `foot` profiles are migrated; `car` is dropped (no
caller, YAGNI).

## Code changes

All changes in `src/plan/external.ts`:

- **Remove:**
  - `OSRM_BIN` constant (env `OSRM_AU_BIN` no longer consulted).
  - `osrmPointArg` helper.
  - Argparse-quoting comment block (no longer relevant).
- **Keep:** `runJson` (still used by `ghRouteBike`).
- **Keep:** `decodePolyline` (used to decode OSRM's encoded polyline geometry).
- **Add:** profile→port map and base-URL resolver:

  ```ts
  const OSRM_AU_HOST = process.env.OSRM_AU_HOST ?? 'totoro.magpie-inconnu.ts.net';
  const PROFILE_PORT = { bicycle: 5002, foot: 5003 } as const;

  function osrmBase(profile: 'bicycle' | 'foot'): string {
    const override =
      profile === 'bicycle'
        ? process.env.OSRM_AU_BICYCLE_URL
        : process.env.OSRM_AU_FOOT_URL;
    return override ?? `http://${OSRM_AU_HOST}:${PROFILE_PORT[profile]}`;
  }
  ```

- **Rewrite `osrmTable(profile, source, destinations)`:**
  - Build URL: `${osrmBase(profile)}/table/v1/driving/${coordPath}` where
    `coordPath` is `lon,lat;lon,lat;...` over `[source, ...destinations]`.
    Note the lat/lon flip at the wire boundary — internal `LatLon` stays
    `{lat, lon}`.
  - Query string:
    `annotations=duration,distance&sources=0&destinations=1;2;...;N`.
  - Validate `data.code === 'Ok'`. Throw
    `OSRM ${profile} table: ${data.code} - ${data.message}` otherwise.
  - Return `{ durations: data.durations[0] ?? [], distances: data.distances[0] ?? [] }`.
- **Rewrite `osrmRoute(profile, from, to)`:**
  - Build URL: `${osrmBase(profile)}/route/v1/driving/${lonFrom},${latFrom};${lonTo},${latTo}`.
  - Query string: `overview=full&geometries=polyline` (precision 5, matches
    `decodePolyline`'s default).
  - Validate `data.code === 'Ok'`, otherwise throw.
  - Extract `routes[0]`; throw if `distance` or `duration` missing.
  - Return `{ km: distance/1000, min: duration/60, geometry: decodePolyline(routes[0].geometry) }`.

URL path prefix is always `/driving` regardless of the configured
profile — each profile runs on its own port (or its own container in
the docker network), and OSRM's HTTP API hardcodes the path. Mirrors
the Python wrapper's behaviour.

## Configuration

| Env var                | Default                              | Purpose                                                    |
| ---------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `OSRM_AU_HOST`         | `totoro.magpie-inconnu.ts.net`       | Host where OSRM REST services run (laptop / tailnet case)  |
| `OSRM_AU_BICYCLE_URL`  | _unset_                              | Full base URL override for bicycle profile (container case)|
| `OSRM_AU_FOOT_URL`     | _unset_                              | Full base URL override for foot profile (container case)   |

Removed: `OSRM_AU_BIN`. Documented removal in `CLAUDE.md` "Optional
environment overrides" section.

## Compose snippet

Update `docker-compose.snippet.yml`:

```yaml
services:
  ptv-web:
    environment:
      # ... existing env ...
      OSRM_AU_BICYCLE_URL: http://osrm-au-bicycle:5000
      OSRM_AU_FOOT_URL: http://osrm-au-foot:5000
    networks:
      - default
      - nominatim_default
      - twenty_default
      - graphhopper_default
      - osrm-au_default              # NEW

networks:
  # ... existing ...
  osrm-au_default:                   # NEW
    external: true
```

## Tests

- **Unit (`tests/unit/plan/external.test.ts`):**
  - Stub `globalThis.fetch` to return canned OSRM responses for
    `/route/v1/driving/...` and `/table/v1/driving/...`.
  - Assert: URL has correct `lon,lat` order (i.e. lat/lon flip
    happens); `annotations=duration,distance` query param present;
    `sources=0&destinations=...` correct for `osrmTable`;
    `osrmRoute` returns a decoded `GeoJsonLineString` from a known
    polyline.
  - Error path: `fetch` returns `{ code: 'NoRoute', message: '...' }`
    → both functions throw with code + message.
- **Remove:** any `vi.doMock('child_process', ...)` stubs targeting
  `osrm-au` (the gh-route subprocess mocks stay).
- **Integration (`tests/integration/`):** existing tests that exercise
  the plan path should keep passing once `OSRM_AU_HOST` points at a
  reachable OSRM service. No new integration test required.
- **E2e:** existing `tests/e2e/cli.test.ts` should keep passing
  end-to-end after rebuild. The win is that the same e2e now also
  works against the container image.

## Failure modes

- OSRM returns `code: 'NoRoute' | 'NoSegment' | ...`: throw a typed
  error message; `orchestrator.ts` already bubbles this the same way it
  bubbled non-zero subprocess exits.
- `fetch` network failure (DNS / connect refused): let the error
  propagate. The orchestrator's existing error handling treats it
  identically to a subprocess failure.
- No timeout is added in this migration. The Python wrapper uses 45s;
  if future ops calls for it, add `AbortController` with the same value
  in a follow-up bead.

## Out of scope

- `car` profile support.
- Standing up new OSRM services (the three on totoro suffice).
- Reverse proxy in front of the OSRM containers to give a single URL.
- Fetch retry / circuit breaker (a follow-up if needed).
- Replacing the subprocess hop in `ghRouteBike` (separate concern — see
  `GH_ROUTE_BIN`; tracked elsewhere if/when it bites in-container).
