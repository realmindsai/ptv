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
        routes: { 6: { route_id: 6, route_name: 'Frankston' } },
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

function k2PtvFactory(): {
  ptv: (path: string, params?: Record<string, unknown>) => Promise<unknown>;
} {
  // Scenario: Rosanna(2011) → Flinders Street(1071) → Dandenong(1049).
  // Route 7 (Hurstbridge): Rosanna → Flinders Street
  // Route 11 (Cranbourne):  Flinders Street → Dandenong
  const ROSANNA = { lat: -37.7390, lon: 145.0682 };
  const DANDY   = { lat: -37.9871, lon: 145.2113 };
  const ptv = vi.fn(async (path: string) => {
    if (path.includes(`/v3/stops/location/${ROSANNA.lat},${ROSANNA.lon}`)) {
      return { stops: [{
        stop_id: 2011, stop_name: 'Rosanna', route_type: 0,
        stop_latitude: -37.7395, stop_longitude: 145.068,
        routes: [{ route_id: 7, route_type: 0 }],
      }] };
    }
    if (path.includes(`/v3/stops/location/${DANDY.lat},${DANDY.lon}`)) {
      return { stops: [{
        stop_id: 1049, stop_name: 'Dandenong', route_type: 0,
        stop_latitude: -37.988, stop_longitude: 145.212,
        routes: [{ route_id: 11, route_type: 0 }],
      }] };
    }
    if (path.startsWith('/v3/departures/route_type/0/stop/2011')) {
      return {
        departures: [{
          route_id: 7, run_ref: 'RUN1', stop_id: 2011,
          scheduled_departure_utc: '2026-05-17T22:00:00Z',
          estimated_departure_utc: null,
        }],
        routes: { 7: { route_id: 7, route_name: 'Hurstbridge' } },
      };
    }
    if (path.startsWith('/v3/pattern/run/RUN1/route_type/0')) {
      return {
        departures: [
          { stop_id: 2011, scheduled_departure_utc: '2026-05-17T22:00:00Z', estimated_departure_utc: null },
          { stop_id: 1071, scheduled_departure_utc: '2026-05-17T22:25:00Z', estimated_departure_utc: null },
        ],
      };
    }
    if (path.startsWith('/v3/departures/route_type/0/stop/1071')) {
      return {
        departures: [{
          route_id: 11, run_ref: 'RUN2', stop_id: 1071,
          scheduled_departure_utc: '2026-05-17T22:35:00Z',
          estimated_departure_utc: null,
        }],
        routes: { 11: { route_id: 11, route_name: 'Cranbourne' } },
      };
    }
    if (path.startsWith('/v3/pattern/run/RUN2/route_type/0')) {
      return {
        departures: [
          { stop_id: 1071, scheduled_departure_utc: '2026-05-17T22:35:00Z', estimated_departure_utc: null },
          { stop_id: 1049, scheduled_departure_utc: '2026-05-17T23:10:00Z', estimated_departure_utc: null },
        ],
      };
    }
    return { stops: [], departures: [] };
  });
  return { ptv };
}

const k2External = {
  osrmTable: vi.fn(async (_p: string, _s: never, dests: unknown[]) => ({
    durations: dests.map(() => 300),
    distances: dests.map(() => 1500),
  })),
  osrmRoute: vi.fn(async () => ({ km: 1.5, min: 5, geometry: '' })),
  ghRouteBike: vi.fn(async () => null),
};

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
    const trainLeg = it.legs[1];
    if (trainLeg.mode === 'train') {
      expect(trainLeg.routeName).toBe('Frankston');
    }
  });

  it('--max-transfers >= 2 not yet implemented in v1.2', async () => {
    const { ptv } = fakePtvFactory();
    await expect(
      plan(makeReq({ maxTransfers: 2 }), { ptv, external: fakeExternal as never }),
    ).rejects.toThrow(/not yet implemented in v1\.2/);
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

  it('K=2 fallback: returns itinerary with transfers=1 and 4 legs when K=1 has no shared route', async () => {
    const { ptv } = k2PtvFactory();
    const out = await plan(
      {
        from: { lat: -37.7390, lon: 145.0682 },
        to:   { lat: -37.9871, lon: 145.2113 },
        departUtc: new Date('2026-05-17T21:30:00Z'),
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 1, enrich: false,
      },
      { ptv, external: k2External as never },
    );
    expect(out.itineraries).toHaveLength(1);
    const it = out.itineraries[0];
    expect(it.transfers).toBe(1);
    expect(it.legs).toHaveLength(4);
    expect(it.legs[0].mode).toBe('bike');
    expect(it.legs[1].mode).toBe('train');
    expect(it.legs[2].mode).toBe('train');
    expect(it.legs[3].mode).toBe('bike');
    const l1 = it.legs[1];
    const l2 = it.legs[2];
    if (l1.mode === 'train' && l2.mode === 'train') {
      expect(l1.toStopId).toBe(l2.fromStopId);
      // Hub name is populated for the transfer point (Flinders Street, stop_id 1071)
      expect(l1.toStopName).toBe('Flinders Street Station');
      expect(l2.fromStopName).toBe('Flinders Street Station');
    }
  });

  it('K=1 result is preferred when it has feasible itineraries (no K=2 fallback)', async () => {
    const { ptv } = fakePtvFactory();
    const out = await plan(makeReq({ maxTransfers: 1 }), { ptv, external: fakeExternal as never });
    expect(out.itineraries).toHaveLength(1);
    expect(out.itineraries[0].transfers).toBe(0);
    expect(out.itineraries[0].legs).toHaveLength(3);
  });

  it('--max-transfers=0 forces K=1 only (no fallback even when K=2 would succeed)', async () => {
    const { ptv } = k2PtvFactory();
    const out = await plan(
      {
        from: { lat: -37.7390, lon: 145.0682 },
        to:   { lat: -37.9871, lon: 145.2113 },
        departUtc: new Date('2026-05-17T21:30:00Z'),
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0, enrich: false,
      },
      { ptv, external: k2External as never },
    );
    expect(out.itineraries).toHaveLength(0);
  });

  it('K=2: totalTimeMin includes transferDwellMin and the field is populated', async () => {
    const { ptv } = k2PtvFactory();
    const out = await plan(
      {
        from: { lat: -37.7390, lon: 145.0682 },
        to:   { lat: -37.9871, lon: 145.2113 },
        departUtc: new Date('2026-05-17T21:30:00Z'),
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 1, enrich: false,
      },
      { ptv, external: k2External as never },
    );
    expect(out.itineraries).toHaveLength(1);
    const it = out.itineraries[0];
    // k2PtvFactory: RUN1 arrives FSS 22:25; RUN2 departs FSS 22:35. Dwell = 10 min.
    expect(it.transferDwellMin).toBe(10);
    // train1 = 25 min (22:00→22:25), dwell = 10, train2 = 35 min (22:35→23:10)
    // bike = 2 × 5 = 10 min, wait = (22:00 - 21:30) - 5 = 25 min
    // total = 10 + 25 + 25 + 10 + 35 = 105 min
    expect(it.totalTimeMin).toBeCloseTo(105);
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
