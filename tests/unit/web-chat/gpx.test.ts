import { describe, it, expect } from 'vitest';
import { itineraryToGpx } from '../../../web-chat/src/gpx';

describe('itineraryToGpx', () => {
  it('writes one trkseg per leg with geometry, emitting <ele> when altitude is present', () => {
    const xml = itineraryToGpx({
      id: 'p1',
      label: 'fastest',
      color: '#e6194b',
      itinerary: {
        legs: [
          { mode: 'bike', geometry: { type: 'LineString', coordinates: [[144.9, -37.8, 25], [144.95, -37.75, 40]] } },
          { mode: 'train', geometry: { type: 'LineString', coordinates: [[144.95, -37.75], [145.0, -37.7]] } },
        ],
      },
    });
    expect(xml).toMatch(/<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toMatch(/<gpx version="1.1"/);
    expect(xml).toMatch(/<name>fastest<\/name>/);
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(xml).toMatch(/<trkpt lat="-37.8" lon="144.9"><ele>25<\/ele><\/trkpt>/);
    // Train leg coords have no altitude — should still emit the trkpt.
    expect(xml).toMatch(/<trkpt lat="-37.75" lon="144.95"><\/trkpt>/);
  });

  it('skips legs missing geometry', () => {
    const xml = itineraryToGpx({
      id: 'p2',
      label: 'recommended',
      color: '#3cb44b',
      itinerary: {
        legs: [
          { mode: 'bike', geometry: { type: 'LineString', coordinates: [[1, 2, 3], [4, 5, 6]] } },
          { mode: 'train' /* no geometry */ },
        ],
      },
    });
    expect(xml.match(/<trkseg>/g)).toHaveLength(1);
  });

  it('still produces a valid (empty) GPX when no legs have geometry', () => {
    const xml = itineraryToGpx({
      id: 'p3', label: 'x', color: '#fff',
      itinerary: { legs: [] },
    });
    expect(xml).toMatch(/<gpx /);
    expect(xml).not.toMatch(/<trkseg>/);
  });

  it('XML-escapes the route label', () => {
    const xml = itineraryToGpx({
      id: 'p4', label: 'a&b<c>', color: '#fff',
      itinerary: { legs: [{ mode: 'bike', geometry: { type: 'LineString', coordinates: [[1,2],[3,4]] } }] },
    });
    expect(xml).toMatch(/<name>a&amp;b&lt;c&gt;<\/name>/);
  });
});
