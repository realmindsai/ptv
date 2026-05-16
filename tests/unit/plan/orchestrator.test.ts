import { describe, it, expect, vi } from 'vitest';
import { plan } from '../../../src/plan/orchestrator';
import type { PlanRequest } from '../../../src/plan/types';

function makeReq(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    from: { lat: -37.78, lon: 144.96 },
    to:   { lat: -38.14, lon: 145.12 },
    departUtc: new Date('2026-05-16T22:00:00Z'),
    minBikeKm: 0, maxBikeKm: 15, maxTransfers: 0, enrich: false,
    ...over,
  };
}

// A fake ptv() that responds based on URL prefix
function fakePtvFactory(): {
  ptv: (path: string, params?: Record<string, unknown>) => Promise<unknown>;
} {
  const ptv = vi.fn(async (path: string) => {
    if (path.startsWith('/v3/stops/location/-37.78,144.96')) {
      return {
        stops: [{
          stop_id: 1071, stop_name: 'Brunswick', route_type: 0,
          stop_latitude: -37.77, stop_longitude: 144.96,
          routes: [{ route_id: 6, route_type: 0 }],
        }],
      };
    }
    if (path.startsWith('/v3/stops/location/-38.14,145.12')) {
      return {
        stops: [{
          stop_id: 1162, stop_name: 'Frankston', route_type: 0,
          stop_latitude: -38.14, stop_longitude: 145.12,
          routes: [{ route_id: 6, route_type: 0 }],
        }],
      };
    }
    if (path.startsWith('/v3/departures/route_type/0/stop/1071')) {
      return {
        departures: [{
          route_id: 6, run_ref: 'R1', stop_id: 1071,
          scheduled_departure_utc: '2026-05-16T22:20:00Z',
          estimated_departure_utc: null,
        }],
      };
    }
    if (path.startsWith('/v3/pattern/run/R1/route_type/0')) {
      return {
        departures: [
          { stop_id: 1071, scheduled_departure_utc: '2026-05-16T22:20:00Z', estimated_departure_utc: null },
          { stop_id: 1162, scheduled_departure_utc: '2026-05-16T23:10:00Z', estimated_departure_utc: null },
        ],
      };
    }
    return { stops: [], departures: [] };
  });
  return { ptv };
}

const fakeExternal = {
  osrmTable: vi.fn(async (_p: string, _s: never, dests: unknown[]) => ({
    durations: dests.map(() => 600),
    distances: dests.map(() => 3000),
  })),
  osrmRoute: vi.fn(async () => ({ km: 3, min: 10, geometry: '' })),
  ghRouteBike: vi.fn(async () => null),
};

describe('plan() — happy path', () => {
  it('returns one itinerary for a single train segment', async () => {
    const { ptv } = fakePtvFactory();
    const out = await plan(makeReq(), { ptv, external: fakeExternal as never });
    expect(out.itineraries).toHaveLength(1);
    const it = out.itineraries[0];
    expect(it.legs).toHaveLength(3);
    expect(it.legs[0].mode).toBe('bike');
    expect(it.legs[1].mode).toBe('train');
    expect(it.legs[2].mode).toBe('bike');
    expect(it.labels).toContain('fastest');
  });

  it('rejects --max-transfers > 0 in v1', async () => {
    const { ptv } = fakePtvFactory();
    await expect(
      plan(makeReq({ maxTransfers: 1 }), { ptv, external: fakeExternal as never }),
    ).rejects.toThrow(/max-transfers/);
  });

  it('infeasible: returns near-miss when minBikeKm exceeds available', async () => {
    const { ptv } = fakePtvFactory();
    const out = await plan(
      makeReq({ minBikeKm: 50 }),
      { ptv, external: fakeExternal as never },
    );
    expect(out.itineraries).toHaveLength(1);
    expect(out.itineraries[0].constraintsViolated).toContain('min_bike_km');
    expect(out.warnings?.[0]).toMatch(/min-bike-km/);
  });

  it('--arrive-by: waitMin is 0, totalTimeMin is bikeOut + train + bikeIn', async () => {
    const { ptv } = fakePtvFactory();
    const out = await plan(
      makeReq({
        departUtc: undefined,
        arriveByUtc: new Date('2026-05-17T01:00:00Z'),
      }),
      { ptv, external: fakeExternal as never },
    );
    expect(out.itineraries).toHaveLength(1);
    const it = out.itineraries[0];
    expect(it.waitMin).toBe(0);
    // bikeOut.min + bikeIn.min = 10 + 10 = 20; train run is 22:20→23:10 = 50 min.
    expect(it.totalTimeMin).toBeCloseTo(70, 5);
  });

  it('memoizes osrmRoute calls by stop id (no redundant calls across tuples)', async () => {
    // PTV stub: TWO departures from stop 1071, both reaching stop 1162.
    const ptv = vi.fn(async (path: string) => {
      if (path.startsWith('/v3/stops/location/-37.78,144.96')) {
        return {
          stops: [{
            stop_id: 1071, stop_name: 'Brunswick', route_type: 0,
            stop_latitude: -37.77, stop_longitude: 144.96,
            routes: [{ route_id: 6, route_type: 0 }],
          }],
        };
      }
      if (path.startsWith('/v3/stops/location/-38.14,145.12')) {
        return {
          stops: [{
            stop_id: 1162, stop_name: 'Frankston', route_type: 0,
            stop_latitude: -38.14, stop_longitude: 145.12,
            routes: [{ route_id: 6, route_type: 0 }],
          }],
        };
      }
      if (path.startsWith('/v3/departures/route_type/0/stop/1071')) {
        return {
          departures: [
            { route_id: 6, run_ref: 'R1', stop_id: 1071,
              scheduled_departure_utc: '2026-05-16T22:20:00Z', estimated_departure_utc: null },
            { route_id: 6, run_ref: 'R2', stop_id: 1071,
              scheduled_departure_utc: '2026-05-16T22:40:00Z', estimated_departure_utc: null },
          ],
        };
      }
      if (path.startsWith('/v3/pattern/run/R1/route_type/0')
        || path.startsWith('/v3/pattern/run/R2/route_type/0')) {
        return {
          departures: [
            { stop_id: 1071, scheduled_departure_utc: '2026-05-16T22:20:00Z', estimated_departure_utc: null },
            { stop_id: 1162, scheduled_departure_utc: '2026-05-16T23:10:00Z', estimated_departure_utc: null },
          ],
        };
      }
      return { stops: [], departures: [] };
    });

    const osrmRouteSpy = vi.fn(async () => ({ km: 3, min: 10, geometry: '' }));
    const memoExternal = {
      osrmTable: vi.fn(async (_p: string, _s: never, dests: unknown[]) => ({
        durations: dests.map(() => 600), distances: dests.map(() => 3000),
      })),
      osrmRoute: osrmRouteSpy,
      ghRouteBike: vi.fn(async () => null),
    };

    const out = await plan(makeReq(), { ptv, external: memoExternal as never });
    expect(out.itineraries.length).toBeGreaterThanOrEqual(2);
    // With memoization: 1 call for (origin → 1071), 1 call for (1162 → dest) = 2 total.
    // Without: 2 tuples × 2 calls = 4.
    expect(osrmRouteSpy).toHaveBeenCalledTimes(2);
  });
});
