import type { DepartureWithPattern, RouteTypeBikeable } from './types';

type PtvFn = (path: string, params?: Record<string, string | number | number[] | string[]>) => Promise<unknown>;
type Deps = { ptv: PtvFn };

type DepartureRaw = {
  route_id: number;
  run_ref: string;
  scheduled_departure_utc: string;
  estimated_departure_utc: string | null;
  stop_id: number;
};

async function defaultDeps(): Promise<Deps> {
  const { ptv } = await import('../client');
  return { ptv };
}

export async function departuresFrom(
  stopId: number,
  routeType: RouteTypeBikeable,
  notBefore: Date,
  lookaheadMin: number,
  deps?: Deps,
): Promise<DepartureWithPattern[]> {
  const { ptv } = deps ?? (await defaultDeps());

  const raw = (await ptv(
    `/v3/departures/route_type/${routeType}/stop/${stopId}`,
    {
      date_utc: notBefore.toISOString(),
      max_results: 10,
      expand: ['Run', 'Stop', 'Route'],
    },
  )) as {
    departures?: DepartureRaw[];
    routes?: Record<string, { route_id: number; route_name?: string }>;
  };

  const notBeforeMs = notBefore.getTime();
  const cutoffMs = notBeforeMs + lookaheadMin * 60_000;

  const routesMap = raw.routes ?? {};
  const out: DepartureWithPattern[] = [];
  for (const d of raw.departures ?? []) {
    const t = d.estimated_departure_utc ?? d.scheduled_departure_utc;
    const tMs = Date.parse(t);
    if (tMs < notBeforeMs || tMs > cutoffMs) continue;
    out.push({
      routeId: d.route_id,
      routeType,
      routeName: routesMap[String(d.route_id)]?.route_name ?? '',
      runRef: d.run_ref,
      departUtc: t,
      pattern: [], // populated by orchestrator via runPattern() when needed
    });
  }
  return out;
}

export async function runPattern(
  runRef: string,
  routeType: RouteTypeBikeable,
  dateUtc?: Date,
  deps?: Deps,
): Promise<{ stopId: number; arriveUtc: string }[]> {
  const { ptv } = deps ?? (await defaultDeps());
  // `date_utc` anchors which scheduled instance of this run to return.
  // Without it PTV returns *today's* instance, which corrupts patterns when
  // the trip is for a future day (depart/arrive timestamps come back stamped
  // with today's date, often producing arrive < depart and negative durations).
  const params: Record<string, string | number | string[]> = { expand: ['Stop'] };
  if (dateUtc) params.date_utc = dateUtc.toISOString();
  const raw = (await ptv(
    `/v3/pattern/run/${runRef}/route_type/${routeType}`, params,
  )) as { departures?: { stop_id: number; scheduled_departure_utc: string; estimated_departure_utc: string | null }[] };
  return (raw.departures ?? []).map((d) => ({
    stopId: d.stop_id,
    arriveUtc: d.estimated_departure_utc ?? d.scheduled_departure_utc,
  }));
}
