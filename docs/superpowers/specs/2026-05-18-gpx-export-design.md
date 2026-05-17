# Design — `ptv plan --gpx <path>` GPX export (ptv-0dm)

**Status:** draft
**Bead:** ptv-0dm — *Add --gpx \<path\> flag to plan command for OsmAnd/Locus/Gaia export*
**Date:** 2026-05-18
**Labels:** v1.6

## Problem

`ptv plan` emits JSON and (with `--html`) a Leaflet map. Neither is usable on a phone offline. Most cycling/hiking apps (OsmAnd, Locus, Gaia, Organic Maps, Mapy.cz, Komoot) read GPX. Adding `--gpx <path>` makes the planner's output directly loadable on the phone for visual reference.

The output is a **static snapshot**: a GPX track, not a navigable route with turn-by-turn. For live re-routing the user would need the phone app's own router (OsmAnd offline, etc.). That's explicitly out of scope.

## Goals

- New CLI flag `--gpx <path>` on `ptv plan`, parallel to existing `--html <path>`.
- One file per invocation. One `<trk>` per labeled itinerary (so recommended + fastest + most-bike-path land in the same file as separately-named tracks).
- Bike legs render along actual decoded polyline geometry. Train legs render as straight `from-station → to-station` segs.
- Station boardings/alightings emit `<wpt>` markers with the station name.
- Auto-`open` the file like `--html` does, with the same `VITEST`/test-env guard.
- No new runtime dependencies.

## Non-goals

- Per-`<trkpt>` `<time>` interpolation for ETA pacing. We embed a single `<metadata><time>` only.
- GPX 1.0 backwards compatibility — only GPX 1.1.
- Embedded `<ele>` elevation per point. The data we have from `gh-route` is segment-indexed (slope ranges), not point-indexed.
- Pushing the file to the phone. Documented as a separate user concern (Syncthing, Tailscale Drop, etc.) in CLAUDE.md prose.
- A separate `--open`/`--no-open` flag — auto-open matches `--html` UX.
- Splitting itineraries into multiple files.

## Approach

Hand-rolled XML string assembly in a new module `src/plan/gpx.ts`, structurally mirroring `src/plan/map.ts`. One exported function `writeGpx(path, result)`. No new dependency.

GPX is fixed grammar, our content is mostly numeric, and the only user-influenced strings (station names, route names) are escaped through a 5-character `escapeXml` helper. A real XML builder library adds weight for no validation benefit at this size.

## Files

### New: `src/plan/gpx.ts`

Exported:

```ts
export function writeGpx(path: string, result: PlanResult): void
```

Internal helpers (file-local, not exported):
- `escapeXml(s: string): string` — escapes `& < > " '`.
- `coord(n: number): string` — `n.toFixed(6)`.
- `metadataTimeFor(result): string` — picks `result.query.departUtc` ?? `result.query.arriveByUtc` ?? `new Date()`, formatted ISO.
- `bikeTrksegFor(leg: BikeLeg): string` — emits `<trkseg>` of `<trkpt>`s from `leg.geometry.coordinates`. Falls back to `[from, to]` when geometry missing/empty.
- `trainTrksegFor(leg: TrainLeg): string` — emits `<trkseg>` with 2 `<trkpt>`s from `(fromLat,fromLon)`/`(toLat,toLon)`. Returns `''` when either coord is missing.
- `trkFor(it: Itinerary): string` — assembles one `<trk>` with `<name>`, `<desc>`, and per-leg `<trkseg>`s.
- `collectWaypoints(itineraries): Array<{lat, lon, name, desc}>` — flattens all train legs across labeled itineraries, deduplicates by `(lat, lon, name)`.

Body assembly:

```
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ptv plan" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>{iso}</time></metadata>
  {dedup'd <wpt> blocks}
  {one <trk> per labeled itinerary}
</gpx>
```

File-system side mirrors `writeMapHtml` 1:1: `resolve(path)` → `dirname` → `existsSync` check → throw with the same message → `writeFileSync(fullPath, xml, 'utf8')` → `if (process.env.VITEST || process.env.NODE_ENV === 'test') return;` → `spawnSync('open', [fullPath], { stdio: 'ignore' })` in a try/catch.

### Modified: `src/commands/plan.ts`

Two changes:

1. Add the option, immediately after the existing `--html` line:
   ```ts
   .option('--gpx <path>', 'Write a GPX track to <path> and open it')
   ```

2. After the `if (opts.html) { ... }` block at the bottom of the action handler, add the symmetric:
   ```ts
   if (opts.gpx) {
     const { writeGpx } = await import('../plan/gpx');
     writeGpx(opts.gpx, result);
   }
   ```

Both flags can be combined: `ptv plan A B --html trip.html --gpx trip.gpx` writes both files.

### Modified: `CLAUDE.md`

Append one bullet to `### plan key behaviors`:

> - **`--gpx <path>`** writes a GPX 1.1 file with one `<trk>` per labeled itinerary and `<wpt>` markers at transfer stations. Loads in OsmAnd, Locus, Gaia, Organic Maps, Mapy.cz. Push to phone via Syncthing (recommended), Tailscale Drop, or ad-hoc `python3 -m http.server`. Not a navigable route — for live re-routing use OsmAnd's own offline router.

### New: `tests/unit/plan/gpx.test.ts`

Cases:

| # | Setup | Assert |
|---|---|---|
| 1 | One labeled bike-only itinerary with 5-point bike-leg geometry | exactly one `<trk>`, one `<trkseg>`, five `<trkpt>` elements |
| 2 | Two labeled itineraries (recommended, fastest) | two `<trk>` blocks; `<name>` attributes contain `'recommended'` and `'fastest'` respectively |
| 3 | Bike-train itinerary: bike-train-bike | one `<trk>` with three `<trkseg>` children; train seg has exactly two `<trkpt>`s |
| 4 | Unlabeled itineraries mixed in | unlabeled ones do not appear in the output |
| 5 | Station name contains `&` | escaped to `&amp;` in `<wpt><name>` |
| 6 | `result.itineraries` empty / all unlabeled | output is valid XML with `<metadata>` only, no `<trk>`, no `<wpt>` |
| 7 | Bike leg with `geometry: null` | falls back to a 2-point `<trkseg>` (`from`, `to`) |
| 8 | Train leg missing `fromLat` | that `<trkseg>` is omitted, no crash |
| 9 | Two itineraries cross the same hub (same name+coords) | exactly one `<wpt>` for that station, not two |
| 10 | `result.query.departUtc` set | `<metadata><time>` equals that ISO value |

All assertions are on the returned XML string. For element-counting, use simple regex match-counts (e.g. `(xml.match(/<trkpt /g) ?? []).length`). This avoids pulling in a DOM dependency.

The unit module exports `writeGpx` only; tests call it with a tmpfile path, read the file back, and assert on the contents. Cleanup with `fs.unlinkSync` in a `finally`.

### Modified: `tests/e2e/plan.test.ts`

Append one case mirroring the existing `--html writes a file containing Leaflet markup` test (around line 99). The existing test pulls `fs`, `pathMod`, `os` via `require` inside the test body and uses a helper named `run`, so follow the same shape:

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

`run` is the existing CLI-spawning helper used by the surrounding cases in this file.

## XML shape

A representative output:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ptv plan" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>2026-05-18T08:00:00.000Z</time></metadata>
  <wpt lat="-37.640123" lon="145.190456">
    <name>Hurstbridge Station</name>
    <desc>Hurstbridge line · board 2026-05-18T08:15:00Z</desc>
  </wpt>
  <wpt lat="-37.818234" lon="144.967890">
    <name>Flinders Street Station</name>
    <desc>Hurstbridge line · alight 2026-05-18T08:55:00Z</desc>
  </wpt>
  <trk>
    <name>recommended, fastest</name>
    <desc>62 min · 14.2 km bike · 0 transfers</desc>
    <trkseg>
      <trkpt lat="-37.640100" lon="145.190200"/>
      <trkpt lat="-37.640500" lon="145.190900"/>
      ...
    </trkseg>
    <trkseg>
      <trkpt lat="-37.640123" lon="145.190456"/>
      <trkpt lat="-37.818234" lon="144.967890"/>
    </trkseg>
    <trkseg>
      <trkpt lat="-37.818000" lon="144.967500"/>
      ...
    </trkseg>
  </trk>
</gpx>
```

Three `<trkseg>` children = bike → train → bike. The middle (train) seg has exactly two `<trkpt>`s; bike segs have many (the decoded polyline points).

## Data flow

```
ptv plan A B --gpx /tmp/trip.gpx
  ↓
commands/plan.ts → plan() (orchestrator)
  ↓
PlanResult { query, itineraries[] }
  ↓ (also still JSON-printed to stdout, as today)
writeGpx(path, result)
  ↓
  filter labeled, sort by totalTimeMin
  collect & dedup waypoints from train legs
  assemble <gpx><metadata>...</metadata>{wpts}{trks}</gpx>
  writeFileSync
  open <path>  (skipped under VITEST/NODE_ENV=test)
```

## Error handling

| Condition | Behavior |
|---|---|
| Directory of `<path>` doesn't exist | throw `cannot write to ${path}: directory does not exist` (matches `writeMapHtml`) |
| `result.itineraries` empty or all unlabeled | write valid `<gpx>` with `<metadata>` only |
| `BikeLeg.geometry` null/empty | fall back to 2-point seg from `from`/`to` (matches `map.ts:28-30`) |
| `TrainLeg` missing `fromLat`/`fromLon`/`toLat`/`toLon` | omit that `<trkseg>`; no crash |
| `open` unavailable / non-macOS | silent skip via try/catch (matches `map.ts:130-134`) |

No path-traversal protection beyond resolving and checking dir-existence. The CLI is a local-user tool; `--html` makes the same assumption.

## Conventions

- 6 decimal places on lat/lon (`(n).toFixed(6)`) → ~11 cm precision, comfortably above GPS noise and tile-render needs.
- Track `<name>` = itinerary's labels joined with `', '`. `<desc>` = `${totalTimeMin.toFixed(0)} min · ${bikeKm.toFixed(1)} km bike · ${transfers} transfers`.
- Waypoint dedup key = `${lat.toFixed(6)}|${lon.toFixed(6)}|${name}`. Two itineraries through the same hub produce one wpt.
- File written as UTF-8.

## Out of scope (deferred to follow-up beads)

- Per-`<trkpt>` `<time>` for ETA pacing along the route — requires a per-point speed model we don't have.
- Embedded `<ele>` on bike `<trkpt>`s — `gh-route` returns segment-indexed slope buckets, not per-coordinate elevation. Would need an elevation-fetch step or interpolation.
- Push automation (write into a watched folder, emit QR for ad-hoc HTTP serve). The bead's "Delivery to phone" section is documentation only.
- Round-trip import (read GPX back into a PlanResult) — no use case yet.

## Risk / rollback

Risk: low. New file + 2 lines in `commands/plan.ts` + 1 line in `CLAUDE.md`. No existing code paths change. Rollback is `git revert` of the implementation commit.

Compatibility: GPX 1.1 is universally supported by every mainstream phone mapping app released in the last decade. No app-specific extensions; `<extensions>` blocks omitted by design.
