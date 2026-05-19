import { z } from 'zod';
import type { ChatCtx } from '../types';
import type { Itinerary, Leg, PlanRequest, PlanResult } from '../../plan/types';
import { parseTime } from '../../plan/parse_time';

// Melbourne wall-clock for a UTC ISO string, e.g. "06:18 (Sun)".
const MELB_TIME = new Intl.DateTimeFormat('en-AU', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Melbourne',
});
const MELB_DAY = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short', timeZone: 'Australia/Melbourne',
});
function melbLocal(iso: string): string {
  try {
    const d = new Date(iso);
    return `${MELB_TIME.format(d)} (${MELB_DAY.format(d)})`;
  } catch {
    return iso;
  }
}

function summarizeLeg(leg: Leg) {
  if (leg.mode === 'bike') {
    return {
      mode: 'bike' as const,
      km: leg.km,
      min: Math.round(leg.min),
      kmOnPath: leg.kmOnPath ?? undefined,
      ascendM: leg.ascendM,
      descendM: leg.descendM,
    };
  }
  return {
    mode: 'train' as const,
    route: leg.routeName,
    fromStop: leg.fromStopName,
    toStop: leg.toStopName,
    departLocal: melbLocal(leg.departUtc),
    arriveLocal: melbLocal(leg.arriveUtc),
    runRef: leg.runRef,
  };
}

const zLatLon = z.object({ lat: z.number(), lon: z.number() });

export const zPlanArgs = z.object({
  from: zLatLon,
  to: zLatLon,
  depart: z.string().optional(),
  arriveBy: z.string().optional(),
  mode: z.enum(['bike-train', 'bike-only']).default('bike-train'),
  goal: z.enum(['commute', 'day-ride', 'max-path']).default('commute'),
  maxTransfers: z.number().int().min(0).max(1).default(1),
  minBikeKm: z.number().min(0).optional(),
  maxBikeKm: z.number().min(0).optional(),
  preferBikePath: z.boolean().optional(),
  hillWeight: z.number().optional(),
  minOnPathFraction: z.number().min(0).max(1).optional(),
});
export type PlanArgs = z.infer<typeof zPlanArgs>;

export type PlanFn = (req: PlanRequest) => Promise<PlanResult>;

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080'];
let paletteCursor = 0;
function nextColor(): string {
  const c = PALETTE[paletteCursor % PALETTE.length];
  paletteCursor++;
  return c;
}

function buildRequest(a: PlanArgs): PlanRequest {
  const mode = a.mode;
  // bike-only forbids maxTransfers > 0 (orchestrator invariant)
  const maxTransfers = mode === 'bike-only' ? 0 : a.maxTransfers;
  return {
    from: a.from, to: a.to,
    departUtc: parseTime(a.depart),
    arriveByUtc: parseTime(a.arriveBy),
    minBikeKm: a.minBikeKm ?? 0,
    maxBikeKm: a.maxBikeKm ?? 40,
    maxTransfers,
    enrich: true,
    preferBikePath: a.preferBikePath ?? false,
    hillWeight: a.hillWeight ?? 0,
    goal: a.goal,
    mode,
    minOnPathFraction: a.minOnPathFraction,
  };
}

function summarize(it: Itinerary) {
  // Pull the first train leg's depart / last train leg's arrive as the trip
  // window. For bike-only itineraries these are undefined.
  const trainLegs = it.legs.filter((l): l is Extract<Leg, { mode: 'train' }> => l.mode === 'train');
  const tripDepartLocal = trainLegs[0] ? melbLocal(trainLegs[0].departUtc) : undefined;
  const tripArriveLocal = trainLegs.length > 0
    ? melbLocal(trainLegs[trainLegs.length - 1].arriveUtc) : undefined;

  return {
    label: it.labels[0],
    totalTimeMin: Math.round(it.totalTimeMin),
    bikeKm: it.bikeKm,
    bikeMin: Math.round(it.bikeMin),
    trainKm: it.trainKm,
    trainMin: Math.round(it.trainMin),
    waitMin: Math.round(it.waitMin),
    transferDwellMin: it.transferDwellMin != null ? Math.round(it.transferDwellMin) : undefined,
    transfers: it.transfers,
    bikeKmOnPath: it.bikeKmOnPath ?? undefined,
    // Trip window (Melbourne local time), if any train legs exist.
    tripDepartLocal,
    tripArriveLocal,
    // Per-leg breakdown so you can quote exact route + departure/arrival times.
    legs: it.legs.map(summarizeLeg),
    // Elevation analytics aggregated across all bike legs (from GraphHopper).
    ascendM: it.ascendM,
    descendM: it.descendM,
    maxSustainedGradePercent: it.maxSustainedGradePercent,
    maxSustainedGradeM: it.maxSustainedGradeM,
    flatFraction: it.flatFraction,
    steepFraction: it.steepFraction,
  };
}

// labelAndSort returns every feasible dedup'd itinerary, but only the top 2-3
// receive labels ('fastest', 'recommended', 'most-bike'). The rest are candidate
// leftovers the orchestrator considered. For the chat UI we only want labeled
// finalists — anything else clutters the map.
function selectFinalists(its: Itinerary[]): Itinerary[] {
  return its.filter((it) => Array.isArray(it.labels) && it.labels.length > 0);
}

export function makePlanTool(
  ctx: ChatCtx,
  planFn: PlanFn,
  genId: () => string = () => `p-${Math.random().toString(36).slice(2, 10)}`,
) {
  return {
    name: 'plan' as const,
    description:
      'Plan a bike+train (or bike-only) trip between two coordinates in Melbourne. ' +
      'Backed by the live PTV Timetable API + GraphHopper bike routing. ' +
      'Returns 1-3 labeled finalist routes per call ("fastest", "recommended", ' +
      '"most-bike"), each with a per-leg breakdown including real train departure ' +
      'and arrival times in Melbourne local. Call multiple times to compare goals ' +
      'or modes.\n\n' +
      'Time arguments (`depart`, `arriveBy`):\n' +
      '- "HH:MM" — interpreted as TODAY in Melbourne local. Use this only when the ' +
      '  user is asking about today.\n' +
      '- Full ISO8601 with timezone offset, e.g. "2026-05-25T07:00:00+10:00" — use ' +
      '  for any other day. Australia/Melbourne is +10:00 (AEST) or +11:00 (AEDT).\n' +
      'For arrive-by queries, the planner backs out feasible departures and picks ' +
      'the latest one that meets the deadline.',
    schema: zPlanArgs,
    handler: async (args: PlanArgs) => {
      const result = await planFn(buildRequest(args));
      const finalists = selectFinalists(result.itineraries);
      if (finalists.length === 0) {
        return result.itineraries.length === 0
          ? { ok: false as const, error: 'No itineraries found' }
          : { ok: false as const, error: 'No feasible itinerary matched the constraints' };
      }
      const summaries = finalists.map((it) => {
        const id = genId();
        ctx.emit({
          type: 'path_add',
          pathId: id,
          label: it.labels[0],
          color: nextColor(),
          itinerary: it,
        });
        return summarize(it);
      });
      return { ok: true as const, itineraryCount: finalists.length, summaries };
    },
  };
}
