import { describe, it, expect } from 'vitest';
import { ptv } from '../../src/client';
import {
  trimDepartures, trimRoutes, trimDisruptions,
  trimSearch, trimNearby, trimStopsSearch, trimStopDetails,
} from '../../src/trim';

const SKIP = !process.env.PTV_DEV_ID || !process.env.PTV_API_KEY || process.env.SKIP_LIVE_TESTS === '1';
// Note: ptv() throws MissingCredentialsError if creds absent — the SKIP guard prevents that reaching the runner.

describe.skipIf(SKIP)('integration: all commands', () => {

  describe('route-types', () => {
    it('returns an array of route type objects', async () => {
      const data = await ptv('/v3/route_types') as Record<string, unknown>;
      expect(Array.isArray(data.route_types)).toBe(true);
      const first = (data.route_types as Record<string, unknown>[])[0];
      expect(first).toHaveProperty('route_type');
      expect(first).toHaveProperty('route_type_name');
    });
  });

  describe('routes', () => {
    it('returns trimmed routes for route type 0 (train)', async () => {
      const data = await ptv('/v3/routes', { route_types: [0] }) as Record<string, unknown>;
      const trimmed = trimRoutes(data);
      expect(Array.isArray(trimmed)).toBe(true);
      expect(trimmed.length).toBeGreaterThan(0);
      expect(trimmed[0]).toHaveProperty('route_id');
      expect(trimmed[0]).toHaveProperty('route_name');
    });
  });

  describe('departures', () => {
    it('returns trimmed departures from Flinders Street (stop 1071, train)', async () => {
      const data = await ptv('/v3/departures/route_type/0/stop/1071', { max_results: 3 }) as Record<string, unknown>;
      const trimmed = trimDepartures(data);
      expect(Array.isArray(trimmed)).toBe(true);
      // Structural check only — exact times change
      if (trimmed.length > 0) {
        expect(trimmed[0]).toHaveProperty('scheduled_departure_utc');
        expect(trimmed[0]).toHaveProperty('route_id');
        expect(trimmed[0]).toHaveProperty('stop_id');
      }
    });

    it('--raw returns a superset of trimmed fields', async () => {
      const raw = await ptv('/v3/departures/route_type/0/stop/1071', { max_results: 1 }) as Record<string, unknown>;
      const trimmed = trimDepartures(raw);
      if ((trimmed as unknown[]).length > 0) {
        const rawFirst = (raw.departures as Record<string, unknown>[])[0];
        const trimFirst = (trimmed as Record<string, unknown>[])[0];
        for (const key of Object.keys(trimFirst)) {
          expect(rawFirst).toHaveProperty(key);
        }
      }
    });
  });

  describe('stops search', () => {
    it('returns trimmed stops matching "flinders" or skips gracefully if endpoint unavailable', async () => {
      try {
        const data = await ptv('/v3/stops/search/flinders') as Record<string, unknown>;
        const trimmed = trimStopsSearch(data) as Record<string, unknown>;
        expect(Array.isArray(trimmed.stops)).toBe(true);
        if ((trimmed.stops as unknown[]).length > 0) {
          const first = (trimmed.stops as Record<string, unknown>[])[0];
          expect(first).toHaveProperty('stop_id');
          expect(first).toHaveProperty('stop_name');
        }
      } catch (e: unknown) {
        // Undocumented endpoint may return 404 — skip gracefully
        const msg = (e as Error).message;
        if (!msg.includes('"error"')) throw e;
        console.warn('stops/search endpoint unavailable (undocumented), skipping assertion');
      }
    });
  });

  describe('disruptions', () => {
    it('returns an array (may be empty if no disruptions)', async () => {
      const data = await ptv('/v3/disruptions') as Record<string, unknown>;
      const trimmed = trimDisruptions(data);
      expect(Array.isArray(trimmed)).toBe(true);
    });
  });

  describe('search', () => {
    it('returns stops and routes for "flinders street"', async () => {
      const data = await ptv('/v3/search/flinders%20street') as Record<string, unknown>;
      const trimmed = trimSearch(data) as Record<string, unknown>;
      expect(Array.isArray(trimmed.stops)).toBe(true);
      expect(Array.isArray(trimmed.routes)).toBe(true);
    });
  });

  describe('nearby', () => {
    it('returns stops near Melbourne CBD', async () => {
      // Flinders Street Station coordinates
      const data = await ptv('/v3/stops/location/-37.8183,144.9671', { max_results: 5 }) as Record<string, unknown>;
      const trimmed = trimNearby(data);
      expect(Array.isArray(trimmed)).toBe(true);
      expect(trimmed.length).toBeGreaterThan(0);
      expect(trimmed[0]).toHaveProperty('stop_id');
      expect(trimmed[0]).toHaveProperty('stop_latitude');
    });
  });

  describe('stop-details', () => {
    it('returns details for Flinders Street Station (stop 1071, train)', async () => {
      const data = await ptv('/v3/stops/1071/route_type/0') as Record<string, unknown>;
      const trimmed = trimStopDetails(data, {});
      expect(trimmed).toHaveProperty('stop_id', 1071);
      expect(trimmed).toHaveProperty('stop_name');
      expect(trimmed).toHaveProperty('stop_latitude');
    });

    it('includes stop_amenities sub-object when requested', async () => {
      const data = await ptv('/v3/stops/1071/route_type/0', { stop_amenities: 'true' }) as Record<string, unknown>;
      const trimmed = trimStopDetails(data, { amenities: true }) as Record<string, unknown>;
      expect(trimmed).toHaveProperty('stop_amenities');
      expect(typeof trimmed.stop_amenities).toBe('object');
    });
  });

});
