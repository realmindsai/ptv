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
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
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
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute' },
    });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/class="itinerary-card"/);
    expect(res.body).toContain('60');     // minutes
    expect(res.body).toContain('L.map');  // map init script embedded
    await app.close();
  });

  it('returns 400 with "invalid coordinates" when lat is non-numeric', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: 'abc', lon: 0 }, destination: { lat: 0, lon: 0 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/invalid coordinates/);
    expect(planFn).not.toHaveBeenCalled();
    await app.close();
  });

  it('parses form-encoded body (HTMX style)', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      payload: 'origin%5Blat%5D=-37.64&origin%5Blon%5D=145.19&destination%5Blat%5D=-37.86&destination%5Blon%5D=144.89&mode=bike-only&goal=commute',
    });
    expect(res.statusCode).toBe(200);
    expect(planFn).toHaveBeenCalledOnce();
    await app.close();
  });

  it('coerces maxTransfers to 0 when mode is bike-only (orchestrator invariant)', async () => {
    // The orchestrator throws "--mode bike-only is incompatible with --max-transfers > 0".
    // The route must respect that invariant by coercing the value rather than passing
    // through a client-supplied (or default) non-zero maxTransfers.
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'day-ride', maxTransfers: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(planFn).toHaveBeenCalledOnce();
    const calledWith = planFn.mock.calls[0][0] as { mode: string; maxTransfers: number };
    expect(calledWith.mode).toBe('bike-only');
    expect(calledWith.maxTransfers).toBe(0);
    await app.close();
  });

  it('parses depart=HH:MM as Melbourne local time and passes it to planFn', async () => {
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: '08:00' },
    });
    expect(res.statusCode).toBe(200);
    const calledWith = planFn.mock.calls[0][0] as { departUtc?: Date; arriveByUtc?: Date };
    expect(calledWith.departUtc).toBeInstanceOf(Date);
    expect(calledWith.arriveByUtc).toBeUndefined();
    const melHour = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne', hour: 'numeric', hour12: false,
    }).format(calledWith.departUtc as Date);
    expect(parseInt(melHour, 10)).toBe(8);
    await app.close();
  });

  it('treats depart="" (empty string from form) as undefined, not as an error', async () => {
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: '', arriveBy: '' },
    });
    expect(res.statusCode).toBe(200);
    const calledWith = planFn.mock.calls[0][0] as { departUtc?: Date; arriveByUtc?: Date };
    expect(calledWith.departUtc).toBeUndefined();
    expect(calledWith.arriveByUtc).toBeUndefined();
    await app.close();
  });

  it('returns 400 with "invalid time" when depart is malformed', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: 'garbage' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_INPUT');
    expect(res.json().error.message).toMatch(/depart: invalid time/);
    expect(planFn).not.toHaveBeenCalled();
    await app.close();
  });
});
