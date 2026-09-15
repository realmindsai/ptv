import { describe, it, expect, beforeEach } from 'vitest';
import {
  patternCacheKey, getCachedPattern, setCachedPattern, clearPatternCache,
  PATTERN_CACHE_TTL_MS, PATTERN_CACHE_MAX_ENTRIES,
} from '../../../src/plan/pattern_cache';

const stops = [{ stopId: 1071, arriveUtc: '2026-05-16T22:20:00Z' }];

beforeEach(() => clearPatternCache());

describe('patternCacheKey', () => {
  it('includes the calendar day, so Tuesday cannot serve Monday', () => {
    const mon = patternCacheKey('R1', new Date('2026-05-16T22:20:00Z'));
    const tue = patternCacheKey('R1', new Date('2026-05-17T22:20:00Z'));
    expect(mon).not.toBe(tue);
    expect(mon).toContain('2026-05-16');
  });

  it('separates different runs on the same day', () => {
    const d = new Date('2026-05-16T22:20:00Z');
    expect(patternCacheKey('R1', d)).not.toBe(patternCacheKey('R2', d));
  });

  it('falls back to a stable key when no date is given', () => {
    expect(patternCacheKey('R1')).toBe(patternCacheKey('R1'));
    expect(patternCacheKey('R1')).toContain('today');
  });
});

describe('cache read/write', () => {
  it('returns what was stored', () => {
    const k = patternCacheKey('R1', new Date('2026-05-16T00:00:00Z'));
    setCachedPattern(k, stops);
    expect(getCachedPattern(k)).toEqual(stops);
  });

  it('misses on an unknown key', () => {
    expect(getCachedPattern('nope@2026-05-16')).toBeUndefined();
  });

  it('expires an entry once the TTL has passed', () => {
    const k = patternCacheKey('R1', new Date('2026-05-16T00:00:00Z'));
    const t0 = 1_000_000;
    setCachedPattern(k, stops, t0);
    expect(getCachedPattern(k, t0 + PATTERN_CACHE_TTL_MS - 1)).toEqual(stops);
    expect(getCachedPattern(k, t0 + PATTERN_CACHE_TTL_MS)).toBeUndefined();
  });

  it('evicts the oldest entry rather than growing without bound', () => {
    for (let i = 0; i < PATTERN_CACHE_MAX_ENTRIES; i++) {
      setCachedPattern(`R${i}@d`, stops);
    }
    expect(getCachedPattern('R0@d')).toEqual(stops);
    setCachedPattern('overflow@d', stops);
    expect(getCachedPattern('R0@d')).toBeUndefined();     // oldest gone
    expect(getCachedPattern('overflow@d')).toEqual(stops); // newest kept
  });

  it('re-writing an existing key does not evict anything', () => {
    for (let i = 0; i < PATTERN_CACHE_MAX_ENTRIES; i++) setCachedPattern(`R${i}@d`, stops);
    setCachedPattern('R0@d', stops);
    expect(getCachedPattern('R1@d')).toEqual(stops);
  });

  it('clearPatternCache empties it', () => {
    setCachedPattern('R1@d', stops);
    clearPatternCache();
    expect(getCachedPattern('R1@d')).toBeUndefined();
  });
});
