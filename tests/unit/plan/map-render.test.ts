import { describe, it, expect } from 'vitest';
import { readFileSync, unlinkSync } from 'fs';
import { renderMapInit, writeMapHtml } from '../../../src/plan/map';
import type { PlanResult } from '../../../src/plan/types';

const RESULT: PlanResult = {
  query: {
    from: { lat: -37.64, lon: 145.19 },
    to: { lat: -37.86, lon: 144.89 },
    minBikeKm: 0, maxBikeKm: 20, maxTransfers: 0, enrich: true,
    preferBikePath: false, hillWeight: 0, goal: 'commute', mode: 'bike-only',
  },
  itineraries: [{
    labels: ['recommended', 'fastest'],
    totalTimeMin: 60, bikeKm: 25, bikeMin: 60,
    trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
    legs: [{
      mode: 'bike',
      from: { lat: -37.64, lon: 145.19 },
      to: { lat: -37.86, lon: 144.89 },
      km: 25, min: 60,
      geometry: { type: 'LineString', coordinates: [[145.19, -37.64], [144.89, -37.86]] },
    }],
  }],
};

describe('renderMapInit()', () => {
  it('returns scriptBody and cssBody containing the embedded data + Leaflet init', () => {
    const out = renderMapInit(RESULT);
    expect(out.scriptBody).toContain('L.map');
    expect(out.scriptBody).toContain('"recommended"');
    expect(out.scriptBody).toContain('L.tileLayer');
    expect(out.cssBody).toContain('.legend');
  });
});

describe('writeMapHtml() — parity', () => {
  it('produces a full HTML document containing the same embedded data + Leaflet init', () => {
    const tmp = `/tmp/ptv-map-test-${Date.now()}-${Math.floor(Math.random()*1e6)}.html`;
    writeMapHtml(tmp, RESULT);
    try {
      const html = readFileSync(tmp, 'utf8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('L.map');
      expect(html).toContain('"recommended"');
      expect(html).toContain('leaflet@1.9.4/dist/leaflet.css');
      expect(html).toContain('<style>');
      expect(html).toContain('<div id="map"></div>');
    } finally {
      try { unlinkSync(tmp); } catch { /* ignore */ }
    }
  });
});
