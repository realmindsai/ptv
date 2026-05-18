import { spawnSync } from 'child_process';
import { resolve } from 'path';
import type { LatLon, GeoJsonLineString, CustomModel } from './types';

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

const OSRM_AU_HOST = process.env.OSRM_AU_HOST ?? 'totoro.magpie-inconnu.ts.net';
const OSRM_PROFILE_PORT = { bicycle: 5002, foot: 5003 } as const;

type OsrmProfile = keyof typeof OSRM_PROFILE_PORT;

function osrmBase(profile: OsrmProfile): string {
  const override =
    profile === 'bicycle'
      ? process.env.OSRM_AU_BICYCLE_URL
      : process.env.OSRM_AU_FOOT_URL;
  return override ?? `http://${OSRM_AU_HOST}:${OSRM_PROFILE_PORT[profile]}`;
}

function osrmCoordPath(points: LatLon[]): string {
  // OSRM wire format is lon,lat — flip from our internal {lat, lon}.
  return points.map((p) => `${p.lon},${p.lat}`).join(';');
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

export async function osrmTable(
  profile: OsrmProfile,
  source: LatLon,
  destinations: LatLon[],
): Promise<{ durations: number[]; distances: number[] }> {
  if (destinations.length === 0) return { durations: [], distances: [] };
  const coords = osrmCoordPath([source, ...destinations]);
  const destIdx = destinations.map((_, i) => String(i + 1)).join(';');
  const qs = new URLSearchParams({
    annotations: 'duration,distance',
    sources: '0',
    destinations: destIdx,
  });
  const url = `${osrmBase(profile)}/table/v1/driving/${coords}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OSRM ${profile} table HTTP ${r.status}`);
  const data = (await r.json()) as {
    code?: string; message?: string;
    durations?: number[][]; distances?: number[][];
  };
  if (data.code && data.code !== 'Ok') {
    throw new Error(`OSRM ${profile} table: ${data.code} - ${data.message ?? ''}`);
  }
  if (!data.durations || !data.distances) {
    throw new Error('OSRM table response missing durations/distances');
  }
  return {
    durations: data.durations[0] ?? [],
    distances: data.distances[0] ?? [],
  };
}

export async function osrmRoute(
  profile: OsrmProfile,
  from: LatLon,
  to: LatLon,
): Promise<{ km: number; min: number; geometry: GeoJsonLineString | null }> {
  const coords = osrmCoordPath([from, to]);
  const qs = new URLSearchParams({
    overview: 'full',
    geometries: 'polyline',
  });
  const url = `${osrmBase(profile)}/route/v1/driving/${coords}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OSRM ${profile} route HTTP ${r.status}`);
  const data = (await r.json()) as {
    code?: string; message?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: GeoJsonLineString | string;
    }>;
  };
  if (data.code && data.code !== 'Ok') {
    throw new Error(`OSRM ${profile} route: ${data.code} - ${data.message ?? ''}`);
  }
  const route = data.routes?.[0];
  if (route?.distance === undefined || route?.duration === undefined) {
    throw new Error('OSRM route response missing distance/duration');
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

  // Geometry (points is either GeoJsonLineString or absent for ghRouteBike)
  const geometry = p.points && typeof p.points === 'object'
    ? (p.points as GeoJsonLineString) : null;

  // Per-segment haversine distances, shared by kmOnPath and slope analysis.
  // Falls back to empty when geometry is absent; the road_class branch below then
  // uses an index-span approximation instead (less accurate; preserved for callers
  // that don't pass geometry).
  const segDistM: number[] = [];
  if (geometry && geometry.coordinates.length > 1) {
    const coords = geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      segDistM.push(haversineM(coords[i], coords[i + 1]));
    }
  }

  // road_class for kmOnPath. Sum metres (not coordinate-index spans) when we have
  // geometry — dense polyline points along path-class segments would otherwise
  // inflate the path fraction (ptv-aw2).
  const rcSegments = p.details?.road_class ?? [];
  let totalRcM = 0;
  let pathM = 0;
  let totalRcIdx = 0;
  let pathIdx = 0;
  for (const [from, to, cls] of rcSegments) {
    const idxSpan = to - from;
    totalRcIdx += idxSpan;
    if (PATH_ROAD_CLASSES.has(cls)) pathIdx += idxSpan;
    if (segDistM.length > 0) {
      let d = 0;
      for (let i = from; i < to; i++) d += segDistM[i] ?? 0;
      totalRcM += d;
      if (PATH_ROAD_CLASSES.has(cls)) pathM += d;
    }
  }
  const kmOnPath = segDistM.length > 0
    ? (totalRcM > 0 ? km * (pathM / totalRcM) : 0)
    : (totalRcIdx > 0 ? km * (pathIdx / totalRcIdx) : 0);

  // Slope analysis — reuses segDistM from above
  const slopeSegments = p.details?.average_slope ?? [];
  let ascendM = typeof p.ascend === 'number' ? p.ascend : 0;
  let descendM = typeof p.descend === 'number' ? p.descend : 0;
  let flatFraction = 0;
  let steepFraction = 0;
  let maxSustainedGradePercent = 0;
  let maxSustainedGradeM = 0;

  if (slopeSegments.length > 0 && segDistM.length > 0) {
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
  // REST first — works inside Docker (graphhopper-vic-bike:8989) and from any
  // machine on the tailnet (graphhopper.magpie-inconnu.ts.net:8989). Same data
  // as the subprocess CLI, fewer moving parts in the container deploy.
  try {
    const r = await fetch(GH_REST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [[from.lon, from.lat], [to.lon, to.lat]],
        profile,
        'ch.disable': true,
        points_encoded: false,
        instructions: false,
        elevation: true,
        details: ['road_class', 'average_slope', 'surface'],
      }),
    });
    if (r.ok) {
      const data = await r.json() as { paths?: unknown[] };
      if (data.paths && data.paths.length > 0) {
        return parseGhRoute([{ response: { paths: data.paths as never } }]);
      }
    }
  } catch {
    // network/connection refused — fall through to the subprocess binary if present
  }
  // Subprocess fallback for CLI dev environments where REST isn't reachable
  // but a local gh-route binary exists.
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
