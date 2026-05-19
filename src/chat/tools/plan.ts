import { z } from 'zod';
import type { ChatCtx } from '../types';
import type { Itinerary, PlanRequest, PlanResult } from '../../plan/types';
import { parseTime } from '../../plan/parse_time';

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
  return {
    label: it.labels[0] ?? 'unlabeled',
    totalTimeMin: it.totalTimeMin,
    bikeKm: it.bikeKm,
    trainKm: it.trainKm,
    transfers: it.transfers,
    bikeKmOnPath: it.bikeKmOnPath ?? undefined,
  };
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
      'Returns a count + per-itinerary summary. Full geometry is sent to the user map ' +
      'directly as a side effect. Call multiple times to compare goals or modes.',
    schema: zPlanArgs,
    handler: async (args: PlanArgs) => {
      const result = await planFn(buildRequest(args));
      if (result.itineraries.length === 0) {
        return { ok: false as const, error: 'No itineraries found' };
      }
      const summaries = result.itineraries.map((it) => {
        const id = genId();
        ctx.emit({
          type: 'path_add',
          pathId: id,
          label: it.labels[0] ?? 'unlabeled',
          color: nextColor(),
          itinerary: it,
        });
        return summarize(it);
      });
      return { ok: true as const, itineraryCount: result.itineraries.length, summaries };
    },
  };
}
