import { describe, it, expect, vi } from 'vitest';
import { makeSearchStopsTool, makeNearbyStopsTool } from '../../../../src/chat/tools/stops';

describe('search_stops tool', () => {
  it('returns top-10 stops by name', async () => {
    const ptv = vi.fn().mockResolvedValue({
      stops: [
        { stop_id: 1, stop_name: 'Hurstbridge', stop_suburb: 'Hurstbridge', route_type: 0 },
        { stop_id: 2, stop_name: 'Hurstbridge SC', stop_suburb: 'Hurstbridge', route_type: 1 },
      ],
    });
    const t = makeSearchStopsTool(ptv);
    const out = await t.handler({ term: 'Hurst' });
    expect(ptv).toHaveBeenCalledWith('/v3/search/Hurst', {});
    expect(out).toEqual({
      ok: true,
      stops: [
        { stop_id: 1, name: 'Hurstbridge', suburb: 'Hurstbridge', routeType: 0 },
        { stop_id: 2, name: 'Hurstbridge SC', suburb: 'Hurstbridge', routeType: 1 },
      ],
    });
  });

  it('passes routeType when provided', async () => {
    const ptv = vi.fn().mockResolvedValue({ stops: [] });
    const t = makeSearchStopsTool(ptv);
    await t.handler({ term: 'flinders', routeType: 0 });
    expect(ptv).toHaveBeenCalledWith('/v3/search/flinders', { route_types: [0] });
  });
});

describe('nearby_stops tool', () => {
  it('returns stops near a coord with distance', async () => {
    const ptv = vi.fn().mockResolvedValue({
      stops: [{ stop_id: 5, stop_name: 'Eltham', stop_suburb: 'Eltham',
        route_type: 0, stop_distance: 400 }],
    });
    const t = makeNearbyStopsTool(ptv);
    const out = await t.handler({ lat: -37.7, lon: 145.1 });
    expect(ptv).toHaveBeenCalledWith('/v3/stops/location/-37.7,145.1', { max_results: 10 });
    expect(out).toEqual({
      ok: true,
      stops: [{ stop_id: 5, name: 'Eltham', suburb: 'Eltham', routeType: 0, distanceM: 400 }],
    });
  });

  it('passes maxKm as max_distance in metres', async () => {
    const ptv = vi.fn().mockResolvedValue({ stops: [] });
    const t = makeNearbyStopsTool(ptv);
    await t.handler({ lat: -37.7, lon: 145.1, maxKm: 2 });
    expect(ptv).toHaveBeenCalledWith('/v3/stops/location/-37.7,145.1', {
      max_results: 10, max_distance: 2000,
    });
  });
});
