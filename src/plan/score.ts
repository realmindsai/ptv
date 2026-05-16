import type { Itinerary, PlanRequest, ItineraryLabel } from './types';
import { PATH_BONUS_PER_KM } from './types';

function legsKey(it: Itinerary): string {
  return JSON.stringify([
    it.totalTimeMin,
    it.bikeKm,
    it.legs.map((l) =>
      l.mode === 'train'
        ? ['t', l.runRef, l.fromStopId, l.toStopId]
        : ['b', l.from.lat, l.from.lon, l.to.lat, l.to.lon, l.km],
    ),
  ]);
}

function feasible(it: Itinerary, req: PlanRequest): boolean {
  if (it.bikeKm < req.minBikeKm) return false;
  if (it.bikeKm > req.maxBikeKm) return false;
  if (req.minOnPathFraction !== undefined && req.minOnPathFraction > 0) {
    const onPathFraction = it.bikeKm > 0 && typeof it.bikeKmOnPath === 'number'
      ? it.bikeKmOnPath / it.bikeKm : 0;
    if (onPathFraction < req.minOnPathFraction) return false;
  }
  return true;
}

export function labelAndSort(items: Itinerary[], req: PlanRequest): Itinerary[] {
  if (items.length === 0) return [];

  const feasibleItems = items.filter((i) => feasible(i, req));

  if (feasibleItems.length === 0) {
    function onPathFraction(it: Itinerary): number {
      return it.bikeKm > 0 && typeof it.bikeKmOnPath === 'number'
        ? it.bikeKmOnPath / it.bikeKm : 0;
    }
    function violationDistance(a: Itinerary): number {
      let d = 0;
      if (a.bikeKm < req.minBikeKm) d += req.minBikeKm - a.bikeKm;
      if (a.bikeKm > req.maxBikeKm) d += a.bikeKm - req.maxBikeKm;
      if (req.minOnPathFraction !== undefined) {
        const f = onPathFraction(a);
        if (f < req.minOnPathFraction) d += (req.minOnPathFraction - f) * 10;
      }
      return d;
    }
    const closest = items.slice().sort((a, b) => violationDistance(a) - violationDistance(b))[0];
    const violations: Itinerary['constraintsViolated'] = [];
    if (closest.bikeKm < req.minBikeKm) violations.push('min_bike_km');
    if (closest.bikeKm > req.maxBikeKm) violations.push('max_bike_km');
    if (req.minOnPathFraction !== undefined && onPathFraction(closest) < req.minOnPathFraction) {
      violations.push('min_on_path_fraction');
    }
    return [{ ...closest, labels: ['fastest', 'recommended'], constraintsViolated: violations }];
  }

  const byKey = new Map<string, Itinerary>();
  for (const it of feasibleItems) {
    const k = legsKey(it);
    if (!byKey.has(k)) byKey.set(k, { ...it, labels: [] });
  }
  const deduped = Array.from(byKey.values());

  deduped.sort((a, b) => a.totalTimeMin - b.totalTimeMin);

  const fastest = deduped[0];
  const mostBike = deduped.reduce((m, i) => (i.bikeKm > m.bikeKm ? i : m));
  const fewestTransfers = deduped.reduce((m, i) =>
    i.transfers < m.transfers ? i : m,
  );

  const withPath = deduped.filter((i) => typeof i.bikeKmOnPath === 'number');
  const mostBikePath = withPath.length > 0
    ? withPath.reduce((m, i) =>
        ((i.bikeKmOnPath as number) > (m.bikeKmOnPath as number)
          || ((i.bikeKmOnPath as number) === (m.bikeKmOnPath as number) && i.bikeKm > m.bikeKm))
          ? i : m,
      )
    : null;

  let recommended: Itinerary;
  if (req.preferBikePath && withPath.length > 0) {
    const cost = (i: Itinerary): number =>
      i.totalTimeMin - PATH_BONUS_PER_KM * ((i.bikeKmOnPath as number) ?? 0);
    recommended = deduped.reduce((m, i) => (cost(i) < cost(m) ? i : m));
  } else {
    recommended = deduped.reduce((m, i) =>
      i.totalTimeMin < m.totalTimeMin ? i : m,
    );
  }

  function tag(it: Itinerary, label: ItineraryLabel): void {
    if (!it.labels.includes(label)) it.labels.push(label);
  }
  tag(fastest, 'fastest');
  tag(mostBike, 'most-bike');
  tag(fewestTransfers, 'fewest-transfers');
  tag(recommended, 'recommended');
  if (mostBikePath) tag(mostBikePath, 'most-bike-path');

  return deduped;
}
