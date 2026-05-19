import { z } from 'zod';
import type { ChatCtx } from '../types';
import type { Itinerary, LatLon, BikeLeg } from '../../plan/types';
import type { ParsedGhRoute } from '../../plan/external';

const zLatLon = z.object({ lat: z.number(), lon: z.number() });

export const zBikeRouteArgs = z.object({
  from: zLatLon,
  to: zLatLon,
  goal: z.enum(['commute', 'day-ride', 'max-path']).default('commute'),
});
export type BikeRouteArgs = z.infer<typeof zBikeRouteArgs>;

export type BikeFn = (
  from: LatLon, to: LatLon, goal: BikeRouteArgs['goal'],
) => Promise<ParsedGhRoute | null>;

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080'];
let cursor = 0;
const nextColor = () => PALETTE[cursor++ % PALETTE.length];

function toItinerary(args: BikeRouteArgs, r: ParsedGhRoute): Itinerary {
  const leg: BikeLeg = {
    mode: 'bike',
    from: args.from,
    to: args.to,
    km: r.km,
    min: r.min,
    kmOnPath: r.kmOnPath,
    ascendM: r.ascendM,
    descendM: r.descendM,
    maxSustainedGradePercent: r.maxSustainedGradePercent,
    maxSustainedGradeM: r.maxSustainedGradeM,
    flatFraction: r.flatFraction,
    steepFraction: r.steepFraction,
    geometry: r.geometry,
  };
  return {
    labels: [`bike-${args.goal}` as never],
    totalTimeMin: r.min,
    bikeKm: r.km,
    bikeMin: r.min,
    bikeKmOnPath: r.kmOnPath,
    trainKm: 0,
    trainMin: 0,
    waitMin: 0,
    transfers: 0,
    ascendM: r.ascendM,
    descendM: r.descendM,
    legs: [leg],
  };
}

export function makeBikeRouteTool(
  ctx: ChatCtx,
  bikeFn: BikeFn,
  genId: () => string = () => `b-${Math.random().toString(36).slice(2, 10)}`,
) {
  return {
    name: 'bike_route' as const,
    description:
      'Pure bicycle routing between two coords. Backed by GraphHopper. ' +
      'goal=commute (fastest/safest, default `bike` profile), day-ride (prefers ' +
      'cycleways via custom_model), or max-path (longest on dedicated path, more ' +
      'aggressive custom_model). Returns distance + elevation analytics.',
    schema: zBikeRouteArgs,
    handler: async (args: BikeRouteArgs) => {
      const r = await bikeFn(args.from, args.to, args.goal);
      if (!r) return { ok: false as const, error: 'No route found' };
      const id = genId();
      ctx.emit({
        type: 'path_add',
        pathId: id,
        label: `bike (${args.goal})`,
        color: nextColor(),
        itinerary: toItinerary(args, r),
      });
      return {
        ok: true as const,
        km: r.km,
        min: r.min,
        kmOnPath: r.kmOnPath,
        ascendM: r.ascendM,
        descendM: r.descendM,
        maxSustainedGradePercent: r.maxSustainedGradePercent,
        maxSustainedGradeM: r.maxSustainedGradeM,
        flatFraction: r.flatFraction,
        steepFraction: r.steepFraction,
      };
    },
  };
}
