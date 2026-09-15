import { z } from 'zod';
import type { Nominatim } from '../../server/nominatim';
import type { Photon } from '../../server/photon';
import { rankPhotonHits } from '../../server/photon_rank';
import type { ChatCtx } from '../types';

const zArgs = z.object({ query: z.string().min(1) });
type Args = z.infer<typeof zArgs>;

// Photon is asked for a shortlist rather than a single hit: its own top result
// is chosen on name similarity alone, so the candidate that matches the suburb
// the user named is often two or three rows down. See server/photon_rank.ts.
const PHOTON_CANDIDATES = 8;

// Said to the model, not to a human. Both beads were reported because every
// LLM in the eval suite noticed the bad coordinate and none recovered; naming
// the right tool is what turns a dead end into a recovery.
const NO_MATCH_ADVICE =
  'This geocoder indexes streets, suburbs and addresses only — not points of ' +
  'interest. For a train station, tram or bus stop use search_stops; ' +
  'otherwise try a street address, or just the suburb name.';

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
      'falls back to Nominatim if Photon returns nothing confident. ' +
      'Results are limited to Victoria. A result with confident:false matched ' +
      'the words but maybe not the place — check displayName before using it.',
    schema: zArgs,
    handler: async (args: Args) => {
      // Try Photon first when configured.
      let weak: { lat: number; lon: number; label: string } | null = null;
      if (photon) {
        const ranked = rankPhotonHits(args.query, await photon.search(args.query, PHOTON_CANDIDATES));
        const best = ranked.hits[0];
        if (best && ranked.confident) {
          return {
            ok: true as const,
            lat: best.lat,
            lon: best.lon,
            displayName: best.label,
            source: 'photon' as const,
            confident: true as const,
          };
        }
        // Not confident: hold it, but let Nominatim answer first if it can.
        if (best) weak = { lat: best.lat, lon: best.lon, label: best.label };
      }
      const hits = await nominatim.search(args.query);
      const first = hits[0];
      if (first) {
        return {
          ok: true as const,
          lat: first.lat,
          lon: first.lon,
          displayName: first.label,
          source: 'nominatim' as const,
          confident: true as const,
        };
      }
      // Nothing corroborated the fuzzy Photon hit. Returning it silently is
      // what sent every model to the wrong suburb, so return it flagged.
      if (weak) {
        return {
          ok: true as const,
          lat: weak.lat,
          lon: weak.lon,
          displayName: weak.label,
          source: 'photon' as const,
          confident: false as const,
          note:
            `Weak match: "${args.query}" matched these words but possibly not ` +
            `this place — check the suburb in displayName. ${NO_MATCH_ADVICE}`,
        };
      }
      return {
        ok: false as const,
        error: `No match for "${args.query}". ${NO_MATCH_ADVICE}`,
      };
    },
  };
}
