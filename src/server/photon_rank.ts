import type { PhotonHit } from './photon';

/**
 * Post-ranking for Photon results (beads ptv-qjz, ptv-q97).
 *
 * Photon scores purely on fuzzy name similarity, so it happily returns a place
 * with the right words in the wrong suburb, or the wrong state entirely:
 *
 *   "St Kilda library"        -> "Little LIbrary 40 Clarence St", Brunswick East
 *   "Flinders Street Station" -> a house on Flinders Street in TOWNSVILLE
 *
 * Two signals sitting in the query fix both, and neither is the `osm_value`
 * post-rank the beads proposed: this Photon import carries only `highway`,
 * `place` and `landuse` keys — there is no `amenity=library` or
 * `railway=station` in the index to prefer. Category therefore has to be read
 * out of the feature NAME, and the dominant signal is locality.
 */

// `in`/`near`/`at` are how people phrase "X in suburb Y"; they carry no
// matching value themselves. Kept small deliberately — an aggressive stoplist
// would eat real place names ("The Gap", "A'Beckett Street").
const STOPWORDS = new Set([
  'in', 'at', 'on', 'the', 'to', 'of', 'a', 'an', 'and', 'near', 'nearby', 'by',
]);

// Words that name a KIND of place rather than a place. Used two ways: they are
// excluded from locality matching (so "library" can't match a suburb), and a
// feature whose name contains the one the user asked for scores a small boost.
const CATEGORY_WORDS = new Set([
  'library', 'station', 'hospital', 'school', 'university', 'college',
  'park', 'gardens', 'garden', 'market', 'museum', 'gallery', 'pool',
  'stadium', 'beach', 'pier', 'cemetery', 'church', 'hall', 'centre', 'center',
]);

// The chat stack plans Melbourne trips, and Nominatim has always been bounded
// to Victoria (see nominatim.ts). Anything outside it is noise, not a result.
const IN_REGION_STATE = 'victoria';

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(s: string): string[] {
  return normalise(s).split(' ').filter(Boolean);
}

/** Query words worth matching on: no stopwords, nothing shorter than 3 chars. */
function contentTokens(query: string): string[] {
  return tokens(query).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Everything about a hit a query token could legitimately match. */
function hitText(h: PhotonHit): string {
  return normalise([h.name, h.street, h.district, h.city, h.state, h.label].filter(Boolean).join(' '));
}

/**
 * Just the part of a hit that says WHERE it is. A feature that is itself a
 * place (a suburb) counts its own name; a house or a shop does not, or
 * "Little Library" in Brunswick East would match a query for any library.
 */
function localityText(h: PhotonHit): string {
  const parts = [h.district, h.city];
  if (h.osm_key === 'place' && h.osm_value !== 'house') parts.push(h.name);
  return normalise(parts.filter(Boolean).join(' '));
}

/**
 * Does the query name this hit's locality? Matched on contiguous phrases, not
 * loose tokens: "St Kilda" must match as a phrase, otherwise the bare "St" in
 * the query promotes St Albans just as wrongly as Photon promoted Brunswick
 * East. A single token only counts when it is long enough to be a place name
 * in its own right and is not a category word.
 */
function matchesLocality(queryTokens: string[], h: PhotonHit): boolean {
  const where = localityText(h);
  if (!where) return false;
  for (let i = 0; i < queryTokens.length; i++) {
    for (let j = i + 2; j <= queryTokens.length; j++) {
      if (where.includes(queryTokens.slice(i, j).join(' '))) return true;
    }
  }
  return queryTokens.some(
    (t) => t.length >= 4 && !CATEGORY_WORDS.has(t) && where.split(' ').includes(t),
  );
}

/** Did the user ask for a kind of place this hit's name claims to be? */
function matchesCategory(queryTokens: string[], h: PhotonHit): boolean {
  const asked = queryTokens.filter((t) => CATEGORY_WORDS.has(t));
  if (asked.length === 0) return false;
  const name = normalise(h.name ?? h.label).split(' ');
  return asked.some((t) => name.includes(t));
}

/** Fraction of the query's content words this hit accounts for anywhere. */
function coverage(queryTokens: string[], h: PhotonHit): number {
  if (queryTokens.length === 0) return 0;
  const text = hitText(h).split(' ');
  const found = queryTokens.filter((t) => text.includes(t)).length;
  return found / queryTokens.length;
}

export type RankedPhoton = {
  /** In-region hits, best first. */
  hits: PhotonHit[];
  /**
   * Whether the top hit is worth answering with. False means "Photon found
   * words, not the place" — the caller should try another geocoder and, if
   * that also misses, say so rather than return this confidently.
   */
  confident: boolean;
};

/** Locality outweighs category: the right thing in the wrong suburb is wrong. */
const LOCALITY_WEIGHT = 2;
const CATEGORY_WEIGHT = 1;

/**
 * A hit nobody's query words reach is a fuzzy-match accident. Half the query's
 * content words is the bar for answering without corroboration; below that we
 * ask the other geocoder first.
 */
const CONFIDENT_COVERAGE = 0.6;

export function rankPhotonHits(query: string, hits: PhotonHit[]): RankedPhoton {
  // Out-of-state hits are dropped, not demoted. "Flinders Street Station" has
  // no Victorian candidate at all, and an empty answer beats a Townsville one.
  const inRegion = hits.filter(
    (h) => !h.state || normalise(h.state) === IN_REGION_STATE,
  );
  const qt = contentTokens(query);
  if (inRegion.length === 0 || qt.length === 0) {
    return { hits: inRegion, confident: false };
  }

  const scored = inRegion.map((hit, index) => {
    const locality = matchesLocality(qt, hit);
    return {
      hit,
      index,
      locality,
      score:
        (locality ? LOCALITY_WEIGHT : 0) +
        (matchesCategory(qt, hit) ? CATEGORY_WEIGHT : 0) +
        coverage(qt, hit),
    };
  });

  // Photon's own order is the tiebreak — it is a worse signal than locality,
  // but it is not noise, and keeping it makes the ranking reproducible.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const best = scored[0];
  return {
    hits: scored.map((s) => s.hit),
    confident: best.locality || coverage(qt, best.hit) >= CONFIDENT_COVERAGE,
  };
}
