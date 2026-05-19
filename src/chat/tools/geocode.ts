import { z } from 'zod';
import type { Nominatim } from '../../server/nominatim';
import type { Photon } from '../../server/photon';
import type { ChatCtx } from '../types';

const zArgs = z.object({ query: z.string().min(1) });
type Args = z.infer<typeof zArgs>;

export function makeGeocodeTool(
  _ctx: ChatCtx,
  nominatim: Nominatim,
  photon?: Photon,
) {
  return {
    name: 'geocode' as const,
    description:
      'Resolve a Melbourne-biased place name or address to {lat, lon}. ' +
      'Tries Photon first (fuzzy match, partial name, typos, alt_name); ' +
      'falls back to Nominatim if Photon returns nothing.',
    schema: zArgs,
    handler: async (args: Args) => {
      // Try Photon first when configured.
      if (photon) {
        const ph = await photon.search(args.query, 1);
        if (ph.length > 0) {
          return {
            ok: true as const,
            lat: ph[0].lat,
            lon: ph[0].lon,
            displayName: ph[0].label,
            source: 'photon' as const,
          };
        }
      }
      const hits = await nominatim.search(args.query);
      const first = hits[0];
      if (!first) return { ok: false as const, error: `No match for "${args.query}"` };
      return {
        ok: true as const,
        lat: first.lat,
        lon: first.lon,
        displayName: first.label,
        source: 'nominatim' as const,
      };
    },
  };
}
