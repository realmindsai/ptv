import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - importing untyped JS module
import { formatCoord, parseDecimalCoord, isValidLatLon, debounce, encodePlanBody, DEFAULTS } from '../../../src/server/static-assets/atlas.js';

describe('atlas helpers', () => {
  describe('formatCoord', () => {
    it('formats a single coordinate to 5dp', () => {
      expect(formatCoord(-37.7800123456)).toBe('-37.78001');
      expect(formatCoord(144.96302)).toBe('144.96302');
      expect(formatCoord(0)).toBe('0');
    });

    it('formats a {lat,lon} pair as "lat, lon"', () => {
      expect(formatCoord({ lat: -37.78001, lon: 144.96302 })).toBe('-37.78001, 144.96302');
    });
  });

  describe('parseDecimalCoord', () => {
    it('parses "lat,lon" with optional whitespace', () => {
      expect(parseDecimalCoord('-37.78,144.96')).toEqual({ lat: -37.78, lon: 144.96 });
      expect(parseDecimalCoord('-37.78001, 144.96302')).toEqual({ lat: -37.78001, lon: 144.96302 });
    });

    it('returns null on garbage', () => {
      expect(parseDecimalCoord('Hurstbridge')).toBeNull();
      expect(parseDecimalCoord('-37.78')).toBeNull();
      expect(parseDecimalCoord('')).toBeNull();
    });
  });

  describe('isValidLatLon', () => {
    it('accepts valid ranges', () => {
      expect(isValidLatLon({ lat: -37.78, lon: 144.96 })).toBe(true);
      expect(isValidLatLon({ lat: 0, lon: 0 })).toBe(true);
    });

    it('rejects out-of-range', () => {
      expect(isValidLatLon({ lat: 91, lon: 144.96 })).toBe(false);
      expect(isValidLatLon({ lat: -37.78, lon: 181 })).toBe(false);
      expect(isValidLatLon({ lat: NaN, lon: 144.96 })).toBe(false);
      expect(isValidLatLon(null)).toBe(false);
    });
  });

  describe('debounce', () => {
    it('fires after the delay; coalesces rapid calls', async () => {
      vi.useFakeTimers();
      const spy = vi.fn();
      const d = debounce(spy, 300);
      d(1); d(2); d(3);
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(299);
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(3);
      vi.useRealTimers();
    });
  });

  describe('encodePlanBody', () => {
    it('builds the /api/plan body from state', () => {
      const body = encodePlanBody({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { ...DEFAULTS, mode: 'bike-train', goal: 'max-path', maxTransfers: 2 },
      });
      expect(body).toEqual({
        origin:      { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        mode: 'bike-train',
        goal: 'max-path',
        minBikeKm: 0,
        maxBikeKm: 20,
        maxTransfers: 2,
        hillWeight: 0,
        preferBikePath: false,
      });
    });

    it('omits empty depart/arriveBy and empty minOnPathFraction', () => {
      const body = encodePlanBody({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { ...DEFAULTS },
      });
      expect(body).not.toHaveProperty('depart');
      expect(body).not.toHaveProperty('arriveBy');
      expect(body).not.toHaveProperty('minOnPathFraction');
    });

    it('throws when origin or destination missing', () => {
      expect(() => encodePlanBody({ origin: null, destination: { lat: -37.86, lon: 144.92 }, params: DEFAULTS }))
        .toThrow(/origin/);
      expect(() => encodePlanBody({ origin: { lat: -37.78, lon: 144.96 }, destination: null, params: DEFAULTS }))
        .toThrow(/destination/);
    });
  });
});
