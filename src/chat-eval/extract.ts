import type { SseEvent } from '../chat/types';
import type { Leg, TrainLeg } from '../plan/types';

export interface ExtractedLeg {
  mode: 'bike' | 'train';
  fromName: string;
  toName: string;
  km?: number;
  min?: number;
  /** Leaflet-style [[lat, lon], ...]. Empty for train legs without station coords. */
  latlngs: Array<[number, number]>;
}

export interface ExtractedItinerary {
  label: string;
  color: string;
  totalTimeMin: number;
  legs: ExtractedLeg[];
}

function fmtLatLon(p: { lat: number; lon: number }): string {
  return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

function extractLeg(leg: Leg): ExtractedLeg {
  if (leg.mode === 'bike') {
    const coords = leg.geometry?.coordinates ?? [];
    const latlngs = coords.map(([lon, lat]) => [lat, lon] as [number, number]);
    return {
      mode: 'bike',
      fromName: fmtLatLon(leg.from),
      toName: fmtLatLon(leg.to),
      km: leg.km,
      min: leg.min,
      latlngs,
    };
  }
  const t = leg as TrainLeg;
  const latlngs: Array<[number, number]> =
    t.fromLat != null && t.fromLon != null && t.toLat != null && t.toLon != null
      ? [[t.fromLat, t.fromLon], [t.toLat, t.toLon]]
      : [];
  return {
    mode: 'train',
    fromName: t.fromStopName,
    toName: t.toStopName,
    latlngs,
  };
}

export function extractItineraries(events: SseEvent[]): ExtractedItinerary[] {
  const adds = events.filter((e): e is Extract<SseEvent, { type: 'path_add' }> => e.type === 'path_add');
  return adds.map((ev) => ({
    label: ev.label,
    color: ev.color,
    totalTimeMin: ev.itinerary.totalTimeMin,
    legs: ev.itinerary.legs.map(extractLeg),
  }));
}
