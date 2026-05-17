# OSRM subprocess → LAN REST migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `spawnSync('osrm-au', ...)` calls in `src/plan/external.ts` with native `fetch` to the standard OSRM HTTP API so `/api/plan --goal commute` works inside the deployed container.

**Architecture:** Two functions (`osrmTable`, `osrmRoute`) keep their existing signatures and return shapes. Internals switch to `fetch` against `http://<host>:<port>/{route,table}/v1/driving/<lon,lat;…>`. Profile→port baked in (`bicycle=5002`, `foot=5003`). Per-profile URL override env vars (`OSRM_AU_BICYCLE_URL`, `OSRM_AU_FOOT_URL`) for the container case where all three OSRM services bind to port 5000 inside the `osrm-au_default` docker network. Drop `car`; YAGNI. Drop the subprocess path completely.

**Tech Stack:** TypeScript, Node 20+ native `fetch`, vitest, OSRM HTTP API (osrm-backend), docker compose.

**Spec:** `docs/superpowers/specs/2026-05-18-osrm-rest-migration-design.md`

---

## File map

- **Modify:** `src/plan/external.ts` — replace subprocess implementations of `osrmTable` and `osrmRoute`; remove `OSRM_BIN`, `osrmPointArg`, and the argparse comment block; keep `runJson` (still used by `ghRouteBike`) and `decodePolyline`.
- **Modify:** `tests/unit/plan/external.test.ts` — replace 3 existing `vi.doMock('child_process', …)` `osrmRoute` tests with `globalThis.fetch` stubs; add new `osrmTable` test suite.
- **Modify:** `docker-compose.snippet.yml` — add `OSRM_AU_BICYCLE_URL` and `OSRM_AU_FOOT_URL` env vars and join the `osrm-au_default` external network.
- **Modify:** `CLAUDE.md` — remove the `OSRM_AU_BIN` entry from the "Optional environment overrides" list; add `OSRM_AU_HOST`, `OSRM_AU_BICYCLE_URL`, `OSRM_AU_FOOT_URL`.

No new files.

---

## Task 1: Red — rewrite `osrmRoute` tests + add `osrmTable` tests against fetch

**Files:**
- Test: `tests/unit/plan/external.test.ts` (modify — replace lines 217-285 `describe('osrmRoute()')` block; append new `describe('osrmTable()')` block)

- [ ] **Step 1.1: Replace the three existing `osrmRoute` subprocess tests with fetch-stub equivalents**

Open `tests/unit/plan/external.test.ts`. Replace the entire `describe('osrmRoute()', () => { … })` block (lines 217-285) with:

```ts
describe('osrmRoute()', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OSRM_AU_HOST;
    delete process.env.OSRM_AU_BICYCLE_URL;
    delete process.env.OSRM_AU_FOOT_URL;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('hits /route/v1/driving with lon,lat order (NOT lat,lon)', async () => {
    process.env.OSRM_AU_HOST = 'osrm.example';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmRoute } = await import('../../../src/plan/external');
    await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('http://osrm.example:5002/route/v1/driving/');
    // lon,lat;lon,lat — note the order flip vs internal LatLon
    expect(url).toContain('144.96,-37.78;144.97,-37.79');
    expect(url).toContain('overview=full');
    expect(url).toContain('geometries=polyline');
  });

  it('uses port 5003 for the foot profile', async () => {
    process.env.OSRM_AU_HOST = 'osrm.example';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 100, duration: 120, geometry: '_p~iF~ps|U' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmRoute } = await import('../../../src/plan/external');
    await osrmRoute('foot', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://osrm.example:5003/route/v1/driving/');
  });

  it('honours OSRM_AU_BICYCLE_URL override (container case)', async () => {
    process.env.OSRM_AU_BICYCLE_URL = 'http://osrm-au-bicycle:5000';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmRoute } = await import('../../../src/plan/external');
    await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://osrm-au-bicycle:5000/route/v1/driving/');
  });

  it('returns km and min computed from native units', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    })));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.km).toBeCloseTo(1.5);
    expect(r.min).toBeCloseTo(6);
  });

  it('decodes the encoded polyline into a GeoJSON LineString', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    })));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.geometry).not.toBeNull();
    expect(r.geometry!.type).toBe('LineString');
    expect(r.geometry!.coordinates).toHaveLength(2);
    const [lon1, lat1] = r.geometry!.coordinates[0];
    expect(lon1).toBeCloseTo(144.96, 1);
    expect(lat1).toBeCloseTo(-37.78, 1);
  });

  it('throws when OSRM responds with code !== "Ok"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 'NoRoute', message: 'Impossible route' }),
    })));
    const { osrmRoute } = await import('../../../src/plan/external');
    await expect(
      osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 }),
    ).rejects.toThrow(/NoRoute/);
  });

  it('throws when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    const { osrmRoute } = await import('../../../src/plan/external');
    await expect(
      osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 }),
    ).rejects.toThrow(/502/);
  });
});
```

Make sure `afterEach` is imported from `vitest` at the top of the file (the existing imports already include `vi`/`beforeEach`; add `afterEach` to the same destructure on line 1).

- [ ] **Step 1.2: Append a new `describe('osrmTable()')` block at the end of the file**

```ts
describe('osrmTable()', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OSRM_AU_HOST;
    delete process.env.OSRM_AU_BICYCLE_URL;
    delete process.env.OSRM_AU_FOOT_URL;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns empty arrays when destinations list is empty (no fetch call)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { osrmTable } = await import('../../../src/plan/external');
    const r = await osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, []);
    expect(r).toEqual({ durations: [], distances: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hits /table/v1/driving with source then destinations in lon,lat order', async () => {
    process.env.OSRM_AU_HOST = 'osrm.example';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        durations: [[0, 120, 240]],
        distances: [[0, 1000, 2000]],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmTable } = await import('../../../src/plan/external');
    await osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [
      { lat: -37.79, lon: 144.97 },
      { lat: -37.80, lon: 144.98 },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('http://osrm.example:5002/table/v1/driving/');
    // Three semicolon-separated lon,lat pairs (source + 2 destinations)
    expect(url).toContain('144.96,-37.78;144.97,-37.79;144.98,-37.8');
    expect(url).toContain('annotations=duration%2Cdistance');
    expect(url).toContain('sources=0');
    expect(url).toContain('destinations=1%3B2');
  });

  it('returns row 0 of the durations/distances matrices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        durations: [[0, 120, 240]],
        distances: [[0, 1000, 2000]],
      }),
    })));
    const { osrmTable } = await import('../../../src/plan/external');
    const r = await osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [
      { lat: -37.79, lon: 144.97 },
      { lat: -37.80, lon: 144.98 },
    ]);
    expect(r.durations).toEqual([0, 120, 240]);
    expect(r.distances).toEqual([0, 1000, 2000]);
  });

  it('throws when OSRM responds with code !== "Ok"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 'InvalidQuery', message: 'bad' }),
    })));
    const { osrmTable } = await import('../../../src/plan/external');
    await expect(
      osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [{ lat: -37.79, lon: 144.97 }]),
    ).rejects.toThrow(/InvalidQuery/);
  });

  it('throws when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const { osrmTable } = await import('../../../src/plan/external');
    await expect(
      osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [{ lat: -37.79, lon: 144.97 }]),
    ).rejects.toThrow(/503/);
  });
});
```

- [ ] **Step 1.3: Run the test file and confirm new tests fail (the subprocess code is still in place)**

Run: `npx vitest run tests/unit/plan/external.test.ts`

Expected: many failures in `osrmRoute()` and `osrmTable()` blocks. The existing implementation calls `spawnSync` and ignores `fetch`, so the new tests will either (a) try to spawn `osrm-au` and fail because no fetch was called, or (b) hit URLs that don't match expectations. The `parseGhRoute`, `ghRouteCustom`, and `MAX_PATH_CUSTOM_MODEL` blocks should still pass — if any of them break, stop and investigate (the changes should be confined to `osrmRoute`/`osrmTable` only).

- [ ] **Step 1.4: Commit red phase**

```bash
git add tests/unit/plan/external.test.ts
git commit -m "test(plan): expect OSRM REST instead of subprocess for table/route (ptv-7qp)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Green — rewrite `osrmTable` and `osrmRoute` to use `fetch`

**Files:**
- Modify: `src/plan/external.ts` (lines 6, 60-67, 69-136)

- [ ] **Step 2.1: Replace the `OSRM_BIN` constant and the `osrmPointArg` helper with the new host/port resolver**

In `src/plan/external.ts`:

Delete line 6 (`const OSRM_BIN = …`).

Delete lines 60-67 (the `// osrm-au CLI (current) uses lat,lon order …` comment block and the `osrmPointArg` function).

Just below the `decodePolyline` function (line 42), add:

```ts
const OSRM_AU_HOST = process.env.OSRM_AU_HOST ?? 'totoro.magpie-inconnu.ts.net';
const OSRM_PROFILE_PORT = { bicycle: 5002, foot: 5003 } as const;

type OsrmProfile = keyof typeof OSRM_PROFILE_PORT;

function osrmBase(profile: OsrmProfile): string {
  const override =
    profile === 'bicycle'
      ? process.env.OSRM_AU_BICYCLE_URL
      : process.env.OSRM_AU_FOOT_URL;
  return override ?? `http://${OSRM_AU_HOST}:${OSRM_PROFILE_PORT[profile]}`;
}

function osrmCoordPath(points: LatLon[]): string {
  // OSRM wire format is lon,lat — flip from our internal {lat, lon}.
  return points.map((p) => `${p.lon},${p.lat}`).join(';');
}
```

The `OSRM_AU_HOST` env var falls through to a constant default at module load time — that's fine for the runtime; the tests reset modules via `vi.resetModules()` to pick up env changes per test.

Also remove the obsolete `homedir` import on line 3 *only if it's no longer used*. Check: `GH_BIN` on line 44-45 doesn't use `homedir` (it uses `resolve(__dirname, …)`), and nothing else in the file uses it. Delete the import.

- [ ] **Step 2.2: Rewrite `osrmTable`**

Replace lines 69-93 (the entire `export async function osrmTable(...)`) with:

```ts
export async function osrmTable(
  profile: OsrmProfile,
  source: LatLon,
  destinations: LatLon[],
): Promise<{ durations: number[]; distances: number[] }> {
  if (destinations.length === 0) return { durations: [], distances: [] };
  const coords = osrmCoordPath([source, ...destinations]);
  const destIdx = destinations.map((_, i) => String(i + 1)).join(';');
  const qs = new URLSearchParams({
    annotations: 'duration,distance',
    sources: '0',
    destinations: destIdx,
  });
  const url = `${osrmBase(profile)}/table/v1/driving/${coords}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OSRM ${profile} table HTTP ${r.status}`);
  const data = (await r.json()) as {
    code?: string; message?: string;
    durations?: number[][]; distances?: number[][];
  };
  if (data.code && data.code !== 'Ok') {
    throw new Error(`OSRM ${profile} table: ${data.code} - ${data.message ?? ''}`);
  }
  if (!data.durations || !data.distances) {
    throw new Error('osrm-au table response missing durations/distances');
  }
  return {
    durations: data.durations[0] ?? [],
    distances: data.distances[0] ?? [],
  };
}
```

The function signature changes from `profile: 'bicycle' | 'foot'` to `profile: OsrmProfile`. Same set, just expressed via the type alias.

- [ ] **Step 2.3: Rewrite `osrmRoute`**

Replace lines 95-136 (the entire `export async function osrmRoute(...)`) with:

```ts
export async function osrmRoute(
  profile: OsrmProfile,
  from: LatLon,
  to: LatLon,
): Promise<{ km: number; min: number; geometry: GeoJsonLineString | null }> {
  const coords = osrmCoordPath([from, to]);
  const qs = new URLSearchParams({
    overview: 'full',
    geometries: 'polyline',
  });
  const url = `${osrmBase(profile)}/route/v1/driving/${coords}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OSRM ${profile} route HTTP ${r.status}`);
  const data = (await r.json()) as {
    code?: string; message?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: GeoJsonLineString | string;
    }>;
  };
  if (data.code && data.code !== 'Ok') {
    throw new Error(`OSRM ${profile} route: ${data.code} - ${data.message ?? ''}`);
  }
  const route = data.routes?.[0];
  if (route?.distance === undefined || route?.duration === undefined) {
    throw new Error('osrm-au route response missing distance/duration');
  }
  let geom: GeoJsonLineString | null = null;
  if (route.geometry) {
    if (typeof route.geometry === 'object') {
      geom = route.geometry as GeoJsonLineString;
    } else if (typeof route.geometry === 'string') {
      try {
        geom = decodePolyline(route.geometry);
      } catch {
        geom = null;
      }
    }
  }
  return {
    km: route.distance / 1000,
    min: route.duration / 60,
    geometry: geom,
  };
}
```

Note `runJson` is no longer called from this function. Confirm it's still referenced (by `ghRouteBike` on line 261) — it is. Leave `runJson` in place.

Also confirm `spawnSync` is still imported (line 1) — it's used by `runJson` (line 51). Leave the import.

- [ ] **Step 2.4: Run the external test file and confirm everything passes**

Run: `npx vitest run tests/unit/plan/external.test.ts`

Expected: all tests in the file pass — `parseGhRoute` (10 tests), `ghRouteCustom` (4), `MAX_PATH_CUSTOM_MODEL` (2), `osrmRoute` (7 new), `osrmTable` (5 new).

If a test fails, read the diff against the expected fetch URL or response shape and fix the implementation. Do **not** modify the test to match a buggy implementation.

- [ ] **Step 2.5: Run the broader unit suite to catch knock-on damage**

Run: `npm run test:unit`

Expected: all unit tests pass. `candidates.test.ts` and `orchestrator.test.ts` pass mocked `external` objects, so they're insulated from this change — but run them anyway to confirm no unexpected coupling.

If anything breaks, investigate before proceeding.

- [ ] **Step 2.6: Type-check the build**

Run: `npm run build`

Expected: clean tsc compile. The `OsrmProfile` type alias and the `URLSearchParams` import should both be standard-lib types; no new dependencies needed.

If TS complains about `profile: OsrmProfile` not assignable to `'bicycle' | 'foot'` at call sites in `candidates.ts` or `orchestrator.ts`, that's expected to be fine (the alias *is* that union), but if it surfaces, narrow at the call site or export `OsrmProfile`.

- [ ] **Step 2.7: Commit green phase**

```bash
git add src/plan/external.ts
git commit -m "refactor(plan): osrm-au subprocess -> LAN OSRM REST (ptv-7qp)

Replaces spawnSync('osrm-au', ...) in osrmTable/osrmRoute with native
fetch to the standard OSRM HTTP API (route/v1, table/v1 over /driving).
Profile->port baked in (bicycle=5002, foot=5003) with per-profile URL
overrides for the container case. Drops car profile; YAGNI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Update compose snippet for container deploy

**Files:**
- Modify: `docker-compose.snippet.yml`

- [ ] **Step 3.1: Add the two URL overrides and the osrm network**

Edit `docker-compose.snippet.yml`. In `services.ptv-web.environment`, add (preserve alphabetical-ish ordering near the other URL envs):

```yaml
      OSRM_AU_BICYCLE_URL: http://osrm-au-bicycle:5000
      OSRM_AU_FOOT_URL: http://osrm-au-foot:5000
```

In `services.ptv-web.networks`, add:

```yaml
      - osrm-au_default
```

At the bottom under `networks:`, add:

```yaml
  osrm-au_default:
    external: true
```

- [ ] **Step 3.2: Lint the YAML by parsing it**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('docker-compose.snippet.yml'))" && echo OK`

Expected: `OK`. If parsing fails, fix indentation.

- [ ] **Step 3.3: Commit**

```bash
git add docker-compose.snippet.yml
git commit -m "build(compose): wire ptv-web into osrm-au_default network (ptv-7qp)

Container reaches the three OSRM REST containers on port 5000 via their
in-network hostnames (osrm-au-bicycle, osrm-au-foot), shortcircuiting
the OSRM_AU_HOST tailnet path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Update `CLAUDE.md` env var reference

**Files:**
- Modify: `CLAUDE.md` (the "Optional environment overrides" list under "Credentials")

- [ ] **Step 4.1: Swap the OSRM env entry**

Find the line:

```
- `OSRM_AU_BIN` — path to the `osrm-au` binary (default `~/bin/osrm-au`)
```

Replace it with:

```
- `OSRM_AU_HOST` — host for LAN OSRM REST services (default `totoro.magpie-inconnu.ts.net`; profiles on ports 5002/bicycle, 5003/foot)
- `OSRM_AU_BICYCLE_URL` — full base URL override for the bicycle profile (e.g. `http://osrm-au-bicycle:5000` inside the `osrm-au_default` docker network)
- `OSRM_AU_FOOT_URL` — full base URL override for the foot profile
```

- [ ] **Step 4.2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update OSRM env vars to REST-based config (ptv-7qp)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Integration smoke against the live LAN OSRM

**Files:** none modified — this is a runtime verification.

- [ ] **Step 5.1: Run the e2e suite against the built CLI**

Run: `npm run build && npm run test:e2e`

Expected: all e2e tests pass. The `plan ... --goal commute` path is exercised end-to-end; if `OSRM_AU_HOST` reaches the LAN services, this confirms the migration works.

If the e2e suite has no `--goal commute` case, skip this sub-step.

- [ ] **Step 5.2: Manual smoke — plan a real commute trip**

Run:

```bash
node dist/index.js plan -37.78,144.96 -37.81,145.02 --goal commute --no-enrich --depart 09:00
```

Expected: JSON itineraries on stdout, no errors, no `osrm-au` subprocess invocation (the binary on disk is irrelevant now). At least one itinerary has a `bike` leg with `km > 0` and a non-null `geometry` of type `LineString`.

If the request 404s or returns `code: 'NoRoute'`, sanity-check the LAN service is up: `curl -s 'http://totoro.magpie-inconnu.ts.net:5002/route/v1/driving/144.96,-37.78;145.02,-37.81?overview=false' | head -c 200`. If that returns OK, the issue is in our code.

- [ ] **Step 5.3: Manual smoke — container build**

Run:

```bash
docker build -t ptv-web:ptv-7qp .
```

Expected: clean build. No `osrm-au` binary needed in the image.

(Skip a full compose-up here; that's a deploy-time concern owned by the totoro deployment workflow, not this bead.)

---

## Task 6: Close out

- [ ] **Step 6.1: Confirm full test suite is green**

Run: `npm test`

Expected: all suites pass (unit + integration + e2e). Integration tests skip themselves when PTV credentials are absent — that's expected, not a failure.

- [ ] **Step 6.2: Close the bead**

Run:

```bash
bd close ptv-7qp --reason "Migrated osrm-au subprocess to LAN OSRM REST. /api/plan --goal commute now works in-container."
```

If `bd close` is not the right CLI shape, run `bd --help` and use the equivalent close/done command. Confirm with `bd show ptv-7qp` that the status is `closed`/`done`.

- [ ] **Step 6.3: Final review log**

`git log --oneline -10` to confirm the four commits land in order: red tests → green implementation → compose → CLAUDE.md.
