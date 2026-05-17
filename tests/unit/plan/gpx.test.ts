import { describe, it, expect } from 'vitest';
import { writeGpx } from '../../../src/plan/gpx';
import { readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { PlanResult } from '../../../src/plan/types';

function tmpGpxPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ptv-gpx-'));
  return join(dir, 'trip.gpx');
}

function bikeOnlyResult(): PlanResult {
  return {
    query: {
      from: { lat: -37.78, lon: 144.96 },
      to:   { lat: -37.77, lon: 144.97 },
      minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
      enrich: false, preferBikePath: false,
      hillWeight: 0, goal: 'commute', mode: 'bike-only',
    },
    itineraries: [
      {
        labels: ['recommended'],
        totalTimeMin: 12,
        bikeKm: 1.5, bikeMin: 12,
        trainKm: 0, trainMin: 0, waitMin: 0,
        transfers: 0,
        legs: [
          {
            mode: 'bike',
            from: { lat: -37.78, lon: 144.96 },
            to:   { lat: -37.77, lon: 144.97 },
            km: 1.5, min: 12,
            geometry: {
              type: 'LineString',
              coordinates: [
                [144.96, -37.78], [144.965, -37.775], [144.97, -37.77],
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('writeGpx()', () => {
  it('writes a valid GPX with one <trk> and one <trkseg> for a bike-only itinerary', () => {
    const path = tmpGpxPath();
    writeGpx(path, bikeOnlyResult());
    const xml = readFileSync(path, 'utf8');
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<trk>');
    expect(xml).toContain('<name>recommended</name>');
    // One trkseg with three trkpts (matches the 3-coord geometry).
    expect((xml.match(/<trkseg>/g) ?? []).length).toBe(1);
    expect((xml.match(/<trkpt /g) ?? []).length).toBe(3);
    unlinkSync(path);
  });

  it('falls back to a 2-point seg when bike-leg geometry is missing', () => {
    const r = bikeOnlyResult();
    (r.itineraries[0].legs[0] as { geometry: null }).geometry = null;
    const path = tmpGpxPath();
    writeGpx(path, r);
    const xml = readFileSync(path, 'utf8');
    expect((xml.match(/<trkseg>/g) ?? []).length).toBe(1);
    // Two trkpts: from and to.
    expect((xml.match(/<trkpt /g) ?? []).length).toBe(2);
    expect(xml).toContain('lat="-37.780000"');
    expect(xml).toContain('lat="-37.770000"');
    unlinkSync(path);
  });

  it('writes valid GPX with no <trk> when all itineraries are unlabeled or none exist', () => {
    const path = tmpGpxPath();
    writeGpx(path, { query: bikeOnlyResult().query, itineraries: [] });
    const xml = readFileSync(path, 'utf8');
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<metadata>');
    expect(xml).not.toContain('<trk>');
    unlinkSync(path);
  });

  it('throws when target directory does not exist', () => {
    expect(() => writeGpx('/nonexistent-dir-aaa-bbb/trip.gpx', bikeOnlyResult()))
      .toThrow(/directory does not exist/);
  });
});
