import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseGhRoute } from '../../../src/plan/external';

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
});

describe('osrmRoute()', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns geometry as a GeoJSON LineString object when osrm-au includes it', async () => {
    vi.doMock('child_process', () => ({
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({
          routes: [{
            distance: 1500,
            duration: 360,
            geometry: { type: 'LineString', coordinates: [[144.96, -37.78], [144.97, -37.79]] },
          }],
        }),
        stderr: '',
      }),
    }));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.km).toBeCloseTo(1.5);
    expect(r.min).toBeCloseTo(6);
    expect(r.geometry).toEqual({
      type: 'LineString',
      coordinates: [[144.96, -37.78], [144.97, -37.79]],
    });
  });

  it('decodes osrm-au encoded polyline geometry to a GeoJSON LineString', async () => {
    // '~{qeF_owsZn}@o}@' is the Google polyline (precision 5) encoding of
    // (-37.78, 144.96) → (-37.79, 144.97) — verified via manual encode/decode.
    vi.doMock('child_process', () => ({
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({
          routes: [{
            distance: 1500,
            duration: 360,
            geometry: '~{qeF_owsZn}@o}@',
          }],
        }),
        stderr: '',
      }),
    }));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.geometry).not.toBeNull();
    expect(r.geometry!.type).toBe('LineString');
    expect(r.geometry!.coordinates).toHaveLength(2);
    // Decoded coords should be close to the input lat/lon (within ~0.01 deg)
    const [lon1, lat1] = r.geometry!.coordinates[0];
    expect(lon1).toBeCloseTo(144.96, 1);
    expect(lat1).toBeCloseTo(-37.78, 1);
  });

  it('returns geometry: null when osrm-au omits the geometry field', async () => {
    vi.doMock('child_process', () => ({
      spawnSync: () => ({
        status: 0,
        stdout: JSON.stringify({
          routes: [{ distance: 1500, duration: 360 }],
        }),
        stderr: '',
      }),
    }));
    const { osrmRoute } = await import('../../../src/plan/external');
    const r = await osrmRoute('bicycle', { lat: -37.78, lon: 144.96 }, { lat: -37.79, lon: 144.97 });
    expect(r.geometry).toBeNull();
  });
});
