/** One stop on a run's stopping pattern. Defined here because this module is
 *  the only thing that stores them; orchestrator.ts imports it back. */
export type PatternStop = { stopId: number; arriveUtc: string };

/**
 * Process-level cache for /v3/pattern responses (bead ptv-kra).
 *
 * A single plan() fires ~167 calls at /v3/pattern — measured, against 30 at
 * /v3/departures — because every candidate itinerary needs the stopping pattern
 * of its run. PTV throttles per endpoint, so plan() trips its own quota and the
 * 403s look random. The per-request cache that used to live on SearchState only
 * collapsed duplicates WITHIN one plan; consecutive requests re-fetched the same
 * runs from scratch, which is exactly the traffic that hits the limit.
 *
 * A run's stopping pattern for a given day is effectively static, so this is
 * safe to share across requests. The TTL is short anyway — this exists to
 * absorb bursts, not to be a source of truth.
 */

const TTL_MS = 5 * 60_000;
// Melbourne runs a few thousand services a day; this is a burst absorber, not a
// timetable store, so cap it well below that and evict oldest-first.
const MAX_ENTRIES = 500;

type Entry = { value: PatternStop[]; expires: number };

const cache = new Map<string, Entry>();

/**
 * The day must be part of the key: the same runRef yields a different schedule
 * on different days, so a Tuesday request must not reuse Monday's pattern.
 */
export function patternCacheKey(runRef: string, dateUtc?: Date): string {
  return `${runRef}@${dateUtc ? dateUtc.toISOString().slice(0, 10) : 'today'}`;
}

export function getCachedPattern(key: string, now = Date.now()): PatternStop[] | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

export function setCachedPattern(key: string, value: PatternStop[], now = Date.now()): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expires: now + TTL_MS });
}

/** Test seam: a process-level cache would otherwise leak between test cases. */
export function clearPatternCache(): void {
  cache.clear();
}

export const PATTERN_CACHE_TTL_MS = TTL_MS;
export const PATTERN_CACHE_MAX_ENTRIES = MAX_ENTRIES;
