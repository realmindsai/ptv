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
});
