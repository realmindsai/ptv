import type {
  PlanRequest, PlanResult, Itinerary, AccessCandidate, Leg,
} from './types';
import { BIKEABLE_ROUTE_TYPES, MAX_PLAUSIBLE_TOTAL_MIN } from './types';
import { accessCandidates } from './candidates';
import { departuresFrom, runPattern } from './transit';
import { labelAndSort } from './score';

type PtvFn = (path: string, params?: Record<string, string | number | number[] | string[]>) => Promise<unknown>;
type ExternalMod = typeof import('./external');
type Deps = { ptv: PtvFn; external: ExternalMod };

async function defaultDeps(): Promise<Deps> {
  const { ptv } = await import('../client');
  const external = await import('./external');
  return { ptv, external };
}

const EARTH_KM = 6371;
function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export async function plan(req: PlanRequest, deps?: Partial<Deps>): Promise<PlanResult> {
  const resolved = { ...(await defaultDeps()), ...(deps ?? {}) };

  if (req.maxTransfers > 0) {
    throw new Error('--max-transfers > 0 not yet implemented in v1');
  }
  if (req.departUtc && req.arriveByUtc) {
    throw new Error('--depart and --arrive-by are mutually exclusive');
  }

  const warnings: string[] = [];
  const seedTime: Date = req.departUtc
    ?? (req.arriveByUtc
      ? new Date(req.arriveByUtc.getTime() - MAX_PLAUSIBLE_TOTAL_MIN * 60_000)
      : new Date());

  const [access, egress] = await Promise.all([
    accessCandidates(req.from, req.maxBikeKm, BIKEABLE_ROUTE_TYPES, resolved),
    accessCandidates(req.to,   req.maxBikeKm, BIKEABLE_ROUTE_TYPES, resolved),
  ]);
  if (access.length === 0 || egress.length === 0) {
    return { query: req, itineraries: [], warnings: ['no bikeable stops in range'] };
  }

  const egressByStopId = new Map(egress.map((e) => [e.stopId, e]));
  const runPatternCache = new Map<string, { stopId: number; arriveUtc: string }[]>();

  type Tuple = { access: AccessCandidate; egress: AccessCandidate;
                 routeId: number; runRef: string;
                 departUtc: string; arriveUtc: string };
  const tuples: Tuple[] = [];

  await Promise.all(access.map(async (a) => {
    const notBefore = new Date(seedTime.getTime() + a.bikeMin * 60_000);
    const deps = await departuresFrom(a.stopId, a.routeType, notBefore, 60, resolved);

    for (const d of deps) {
      if (!a.routeIds.includes(d.routeId)) continue;
      let pattern = runPatternCache.get(d.runRef);
      if (!pattern) {
        pattern = await runPattern(d.runRef, a.routeType, resolved);
        runPatternCache.set(d.runRef, pattern);
      }
      const aIdx = pattern.findIndex((p) => p.stopId === a.stopId);
      if (aIdx < 0) continue;
      for (let i = aIdx + 1; i < pattern.length; i++) {
        const eg = egressByStopId.get(pattern[i].stopId);
        if (!eg) continue;
        tuples.push({
          access: a, egress: eg,
          routeId: d.routeId, runRef: d.runRef,
          departUtc: d.departUtc, arriveUtc: pattern[i].arriveUtc,
        });
      }
    }
  }));

  async function bikeLegRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<{ km: number; min: number; geometry: string }> {
    return resolved.external.osrmRoute('bicycle', from, to);
  }

  const itineraries: Itinerary[] = [];
  for (const t of tuples) {
    if (req.arriveByUtc && Date.parse(t.arriveUtc) > req.arriveByUtc.getTime()) continue;

    const bikeOut = await bikeLegRoute(req.from, t.access.coord);
    const bikeIn  = await bikeLegRoute(t.egress.coord, req.to);
    const bikeKm  = bikeOut.km + bikeIn.km;
    const bikeMin = bikeOut.min + bikeIn.min;
    const trainKm = haversineKm(t.access.coord, t.egress.coord);
    const trainMin = (Date.parse(t.arriveUtc) - Date.parse(t.departUtc)) / 60_000;
    const isArriveBy = !!req.arriveByUtc;
    const waitMin = isArriveBy
      ? 0
      : Math.max(0, (Date.parse(t.departUtc) - seedTime.getTime()) / 60_000 - bikeOut.min);
    const totalTimeMin = bikeMin + waitMin + trainMin;

    let bikeKmOnPath: number | null | undefined = undefined;
    if (req.enrich) {
      const [out, into] = await Promise.all([
        resolved.external.ghRouteBike(req.from, t.access.coord),
        resolved.external.ghRouteBike(t.egress.coord, req.to),
      ]);
      if (out && into) bikeKmOnPath = out.kmOnPath + into.kmOnPath;
      else {
        bikeKmOnPath = null;
        if (!warnings.includes('gh-route unavailable; bike_km_on_path omitted')) {
          warnings.push('gh-route unavailable; bike_km_on_path omitted');
        }
      }
    }

    const legs: Leg[] = [
      { mode: 'bike', from: req.from, to: t.access.coord,
        km: bikeOut.km, min: bikeOut.min, geometry: bikeOut.geometry },
      { mode: 'train', routeId: t.routeId, routeType: t.access.routeType,
        routeName: '',
        fromStopId: t.access.stopId, toStopId: t.egress.stopId,
        fromStopName: t.access.stopName, toStopName: t.egress.stopName,
        departUtc: t.departUtc, arriveUtc: t.arriveUtc, runRef: t.runRef },
      { mode: 'bike', from: t.egress.coord, to: req.to,
        km: bikeIn.km, min: bikeIn.min, geometry: bikeIn.geometry },
    ];

    itineraries.push({
      labels: [],
      totalTimeMin, bikeKm, bikeMin, bikeKmOnPath,
      trainKm, trainMin, waitMin, transfers: 0, legs,
    });
  }

  // labelAndSort handles near-miss when no itineraries are feasible. But if
  // the orchestrator produced ZERO itineraries (e.g. no shared routes), we
  // also need to surface a near-miss warning when min/max constraints would
  // have been the reason. Let the score module's near-miss path handle the
  // (rare) case where itineraries exist but none are feasible.
  const labeled = labelAndSort(itineraries, req);

  // Add warning for the min_bike_km near-miss case
  if (labeled.length === 1 && labeled[0].constraintsViolated) {
    const v = labeled[0].constraintsViolated;
    if (v.includes('min_bike_km')) {
      warnings.push(`no itinerary met --min-bike-km=${req.minBikeKm}; showing best near-miss (bike_km=${labeled[0].bikeKm.toFixed(1)})`);
    }
    if (v.includes('max_bike_km')) {
      warnings.push(`no itinerary met --max-bike-km=${req.maxBikeKm}; showing best near-miss (bike_km=${labeled[0].bikeKm.toFixed(1)})`);
    }
  }

  return {
    query: req,
    itineraries: labeled,
    ...(warnings.length ? { warnings } : {}),
  };
}
