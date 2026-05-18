import { describe, it, expect } from 'vitest';
import { writeGpx, buildGpxXml } from '../../../src/plan/gpx';
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
    try {
      writeGpx(path, bikeOnlyResult());
      const xml = readFileSync(path, 'utf8');
      expect(xml).toMatch(/^<\?xml/);
      expect(xml).toContain('<gpx version="1.1"');
      expect(xml).toContain('<trk>');
      expect(xml).toContain('<name>recommended</name>');
      // One trkseg with three trkpts (matches the 3-coord geometry).
      expect((xml.match(/<trkseg>/g) ?? []).length).toBe(1);
      expect((xml.match(/<trkpt /g) ?? []).length).toBe(3);
    } finally {
      unlinkSync(path);
    }
  });

  it('falls back to a 2-point seg when bike-leg geometry is missing', () => {
    const r = bikeOnlyResult();
    (r.itineraries[0].legs[0] as { geometry: null }).geometry = null;
    const path = tmpGpxPath();
    try {
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      expect((xml.match(/<trkseg>/g) ?? []).length).toBe(1);
      // Two trkpts: from and to.
      expect((xml.match(/<trkpt /g) ?? []).length).toBe(2);
      expect(xml).toContain('lat="-37.780000"');
      expect(xml).toContain('lat="-37.770000"');
    } finally {
      unlinkSync(path);
    }
  });

  it('writes valid GPX with no <trk> when all itineraries are unlabeled or none exist', () => {
    const path = tmpGpxPath();
    try {
      writeGpx(path, { query: bikeOnlyResult().query, itineraries: [] });
      const xml = readFileSync(path, 'utf8');
      expect(xml).toMatch(/^<\?xml/);
      expect(xml).toContain('<gpx version="1.1"');
      expect(xml).toContain('<metadata>');
      expect(xml).not.toContain('<trk>');
    } finally {
      unlinkSync(path);
    }
  });

  it('throws when target directory does not exist', () => {
    expect(() => writeGpx('/nonexistent-dir-aaa-bbb/trip.gpx', bikeOnlyResult()))
      .toThrow(/directory does not exist/);
  });

  it('emits one <trkseg> per leg for bike-train-bike, with the train seg having 2 trkpts', () => {
    const path = tmpGpxPath();
    try {
      const r: PlanResult = {
        query: {
          from: { lat: -37.78, lon: 144.96 },
          to:   { lat: -37.65, lon: 144.95 },
          minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
          enrich: false, preferBikePath: false,
          hillWeight: 0, goal: 'commute', mode: 'bike-train',
        },
        itineraries: [{
          labels: ['recommended'],
          totalTimeMin: 60,
          bikeKm: 4, bikeMin: 15,
          trainKm: 10, trainMin: 20, waitMin: 5,
          transfers: 0,
          legs: [
            {
              mode: 'bike',
              from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.96 },
              km: 2, min: 8,
              geometry: { type: 'LineString',
                coordinates: [[144.96, -37.78], [144.96, -37.77]] as [number, number][] },
            },
            {
              mode: 'train',
              routeId: 6, routeType: 0, routeName: 'Frankston',
              fromStopId: 1, toStopId: 2,
              fromStopName: 'Origin Station', toStopName: 'Destination Station',
              fromLat: -37.77, fromLon: 144.96,
              toLat: -37.65, toLon: 144.95,
              departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
              runRef: 'R1',
            },
            {
              mode: 'bike',
              from: { lat: -37.65, lon: 144.95 }, to: { lat: -37.65, lon: 144.95 },
              km: 0, min: 0,
              geometry: { type: 'LineString',
                coordinates: [[144.95, -37.65], [144.95, -37.65]] as [number, number][] },
            },
          ],
        }],
      };
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      expect((xml.match(/<trk>/g) ?? []).length).toBe(1);
      expect((xml.match(/<trkseg>/g) ?? []).length).toBe(3);
      // 2 (bike 1) + 2 (train) + 2 (bike 2) = 6 trkpts total.
      expect((xml.match(/<trkpt /g) ?? []).length).toBe(6);
      // Two wpts (one per station).
      expect((xml.match(/<wpt /g) ?? []).length).toBe(2);
      expect(xml).toContain('<name>Origin Station</name>');
      expect(xml).toContain('<name>Destination Station</name>');
    } finally {
      unlinkSync(path);
    }
  });

  it('skips train <trkseg> when station coordinates are missing', () => {
    const path = tmpGpxPath();
    try {
      const r: PlanResult = {
        query: {
          from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.65, lon: 144.95 },
          minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
          enrich: false, preferBikePath: false,
          hillWeight: 0, goal: 'commute', mode: 'bike-train',
        },
        itineraries: [{
          labels: ['recommended'],
          totalTimeMin: 30, bikeKm: 0, bikeMin: 0,
          trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
          legs: [{
            mode: 'train',
            routeId: 6, routeType: 0, routeName: 'X',
            fromStopId: 1, toStopId: 2,
            fromStopName: 'A', toStopName: 'B',
            // fromLat/fromLon/toLat/toLon all undefined
            departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
            runRef: 'R1',
          }],
        }],
      };
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      expect((xml.match(/<trkseg>/g) ?? []).length).toBe(0);
      expect((xml.match(/<wpt /g) ?? []).length).toBe(0);
      // The empty <trk> is still emitted; that's fine — GPX permits it.
      expect(xml).toContain('<trk>');
    } finally {
      unlinkSync(path);
    }
  });

  it('XML-escapes station names containing ampersand', () => {
    const path = tmpGpxPath();
    try {
      const r: PlanResult = {
        query: {
          from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.65, lon: 144.95 },
          minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
          enrich: false, preferBikePath: false,
          hillWeight: 0, goal: 'commute', mode: 'bike-train',
        },
        itineraries: [{
          labels: ['recommended'],
          totalTimeMin: 30, bikeKm: 0, bikeMin: 0,
          trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
          legs: [{
            mode: 'train',
            routeId: 6, routeType: 0, routeName: 'Lilydale & Belgrave',
            fromStopId: 1, toStopId: 2,
            fromStopName: 'Mont Albert & Mont Albert North', toStopName: 'Flinders',
            fromLat: -37.77, fromLon: 144.96,
            toLat: -37.65, toLon: 144.95,
            departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
            runRef: 'R1',
          }],
        }],
      };
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      expect(xml).toContain('Mont Albert &amp; Mont Albert North');
      expect(xml).toContain('Lilydale &amp; Belgrave');
      // The raw '&' must not appear adjacent to a literal name fragment.
      expect(xml).not.toMatch(/Mont Albert & Mont Albert/);
    } finally {
      unlinkSync(path);
    }
  });

  it('emits two <trk> blocks for two labeled itineraries, names from labels', () => {
    const baseLeg = {
      mode: 'bike' as const,
      from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.97 },
      km: 1, min: 5,
      geometry: { type: 'LineString' as const,
        coordinates: [[144.96, -37.78], [144.97, -37.77]] as [number, number][] },
    };
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.97 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
        hillWeight: 0, goal: 'commute', mode: 'bike-only',
      },
      itineraries: [
        // Note: fastest is faster (15 min < 20 min), so it should sort first in output.
        {
          labels: ['recommended'], totalTimeMin: 20,
          bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [baseLeg],
        },
        {
          labels: ['fastest'], totalTimeMin: 15,
          bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [baseLeg],
        },
      ],
    };
    const path = tmpGpxPath();
    try {
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      expect((xml.match(/<trk>/g) ?? []).length).toBe(2);
      expect(xml).toContain('<name>fastest</name>');
      expect(xml).toContain('<name>recommended</name>');
      // Sort order: fastest (15 min) appears before recommended (20 min).
      expect(xml.indexOf('<name>fastest</name>'))
        .toBeLessThan(xml.indexOf('<name>recommended</name>'));
    } finally {
      unlinkSync(path);
    }
  });

  it('uses query.departUtc as the metadata <time> when set', () => {
    const r = bikeOnlyResult();
    r.query.departUtc = new Date('2026-05-18T08:00:00Z');
    const path = tmpGpxPath();
    try {
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      expect(xml).toContain('<time>2026-05-18T08:00:00.000Z</time>');
    } finally {
      unlinkSync(path);
    }
  });

  it('deduplicates <wpt> markers when multiple itineraries cross the same station', () => {
    const trainLeg = {
      mode: 'train' as const,
      routeId: 6, routeType: 0 as const, routeName: 'X',
      fromStopId: 1, toStopId: 2,
      fromStopName: 'Hub Station', toStopName: 'Destination Station',
      fromLat: -37.77, fromLon: 144.96,
      toLat: -37.65, toLon: 144.95,
      departUtc: '2026-05-17T10:00:00Z', arriveUtc: '2026-05-17T10:20:00Z',
      runRef: 'R1',
    };
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.65, lon: 144.95 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
        hillWeight: 0, goal: 'commute', mode: 'bike-train',
      },
      itineraries: [
        {
          labels: ['recommended'],
          totalTimeMin: 60, bikeKm: 0, bikeMin: 0,
          trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
          legs: [trainLeg],
        },
        {
          labels: ['fastest'],
          totalTimeMin: 55, bikeKm: 0, bikeMin: 0,
          trainKm: 10, trainMin: 20, waitMin: 5, transfers: 0,
          legs: [trainLeg],
        },
      ],
    };
    const path = tmpGpxPath();
    try {
      writeGpx(path, r);
      const xml = readFileSync(path, 'utf8');
      // Both itineraries crossed the same two stations; we want one <wpt> per station.
      expect((xml.match(/<wpt /g) ?? []).length).toBe(2);
      expect((xml.match(/<name>Hub Station<\/name>/g) ?? []).length).toBe(1);
      expect((xml.match(/<name>Destination Station<\/name>/g) ?? []).length).toBe(1);
    } finally {
      unlinkSync(path);
    }
  });
});

describe('buildGpxXml()', () => {
  it('returns a well-formed GPX string with one <trk> per labeled itinerary', () => {
    const result = bikeOnlyResult();
    const xml = buildGpxXml(result);
    expect(xml.startsWith('<?xml ')).toBe(true);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<metadata><time>');
    const trkCount = (xml.match(/<trk>/g) || []).length;
    const labeledCount = result.itineraries.filter((i) => i.labels.length > 0).length;
    expect(trkCount).toBe(labeledCount);
  });

  it('returns a well-formed GPX string with no <trk> when all itineraries are unlabeled', () => {
    const xml = buildGpxXml({ query: bikeOnlyResult().query, itineraries: [] });
    expect(xml.startsWith('<?xml ')).toBe(true);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<metadata><time>');
    expect(xml).not.toContain('<trk>');
  });

  it('returns a GPX string with multiple <trk> blocks for multiple labeled itineraries', () => {
    const baseLeg = {
      mode: 'bike' as const,
      from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.97 },
      km: 1, min: 5,
      geometry: { type: 'LineString' as const,
        coordinates: [[144.96, -37.78], [144.97, -37.77]] as [number, number][] },
    };
    const r: PlanResult = {
      query: {
        from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.77, lon: 144.97 },
        minBikeKm: 0, maxBikeKm: 10, maxTransfers: 0,
        enrich: false, preferBikePath: false,
        hillWeight: 0, goal: 'commute', mode: 'bike-only',
      },
      itineraries: [
        {
          labels: ['recommended'], totalTimeMin: 20,
          bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [baseLeg],
        },
        {
          labels: ['fastest'], totalTimeMin: 15,
          bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
          legs: [baseLeg],
        },
      ],
    };
    const xml = buildGpxXml(r);
    expect((xml.match(/<trk>/g) || []).length).toBe(2);
    expect(xml).toContain('<name>fastest</name>');
    expect(xml).toContain('<name>recommended</name>');
    // Verify sort order: fastest (15 min) before recommended (20 min).
    expect(xml.indexOf('<name>fastest</name>'))
      .toBeLessThan(xml.indexOf('<name>recommended</name>'));
  });
});
