import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import type { LatLon, GeoJsonLineString } from './types';

const OSRM_BIN = process.env.OSRM_AU_BIN ?? resolve(homedir(), 'bin/osrm-au');
const GH_BIN = process.env.GH_ROUTE_BIN
  ?? resolve(__dirname, '../../../grasshopper-bike-routing/bin/gh-route');

function runJson(cmd: string, args: string[]): unknown {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout);
}

// osrm-au CLI (current) uses lat,lon order — matches gh-route and the project convention.
// IMPORTANT: pass each point as `--point=lat,lon` (single argv entry with '=') so
// argparse on the osrm-au side does NOT treat the leading '-' on negative
// Melbourne latitudes as a flag. Passing '--point' and '-37.8,144.9' as two
// separate argv entries WILL fail with argparse "unrecognized arguments".
function osrmPointArg(p: LatLon): string {
  return `--point=${p.lat},${p.lon}`;
}

export async function osrmTable(
  profile: 'bicycle' | 'foot',
  source: LatLon,
  destinations: LatLon[],
): Promise<{ durations: number[]; distances: number[] }> {
  if (destinations.length === 0) return { durations: [], distances: [] };
  const pointArgs = [source, ...destinations].map(osrmPointArg);
  const destIdx = destinations.map((_, i) => String(i + 1)).join(';');
  // --json returns native OSRM format: durations in seconds (s), distances in meters (m).
  const data = runJson(OSRM_BIN, [
    'table', '--profile', profile,
    ...pointArgs,
    '--sources', '0',
    '--destinations', destIdx,
    '--annotations', 'both',
    '--json',
  ]) as { durations?: number[][]; distances?: number[][] };
  if (!data.durations || !data.distances) {
    throw new Error('osrm-au table response missing durations/distances');
  }
  return {
    durations: data.durations[0] ?? [],
    distances: data.distances[0] ?? [],
  };
}

export async function osrmRoute(
  profile: 'bicycle' | 'foot',
  from: LatLon,
  to: LatLon,
): Promise<{ km: number; min: number; geometry: GeoJsonLineString | null }> {
  // --overview full + --geometries geojson asks for the full route shape as a GeoJSON LineString.
  // --json returns native OSRM format: routes[0].distance in meters, duration in seconds.
  const data = runJson(OSRM_BIN, [
    'route', '--profile', profile,
    osrmPointArg(from),
    osrmPointArg(to),
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
  const geom = route.geometry && typeof route.geometry === 'object'
    ? (route.geometry as GeoJsonLineString)
    : null;
  return {
    km: route.distance / 1000,
    min: route.duration / 60,
    geometry: geom,
  };
}

type GhRouteRaw = Array<{
  response?: {
    paths?: Array<{
      distance?: number;
      time?: number;
      details?: {
        road_class?: Array<[number, number, string]>;
      };
    }>;
  };
}>;

const PATH_ROAD_CLASSES = new Set(['cycleway', 'path', 'track']);

export function parseGhRoute(raw: unknown):
  { km: number; min: number; kmOnPath: number } | null {
  const arr = raw as GhRouteRaw;
  const p = arr?.[0]?.response?.paths?.[0];
  if (typeof p?.distance !== 'number' || typeof p?.time !== 'number') return null;
  const km = p.distance / 1000;
  const min = p.time / 60_000;
  const segments = p.details?.road_class ?? [];
  if (segments.length === 0) return { km, min, kmOnPath: 0 };
  let totalIdx = 0;
  let pathIdx = 0;
  for (const [from, to, cls] of segments) {
    const span = to - from;
    totalIdx += span;
    if (PATH_ROAD_CLASSES.has(cls)) pathIdx += span;
  }
  const kmOnPath = totalIdx > 0 ? km * (pathIdx / totalIdx) : 0;
  return { km, min, kmOnPath };
}

export async function ghRouteBike(
  from: LatLon,
  to: LatLon,
  profile: 'bike' | 'bike_quiet' = 'bike',
): Promise<{ km: number; min: number; kmOnPath: number } | null> {
  try {
    const raw = runJson(GH_BIN, [
      'route',
      `--point=${from.lat},${from.lon}`,
      `--point=${to.lat},${to.lon}`,
      '--profile', profile,
      '--format', 'json',
    ]);
    return parseGhRoute(raw);
  } catch {
    return null;
  }
}
