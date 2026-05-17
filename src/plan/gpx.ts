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
  // Skip `open` under vitest: the test typically deletes the temp file in a finally,
  // and macOS opens it asynchronously, producing a "file not found" browser tab.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
  try {
    spawnSync('open', [fullPath], { stdio: 'ignore' });
  } catch {
    // non-macOS or open command unavailable — silently skip
  }
}
