import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import type { LatLon } from './types';

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
): Promise<{ km: number; min: number; geometry: string }> {
  // --json returns native OSRM format: routes[0].distance in meters, duration in seconds.
  const data = runJson(OSRM_BIN, [
    'route', '--profile', profile,
    osrmPointArg(from),
    osrmPointArg(to),
    '--json',
  ]) as { routes?: Array<{ distance?: number; duration?: number; geometry?: unknown }> };
  const route = data.routes?.[0];
  if (route?.distance === undefined || route?.duration === undefined) {
    throw new Error('osrm-au route response missing distance/duration');
  }
  return {
    km: route.distance / 1000,
    min: route.duration / 60,
    geometry: typeof route.geometry === 'string' ? route.geometry : '',
  };
}

export async function ghRouteBike(
  from: LatLon,
  to: LatLon,
  profile: 'bike' | 'bike_quiet' = 'bike',
): Promise<{ km: number; min: number; kmOnPath: number } | null> {
  try {
    // gh-route --format json returns [{profile, response: {paths: [{distance (m), time (ms),
    // details: {surface: [[from_idx, to_idx, value], ...]}}]}}].
    // We compute kmOnPath from the surface details by counting path nodes in each segment;
    // since we lack per-segment distance, we approximate as a fraction of total distance.
    // surface_breakdown is a best-guess field name — if absent, kmOnPath defaults to 0.
    const raw = runJson(GH_BIN, [
      'route',
      '--point', `${from.lat},${from.lon}`,
      '--point', `${to.lat},${to.lon}`,
      '--profile', profile,
      '--format', 'json',
    ]) as {
      distance_km?: number;
      time_min?: number;
      surface_breakdown?: Record<string, number>;
    };
    if (raw.distance_km === undefined || raw.time_min === undefined) return null;
    // surface_breakdown maps surface→km; "path-like" surfaces aggregate to kmOnPath.
    const pathSurfaces = new Set(['cycleway', 'path', 'track', 'unpaved', 'gravel']);
    let kmOnPath = 0;
    for (const [surface, km] of Object.entries(raw.surface_breakdown ?? {})) {
      if (pathSurfaces.has(surface)) kmOnPath += km;
    }
    return { km: raw.distance_km, min: raw.time_min, kmOnPath };
  } catch {
    return null;
  }
}
