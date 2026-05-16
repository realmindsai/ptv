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
      expand: ['Run', 'Stop'],
    },
  )) as { departures?: DepartureRaw[] };

  const notBeforeMs = notBefore.getTime();
  const cutoffMs = notBeforeMs + lookaheadMin * 60_000;

  const out: DepartureWithPattern[] = [];
  for (const d of raw.departures ?? []) {
    const t = d.estimated_departure_utc ?? d.scheduled_departure_utc;
    const tMs = Date.parse(t);
    if (tMs < notBeforeMs || tMs > cutoffMs) continue;
    out.push({
      routeId: d.route_id,
      routeType,
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
  deps?: Deps,
): Promise<{ stopId: number; arriveUtc: string }[]> {
  const { ptv } = deps ?? (await defaultDeps());
  const raw = (await ptv(`/v3/pattern/run/${runRef}/route_type/${routeType}`, {
    expand: ['Stop'],
  })) as { departures?: { stop_id: number; scheduled_departure_utc: string; estimated_departure_utc: string | null }[] };
  return (raw.departures ?? []).map((d) => ({
    stopId: d.stop_id,
    arriveUtc: d.estimated_departure_utc ?? d.scheduled_departure_utc,
  }));
}
