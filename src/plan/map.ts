import { writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import type { PlanResult } from './types';

const HTML_TEMPLATE = `<!DOCTYPE html>
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
            ? leg.geometry.coordinates.map(c => [c[1], c[0]])
            : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
          const line = L.polyline(coords, { color: '#2a7', weight: 4 });
          let popup = 'bike: ' + leg.km.toFixed(1) + ' km, ' + leg.min.toFixed(0) + ' min';
          if (typeof leg.kmOnPath === 'number') {
            popup += ' (' + leg.kmOnPath.toFixed(1) + ' on paths)';
          }
          line.bindPopup(popup);
          group.addLayer(line);
          coords.forEach(c => allBounds.push(c));
        } else {
          const fromCoord = (typeof leg.fromLat === 'number' && typeof leg.fromLon === 'number')
            ? [leg.fromLat, leg.fromLon] : null;
          const toCoord = (typeof leg.toLat === 'number' && typeof leg.toLon === 'number')
            ? [leg.toLat, leg.toLon] : null;
          if (fromCoord && toCoord) {
            const line = L.polyline([fromCoord, toCoord], { color: '#c33', weight: 4, dashArray: '8,6' });
            line.bindPopup('train: ' + leg.routeName + '<br>'
              + leg.fromStopName + ' &rarr; ' + leg.toStopName + '<br>'
              + leg.departUtc + ' &rarr; ' + leg.arriveUtc);
            group.addLayer(line);
            L.circleMarker(fromCoord, { radius: 5, color: '#c33', fillOpacity: 1 })
              .bindPopup(leg.fromStopName).addTo(group);
            L.circleMarker(toCoord, { radius: 5, color: '#c33', fillOpacity: 1 })
              .bindPopup(leg.toStopName).addTo(group);
            allBounds.push(fromCoord);
            allBounds.push(toCoord);
          }
        }
      }
      L.marker([data.query.from.lat, data.query.from.lon])
        .bindPopup('Origin').addTo(group);
      L.marker([data.query.to.lat, data.query.to.lon])
        .bindPopup('Destination').addTo(group);

      const label = it.labels.join(', ') || 'unlabeled';
      layers[label + ' — ' + it.totalTimeMin.toFixed(0) + ' min'] = group;
    }

    const recommendedKey = Object.keys(layers).find(k => k.includes('recommended'));
    if (recommendedKey) {
      layers[recommendedKey].addTo(map);
    } else if (Object.keys(layers).length > 0) {
      layers[Object.keys(layers)[0]].addTo(map);
    }

    L.control.layers(null, layers, { collapsed: false }).addTo(map);

    if (allBounds.length > 0) {
      map.fitBounds(allBounds);
    } else {
      map.setView([data.query.from.lat, data.query.from.lon], 11);
    }

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
</body></html>`;

export function writeMapHtml(path: string, result: PlanResult): void {
  const fullPath = resolve(path);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    throw new Error(`cannot write to ${path}: directory does not exist`);
  }
  const labeled = result.itineraries.filter((i) => i.labels.length > 0);
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
