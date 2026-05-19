import { z } from 'zod';

type PtvFn = (
  path: string,
  params?: Record<string, string | number | number[] | string[]>,
) => Promise<unknown>;

export const zSearchArgs = z.object({
  term: z.string().min(1),
  routeType: z.number().int().optional(),
});

export function makeSearchStopsTool(ptv: PtvFn) {
  return {
    name: 'search_stops' as const,
    description: 'Find PTV stops by name. Returns up to 10 top matches.',
    schema: zSearchArgs,
    handler: async (args: z.infer<typeof zSearchArgs>) => {
      const params: Record<string, number[]> = {};
      if (args.routeType !== undefined) params.route_types = [args.routeType];
      const res = (await ptv(`/v3/search/${encodeURIComponent(args.term)}`, params)) as {
        stops?: Array<{ stop_id: number; stop_name: string; stop_suburb: string; route_type: number }>;
      };
      return {
        ok: true as const,
        stops: (res.stops ?? []).slice(0, 10).map((s) => ({
          stop_id: s.stop_id,
          name: s.stop_name,
          suburb: s.stop_suburb,
          routeType: s.route_type,
        })),
      };
    },
  };
}

export const zNearbyArgs = z.object({
  lat: z.number(),
  lon: z.number(),
  maxKm: z.number().min(0).optional(),
});

export function makeNearbyStopsTool(ptv: PtvFn) {
  return {
    name: 'nearby_stops' as const,
    description: 'Find PTV stops near a coordinate. Returns up to 10 closest.',
    schema: zNearbyArgs,
    handler: async (args: z.infer<typeof zNearbyArgs>) => {
      const params: Record<string, number> = { max_results: 10 };
      if (args.maxKm !== undefined) params.max_distance = Math.round(args.maxKm * 1000);
      const res = (await ptv(`/v3/stops/location/${args.lat},${args.lon}`, params)) as {
        stops?: Array<{
          stop_id: number; stop_name: string; stop_suburb: string;
          route_type: number; stop_distance?: number;
        }>;
      };
      return {
        ok: true as const,
        stops: (res.stops ?? []).slice(0, 10).map((s) => ({
          stop_id: s.stop_id,
          name: s.stop_name,
          suburb: s.stop_suburb,
          routeType: s.route_type,
          distanceM: s.stop_distance,
        })),
      };
    },
  };
}
