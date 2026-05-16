import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import type { LatLon, GeoJsonLineString, CustomModel } from './types';

const OSRM_BIN = process.env.OSRM_AU_BIN ?? resolve(homedir(), 'bin/osrm-au');

/**
 * Decode a Google polyline-encoded string into a GeoJsonLineString.
 * OSRM uses precision 5 (1e5) by default with `--overview full`.
 * Algorithm reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string, precision = 5): GeoJsonLineString {
  const factor = Math.pow(10, precision);
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    coordinates.push([lng / factor, lat / factor]);
  }
  return { type: 'LineString', coordinates };
}

const GH_BIN = process.env.GH_ROUTE_BIN
  ?? resolve(__dirname, '../../../grasshopper-bike-routing/bin/gh-route');

const GH_REST_URL = process.env.GH_REST_URL
  ?? 'http://graphhopper.magpie-inconnu.ts.net:8989/route';

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
  // --overview full returns the full route shape as an encoded polyline string (precision 5).
  // --json returns native OSRM format: routes[0].distance in meters, duration in seconds.
  // Note: osrm-au does NOT support --geometries; geometry arrives as an encoded polyline
  // which we decode via decodePolyline().
  const data = runJson(OSRM_BIN, [
    'route', '--profile', profile,
    osrmPointArg(from),
    osrmPointArg(to),
    '--overview', 'full',
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

type GhRouteRaw = Array<{
  response?: {
    paths?: Array<{
      distance?: number;
      time?: number;
      ascend?: number;
      descend?: number;
      points?: GeoJsonLineString | string;
      details?: {
        road_class?: Array<[number, number, string]>;
        average_slope?: Array<[number, number, number]>;
      };
    }>;
  };
}>;

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type ParsedGhRoute = {
  km: number;
  min: number;
  kmOnPath: number;
  ascendM: number;
  descendM: number;
  maxSustainedGradePercent: number;
  maxSustainedGradeM: number;
  flatFraction: number;
  steepFraction: number;
  geometry: GeoJsonLineString | null;
};

const PATH_ROAD_CLASSES = new Set(['cycleway', 'path', 'track']);

export function parseGhRoute(raw: unknown): ParsedGhRoute | null {
  const arr = raw as GhRouteRaw;
  const p = arr?.[0]?.response?.paths?.[0];
  if (typeof p?.distance !== 'number' || typeof p?.time !== 'number') return null;
  const km = p.distance / 1000;
  const min = p.time / 60_000;

  // road_class for kmOnPath
  const rcSegments = p.details?.road_class ?? [];
  let totalRcIdx = 0;
  let pathIdx = 0;
  for (const [from, to, cls] of rcSegments) {
    const span = to - from;
    totalRcIdx += span;
    if (PATH_ROAD_CLASSES.has(cls)) pathIdx += span;
  }
  const kmOnPath = totalRcIdx > 0 ? km * (pathIdx / totalRcIdx) : 0;

  // Geometry (points is either GeoJsonLineString or absent for ghRouteBike)
  const geometry = p.points && typeof p.points === 'object'
    ? (p.points as GeoJsonLineString) : null;

  // Slope analysis — compute per-segment distances from geometry, then aggregate
  const slopeSegments = p.details?.average_slope ?? [];
  let ascendM = typeof p.ascend === 'number' ? p.ascend : 0;
  let descendM = typeof p.descend === 'number' ? p.descend : 0;
  let flatFraction = 0;
  let steepFraction = 0;
  let maxSustainedGradePercent = 0;
  let maxSustainedGradeM = 0;

  if (slopeSegments.length > 0 && geometry && geometry.coordinates.length > 1) {
    const coords = geometry.coordinates;
    const segDistM: number[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      segDistM.push(haversineM(coords[i], coords[i + 1]));
    }
    let totalSlopeD = 0;
    let flatD = 0;
    let steepD = 0;
    let curRun: { endIdx: number; g: number; dist: number } | null = null;
    for (const [a, b, g] of slopeSegments) {
      let d = 0;
      for (let i = a; i < b; i++) d += segDistM[i] ?? 0;
      totalSlopeD += d;
      const absG = Math.abs(g);
      if (absG < 4) flatD += d;
      if (absG >= 6) steepD += d;
      if (g >= 5) {
        if (curRun && curRun.endIdx === a) {
          curRun.endIdx = b; curRun.dist += d; curRun.g = Math.max(curRun.g, g);
        } else {
          curRun = { endIdx: b, g, dist: d };
        }
        if (curRun.dist * curRun.g > maxSustainedGradeM * maxSustainedGradePercent) {
          maxSustainedGradePercent = curRun.g;
          maxSustainedGradeM = curRun.dist;
        }
      } else {
        curRun = null;
      }
    }
    if (totalSlopeD > 0) {
      flatFraction = flatD / totalSlopeD;
      steepFraction = steepD / totalSlopeD;
    }
  }

  return {
    km, min, kmOnPath, ascendM, descendM,
    maxSustainedGradePercent, maxSustainedGradeM,
    flatFraction, steepFraction,
    geometry,
  };
}

export async function ghRouteBike(
  from: LatLon,
  to: LatLon,
  profile: 'bike' | 'bike_quiet' = 'bike',
): Promise<ParsedGhRoute | null> {
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

export async function ghRouteCustom(
  from: LatLon,
  to: LatLon,
  customModel: CustomModel,
): Promise<ParsedGhRoute | null> {
  const body = {
    points: [[from.lon, from.lat], [to.lon, to.lat]],
    profile: 'bike',
    'ch.disable': true,
    points_encoded: false,
    instructions: false,
    elevation: true,
    details: ['road_class', 'average_slope', 'surface'],
    custom_model: customModel,
  };
  try {
    const r = await fetch(GH_REST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const data = await r.json() as { paths?: unknown[] };
    if (!data.paths || data.paths.length === 0) return null;
    return parseGhRoute([{ response: { paths: data.paths as never } }]);
  } catch {
    return null;
  }
}
