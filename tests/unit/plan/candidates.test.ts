import { describe, it, expect, vi } from 'vitest';
import { accessCandidates } from '../../../src/plan/candidates';

describe('accessCandidates()', () => {
  it('filters to bikeable route_types (0, 3) only', async () => {
    const fakePtv = vi.fn(async () => ({
      stops: [
        { stop_id: 1, stop_name: 'Train A', route_type: 0,
          stop_latitude: -37.77, stop_longitude: 144.96,
          routes: [{ route_id: 100, route_type: 0 }] },
        { stop_id: 2, stop_name: 'Tram B', route_type: 1,
          stop_latitude: -37.78, stop_longitude: 144.97,
          routes: [{ route_id: 200, route_type: 1 }] },
        { stop_id: 3, stop_name: 'VLine C', route_type: 3,
          stop_latitude: -37.79, stop_longitude: 144.98,
          routes: [{ route_id: 300, route_type: 3 }] },
      ],
    }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({
        durations: [600, 600, 600],
        distances: [3000, 3000, 3000],
      })),
    };

    const out = await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 5, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(out.map((c) => c.stopId).sort()).toEqual([1, 3]);
  });

  it('drops stops over the bike budget', async () => {
    const fakePtv = vi.fn(async () => ({
      stops: [
        { stop_id: 1, stop_name: 'Close', route_type: 0,
          stop_latitude: -37.77, stop_longitude: 144.96,
          routes: [{ route_id: 100, route_type: 0 }] },
        { stop_id: 2, stop_name: 'Far', route_type: 0,
          stop_latitude: -37.85, stop_longitude: 145.05,
          routes: [{ route_id: 100, route_type: 0 }] },
      ],
    }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({
        durations: [300, 1800],
        distances: [1500, 9000], // 1.5km, 9km
      })),
    };

    const out = await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 5, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(out.map((c) => c.stopId)).toEqual([1]); // 9km > 5km budget dropped
  });

  it('populates bikeKm/bikeMin from the OSRM table', async () => {
    const fakePtv = vi.fn(async () => ({
      stops: [
        { stop_id: 1, stop_name: 'A', route_type: 0,
          stop_latitude: -37.77, stop_longitude: 144.96,
          routes: [{ route_id: 100, route_type: 0 }] },
      ],
    }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({
        durations: [600], distances: [3000],
      })),
    };
    const out = await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 5, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(out[0].bikeMin).toBeCloseTo(10);
    expect(out[0].bikeKm).toBeCloseTo(3);
    expect(out[0].routeIds).toEqual([100]);
  });

  it('passes max_results: 200 to PTV stops/location', async () => {
    const fakePtv = vi.fn(async () => ({ stops: [] }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({ durations: [], distances: [] })),
    };
    await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 5, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(fakePtv).toHaveBeenCalledWith(
      expect.stringContaining('/v3/stops/location'),
      expect.objectContaining({ max_results: 200 }),
    );
  });

  it('caps the result set at TOP_N_CANDIDATES (30), sorted by bikeMin ascending', async () => {
    const stops = Array.from({ length: 50 }, (_, i) => ({
      stop_id: 1000 + i, stop_name: `Stop${i}`, route_type: 0,
      stop_latitude: -37.78 + i * 0.001, stop_longitude: 144.96,
      routes: [{ route_id: 100, route_type: 0 }],
    }));
    const fakePtv = vi.fn(async () => ({ stops }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({
        durations: stops.map((_, i) => 300 + i * 60),    // 5min..54min
        distances: stops.map((_, i) => 1000 + i * 100),   // 1km..5.9km
      })),
    };
    const out = await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 100, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(out).toHaveLength(30);
    // Result preserves the 15 closest AND the 15 farthest by bikeMin
    const keptIds = new Set(out.map((c) => c.stopId));
    for (let i = 0; i < 15; i++) expect(keptIds.has(1000 + i)).toBe(true);   // close
    for (let i = 35; i < 50; i++) expect(keptIds.has(1000 + i)).toBe(true);  // far
    for (let i = 15; i < 35; i++) expect(keptIds.has(1000 + i)).toBe(false); // middle dropped
  });

  it('drops candidates that detour excessively off the origin→axisOther axis', async () => {
    // origin near central Melb, dest north-east. A station NW (Sunbury-ish) is far
    // off-axis; one between origin and dest is on-axis.
    const origin = { lat: -37.78, lon: 144.96 };
    const dest   = { lat: -37.65, lon: 145.20 };
    const onAxis  = { lat: -37.72, lon: 145.05 }; // roughly between
    const offAxis = { lat: -37.58, lon: 144.72 }; // far NW (Sunbury direction)

    const fakePtv = vi.fn(async () => ({
      stops: [
        { stop_id: 1, stop_name: 'OnAxis', route_type: 0,
          stop_latitude: onAxis.lat, stop_longitude: onAxis.lon,
          routes: [{ route_id: 100, route_type: 0 }] },
        { stop_id: 2, stop_name: 'OffAxis', route_type: 0,
          stop_latitude: offAxis.lat, stop_longitude: offAxis.lon,
          routes: [{ route_id: 100, route_type: 0 }] },
      ],
    }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({
        durations: [600, 7200],
        distances: [3000, 32000],
      })),
    };

    const out = await accessCandidates(
      origin, 40, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
      dest,
    );
    expect(out.map((c) => c.stopId)).toEqual([1]);
  });

  it('skips directionality filter when axisOther is omitted (backward compat)', async () => {
    const fakePtv = vi.fn(async () => ({
      stops: [
        { stop_id: 2, stop_name: 'OffAxis', route_type: 0,
          stop_latitude: -37.58, stop_longitude: 144.72,
          routes: [{ route_id: 100, route_type: 0 }] },
      ],
    }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({ durations: [7200], distances: [32000] })),
    };
    const out = await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 40, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(out.map((c) => c.stopId)).toEqual([2]);
  });

  it('keeps both close and far stops (15 each, union) when input has more than 30 candidates', async () => {
    const stops = Array.from({ length: 50 }, (_, i) => ({
      stop_id: 1000 + i, stop_name: `Stop${i}`, route_type: 0,
      stop_latitude: -37.78 + i * 0.001, stop_longitude: 144.96,
      routes: [{ route_id: 100, route_type: 0 }],
    }));
    const fakePtv = vi.fn(async () => ({ stops }));
    const fakeExternal = {
      osrmTable: vi.fn(async () => ({
        durations: stops.map((_, i) => 300 + i * 60),    // 5min..54min
        distances: stops.map((_, i) => 1000 + i * 100),
      })),
    };
    const out = await accessCandidates(
      { lat: -37.78, lon: 144.96 }, 100, [0, 3],
      { ptv: fakePtv, external: fakeExternal as never },
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(30);
    const ids = new Set(out.map((c) => c.stopId));
    expect(ids.has(1000)).toBe(true);  // closest (i=0)
    expect(out.some((c) => c.stopId >= 1000 && c.stopId < 1015)).toBe(true);  // close half
    expect(out.some((c) => c.stopId >= 1035 && c.stopId < 1050)).toBe(true);  // far half
    expect(ids.has(1049)).toBe(true);  // farthest (i=49)
  });
});
