# GPX export (`ptv plan --gpx`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ptv plan --gpx <path>` so plan output can be loaded on the phone in OsmAnd / Locus / Gaia / Organic Maps / Mapy.cz (ptv-0dm).

**Architecture:** New module `src/plan/gpx.ts` exports `writeGpx(path, result)`. Mirrors `src/plan/map.ts` 1:1: resolve path → dir check → hand-rolled GPX 1.1 XML body → `writeFileSync` → `open` (skipped under `VITEST`/`NODE_ENV=test`). One `<trk>` per labeled itinerary, one `<trkseg>` per leg, `<wpt>` markers at transfer stations (deduplicated across itineraries). No new runtime dependency.

**Tech Stack:** TypeScript, vitest, GPX 1.1 (hand-rolled string-templated XML).

**Reference:** `docs/superpowers/specs/2026-05-18-gpx-export-design.md`

---

## File map

| File | Status | Purpose |
|---|---|---|
| `src/plan/gpx.ts` | new | `writeGpx` + private helpers (`escapeXml`, `coord`, `metadataTimeFor`, `bikeTrksegFor`, `trainTrksegFor`, `trkFor`, `collectWaypoints`) |
| `src/commands/plan.ts` | modify | add `--gpx <path>` option + post-plan `writeGpx` call |
| `tests/unit/plan/gpx.test.ts` | new | unit tests for all `writeGpx` behaviors |
| `tests/e2e/plan.test.ts` | modify | one new e2e case: `--gpx` writes a valid GPX file |
| `CLAUDE.md` | modify | one bullet under `### plan key behaviors` |

---

## Task 1: Build `writeGpx` for bike-only itineraries

Scaffold the new module via TDD. Cover the smallest viable case (a single bike-only labeled itinerary), the geometry-missing fallback, and the empty-result case. Three failing tests, then one implementation that makes them all pass.

**Files:**
- Create: `src/plan/gpx.ts`
- Create: `tests/unit/plan/gpx.test.ts`

- [ ] **Step 1: Write the three failing tests**

Create `tests/unit/plan/gpx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { writeGpx } from '../../../src/plan/gpx';
import { readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PlanResult } from '../../../src/plan/types';

function tmpGpxPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ptv-gpx-'));
  return join(dir, 'trip.gpx');
}

function bikeOnlyResult(): PlanResult {
  return {
    query: {
      from: { lat: -37.78, lon: 144.96 },
      to:   { lat: -37.77, lon: 144.97 },
      minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
      enrich: false, preferBikePath: false,
    },
    itineraries: [
      {
        labels: ['recommended'],
        totalTimeMin: 12,
        bikeKm: 1.5, bikeMin: 12,
        trainKm: 0, trainMin: 0, waitMin: 0,
        transfers: 0,
        legs: [
          {
            mode: 'bike',
            from: { lat: -37.78, lon: 144.96 },
            to:   { lat: -37.77, lon: 144.97 },
            km: 1.5, min: 12,
            geometry: {
              type: 'LineString',
              coordinates: [
                [144.96, -37.78], [144.965, -37.775], [144.97, -37.77],
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('writeGpx()', () => {
  it('writes a valid GPX with one <trk> and one <trkseg> for a bike-only itinerary', () => {
    const path = tmpGpxPath();
    writeGpx(path, bikeOnlyResult());
    const xml = readFileSync(path, 'utf8');
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<trk>');
    expect(xml).toContain('<name>recommended</name>');
    // One trkseg with three trkpts (matches the 3-coord geometry).
    expect((xml.match(/<trkseg>/g) ?? []).length).toBe(1);
    expect((xml.match(/<trkpt /g) ?? []).length).toBe(3);
    unlinkSync(path);
  });

  it('falls back to a 2-point seg when bike-leg geometry is missing', () => {
    const r = bikeOnlyResult();
    (r.itineraries[0].legs[0] as { geometry: null }).geometry = null;
    const path = tmpGpxPath();
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect((xml.match(/<trkseg>/g) ?? []).length).toBe(1);
    // Two trkpts: from and to.
    expect((xml.match(/<trkpt /g) ?? []).length).toBe(2);
    expect(xml).toContain('lat="-37.780000"');
    expect(xml).toContain('lat="-37.770000"');
    unlinkSync(path);
  });

  it('writes valid GPX with no <trk> when all itineraries are unlabeled or none exist', () => {
    const path = tmpGpxPath();
    writeGpx(path, { query: bikeOnlyResult().query, itineraries: [] });
    const xml = readFileSync(path, 'utf8');
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<metadata>');
    expect(xml).not.toContain('<trk>');
    unlinkSync(path);
  });

  it('throws when target directory does not exist', () => {
    expect(() => writeGpx('/nonexistent-dir-aaa-bbb/trip.gpx', bikeOnlyResult()))
      .toThrow(/directory does not exist/);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run tests/unit/plan/gpx.test.ts`
Expected: ALL fail with `Cannot find module '../../../src/plan/gpx'` (file doesn't exist).

- [ ] **Step 3: Create the module with the minimal implementation**

Create `src/plan/gpx.ts`:

```ts
import { writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import type { PlanResult, Itinerary, BikeLeg, Leg } from './types';

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  }[c]!));
}

function coord(n: number): string {
  return n.toFixed(6);
}

function metadataTimeFor(result: PlanResult): string {
  const q = result.query as { departUtc?: Date | string; arriveByUtc?: Date | string };
  const t = q.departUtc ?? q.arriveByUtc;
  if (t instanceof Date) return t.toISOString();
  if (typeof t === 'string') return t;
  return new Date().toISOString();
}

function bikeTrksegFor(leg: BikeLeg): string {
  const coords = leg.geometry && leg.geometry.coordinates.length > 0
    ? leg.geometry.coordinates
    : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]] as [number, number][];
  const pts = coords.map(([lon, lat]) => `<trkpt lat="${coord(lat)}" lon="${coord(lon)}"/>`).join('');
  return `<trkseg>${pts}</trkseg>`;
}

function trksegFor(leg: Leg): string {
  if (leg.mode === 'bike') return bikeTrksegFor(leg);
  return ''; // train legs handled in Task 2
}

function trkFor(it: Itinerary): string {
  const name = escapeXml(it.labels.join(', '));
  const desc = escapeXml(
    `${it.totalTimeMin.toFixed(0)} min · ${it.bikeKm.toFixed(1)} km bike · ${it.transfers} transfers`,
  );
  const segs = it.legs.map(trksegFor).filter((s) => s.length > 0).join('');
  return `<trk><name>${name}</name><desc>${desc}</desc>${segs}</trk>`;
}

export function writeGpx(path: string, result: PlanResult): void {
  const fullPath = resolve(path);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    throw new Error(`cannot write to ${path}: directory does not exist`);
  }
  const labeled = result.itineraries.filter((i) => i.labels.length > 0);
  labeled.sort((a, b) => a.totalTimeMin - b.totalTimeMin);
  const time = metadataTimeFor(result);
  const trks = labeled.map(trkFor).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ptv plan" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><time>${time}</time></metadata>
${trks}
</gpx>`;
  writeFileSync(fullPath, xml, 'utf8');
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
  try {
    spawnSync('open', [fullPath], { stdio: 'ignore' });
  } catch {
    // non-macOS or open command unavailable — silently skip
  }
}
```

- [ ] **Step 4: Run tests and confirm green**

Run: `npx vitest run tests/unit/plan/gpx.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/plan/gpx.ts tests/unit/plan/gpx.test.ts
git commit -m "feat(plan): writeGpx — bike-only itinerary scaffold (ptv-0dm)

New module mirroring src/plan/map.ts. Hand-rolled GPX 1.1 string
assembly with escapeXml, coord, bikeTrksegFor, trkFor helpers. One
<trk> per labeled itinerary, sorted by totalTimeMin. Empty result
emits valid GPX with <metadata> only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Train legs + waypoint markers + dedup

Add the bike-train-bike case. Train legs become straight-line `<trkseg>`s; each station boarding/alighting becomes a `<wpt>` deduplicated across itineraries.

**Files:**
- Modify: `src/plan/gpx.ts`
- Modify: `tests/unit/plan/gpx.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('writeGpx()', ...)` block in `tests/unit/plan/gpx.test.ts`:

```ts
  it('emits one <trkseg> per leg for bike-train-bike, with the train seg having 2 trkpts', () => {
    const path = tmpGpxPath();
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 },
        to:   { lat: -37.65, lon: 144.95 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
      },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 60,
        bikeKm: 4, bikeMin: 15,
        trainKm: 10, trainMin: 20, waitMin: 5,
        transfers: 0,
        legs: [
          {
            mode: 'bike',
            from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.96 },
            km: 2, min: 8,
            geometry: { type: 'LineString',
              coordinates: [[144.96, -37.78], [144.96, -37.77]] as [number, number][] },
          },
          {
            mode: 'train',
            routeId: 6, routeType: 0, routeName: 'Frankston',
            fromStopId: 1, toStopId: 2,
            fromStopName: 'Origin Station', toStopName: 'Destination Station',
            fromLat: -37.77, fromLon: 144.96,
            toLat: -37.65, toLon: 144.95,
            departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
            runRef: 'R1',
          },
          {
            mode: 'bike',
            from: { lat: -37.65, lon: 144.95 }, to: { lat: -37.65, lon: 144.95 },
            km: 0, min: 0,
            geometry: { type: 'LineString',
              coordinates: [[144.95, -37.65], [144.95, -37.65]] as [number, number][] },
          },
        ],
      }],
    };
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect((xml.match(/<trk>/g) ?? []).length).toBe(1);
    expect((xml.match(/<trkseg>/g) ?? []).length).toBe(3);
    // 2 (bike 1) + 2 (train) + 2 (bike 2) = 6 trkpts total.
    expect((xml.match(/<trkpt /g) ?? []).length).toBe(6);
    // Two wpts (one per station).
    expect((xml.match(/<wpt /g) ?? []).length).toBe(2);
    expect(xml).toContain('<name>Origin Station</name>');
    expect(xml).toContain('<name>Destination Station</name>');
    unlinkSync(path);
  });

  it('skips train <trkseg> when station coordinates are missing', () => {
    const path = tmpGpxPath();
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.65, lon: 144.95 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
      },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 30, bikeKm: 0, bikeMin: 0,
        trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
        legs: [{
          mode: 'train',
          routeId: 6, routeType: 0, routeName: 'X',
          fromStopId: 1, toStopId: 2,
          fromStopName: 'A', toStopName: 'B',
          // fromLat/fromLon/toLat/toLon all undefined
          departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
          runRef: 'R1',
        }],
      }],
    };
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect((xml.match(/<trkseg>/g) ?? []).length).toBe(0);
    expect((xml.match(/<wpt /g) ?? []).length).toBe(0);
    // The empty <trk> is still emitted; that's fine — GPX permits it.
    expect(xml).toContain('<trk>');
    unlinkSync(path);
  });

  it('deduplicates <wpt> markers when multiple itineraries cross the same station', () => {
    const trainLeg = {
      mode: 'train' as const,
      routeId: 6, routeType: 0 as const, routeName: 'X',
      fromStopId: 1, toStopId: 2,
      fromStopName: 'Hub Station', toStopName: 'Destination Station',
      fromLat: -37.77, fromLon: 144.96,
      toLat: -37.65, toLon: 144.95,
      departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
      runRef: 'R1',
    };
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.65, lon: 144.95 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
      },
      itineraries: [
        {
          labels: ['recommended'],
          totalTimeMin: 60, bikeKm: 0, bikeMin: 0,
          trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
          legs: [trainLeg],
        },
        {
          labels: ['fastest'],
          totalTimeMin: 55, bikeKm: 0, bikeMin: 0,
          trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
          legs: [trainLeg],
        },
      ],
    };
    const path = tmpGpxPath();
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    // Both itineraries crossed the same two stations; we want one <wpt> per station.
    expect((xml.match(/<wpt /g) ?? []).length).toBe(2);
    expect((xml.match(/<name>Hub Station<\/name>/g) ?? []).length).toBe(1);
    expect((xml.match(/<name>Destination Station<\/name>/g) ?? []).length).toBe(1);
    unlinkSync(path);
  });
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npx vitest run tests/unit/plan/gpx.test.ts`
Expected:
- `emits one <trkseg> per leg for bike-train-bike ...` FAILS: 2 trksegs instead of 3 (train returns ''), 0 wpts instead of 2.
- `skips train <trkseg> when station coordinates are missing` likely PASSES (already returns '' for trains in Task 1's scaffold) but the wpt assertion holds at 0 either way.
- `deduplicates <wpt> markers ...` FAILS: 0 wpts emitted.

- [ ] **Step 3: Implement train trkseg + waypoint collection**

In `src/plan/gpx.ts`:

(a) Add a `TrainLeg` import to the existing type import:

```ts
import type { PlanResult, Itinerary, BikeLeg, TrainLeg, Leg } from './types';
```

(b) Replace the placeholder `trksegFor` and add a `trainTrksegFor` helper:

```ts
function trainTrksegFor(leg: TrainLeg): string {
  if (typeof leg.fromLat !== 'number' || typeof leg.fromLon !== 'number'
      || typeof leg.toLat !== 'number' || typeof leg.toLon !== 'number') {
    return '';
  }
  return `<trkseg>`
    + `<trkpt lat="${coord(leg.fromLat)}" lon="${coord(leg.fromLon)}"/>`
    + `<trkpt lat="${coord(leg.toLat)}" lon="${coord(leg.toLon)}"/>`
    + `</trkseg>`;
}

function trksegFor(leg: Leg): string {
  return leg.mode === 'bike' ? bikeTrksegFor(leg) : trainTrksegFor(leg);
}
```

(c) Add a `collectWaypoints` helper and a `wptFor` formatter:

```ts
type Waypoint = { lat: number; lon: number; name: string; desc: string };

function collectWaypoints(itineraries: Itinerary[]): Waypoint[] {
  const seen = new Set<string>();
  const out: Waypoint[] = [];
  for (const it of itineraries) {
    for (const leg of it.legs) {
      if (leg.mode !== 'train') continue;
      const stops: Array<[number | undefined, number | undefined, string, 'board' | 'alight']> = [
        [leg.fromLat, leg.fromLon, leg.fromStopName, 'board'],
        [leg.toLat,   leg.toLon,   leg.toStopName,   'alight'],
      ];
      for (const [lat, lon, name, kind] of stops) {
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        const key = `${coord(lat)}|${coord(lon)}|${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const stamp = kind === 'board' ? leg.departUtc : leg.arriveUtc;
        out.push({ lat, lon, name, desc: `${leg.routeName} · ${kind} ${stamp}` });
      }
    }
  }
  return out;
}

function wptFor(w: Waypoint): string {
  return `<wpt lat="${coord(w.lat)}" lon="${coord(w.lon)}">`
    + `<name>${escapeXml(w.name)}</name>`
    + `<desc>${escapeXml(w.desc)}</desc>`
    + `</wpt>`;
}
```

(d) Wire the waypoints into `writeGpx`, between `<metadata>` and `<trk>` blocks:

Locate the existing XML template inside `writeGpx`:

```ts
  const trks = labeled.map(trkFor).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ptv plan" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><time>${time}</time></metadata>
${trks}
</gpx>`;
```

Replace with:

```ts
  const trks = labeled.map(trkFor).join('');
  const wpts = collectWaypoints(labeled).map(wptFor).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ptv plan" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><time>${time}</time></metadata>
${wpts}
${trks}
</gpx>`;
```

- [ ] **Step 4: Run tests and confirm green**

Run: `npx vitest run tests/unit/plan/gpx.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/plan/gpx.ts tests/unit/plan/gpx.test.ts
git commit -m "feat(plan): writeGpx — train legs + deduped waypoints (ptv-0dm)

Train legs become straight-line <trkseg>s (omitted when station coords
are missing). Each unique station boarding/alighting becomes one <wpt>,
deduplicated by (lat, lon, name) so hubs shared across itineraries
don't double up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: XML escaping, multi-itinerary, metadata time

Cover the remaining unit-test cases: XML escaping of station names with `&`, multi-itinerary ordering and naming, metadata `<time>` picked from `query.departUtc`.

**Files:**
- Modify: `tests/unit/plan/gpx.test.ts`
- Possibly modify: `src/plan/gpx.ts` (only if a test fails)

- [ ] **Step 1: Add the three tests**

Append inside the same `describe`:

```ts
  it('XML-escapes station names containing ampersand', () => {
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.65, lon: 144.95 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
      },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 30, bikeKm: 0, bikeMin: 0,
        trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
        legs: [{
          mode: 'train',
          routeId: 6, routeType: 0, routeName: 'Lilydale & Belgrave',
          fromStopId: 1, toStopId: 2,
          fromStopName: 'Mont Albert & Mont Albert North', toStopName: 'Flinders',
          fromLat: -37.77, fromLon: 144.96,
          toLat: -37.65, toLon: 144.95,
          departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
          runRef: 'R1',
        }],
      }],
    };
    const path = tmpGpxPath();
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect(xml).toContain('Mont Albert &amp; Mont Albert North');
    expect(xml).toContain('Lilydale &amp; Belgrave');
    // The raw '&' must not appear adjacent to a literal name fragment.
    expect(xml).not.toMatch(/Mont Albert & Mont Albert/);
    unlinkSync(path);
  });

  it('emits two <trk> blocks for two labeled itineraries, names from labels', () => {
    const baseLeg = {
      mode: 'bike' as const,
      from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.97 },
      km: 1, min: 5,
      geometry: { type: 'LineString' as const,
        coordinates: [[144.96, -37.78], [144.97, -37.77]] as [number, number][] },
    };
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.97 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
      },
      itineraries: [
        // Note: fastest is faster (15 min < 20 min), so it should sort first in output.
        {
          labels: ['recommended'], totalTimeMin: 20,
          bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [baseLeg],
        },
        {
          labels: ['fastest'], totalTimeMin: 15,
          bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [baseLeg],
        },
      ],
    };
    const path = tmpGpxPath();
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect((xml.match(/<trk>/g) ?? []).length).toBe(2);
    expect(xml).toContain('<name>fastest</name>');
    expect(xml).toContain('<name>recommended</name>');
    // Sort order: fastest (15 min) appears before recommended (20 min).
    expect(xml.indexOf('<name>fastest</name>'))
      .toBeLessThan(xml.indexOf('<name>recommended</name>'));
    unlinkSync(path);
  });

  it('uses query.departUtc as the metadata <time> when set', () => {
    const r = bikeOnlyResult();
    (r.query as { departUtc?: Date }).departUtc = new Date('2026-05-18T08:00:00Z');
    const path = tmpGpxPath();
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect(xml).toContain('<time>2026-05-18T08:00:00.000Z</time>');
    unlinkSync(path);
  });
```

- [ ] **Step 2: Run and confirm pass-or-fail**

Run: `npx vitest run tests/unit/plan/gpx.test.ts`
Expected: all 10 tests pass. The escaping and metadata-time tests should already pass because `escapeXml` is called by `trkFor`/`wptFor` and `metadataTimeFor` reads `query.departUtc`. The multi-itinerary test should pass because `writeGpx` sorts by `totalTimeMin`.

If any of the three new tests fails, fix the implementation:
- Escaping fail → confirm `escapeXml` is called on both `routeName` and station names in `wptFor`; the `desc` already calls `escapeXml`.
- Sort-order fail → confirm `labeled.sort((a, b) => a.totalTimeMin - b.totalTimeMin)` is present.
- Metadata-time fail → confirm `metadataTimeFor` returns the ISO string of the Date when `departUtc` is a Date instance.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/plan/gpx.test.ts
git commit -m "test(plan): cover gpx escaping, multi-itinerary, metadata time (ptv-0dm)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(If step 2 required code changes in `src/plan/gpx.ts`, include that file in the `git add` and adjust the message — e.g. `feat(plan): wire X into writeGpx`.)

---

## Task 4: Wire `--gpx` into the CLI

Add the CLI option and the post-plan invocation. Mirrors the existing `--html` block in the same file.

**Files:**
- Modify: `src/commands/plan.ts`

- [ ] **Step 1: Add the option**

In `src/commands/plan.ts`, find the existing line:

```ts
    .option('--html <path>', 'Write a Leaflet HTML map to <path> and open it')
```

Add immediately after it:

```ts
    .option('--gpx <path>', 'Write a GPX track to <path> and open it')
```

- [ ] **Step 2: Add the post-plan invocation**

In the same file, find the existing block (near the bottom of `.action(...)`):

```ts
      if (opts.html) {
        const { writeMapHtml } = await import('../plan/map');
        writeMapHtml(opts.html, result);
      }
```

Add immediately after it:

```ts
      if (opts.gpx) {
        const { writeGpx } = await import('../plan/gpx');
        writeGpx(opts.gpx, result);
      }
```

- [ ] **Step 3: Build and smoke-test from the CLI**

Run:
```bash
npm run build && node dist/index.js plan -37.78,144.96 -37.77,144.97 \
  --mode bike-only --max-bike-km 8 --no-enrich --gpx /tmp/ptv-gpx-smoke.gpx
test -s /tmp/ptv-gpx-smoke.gpx && head -5 /tmp/ptv-gpx-smoke.gpx
rm /tmp/ptv-gpx-smoke.gpx
```

Expected: build succeeds; the file is non-empty and starts with `<?xml version="1.0"` followed by `<gpx version="1.1"`. macOS may briefly try to open the file — that's expected behavior; close the window.

If `npm run build` fails because of a TypeScript error, fix it before committing.

- [ ] **Step 4: Run the full test suite to catch any wiring regressions**

Run: `npm test`
Expected: all unit + integration tests pass (the pre-existing PTV 403 in `tests/integration/plan.test.ts` and the e2e tests that need a fresh `dist/` plus live OSRM/GH are tolerated — flag them but they're not blockers).

- [ ] **Step 5: Commit**

```bash
git add src/commands/plan.ts
git commit -m "feat(cli): plan --gpx <path> writes GPX 1.1 (ptv-0dm)

Mirrors --html: adds option and post-plan writeGpx call. Both flags can
be combined in one invocation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: E2e test

End-to-end check that the CLI actually emits a valid GPX file. Mirrors the existing `--html writes a file` test in the same file.

**Files:**
- Modify: `tests/e2e/plan.test.ts`

- [ ] **Step 1: Add the test**

Append immediately after the existing `--html writes a file containing Leaflet markup` test (around line 113):

```ts
  it('--gpx writes a file containing a GPX track', () => {
    const fs = require('fs');
    const pathMod = require('path');
    const os = require('os');
    const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ptv-e2e-'));
    const gpxPath = pathMod.join(tmpDir, 'trip.gpx');
    const { code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--max-bike-km', '8', '--no-enrich', '--gpx', gpxPath,
    ]);
    expect(code).toBe(0);
    const contents = fs.readFileSync(gpxPath, 'utf8');
    expect(contents).toMatch(/^<\?xml/);
    expect(contents).toContain('<gpx version="1.1"');
    expect(contents).toMatch(/<trk>[\s\S]*<\/trk>/);
    fs.unlinkSync(gpxPath);
  }, 60_000);
```

`run` is the existing CLI-spawning helper used by every test in this file.

- [ ] **Step 2: Build and run e2e**

Run: `npm run build && npx vitest run tests/e2e/plan.test.ts`
Expected: the new test passes. The other e2e tests in this file may fail due to live PTV / OSRM / GH dependencies — those are pre-existing and unrelated; flag them if they show up but they're not blockers.

If the `--gpx` test fails because the planner had no itineraries to write (which would produce a valid empty GPX without `<trk>`), the test still passes its `<?xml` and `<gpx version="1.1"` assertions but fails the `<trk>...</trk>` assertion. In that case, the route in the test is genuinely unplannable on this machine's network — try a different coord pair like the existing `-37.7656,144.9614` → `-37.648,144.946` (Princes Hill → Hurstbridge) which the `--html` test already proves is plannable.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/plan.test.ts
git commit -m "test(e2e): plan --gpx writes a valid GPX file (ptv-0dm)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CLAUDE.md note + close bead

Final cleanup: document the flag, close the bead, push.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append the documentation bullet**

In `CLAUDE.md`, find the existing `### plan key behaviors` section. The last bullet currently is `**`--raw`** is currently a no-op for `plan` ...`.

Add a new bullet at the end of that section's list:

```markdown
- **`--gpx <path>`** writes a GPX 1.1 file with one `<trk>` per labeled itinerary and `<wpt>` markers at transfer stations. Loads in OsmAnd, Locus, Gaia, Organic Maps, Mapy.cz. Push to phone via Syncthing (recommended), Tailscale Drop, or ad-hoc `python3 -m http.server`. Not a navigable route — for live re-routing use OsmAnd's own offline router.
```

- [ ] **Step 2: Commit the doc note**

```bash
git add CLAUDE.md
git commit -m "docs(plan): document --gpx flag (ptv-0dm)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Close the bead**

Run:
```bash
bd close ptv-0dm -m "shipped: --gpx <path> writes GPX 1.1 with one <trk> per labeled itinerary, deduped <wpt> at transfer stations; auto-opens like --html"
```

- [ ] **Step 4: Final verification**

Run:
```bash
git log --oneline c1c77df..HEAD
npm run test:unit
```

Expected: 5 commits visible (Tasks 1, 2, 3, 4, 5, 6 — though Task 3 may be a no-op commit if all behavior was already correct in Task 2's implementation, in which case only 5 commits land). All unit tests green.

- [ ] **Step 5: Report status to the user**

Tell the user the bead is shipped, summarize commits, ask before pushing. Do NOT push without confirmation.

---

## Project rules (apply to every task)

- **NEVER use `--no-verify`, `--no-hooks`.** If pre-commit hooks fail, follow `~/.claude/rules/git.md`: fix the root cause and re-run.
- **Pre-commit failure → commit DID NOT happen → fix and create a NEW commit (don't amend).**
- The user is "Doctor Dee" — address them as such if reporting.
- Don't push to origin without explicit user approval (the final-task report step).
- If you find unrelated dirty files in `git status` between tasks, surface them — don't let them ride along in a feature commit.

## Self-review notes (for the executor)

- Every task ends with a single commit covering exactly the files it modifies. Cross-check via `git diff --stat HEAD~1` after committing.
- Test counts after each task: T1 → 4, T2 → 7, T3 → 10. If the count is off, you added or skipped something.
- The bead `ptv-0dm` is closed only in Task 6 (after CLAUDE.md lands). Don't close it earlier even if the code is done — the doc note is part of "shipped".
