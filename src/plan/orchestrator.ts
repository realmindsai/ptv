import type {
  PlanRequest, PlanResult, Itinerary, AccessCandidate, Leg, GeoJsonLineString,
} from './types';
import {
  BIKEABLE_ROUTE_TYPES, MAX_PLAUSIBLE_TOTAL_MIN,
  TRANSFER_BUFFER_MIN, MAX_HUB_FANOUT,
} from './types';
import { accessCandidates } from './candidates';
import { departuresFrom, runPattern } from './transit';
import { labelAndSort } from './score';
import { isHub, hubName } from './hubs';

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

type RouteResult = { km: number; min: number; geometry: GeoJsonLineString | null };
type EnrichResult = { km: number; min: number; kmOnPath: number } | null;
type PatternStop = { stopId: number; arriveUtc: string };

type SearchState = {
  req: PlanRequest;
  deps: Deps;
  seedTime: Date;
  access: AccessCandidate[];
  egress: AccessCandidate[];
  egressByStopId: Map<number, AccessCandidate>;
  patternCache: Map<string, PatternStop[]>;
  accessRouteCache: Map<number, Promise<RouteResult>>;
  egressRouteCache: Map<number, Promise<RouteResult>>;
  accessEnrichCache: Map<number, Promise<EnrichResult>>;
  egressEnrichCache: Map<number, Promise<EnrichResult>>;
  warnings: string[];
};

function accessBikeRoute(s: SearchState, a: AccessCandidate): Promise<RouteResult> {
  let p = s.accessRouteCache.get(a.stopId);
  if (!p) {
    p = s.deps.external.osrmRoute('bicycle', s.req.from, a.coord);
    s.accessRouteCache.set(a.stopId, p);
  }
  return p;
}
function egressBikeRoute(s: SearchState, e: AccessCandidate): Promise<RouteResult> {
  let p = s.egressRouteCache.get(e.stopId);
  if (!p) {
    p = s.deps.external.osrmRoute('bicycle', e.coord, s.req.to);
    s.egressRouteCache.set(e.stopId, p);
  }
  return p;
}
function accessEnrich(s: SearchState, a: AccessCandidate): Promise<EnrichResult> {
  let p = s.accessEnrichCache.get(a.stopId);
  if (!p) {
    p = s.deps.external.ghRouteBike(s.req.from, a.coord);
    s.accessEnrichCache.set(a.stopId, p);
  }
  return p;
}
function egressEnrich(s: SearchState, e: AccessCandidate): Promise<EnrichResult> {
  let p = s.egressEnrichCache.get(e.stopId);
  if (!p) {
    p = s.deps.external.ghRouteBike(e.coord, s.req.to);
    s.egressEnrichCache.set(e.stopId, p);
  }
  return p;
}

async function getPattern(s: SearchState, runRef: string, routeType: 0 | 3): Promise<PatternStop[]> {
  let p = s.patternCache.get(runRef);
  if (!p) {
    p = await runPattern(runRef, routeType, s.deps);
    s.patternCache.set(runRef, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// K=1: single-train search
// ---------------------------------------------------------------------------

type K1Tuple = {
  access: AccessCandidate; egress: AccessCandidate;
  routeId: number; runRef: string; routeName: string;
  departUtc: string; arriveUtc: string;
};

async function planK1(s: SearchState): Promise<Itinerary[]> {
  const tuples: K1Tuple[] = [];

  await Promise.all(s.access.map(async (a) => {
    const notBefore = new Date(s.seedTime.getTime() + a.bikeMin * 60_000);
    const deps = await departuresFrom(a.stopId, a.routeType, notBefore, 60, s.deps);
    for (const d of deps) {
      if (!a.routeIds.includes(d.routeId)) continue;
      const pattern = await getPattern(s, d.runRef, a.routeType);
      const aIdx = pattern.findIndex((p) => p.stopId === a.stopId);
      if (aIdx < 0) continue;
      for (let i = aIdx + 1; i < pattern.length; i++) {
        const eg = s.egressByStopId.get(pattern[i].stopId);
        if (!eg) continue;
        tuples.push({
          access: a, egress: eg,
          routeId: d.routeId, runRef: d.runRef, routeName: d.routeName,
          departUtc: d.departUtc, arriveUtc: pattern[i].arriveUtc,
        });
      }
    }
  }));

  const itineraries: Itinerary[] = [];
  for (const t of tuples) {
    if (s.req.arriveByUtc && Date.parse(t.arriveUtc) > s.req.arriveByUtc.getTime()) continue;

    const bikeOut = await accessBikeRoute(s, t.access);
    const bikeIn  = await egressBikeRoute(s, t.egress);
    const bikeKm  = bikeOut.km + bikeIn.km;
    const bikeMin = bikeOut.min + bikeIn.min;
    const trainKm = haversineKm(t.access.coord, t.egress.coord);
    const trainMin = (Date.parse(t.arriveUtc) - Date.parse(t.departUtc)) / 60_000;
    const isArriveBy = !!s.req.arriveByUtc;
    const waitMin = isArriveBy
      ? 0
      : Math.max(0, (Date.parse(t.departUtc) - s.seedTime.getTime()) / 60_000 - bikeOut.min);
    const totalTimeMin = bikeMin + waitMin + trainMin;

    let bikeKmOnPath: number | null | undefined = undefined;
    if (s.req.enrich) {
      const [out, into] = await Promise.all([accessEnrich(s, t.access), egressEnrich(s, t.egress)]);
      if (out && into) bikeKmOnPath = out.kmOnPath + into.kmOnPath;
      else {
        bikeKmOnPath = null;
        if (!s.warnings.includes('gh-route unavailable; bike_km_on_path omitted')) {
          s.warnings.push('gh-route unavailable; bike_km_on_path omitted');
        }
      }
    }

    const legs: Leg[] = [
      { mode: 'bike', from: s.req.from, to: t.access.coord,
        km: bikeOut.km, min: bikeOut.min, geometry: bikeOut.geometry },
      { mode: 'train', routeId: t.routeId, routeType: t.access.routeType,
        routeName: t.routeName,
        fromStopId: t.access.stopId, toStopId: t.egress.stopId,
        fromStopName: t.access.stopName, toStopName: t.egress.stopName,
        departUtc: t.departUtc, arriveUtc: t.arriveUtc, runRef: t.runRef },
      { mode: 'bike', from: t.egress.coord, to: s.req.to,
        km: bikeIn.km, min: bikeIn.min, geometry: bikeIn.geometry },
    ];

    itineraries.push({
      labels: [], totalTimeMin, bikeKm, bikeMin, bikeKmOnPath,
      trainKm, trainMin, waitMin, transfers: 0, legs,
    });
  }
  return itineraries;
}

// ---------------------------------------------------------------------------
// K=2: hub-based two-train fallback
// ---------------------------------------------------------------------------

type HubArrival = {
  hubStopId: number;
  hubArriveUtc: string;
  viaAccess: AccessCandidate;
  run1Ref: string;
  routeId1: number;
  routeName1: string;
  depart1Utc: string;
};

type K2Tuple = {
  access: AccessCandidate;
  egress: AccessCandidate;
  hubStopId: number;
  run1Ref: string; routeId1: number; routeName1: string;
  depart1Utc: string; arrive1Utc: string;
  run2Ref: string; routeId2: number; routeName2: string;
  depart2Utc: string; arrive2Utc: string;
};

async function planK2Hubs(s: SearchState): Promise<Itinerary[]> {
  const hubArrivals: HubArrival[] = [];

  await Promise.all(s.access.map(async (a) => {
    const notBefore = new Date(s.seedTime.getTime() + a.bikeMin * 60_000);
    const deps = await departuresFrom(a.stopId, a.routeType, notBefore, 60, s.deps);
    for (const d of deps) {
      if (!a.routeIds.includes(d.routeId)) continue;
      const pattern = await getPattern(s, d.runRef, a.routeType);
      const aIdx = pattern.findIndex((p) => p.stopId === a.stopId);
      if (aIdx < 0) continue;
      for (let i = aIdx + 1; i < pattern.length; i++) {
        if (!isHub(pattern[i].stopId)) continue;
        hubArrivals.push({
          hubStopId: pattern[i].stopId,
          hubArriveUtc: pattern[i].arriveUtc,
          viaAccess: a, run1Ref: d.runRef, routeId1: d.routeId,
          routeName1: d.routeName, depart1Utc: d.departUtc,
        });
      }
    }
  }));

  if (hubArrivals.length > MAX_HUB_FANOUT) {
    hubArrivals.sort((x, y) => Date.parse(x.hubArriveUtc) - Date.parse(y.hubArriveUtc));
    hubArrivals.length = MAX_HUB_FANOUT;
  }
  if (hubArrivals.length === 0) return [];

  const tuples: K2Tuple[] = [];

  await Promise.all(hubArrivals.map(async (ha) => {
    const notBefore = new Date(Date.parse(ha.hubArriveUtc) + TRANSFER_BUFFER_MIN * 60_000);
    for (const rt of BIKEABLE_ROUTE_TYPES) {
      const hubDeps = await departuresFrom(ha.hubStopId, rt, notBefore, 60, s.deps);
      for (const hd of hubDeps) {
        if (hd.runRef === ha.run1Ref) continue;
        const pattern = await getPattern(s, hd.runRef, rt);
        const hIdx = pattern.findIndex((p) => p.stopId === ha.hubStopId);
        if (hIdx < 0) continue;
        for (let j = hIdx + 1; j < pattern.length; j++) {
          const eg = s.egressByStopId.get(pattern[j].stopId);
          if (!eg) continue;
          tuples.push({
            access: ha.viaAccess, egress: eg,
            hubStopId: ha.hubStopId,
            run1Ref: ha.run1Ref, routeId1: ha.routeId1, routeName1: ha.routeName1,
            depart1Utc: ha.depart1Utc, arrive1Utc: ha.hubArriveUtc,
            run2Ref: hd.runRef, routeId2: hd.routeId, routeName2: hd.routeName,
            depart2Utc: hd.departUtc, arrive2Utc: pattern[j].arriveUtc,
          });
        }
      }
    }
  }));

  const itineraries: Itinerary[] = [];
  for (const t of tuples) {
    if (s.req.arriveByUtc && Date.parse(t.arrive2Utc) > s.req.arriveByUtc.getTime()) continue;

    const bikeOut = await accessBikeRoute(s, t.access);
    const bikeIn  = await egressBikeRoute(s, t.egress);
    const bikeKm  = bikeOut.km + bikeIn.km;
    const bikeMin = bikeOut.min + bikeIn.min;
    const trainKm = haversineKm(t.access.coord, t.egress.coord);
    const train1Min = (Date.parse(t.arrive1Utc) - Date.parse(t.depart1Utc)) / 60_000;
    const train2Min = (Date.parse(t.arrive2Utc) - Date.parse(t.depart2Utc)) / 60_000;
    const trainMin = train1Min + train2Min;
    const transferDwellMin = (Date.parse(t.depart2Utc) - Date.parse(t.arrive1Utc)) / 60_000;
    const isArriveBy = !!s.req.arriveByUtc;
    const waitMin = isArriveBy
      ? 0
      : Math.max(0, (Date.parse(t.depart1Utc) - s.seedTime.getTime()) / 60_000 - bikeOut.min);
    const totalTimeMin = bikeMin + waitMin + trainMin + transferDwellMin;

    let bikeKmOnPath: number | null | undefined = undefined;
    if (s.req.enrich) {
      const [out, into] = await Promise.all([accessEnrich(s, t.access), egressEnrich(s, t.egress)]);
      if (out && into) bikeKmOnPath = out.kmOnPath + into.kmOnPath;
      else {
        bikeKmOnPath = null;
        if (!s.warnings.includes('gh-route unavailable; bike_km_on_path omitted')) {
          s.warnings.push('gh-route unavailable; bike_km_on_path omitted');
        }
      }
    }

    const legs: Leg[] = [
      { mode: 'bike', from: s.req.from, to: t.access.coord,
        km: bikeOut.km, min: bikeOut.min, geometry: bikeOut.geometry },
      { mode: 'train', routeId: t.routeId1, routeType: t.access.routeType,
        routeName: t.routeName1,
        fromStopId: t.access.stopId, toStopId: t.hubStopId,
        fromStopName: t.access.stopName, toStopName: hubName(t.hubStopId),
        departUtc: t.depart1Utc, arriveUtc: t.arrive1Utc, runRef: t.run1Ref },
      { mode: 'train', routeId: t.routeId2, routeType: t.egress.routeType,
        routeName: t.routeName2,
        fromStopId: t.hubStopId, toStopId: t.egress.stopId,
        fromStopName: hubName(t.hubStopId), toStopName: t.egress.stopName,
        departUtc: t.depart2Utc, arriveUtc: t.arrive2Utc, runRef: t.run2Ref },
      { mode: 'bike', from: t.egress.coord, to: s.req.to,
        km: bikeIn.km, min: bikeIn.min, geometry: bikeIn.geometry },
    ];

    itineraries.push({
      labels: [], totalTimeMin, bikeKm, bikeMin, bikeKmOnPath,
      trainKm, trainMin, waitMin, transfers: 1, transferDwellMin, legs,
    });
  }
  return itineraries;
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

function hasFeasibleItineraries(items: Itinerary[]): boolean {
  return items.length > 0 && items.every((i) => !i.constraintsViolated);
}

export async function plan(req: PlanRequest, deps?: Partial<Deps>): Promise<PlanResult> {
  const resolved = { ...(await defaultDeps()), ...(deps ?? {}) };

  if (req.maxTransfers >= 2) {
    throw new Error('--max-transfers >= 2 not yet implemented in v1.2');
  }
  if (req.maxTransfers < 0) {
    throw new Error('--max-transfers must be >= 0');
  }
  if (req.departUtc && req.arriveByUtc) {
    throw new Error('--depart and --arrive-by are mutually exclusive');
  }

  const seedTime: Date = req.departUtc
    ?? (req.arriveByUtc
      ? new Date(req.arriveByUtc.getTime() - MAX_PLAUSIBLE_TOTAL_MIN * 60_000)
      : new Date());

  const [access, egress] = await Promise.all([
    accessCandidates(req.from, req.maxBikeKm, BIKEABLE_ROUTE_TYPES, resolved),
    accessCandidates(req.to,   req.maxBikeKm, BIKEABLE_ROUTE_TYPES, resolved),
  ]);

  const warnings: string[] = [];

  if (access.length === 0 || egress.length === 0) {
    return { query: req, itineraries: [], warnings: ['no bikeable stops in range'] };
  }

  const state: SearchState = {
    req, deps: resolved, seedTime, access, egress,
    egressByStopId: new Map(egress.map((e) => [e.stopId, e])),
    patternCache: new Map(),
    accessRouteCache: new Map(),
    egressRouteCache: new Map(),
    accessEnrichCache: new Map(),
    egressEnrichCache: new Map(),
    warnings,
  };

  const k1Items = await planK1(state);
  const k1Labeled = labelAndSort(k1Items, req);

  let allItems: Itinerary[] = k1Labeled;

  if (req.maxTransfers >= 1 && !hasFeasibleItineraries(k1Labeled)) {
    const k2Items = await planK2Hubs(state);
    if (k2Items.length > 0) {
      const combined = [...k1Items, ...k2Items];
      allItems = labelAndSort(combined, req);
    }
  }

  if (allItems.length === 1 && allItems[0].constraintsViolated) {
    const v = allItems[0].constraintsViolated;
    if (v.includes('min_bike_km')) {
      warnings.push(`no itinerary met --min-bike-km=${req.minBikeKm}; showing best near-miss (bike_km=${allItems[0].bikeKm.toFixed(1)})`);
    }
    if (v.includes('max_bike_km')) {
      warnings.push(`no itinerary met --max-bike-km=${req.maxBikeKm}; showing best near-miss (bike_km=${allItems[0].bikeKm.toFixed(1)})`);
    }
  }

  return {
    query: req,
    itineraries: allItems,
    ...(warnings.length ? { warnings } : {}),
  };
}
