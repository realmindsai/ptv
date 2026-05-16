import type {
  LatLon, AccessCandidate, RouteTypeBikeable,
} from './types';

type PtvFn = (path: string, params?: Record<string, string | number | number[]>) => Promise<unknown>;
type ExternalMod = typeof import('./external');

type Deps = { ptv: PtvFn; external: ExternalMod };

type StopRaw = {
  stop_id: number;
  stop_name: string;
  route_type: number;
  stop_latitude: number;
  stop_longitude: number;
  routes?: { route_id: number; route_type: number }[];
};

async function defaultDeps(): Promise<Deps> {
  const { ptv } = await import('../client');
  const external = await import('./external');
  return { ptv, external };
}

export async function accessCandidates(
  origin: LatLon,
  maxBikeKm: number,
  routeTypes: RouteTypeBikeable[],
  deps?: Deps,
): Promise<AccessCandidate[]> {
  const { ptv, external } = deps ?? (await defaultDeps());

  const raw = (await ptv(`/v3/stops/location/${origin.lat},${origin.lon}`, {
    max_distance: Math.round(maxBikeKm * 1000),
    route_types: routeTypes as number[],
    expand: 'Route',
    max_results: 200,
  })) as { stops?: StopRaw[] };

  if ((raw.stops?.length ?? 0) === 200) {
    // Truncation signal: the caller may want to narrow the radius.
    // We write to stderr because this helper has no warnings channel back to
    // the orchestrator in v1.1. A future refactor can return warnings as a
    // second value if a caller needs to surface them in the JSON response.
    process.stderr.write(
      `candidates: stops/location returned exactly 200 — possible truncation at ${origin.lat},${origin.lon}\n`,
    );
  }

  const stops = (raw.stops ?? []).filter((s) =>
    (routeTypes as number[]).includes(s.route_type),
  );
  if (stops.length === 0) return [];

  const dests: LatLon[] = stops.map((s) => ({
    lat: s.stop_latitude,
    lon: s.stop_longitude,
  }));
  const { durations, distances } = await external.osrmTable('bicycle', origin, dests);

  const out: AccessCandidate[] = [];
  for (let i = 0; i < stops.length; i++) {
    const km = (distances[i] ?? Infinity) / 1000;
    const min = (durations[i] ?? Infinity) / 60;
    if (km > maxBikeKm) continue;
    const s = stops[i];
    const routeIds = (s.routes ?? [])
      .filter((r) => (routeTypes as number[]).includes(r.route_type))
      .map((r) => r.route_id);
    out.push({
      stopId: s.stop_id,
      stopName: s.stop_name,
      routeType: s.route_type as RouteTypeBikeable,
      routeIds,
      coord: { lat: s.stop_latitude, lon: s.stop_longitude },
      bikeKm: km,
      bikeMin: min,
    });
  }
  return out;
}
