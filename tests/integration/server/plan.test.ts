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

  it('parses arriveBy=HH:MM and passes only arriveByUtc to planFn', async () => {
    const planFn = vi.fn(async (req) => ({ ...fakeResult, query: req }));
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', arriveBy: '17:30' },
    });
    expect(res.statusCode).toBe(200);
    const calledWith = planFn.mock.calls[0][0] as { departUtc?: Date; arriveByUtc?: Date };
    expect(calledWith.departUtc).toBeUndefined();
    expect(calledWith.arriveByUtc).toBeInstanceOf(Date);
    const melHour = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).format(calledWith.arriveByUtc as Date);
    // Allow both "17:30" and "17.30" locale variants — same as the unit test.
    expect(melHour).toMatch(/^17[:.]30$/);
    await app.close();
  });

  it('returns 400 with "arriveBy: invalid time" when arriveBy is malformed', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', arriveBy: 'garbage' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_INPUT');
    expect(res.json().error.message).toMatch(/arriveBy: invalid time/);
    expect(planFn).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 400 when both depart and arriveBy are non-empty', async () => {
    const planFn = vi.fn(async () => fakeResult);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute', depart: '08:00', arriveBy: '09:00' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_INPUT');
    expect(res.json().error.message).toMatch(/either depart or arriveBy/);
    expect(planFn).not.toHaveBeenCalled();
    await app.close();
  });

  it('HTML response includes a segment bar with bike and train segments + dep/arr times', async () => {
    const fakeResultMixed = {
      query: {
        from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
        minBikeKm: 0, maxBikeKm: 20, maxTransfers: 1, enrich: true,
        preferBikePath: false, hillWeight: 0, goal: 'commute', mode: 'bike-train',
      },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 92, bikeKm: 16, bikeMin: 43,
        trainKm: 30, trainMin: 45, waitMin: 4, transfers: 0,
        bikeKmOnPath: 12.5, ascendM: 220,
        legs: [
          { mode: 'bike',
            from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.65, lon: 145.10 },
            km: 5, min: 12 },
          { mode: 'train', routeId: 1, routeType: 0, routeName: 'Hurstbridge',
            fromStopId: 1, toStopId: 2, fromStopName: 'A', toStopName: 'B',
            departUtc: '2026-05-18T08:04:00Z', arriveUtc: '2026-05-18T08:49:00Z', runRef: 'r' },
          { mode: 'bike',
            from: { lat: -37.85, lon: 144.95 }, to: { lat: -37.86, lon: 144.89 },
            km: 11, min: 31 },
        ],
      }],
    };
    const planFn = vi.fn(async () => fakeResultMixed);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'text/html' },
      payload: { origin: { lat: -37.64, lon: 145.19 }, destination: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-train', goal: 'commute' },
    });
    expect(res.body).toMatch(/class="seg-bar"/);
    expect(res.body).toMatch(/seg seg--bike/);
    expect(res.body).toMatch(/seg seg--train/);
    expect(res.body).toMatch(/class="itin__dep mono"/);
    expect(res.body).toMatch(/class="itin__arr mono"/);
    expect(res.body).toMatch(/220.*m ↑/);
    expect(res.body).toMatch(/78%.*path/);  // round(100 * 12.5 / 16) = 78
    // action buttons (inert here; wired in task 4.3)
    expect(res.body).toMatch(/data-action="share"/);
    expect(res.body).toMatch(/data-action="gpx"/);
    expect(res.body).toMatch(/data-action="osmand"/);
    expect(res.body).toMatch(/data-action="equiv"/);
    await app.close();
  });

  it('JSON response exposes fields atlas.js renders', async () => {
    // Minimal fake plan result with all the fields renderPlanOnMap + renderResultsSheet read.
    const atlasResult = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [
        {
          labels: ['recommended'],
          totalTimeMin: 30,
          bikeKm: 10.5,
          bikeMin: 30,
          bikeKmOnPath: 8,
          trainKm: 0,
          trainMin: 0,
          waitMin: 0,
          transfers: 0,
          legs: [
            {
              mode: 'bike',
              from: { lat: -37.78, lon: 144.96 },
              to:   { lat: -37.86, lon: 144.92 },
              km: 10.5,
              min: 30,
              kmOnPath: 8,
              geometry: { type: 'LineString', coordinates: [[144.96, -37.78], [144.92, -37.86]] },
            },
          ],
        },
      ],
    };

    const planFn = vi.fn(async () => atlasResult as any);
    const app = createApp({ logger: false, planFn, cache: null, nominatimUrl: 'http://x' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: JSON.stringify({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Top-level shape:
    expect(body).toHaveProperty('itineraries');
    expect(Array.isArray(body.itineraries)).toBe(true);
    const it0 = body.itineraries[0];
    // Card fields (renderResultsSheet):
    expect(it0).toMatchObject({
      labels: ['recommended'],
      totalTimeMin: 30,
      bikeKm: 10.5,
      transfers: 0,
      trainMin: 0,
    });
    // Polyline fields (renderPlanOnMap):
    const bike = it0.legs[0];
    expect(bike.mode).toBe('bike');
    expect(bike).toHaveProperty('km');
    expect(bike).toHaveProperty('kmOnPath');
    expect(bike.geometry.coordinates[0]).toEqual([144.96, -37.78]);
    await app.close();
  });
});
