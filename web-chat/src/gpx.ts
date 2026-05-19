import type { Path } from './types';

function escXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c] as string));
}

function pointXml(coord: number[]): string {
  // GeoJSON convention: [lon, lat, ele?]
  const lon = coord[0];
  const lat = coord[1];
  const ele = coord[2];
  if (typeof ele === 'number') {
    return `      <trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele></trkpt>`;
  }
  return `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`;
}

// Produce a GPX 1.1 document containing one <trk> per route, with one <trkseg>
// per leg that has geometry. Bike legs have point-by-point altitude from
// GraphHopper; train legs (when present) get coarse trkpts without elevation.
export function itineraryToGpx(path: Path): string {
  const legs = (path.itinerary?.legs ?? []) as Array<{
    mode?: string;
    geometry?: { type: 'LineString'; coordinates: number[][] } | null;
  }>;
  const name = path.label || 'ptv-chat route';
  const created = new Date().toISOString();
  const segments: string[] = [];
  for (const leg of legs) {
    const coords = leg?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lines = coords.map(pointXml).join('\n');
    segments.push(`    <trkseg>\n${lines}\n    </trkseg>`);
  }
  if (segments.length === 0) {
    // Fallback: nothing to write.
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="ptv-chat" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escXml(name)}</name><time>${created}</time></metadata></gpx>\n`;
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="ptv-chat" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata>`,
    `    <name>${escXml(name)}</name>`,
    `    <time>${created}</time>`,
    `  </metadata>`,
    `  <trk>`,
    `    <name>${escXml(name)}</name>`,
    ...segments,
    `  </trk>`,
    `</gpx>`,
    ``,
  ].join('\n');
}

export function downloadGpx(path: Path): void {
  const xml = itineraryToGpx(path);
  const slug = (path.label || 'route').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const filename = `ptv-chat_${slug}.gpx`;
  const blob = new Blob([xml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
