import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../../src/server/index';

const fakeResult = {
  query: {
    from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
    minBikeKm: 0, maxBikeKm: 20, maxTransfers: 0, enrich: true,
    preferBikePath: false, hillWeight: 0, goal: 'commute', mode: 'bike-only',
  },
  itineraries: [{
    labels: ['recommended', 'fastest'],
    totalTimeMin: 60, bikeKm: 25, bikeMin: 60,
    trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
    legs: [{ mode: 'bike',
      from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
      km: 25, min: 60,
      geometry: { type: 'LineString', coordinates: [[145.19, -37.64], [144.89, -37.86]] } }],
  }],
};

describe('POST /api/plan', () => {
  it('returns JSON when Accept: application/json', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().itineraries[0].totalTimeMin).toBe(60);
    expect(planFn).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns HTML fragment when Accept: text/html', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'text/html' },
      payload: { from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute' },
    });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/class="itinerary-card"/);
    expect(res.body).toContain('60');     // minutes
    expect(res.body).toContain('L.map');  // map init script embedded
    await app.close();
  });

  it('parses form-encoded body (HTMX style)', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      payload: 'from%5Blat%5D=-37.64&from%5Blon%5D=145.19&to%5Blat%5D=-37.86&to%5Blon%5D=144.89&mode=bike-only&goal=commute',
    });
    expect(res.statusCode).toBe(200);
    expect(planFn).toHaveBeenCalledOnce();
    await app.close();
  });
});
