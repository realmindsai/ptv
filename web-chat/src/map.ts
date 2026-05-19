import type { Itinerary, Path } from './types';

// Leaflet is loaded as a UMD global by the SPA shell (web-chat/index.html).
declare const L: any;

export function polylinesFromItinerary(it: Itinerary): Array<Array<[number, number]>> {
  const legs = it?.legs;
  if (!Array.isArray(legs)) return [];
  const out: Array<Array<[number, number]>> = [];
  for (const leg of legs) {
    const g = leg?.geometry;
    if (!g || !Array.isArray(g.coordinates)) continue;
    if (g.coordinates.length < 2) continue;
    // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
    out.push(g.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]));
  }
  return out;
}

export type MapHandle = {
  addPath: (p: Path) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
  fitToPaths: () => void;
};

export function initMap(elId: string): MapHandle {
  const map = L.map(elId).setView([-37.81, 144.96], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);

  const layers = new Map<string, any[]>();

  return {
    addPath(p: Path) {
      const lines = polylinesFromItinerary(p.itinerary);
      const polys = lines.map((coords) =>
        L.polyline(coords, { color: p.color, weight: 3 }).addTo(map),
      );
      polys.forEach((poly: any) =>
        poly.on('click', () => {
          document.dispatchEvent(new CustomEvent('chat:set-active', { detail: p.id }));
        }),
      );
      layers.set(p.id, polys);
    },
    setActive(id: string | null) {
      for (const [pid, polys] of layers) {
        const active = pid === id;
        polys.forEach((poly: any) =>
          poly.setStyle({
            weight: active ? 5 : (id ? 2 : 3),
            opacity: id && !active ? 0.4 : 1,
          }),
        );
      }
    },
    clear() {
      for (const [, polys] of layers) polys.forEach((poly: any) => map.removeLayer(poly));
      layers.clear();
    },
    fitToPaths() {
      const all: any[] = [];
      for (const [, polys] of layers) all.push(...polys);
      if (all.length === 0) return;
      const group = L.featureGroup(all);
      map.fitBounds(group.getBounds(), { padding: [40, 40] });
    },
  };
}
