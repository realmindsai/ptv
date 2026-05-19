import { describe, it, expect } from 'vitest';
import { polylinesFromItinerary } from '../../../web-chat/src/map';

describe('polylinesFromItinerary', () => {
  it('extracts every leg geometry, flipping [lon,lat] -> [lat,lon]', () => {
    const it = {
      legs: [
        { mode: 'bike',  geometry: { type: 'LineString', coordinates: [[144.9, -37.8], [145.0, -37.74]] }},
        { mode: 'train', geometry: { type: 'LineString', coordinates: [[145.0, -37.74], [145.2, -37.7]] }},
      ],
    };
    expect(polylinesFromItinerary(it as any)).toEqual([
      [[-37.8, 144.9], [-37.74, 145.0]],
      [[-37.74, 145.0], [-37.7, 145.2]],
    ]);
  });

  it('skips legs without geometry', () => {
    const it = {
      legs: [
        { mode: 'bike',  geometry: { type: 'LineString', coordinates: [[144.9, -37.8], [145.0, -37.74]] }},
        { mode: 'train' /* no geometry */ },
        { mode: 'bike',  geometry: null },
      ],
    };
    expect(polylinesFromItinerary(it as any)).toEqual([
      [[-37.8, 144.9], [-37.74, 145.0]],
    ]);
  });

  it('returns [] for an itinerary with no legs', () => {
    expect(polylinesFromItinerary({ legs: [] } as any)).toEqual([]);
  });

  it('returns [] when legs is missing', () => {
    expect(polylinesFromItinerary({} as any)).toEqual([]);
  });

  it('skips polylines with < 2 points', () => {
    const it = { legs: [{ mode: 'bike', geometry: { type: 'LineString', coordinates: [[144.9, -37.8]] }}] };
    expect(polylinesFromItinerary(it as any)).toEqual([]);
  });
});
