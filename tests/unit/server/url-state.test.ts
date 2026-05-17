import { describe, expect, it } from 'vitest';
// @ts-expect-error - importing untyped JS module
import { encodeUrlState, decodeUrlState, DEFAULTS } from '../../../src/server/static-assets/url-state.js';

describe('url-state', () => {
  describe('encodeUrlState', () => {
    it('encodes just from when only origin is set', () => {
      const s = encodeUrlState({
        origin: { lat: -37.78001, lon: 144.96302 },
        destination: null,
        params: { ...DEFAULTS },
      });
      expect(s).toBe('from=-37.78001,144.96302');
    });

    it('encodes from + to when both set, default params', () => {
      const s = encodeUrlState({
        origin: { lat: -37.78001, lon: 144.96302 },
        destination: { lat: -37.86234, lon: 144.92891 },
        params: { ...DEFAULTS },
      });
      expect(s).toBe('from=-37.78001,144.96302&to=-37.86234,144.92891');
    });

    it('encodes non-default params only', () => {
      const s = encodeUrlState({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { ...DEFAULTS, goal: 'max-path', hillWeight: -1 },
      });
      expect(s).toBe('from=-37.78,144.96&to=-37.86,144.92&goal=max-path&hillWeight=-1');
    });

    it('omits coords when null', () => {
      const s = encodeUrlState({
        origin: null,
        destination: null,
        params: { ...DEFAULTS },
      });
      expect(s).toBe('');
    });

    it('rounds coords to 5 decimal places', () => {
      const s = encodeUrlState({
        origin: { lat: -37.7800123456, lon: 144.9630234 },
        destination: null,
        params: { ...DEFAULTS },
      });
      expect(s).toBe('from=-37.78001,144.96302');
    });

    it('encodes boolean preferBikePath only when true', () => {
      const t = encodeUrlState({
        origin: { lat: -37.78, lon: 144.96 },
        destination: null,
        params: { ...DEFAULTS, preferBikePath: true },
      });
      expect(t).toBe('from=-37.78,144.96&preferBikePath=1');

      const f = encodeUrlState({
        origin: { lat: -37.78, lon: 144.96 },
        destination: null,
        params: { ...DEFAULTS, preferBikePath: false },
      });
      expect(f).toBe('from=-37.78,144.96');
    });
  });

  describe('decodeUrlState', () => {
    it('decodes from + to', () => {
      const r = decodeUrlState('?from=-37.78,144.96&to=-37.86,144.92');
      expect(r).toEqual({
        origin:      { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: {},
      });
    });

    it('decodes leading "?" or no prefix', () => {
      const a = decodeUrlState('from=-37.78,144.96');
      const b = decodeUrlState('?from=-37.78,144.96');
      expect(a).toEqual(b);
    });

    it('decodes non-default params', () => {
      const r = decodeUrlState('?from=-37.78,144.96&to=-37.86,144.92&goal=max-path&hillWeight=-1&preferBikePath=1');
      expect(r).toEqual({
        origin:      { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { goal: 'max-path', hillWeight: -1, preferBikePath: true },
      });
    });

    it('returns null on malformed coord', () => {
      expect(decodeUrlState('?from=not-a-coord')).toBeNull();
      expect(decodeUrlState('?from=999,144.96')).toBeNull();  // out of range
      expect(decodeUrlState('?from=-37.78,200')).toBeNull();  // out of range
      expect(decodeUrlState('?from=-37.78')).toBeNull();      // missing lon
    });

    it('returns empty state on empty search', () => {
      expect(decodeUrlState('')).toEqual({ origin: null, destination: null, params: {} });
      expect(decodeUrlState('?')).toEqual({ origin: null, destination: null, params: {} });
    });

    it('ignores unknown keys', () => {
      const r = decodeUrlState('?from=-37.78,144.96&unknown=foo&goal=commute');
      expect(r).toEqual({
        origin: { lat: -37.78, lon: 144.96 },
        destination: null,
        params: { goal: 'commute' },
      });
    });
  });

  it('round-trips a fully-specified state', () => {
    const original = {
      origin: { lat: -37.78001, lon: 144.96302 },
      destination: { lat: -37.86234, lon: 144.92891 },
      params: {
        ...DEFAULTS,
        mode: 'bike-train',
        goal: 'max-path',
        depart: '08:00',
        maxTransfers: 2,
        hillWeight: -1,
        preferBikePath: true,
        minOnPathFraction: 0.5,
      },
    };
    const encoded = encodeUrlState(original);
    const decoded = decodeUrlState(encoded);
    expect(decoded?.origin).toEqual(original.origin);
    expect(decoded?.destination).toEqual(original.destination);
    expect(decoded?.params).toMatchObject({
      mode: 'bike-train',
      goal: 'max-path',
      depart: '08:00',
      maxTransfers: 2,
      hillWeight: -1,
      preferBikePath: true,
      minOnPathFraction: 0.5,
    });
  });
});
