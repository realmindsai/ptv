import { z } from 'zod';
import type { Nominatim } from '../../server/nominatim';
import type { ChatCtx } from '../types';

const zArgs = z.object({ query: z.string().min(1) });
type Args = z.infer<typeof zArgs>;

export function makeGeocodeTool(_ctx: ChatCtx, nominatim: Nominatim) {
  return {
    name: 'geocode' as const,
    description: 'Resolve a Melbourne-biased place name or address to {lat, lon}.',
    schema: zArgs,
    handler: async (args: Args) => {
      const hits = await nominatim.search(args.query);
      const first = hits[0];
      if (!first) return { ok: false as const, error: `No match for "${args.query}"` };
      return {
        ok: true as const,
        lat: first.lat,
        lon: first.lon,
        displayName: first.label,
      };
    },
  };
}
