import { describe, it, expect } from 'vitest';
import { extractItineraries } from '../../../src/chat-eval/extract';
import type { SseEvent } from '../../../src/chat/types';

const pathAdds: SseEvent[] = [
  {
    type: 'path_add', pathId: 'p1', label: 'recommended', color: '#e6194b',
    itinerary: {
      labels: ['recommended'], totalTimeMin: 30, bikeKm: 5, bikeMin: 20,
      trainKm: 8, trainMin: 12, waitMin: 5, transferDwellMin: 0, transfers: 0,
      legs: [
        { mode: 'bike', from: { lat: -37.8, lon: 144.97 }, to: { lat: -37.81, lon: 144.99 },
          km: 5, min: 20,
          geometry: { type: 'LineString', coordinates: [[144.97, -37.8], [144.98, -37.805], [144.99, -37.81]] } },
        { mode: 'train', routeId: 1, routeType: 0 as any, routeName: 'Lilydale',
          fromStopId: 1, toStopId: 2, fromStopName: 'Flinders Street', toStopName: 'Hawthorn',
          fromLat: -37.818, fromLon: 144.967, toLat: -37.822, toLon: 145.035,
          departUtc: '2026-05-24T08:00:00Z', arriveUtc: '2026-05-24T08:12:00Z', runRef: 'r1' },
      ],
    } as any,
  },
];

describe('extractItineraries', () => {
  it('returns one itinerary record per path_add event', () => {
    const out = extractItineraries(pathAdds);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('recommended');
    expect(out[0].color).toBe('#e6194b');
    expect(out[0].legs).toHaveLength(2);
  });

  it('converts bike leg GeoJSON [lon,lat] to Leaflet [lat,lon]', () => {
    const [it] = extractItineraries(pathAdds);
    const bike = it.legs[0];
    expect(bike.mode).toBe('bike');
    expect(bike.latlngs).toEqual([[-37.8, 144.97], [-37.805, 144.98], [-37.81, 144.99]]);
    expect(bike.fromName).toMatch(/-?37\./);
    expect(bike.toName).toMatch(/-?37\./);
  });

  it('uses station coords for train leg straight line', () => {
    const [it] = extractItineraries(pathAdds);
    const train = it.legs[1];
    expect(train.mode).toBe('train');
    expect(train.fromName).toBe('Flinders Street');
    expect(train.toName).toBe('Hawthorn');
    expect(train.latlngs).toEqual([[-37.818, 144.967], [-37.822, 145.035]]);
  });

  it('skips non-path_add events gracefully', () => {
    const mixed: SseEvent[] = [
      { type: 'turn_start' },
      ...pathAdds,
      { type: 'turn_end' },
    ];
    expect(extractItineraries(mixed)).toHaveLength(1);
  });

  it('omits train legs whose station coords are missing rather than emitting [[]] junk', () => {
    const noCoord: SseEvent[] = [{
      type: 'path_add', pathId: 'p2', label: 'fastest', color: '#3cb44b',
      itinerary: {
        labels: ['fastest'], totalTimeMin: 1, bikeKm: 0, bikeMin: 0,
        trainKm: 1, trainMin: 1, waitMin: 0, transferDwellMin: 0, transfers: 0,
        legs: [{
          mode: 'train', routeId: 1, routeType: 0 as any, routeName: 'X',
          fromStopId: 1, toStopId: 2, fromStopName: 'A', toStopName: 'B',
          departUtc: 'x', arriveUtc: 'y', runRef: 'r',
        }],
      } as any,
    }];
    const out = extractItineraries(noCoord);
    expect(out[0].legs[0].latlngs).toEqual([]);
  });
});
