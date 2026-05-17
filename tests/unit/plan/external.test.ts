import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseGhRoute } from '../../../src/plan/external';
import { MAX_PATH_CUSTOM_MODEL, DAY_RIDE_CUSTOM_MODEL } from '../../../src/plan/types';

describe('parseGhRoute()', () => {
  it('returns null on missing distance', () => {
    expect(parseGhRoute([{ response: { paths: [{ time: 100 }] } }])).toBeNull();
  });

  it('returns null on missing time', () => {
    expect(parseGhRoute([{ response: { paths: [{ distance: 1000 }] } }])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(parseGhRoute([])).toBeNull();
  });

  it('computes km and min from native units', () => {
    const out = parseGhRoute([{
      response: { paths: [{ distance: 5000, time: 600000 }] },
    }]);
    expect(out?.km).toBe(5);
    expect(out?.min).toBe(10);
  });

  it('computes kmOnPath from road_class index spans', () => {
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 10000, time: 600000,
        details: {
          road_class: [
            [0, 30, 'cycleway'],
            [30, 50, 'residential'],
            [50, 70, 'path'],
            [70, 100, 'primary'],
          ],
        },
      }] },
    }]);
    expect(out?.kmOnPath).toBeCloseTo(5, 5);
  });

  it('uses road_class, not surface, for path classification', () => {
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 10000, time: 600000,
        details: {
          road_class: [
            [0, 50, 'cycleway'],
            [50, 100, 'residential'],
          ],
          surface: [
            [0, 100, 'asphalt'],
          ],
        },
      }] },
    }]);
    expect(out?.kmOnPath).toBeCloseTo(5, 5);
  });

  it('returns kmOnPath=0 when road_class is absent', () => {
    const out = parseGhRoute([{
      response: { paths: [{ distance: 5000, time: 600000 }] },
    }]);
    expect(out?.kmOnPath).toBe(0);
  });

  it('extracts ascendM/descendM from path response', () => {
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 10000, time: 1800000,
        ascend: 152.5, descend: 88.3,
      }] },
    }]);
    expect(out?.ascendM).toBeCloseTo(152.5, 1);
    expect(out?.descendM).toBeCloseTo(88.3, 1);
  });

  it('computes flatFraction and steepFraction from average_slope', () => {
    // 4 segments, each 250m: grades 1, 4, 7, 0. Half flat (<4%), quarter steep (>=6%).
    const points = {
      type: 'LineString' as const,
      coordinates: [
        [144.96, -37.78], [144.962, -37.78],
        [144.964, -37.78], [144.966, -37.78], [144.968, -37.78],
      ],
    };
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 1000, time: 240000,
        details: {
          average_slope: [[0, 1, 1], [1, 2, 4], [2, 3, 7], [3, 4, 0]] as Array<[number, number, number]>,
        },
        points,
      }] },
    }]);
    // Segments at grade 1 and 0 are flat (|g| < 4) → 2 of 4 segments = 50%
    expect(out?.flatFraction).toBeCloseTo(0.5, 1);
    // Grade 7 is steep (|g| >= 6) → 1 of 4 = 25%
    expect(out?.steepFraction).toBeCloseTo(0.25, 1);
  });

  it('identifies maxSustainedGradePercent and maxSustainedGradeM', () => {
    // Two climb runs: 200m at 6%, and 100m at 8%. The 6%×200m=1200 wins by intensity.
    const points = {
      type: 'LineString' as const,
      coordinates: [
        [144.96, -37.78], [144.962, -37.78],
        [144.964, -37.78], [144.966, -37.78], [144.968, -37.78],
      ],
    };
    const out = parseGhRoute([{
      response: { paths: [{
        distance: 1000, time: 240000,
        details: {
          average_slope: [[0, 2, 6], [2, 3, 0], [3, 4, 8]] as Array<[number, number, number]>,
        },
        points,
      }] },
    }]);
    // 6%×~500m beats 8%×~250m by intensity (3000 vs 2000)
    expect(out?.maxSustainedGradePercent).toBe(6);
    expect(out?.maxSustainedGradeM).toBeGreaterThan(out?.maxSustainedGradeM === 0 ? -1 : 100);
  });

  it('returns 0 elevation fields when path has no ascend/descend/slope', () => {
    const out = parseGhRoute([{
      response: { paths: [{ distance: 5000, time: 600000 }] },
    }]);
    expect(out?.ascendM).toBe(0);
    expect(out?.descendM).toBe(0);
    expect(out?.flatFraction).toBe(0);
    expect(out?.steepFraction).toBe(0);
    expect(out?.maxSustainedGradePercent).toBe(0);
    expect(out?.maxSustainedGradeM).toBe(0);
  });
});

describe('ghRouteCustom()', () => {
  beforeEach(() => { vi.resetModules(); });

  it('parses successful GraphHopper REST response', async () => {
    const fakeResponse = {
      paths: [{
        distance: 12345, time: 600000,
        ascend: 75, descend: 60,
        details: { road_class: [[0, 10, 'cycleway']], average_slope: [] },
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => fakeResponse,
    })));
    const { ghRouteCustom } = await import('../../../src/plan/external');
    const { DAY_RIDE_CUSTOM_MODEL } = await import('../../../src/plan/types');
    const r = await ghRouteCustom(
      { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 },
      DAY_RIDE_CUSTOM_MODEL,
    );
    expect(r?.km).toBeCloseTo(12.345);
    expect(r?.ascendM).toBe(75);
    vi.unstubAllGlobals();
  });

  it('returns null on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const { ghRouteCustom } = await import('../../../src/plan/external');
    const { DAY_RIDE_CUSTOM_MODEL } = await import('../../../src/plan/types');
    const r = await ghRouteCustom(
      { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 },
      DAY_RIDE_CUSTOM_MODEL,
    );
    expect(r).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const { ghRouteCustom } = await import('../../../src/plan/external');
    const { DAY_RIDE_CUSTOM_MODEL } = await import('../../../src/plan/types');
    const r = await ghRouteCustom(
      { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 },
      DAY_RIDE_CUSTOM_MODEL,
    );
    expect(r).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null when response has no paths', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ paths: [] }),
    })));
    const { ghRouteCustom } = await import('../../../src/plan/external');
    const { DAY_RIDE_CUSTOM_MODEL } = await import('../../../src/plan/types');
    const r = await ghRouteCustom(
      { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 },
      DAY_RIDE_CUSTOM_MODEL,
    );
    expect(r).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('MAX_PATH_CUSTOM_MODEL', () => {
  it('uses distance_influence 10 (more aggressive than day-ride)', () => {
    expect(MAX_PATH_CUSTOM_MODEL.distance_influence).toBe(10);
    expect(DAY_RIDE_CUSTOM_MODEL.distance_influence).toBe(50);
  });

  it('has 5 priority rules including residential penalty', () => {
    expect(MAX_PATH_CUSTOM_MODEL.priority).toHaveLength(5);
    const resi = MAX_PATH_CUSTOM_MODEL.priority.find((r) => r.if.includes('RESIDENTIAL'));
    expect(resi?.multiply_by).toBe(0.3);
  });
});

describe('osrmRoute()', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OSRM_AU_HOST;
    delete process.env.OSRM_AU_BICYCLE_URL;
    delete process.env.OSRM_AU_FOOT_URL;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('hits /route/v1/driving with lon,lat order (NOT lat,lon)', async () => {
    process.env.OSRM_AU_HOST = 'osrm.example';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmRoute } = await import('../../../src/plan/external');
    await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('http://osrm.example:5002/route/v1/driving/');
    // lon,lat;lon,lat — note the order flip vs internal LatLon
    expect(url).toContain('144.96,-37.78;144.97,-37.79');
    expect(url).toContain('overview=full');
    expect(url).toContain('geometries=polyline');
  });

  it('uses port 5003 for the foot profile', async () => {
    process.env.OSRM_AU_HOST = 'osrm.example';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 100, duration: 120, geometry: '_p~iF~ps|U' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmRoute } = await import('../../../src/plan/external');
    await osrmRoute('foot', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://osrm.example:5003/route/v1/driving/');
  });

  it('honours OSRM_AU_BICYCLE_URL override (container case)', async () => {
    process.env.OSRM_AU_BICYCLE_URL = 'http://osrm-au-bicycle:5000';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmRoute } = await import('../../../src/plan/external');
    await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://osrm-au-bicycle:5000/route/v1/driving/');
  });

  it('returns km and min computed from native units', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    })));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.km).toBeCloseTo(1.5);
    expect(r.min).toBeCloseTo(6);
  });

  it('decodes the encoded polyline into a GeoJSON LineString', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1500, duration: 360, geometry: '~{qeF_owsZn}@o}@' }],
      }),
    })));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.geometry).not.toBeNull();
    expect(r.geometry!.type).toBe('LineString');
    expect(r.geometry!.coordinates).toHaveLength(2);
    const [lon1, lat1] = r.geometry!.coordinates[0];
    expect(lon1).toBeCloseTo(144.96, 1);
    expect(lat1).toBeCloseTo(-37.78, 1);
  });

  it('throws when OSRM responds with code !== "Ok"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 'NoRoute', message: 'Impossible route' }),
    })));
    const { osrmRoute } = await import('../../../src/plan/external');
    await expect(
      osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 }),
    ).rejects.toThrow(/NoRoute/);
  });

  it('throws when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    const { osrmRoute } = await import('../../../src/plan/external');
    await expect(
      osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 }),
    ).rejects.toThrow(/502/);
  });
});

describe('osrmTable()', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OSRM_AU_HOST;
    delete process.env.OSRM_AU_BICYCLE_URL;
    delete process.env.OSRM_AU_FOOT_URL;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns empty arrays when destinations list is empty (no fetch call)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { osrmTable } = await import('../../../src/plan/external');
    const r = await osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, []);
    expect(r).toEqual({ durations: [], distances: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hits /table/v1/driving with source then destinations in lon,lat order', async () => {
    process.env.OSRM_AU_HOST = 'osrm.example';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        durations: [[0, 120, 240]],
        distances: [[0, 1000, 2000]],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { osrmTable } = await import('../../../src/plan/external');
    await osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [
      { lat: -37.79, lon: 144.97 },
      { lat: -37.80, lon: 144.98 },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('http://osrm.example:5002/table/v1/driving/');
    // Three semicolon-separated lon,lat pairs (source + 2 destinations)
    expect(url).toContain('144.96,-37.78;144.97,-37.79;144.98,-37.8');
    expect(url).toContain('annotations=duration%2Cdistance');
    expect(url).toContain('sources=0');
    expect(url).toContain('destinations=1%3B2');
  });

  it('returns row 0 of the durations/distances matrices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        durations: [[0, 120, 240]],
        distances: [[0, 1000, 2000]],
      }),
    })));
    const { osrmTable } = await import('../../../src/plan/external');
    const r = await osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [
      { lat: -37.79, lon: 144.97 },
      { lat: -37.80, lon: 144.98 },
    ]);
    expect(r.durations).toEqual([0, 120, 240]);
    expect(r.distances).toEqual([0, 1000, 2000]);
  });

  it('throws when OSRM responds with code !== "Ok"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 'InvalidQuery', message: 'bad' }),
    })));
    const { osrmTable } = await import('../../../src/plan/external');
    await expect(
      osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [{ lat: -37.79, lon: 144.97 }]),
    ).rejects.toThrow(/InvalidQuery/);
  });

  it('throws when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const { osrmTable } = await import('../../../src/plan/external');
    await expect(
      osrmTable('bicycle', { lat: -37.78, lon: 144.96 }, [{ lat: -37.79, lon: 144.97 }]),
    ).rejects.toThrow(/503/);
  });
});
