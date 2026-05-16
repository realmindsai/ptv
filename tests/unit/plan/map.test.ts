import { describe, it, expect } from 'vitest';
import { writeMapHtml } from '../../../src/plan/map';
import { readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PlanResult } from '../../../src/plan/types';

function fakeResult(): PlanResult {
  return {
    query: {
      from: { lat: -37.78, lon: 144.96 },
      to:   { lat: -37.65, lon: 144.95 },
      minBikeKm: 0, maxBikeKm: 10, maxTransfers: 1,
      enrich: false, preferBikePath: false,
    },
    itineraries: [
      {
        labels: ['recommended', 'fastest'],
        totalTimeMin: 60,
        bikeKm: 4, bikeMin: 15,
        trainKm: 10, trainMin: 20, waitMin: 5,
        transfers: 0,
        legs: [
          {
            mode: 'bike',
            from: { lat: -37.78, lon: 144.96 },
            to:   { lat: -37.77, lon: 144.96 },
            km: 2, min: 8,
            geometry: {
              type: 'LineString',
              coordinates: [[144.96, -37.78], [144.96, -37.77]],
            },
          },
          {
            mode: 'train',
            routeId: 6, routeType: 0, routeName: 'Frankston',
            fromStopId: 1071, toStopId: 1077,
            fromStopName: 'A', toStopName: 'B',
            fromLat: -37.77, fromLon: 144.96,
            toLat: -37.65, toLon: 144.95,
            departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
            runRef: 'R1',
          },
          {
            mode: 'bike',
            from: { lat: -37.65, lon: 144.95 },
            to:   { lat: -37.65, lon: 144.95 },
            km: 0, min: 0,
            geometry: null,
          },
        ],
      },
    ],
  };
}

describe('writeMapHtml()', () => {
  it('writes a file containing injected JSON and Leaflet markup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptv-map-'));
    const path = join(dir, 'trip.html');
    writeMapHtml(path, fakeResult());
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('leaflet@1.9.4');
    expect(contents).toContain('recommended');
    expect(contents).toContain('Frankston');
    expect(contents).toContain('"lat":-37.78');
    unlinkSync(path);
  });

  it('throws when target directory does not exist', () => {
    const path = '/nonexistent-directory-aaa-bbb/trip.html';
    expect(() => writeMapHtml(path, fakeResult())).toThrow(/directory does not exist/);
  });

  it('handles empty itineraries without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptv-map-'));
    const path = join(dir, 'empty.html');
    writeMapHtml(path, {
      query: fakeResult().query,
      itineraries: [],
    });
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('leaflet@1.9.4');
    unlinkSync(path);
  });
});
