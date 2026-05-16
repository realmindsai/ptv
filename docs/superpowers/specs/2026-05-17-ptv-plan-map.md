# PTV `plan` v1.4 — Map Output Spec

## Purpose

Two bounded additions:

1. **Fix the bike-leg `geometry` bug** in `src/plan/external.ts` — currently bike legs emit `geometry: ""` because `osrm-au route` is invoked without `--overview full --geometries geojson`. The geometry field exists in the JSON schema but has been silently empty since v1.0.
2. **Add `--html <path>` flag** that writes a self-contained Leaflet HTML map of the planned trip and auto-opens it.

Train-leg geometry is rendered as a straight line between access and egress stops; full pattern-stop polylines are deferred to a future spec.

Builds on v1.3 (commits through `c5ecb21` on `main`).

---

## Item 1 — Bike-leg geometry bug fix

### Problem

`src/plan/external.ts:55-76` calls:

```ts
runJson(OSRM_BIN, [
  'route', '--profile', profile,
  osrmPointArg(from),
  osrmPointArg(to),
  '--json',
])
```

`osrm-au route` defaults `--overview` to `false` (per the v1.0 `osrm-au describe` output earlier in the session), so the response's `routes[0].geometry` field is absent. The TypeScript code:

```ts
geometry: typeof route.geometry === 'string' ? route.geometry : '',
```

silently falls back to `''`. Every bike leg in every itinerary since v1.0 has had an empty `geometry` field.

### Fix

Add `--overview full --geometries geojson` to the `osrm-au route` call. With `--geometries geojson`, OSRM returns the geometry as a GeoJSON `LineString` object (`{type:'LineString', coordinates:[[lon,lat],...]}`) instead of an encoded polyline string. This is directly usable by Leaflet without needing a polyline decoder.

### Schema change

`BikeLeg.geometry` in `src/plan/types.ts` currently typed as `string`. Change to `LineString | string` — a discriminated GeoJSON object OR an empty string (for the case when OSRM still doesn't return geometry, e.g. trivial 0 m routes).

```ts
export type GeoJsonLineString = {
  type: 'LineString';
  coordinates: [number, number][];  // [lon, lat]
};

export type BikeLeg = {
  mode: 'bike';
  from: LatLon;
  to: LatLon;
  km: number;
  min: number;
  kmOnPath?: number | null;
  geometry?: GeoJsonLineString | null;
};
```

Note: changed from `string` to `GeoJsonLineString | null` (was `string` with `''` fallback). This is a JSON-shape change for consumers — `geometry` is now either a GeoJSON object or null/absent, never an empty string. Acceptable because no caller has used the field (it's always been `""`).

### Implementation

```ts
const data = runJson(OSRM_BIN, [
  'route', '--profile', profile,
  osrmPointArg(from), osrmPointArg(to),
  '--overview', 'full',
  '--geometries', 'geojson',
  '--json',
]) as { routes?: Array<{
  distance?: number;
  duration?: number;
  geometry?: GeoJsonLineString | string;
}> };
const route = data.routes?.[0];
if (route?.distance === undefined || route?.duration === undefined) {
  throw new Error('osrm-au route response missing distance/duration');
}
return {
  km: route.distance / 1000,
  min: route.duration / 60,
  geometry: (route.geometry && typeof route.geometry === 'object'
    ? route.geometry
    : null) as GeoJsonLineString | null,
};
```

The `osrmRoute` return type's `geometry` field is updated to `GeoJsonLineString | null`.

The orchestrator's `accessBikeRoute` / `egressBikeRoute` already store the full route result; no orchestrator change needed beyond updating the TypeScript type signatures to flow `GeoJsonLineString` through the BikeLeg construction.

---

## Item 2 — `--html <path>` map flag

### CLI surface

```
ptv plan A B [options] --html trip.html
```

After the JSON is printed to stdout as normal, the `--html` writer produces a self-contained HTML file at the given path and runs `open <path>` to auto-open it in the system default browser (per the global CLAUDE.md rule).

If the path's parent directory doesn't exist, error to stderr with `cannot write to <path>: directory does not exist`. Do not create directories — leave that to the user.

### HTML template

A single inlined `<script>` block builds the map using Leaflet (loaded from a CDN). The template is a constant string with one `__INJECT_DATA__` placeholder replaced at write time with a JSON literal containing:

```ts
{
  query: PlanRequest,
  itineraries: Itinerary[],  // labeled ones only, max 5
}
```

The template includes:

```html
<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>ptv plan</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html,body,#map { height: 100%; margin: 0; }
    .legend { background: white; padding: 6px 10px; font: 12px sans-serif; }
    .legend .bike  { color: #2a7; }
    .legend .train { color: #c33; }
    .legend .hub   { color: #639; }
  </style>
</head><body>
  <div id="map"></div>
  <script>
    const data = __INJECT_DATA__;
    const map = L.map('map');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const layers = {};
    const allBounds = [];

    for (const it of data.itineraries) {
      const group = L.featureGroup();
      for (const leg of it.legs) {
        if (leg.mode === 'bike') {
          const coords = leg.geometry && leg.geometry.coordinates
            ? leg.geometry.coordinates.map(c => [c[1], c[0]])  // GeoJSON lon,lat → Leaflet lat,lon
            : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
          const line = L.polyline(coords, { color: '#2a7', weight: 4 });
          line.bindPopup('bike: ' + leg.km.toFixed(1) + ' km, ' + leg.min.toFixed(0) + ' min'
            + (typeof leg.kmOnPath === 'number'
              ? ' (' + leg.kmOnPath.toFixed(1) + ' on paths)' : ''));
          group.addLayer(line);
          coords.forEach(c => allBounds.push(c));
        } else {
          // train leg: straight line stop→stop
          const fromCoord = [leg._fromLat, leg._fromLon];
          const toCoord = [leg._toLat, leg._toLon];
          const line = L.polyline([fromCoord, toCoord], { color: '#c33', weight: 4, dashArray: '8,6' });
          line.bindPopup('train: ' + leg.routeName + '<br>'
            + leg.fromStopName + ' → ' + leg.toStopName + '<br>'
            + leg.departUtc + ' → ' + leg.arriveUtc);
          group.addLayer(line);
          // stop markers
          L.circleMarker(fromCoord, { radius: 5, color: '#c33', fillOpacity: 1 })
            .bindPopup(leg.fromStopName).addTo(group);
          L.circleMarker(toCoord, { radius: 5, color: '#c33', fillOpacity: 1 })
            .bindPopup(leg.toStopName).addTo(group);
          allBounds.push(fromCoord); allBounds.push(toCoord);
        }
      }
      // Origin and destination markers (added once per itinerary)
      L.marker([data.query.from.lat, data.query.from.lon])
        .bindPopup('Origin').addTo(group);
      L.marker([data.query.to.lat, data.query.to.lon])
        .bindPopup('Destination').addTo(group);

      const label = it.labels.join(', ') || 'unlabeled';
      layers[label + ' — ' + it.totalTimeMin.toFixed(0) + ' min'] = group;
    }

    // Show 'recommended' by default
    const recommendedKey = Object.keys(layers).find(k => k.includes('recommended'));
    if (recommendedKey) layers[recommendedKey].addTo(map);

    L.control.layers(null, layers, { collapsed: false }).addTo(map);

    if (allBounds.length > 0) map.fitBounds(allBounds);
    else map.setView([-37.81, 144.96], 11);

    // Legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = '<b>Legend</b><br>'
        + '<span class="bike">━━</span> bike<br>'
        + '<span class="train">┄┄</span> train<br>';
      return div;
    };
    legend.addTo(map);
  </script>
</body></html>
```

### Train-leg coordinate injection

The `TrainLeg` type in `types.ts` carries `fromStopId` and `toStopId` but not lat/lon. The orchestrator already has the stop coordinates in `AccessCandidate.coord` for the access/egress stops. For K=2 inner train legs, the hub stop has no coord on the candidate.

We need access/egress stop coords on the TrainLeg for the map renderer. Add four fields to `TrainLeg`:

```ts
export type TrainLeg = {
  mode: 'train';
  routeId: number;
  routeType: RouteTypeBikeable;
  routeName: string;
  fromStopId: number;
  toStopId: number;
  fromStopName: string;
  toStopName: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  departUtc: string;
  arriveUtc: string;
  runRef: string;
};
```

The orchestrator populates these from `t.access.coord` / `t.egress.coord` for K=1, and similarly for K=2 (but the hub coord is currently unknown — we don't have hub coordinates in `HUBS`). Add hub coords to `HUBS`:

```ts
export const HUBS: ReadonlyArray<{
  stopId: number; name: string; lat: number; lon: number;
}> = [
  { stopId: 1071, name: 'Flinders Street Station',  lat: -37.8183, lon: 144.9671 },
  { stopId: 1181, name: 'Southern Cross Station',    lat: -37.8183, lon: 144.9525 },
  { stopId: 1120, name: 'Melbourne Central Station', lat: -37.8108, lon: 144.9631 },
  { stopId: 1155, name: 'Parliament Station',        lat: -37.8113, lon: 144.9731 },
  { stopId: 1068, name: 'Flagstaff Station',         lat: -37.8118, lon: 144.9555 },
  { stopId: 1162, name: 'Richmond Station',          lat: -37.8233, lon: 144.9897 },
  { stopId: 1180, name: 'South Yarra Station',       lat: -37.8385, lon: 144.9924 },
  { stopId: 1144, name: 'North Melbourne Station',   lat: -37.8074, lon: 144.9425 },
  { stopId: 1072, name: 'Footscray Station',         lat: -37.8011, lon: 144.9036 },
  { stopId: 1036, name: 'Caulfield Station',         lat: -37.8771, lon: 145.0431 },
  { stopId: 1049, name: 'Dandenong Station',         lat: -37.9870, lon: 145.2138 },
  { stopId: 1041, name: 'Clifton Hill Station',      lat: -37.7868, lon: 144.9954 },
  { stopId: 1218, name: 'Sunshine Station',          lat: -37.7882, lon: 144.8334 },
];

export function hubCoord(stopId: number): { lat: number; lon: number } | null {
  const h = HUBS.find((x) => x.stopId === stopId);
  return h ? { lat: h.lat, lon: h.lon } : null;
}
```

The lat/lon values above are illustrative — the implementer fetches the correct coordinates via the existing `ptv search <name>` command (each stop returns `stop_latitude` and `stop_longitude`). The implementer copies the verified coords into `hubs.ts` during the implementation task.

`HUB_STOP_IDS` and `hubName()` continue to work unchanged (both derived from `HUBS`).

For K=2 inner train legs, the orchestrator uses `hubCoord(t.hubStopId)` to populate `fromLat/Lon` / `toLat/Lon` accordingly.

### Itinerary selection for the map

To prevent the map from becoming an overlapping mess of 143 polylines, render only the itineraries that carry a label. With v1.3 there are up to 5 distinct labels (recommended / fastest / most-bike / most-bike-path / fewest-transfers). After dedup, this typically yields 2-5 itineraries.

Order: by total time ascending. Default visible: the `recommended` one. Others toggled via Leaflet's layer control.

If `--html` is set but `itineraries` is empty, write an HTML showing just the origin and destination markers with a "no itineraries found" overlay. Do not error.

### Auto-open

After writing the file, run:

```ts
spawnSync('open', [resolvedPath], { stdio: 'ignore' });
```

On non-macOS systems `open` may not exist — catch any spawn failure and skip silently. The user can manually open the file.

---

## CLI changes (`src/commands/plan.ts`)

Add a single option:

```
--html <path>     Write a Leaflet HTML map to <path> and open it
```

In the action handler, after `console.log(JSON.stringify(result, null, 2))`:

```ts
if (opts.html) {
  const { writeMapHtml } = await import('../plan/map');
  writeMapHtml(opts.html, result);
}
```

The dynamic import keeps the map dependency out of the hot path when `--html` isn't used.

---

## New module: `src/plan/map.ts`

```ts
import { writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import type { PlanResult } from './types';

const HTML_TEMPLATE = `<!DOCTYPE html>...`;  // the full template from the spec

export function writeMapHtml(path: string, result: PlanResult): void {
  const fullPath = resolve(path);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    throw new Error(`cannot write to ${path}: directory does not exist`);
  }
  // Only render labeled itineraries
  const labeled = result.itineraries.filter((i) => i.labels.length > 0);
  // Sort by total time ascending
  labeled.sort((a, b) => a.totalTimeMin - b.totalTimeMin);
  const data = { query: result.query, itineraries: labeled };
  const html = HTML_TEMPLATE.replace('__INJECT_DATA__', JSON.stringify(data));
  writeFileSync(fullPath, html, 'utf8');
  try {
    spawnSync('open', [fullPath], { stdio: 'ignore' });
  } catch {
    // non-macOS or open command unavailable — silently skip
  }
}
```

Module surface: one exported function `writeMapHtml(path, result)`. Pure side-effect (writes file + spawns `open`). The template is a constant string in the same module.

---

## JSON output changes (additive)

- `legs[*].geometry` (bike legs only) becomes a populated `GeoJsonLineString` object instead of an empty string. Old consumers checking `geometry === ''` would no longer get truthy results — but no such consumer exists in the codebase.
- `legs[*].fromLat`, `fromLon`, `toLat`, `toLon` (train legs only) — four new optional number fields.
- No other JSON changes.

---

## Tests

### Unit tests

`tests/unit/plan/external.test.ts` (extend):
- `'osrmRoute returns geometry as a GeoJSON LineString'` — vi.mock the spawnSync to return a fixture with `geometry: {type:'LineString', coordinates:[[144.96,-37.78],[144.97,-37.79]]}`, assert the returned geometry is the object (not a string).
- `'osrmRoute returns null geometry when osrm-au omits it'` — fixture with no `geometry` field, assert returned geometry is `null`.

`tests/unit/plan/hubs.test.ts` (extend):
- `'hubCoord returns coordinates for each HUB_STOP_ID'` — for each ID, assert non-null coord with lat in [-39, -36] and lon in [144, 146] (Melbourne bbox sanity).
- `'hubCoord returns null for unknown stop_id'`.

`tests/unit/plan/orchestrator.test.ts` (extend):
- `'K=1: TrainLeg has fromLat/fromLon/toLat/toLon populated'` — assert numeric values matching the test fixture coords.
- `'K=2: TrainLeg uses hubCoord for the inner-leg endpoints at the hub'` — assert `legs[1].toLat` / `toLon` and `legs[2].fromLat` / `fromLon` match `hubCoord(1071)` (Flinders Street).

`tests/unit/plan/map.test.ts` (new):
- `'writeMapHtml creates a file containing the injected JSON'` — temp directory, call function, read file back, assert contains `"recommended"` and the origin coord.
- `'writeMapHtml throws when target directory does not exist'`.
- `'writeMapHtml does not throw when itineraries are empty'`.

### Integration test

Skip — the existing integration tests will exercise the new fields. No new integration test needed.

### E2e test

`tests/e2e/plan.test.ts` (extend):
- `'--html writes a file containing Leaflet markup'` — spawn the CLI with `--html /tmp/ptv-test-map.html`, assert exit 0, assert file exists and contains `leaflet@1.9.4` and `data.itineraries`.

The `open` command will run during the test but we ignore its exit status; on CI it may fail silently.

---

## Commit order

1. `feat(plan): capture full bike-leg geometry from osrm-au` — `types.ts` + `external.ts` + `external.test.ts` (Item 1)
2. `feat(plan): add hub coordinates and propagate stop coords to train legs` — `hubs.ts` + `orchestrator.ts` + `types.ts` (TrainLeg fields) + unit tests
3. `feat(plan): add --html flag with Leaflet map output and auto-open` — `map.ts` (new) + `commands/plan.ts` + tests

Three commits; commit 2 depends on commit 1 (the BikeLeg.geometry shape change must be in place); commit 3 depends on commits 1 and 2 (the renderer reads both).

---

## Out of scope (deferred)

- **Full train pattern polylines** (v1.5+) — fetch every intermediate stop's coord via PTV
- **Bike-quiet profile** (v1.5+)
- **Multiple `--html` invocations producing different views**
- **GeoJSON export flag (`--geojson <path>`)** — JSON output already contains the data; users can `jq` it
- **Disruption overlays on the map**
- **Custom Leaflet tile providers** — OSM hardcoded
- **Offline operation** — Leaflet JS and tiles loaded from CDN
- **K=3 transfers**
