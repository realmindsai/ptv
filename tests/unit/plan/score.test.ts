import { describe, it, expect } from 'vitest';
import { labelAndSort } from '../../../src/plan/score';
import type { Itinerary, PlanRequest } from '../../../src/plan/types';

function makeReq(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    from: { lat: 0, lon: 0 },
    to: { lat: 0, lon: 0 },
    minBikeKm: 0, maxBikeKm: 20, maxTransfers: 0, enrich: true,
    preferBikePath: false,
    ...over,
  };
}

function it1(over: Partial<Itinerary> = {}): Itinerary {
  return {
    labels: [], totalTimeMin: 50, bikeKm: 8, bikeMin: 28,
    trainKm: 40, trainMin: 20, waitMin: 2, transfers: 0, legs: [],
    ...over,
  };
}

describe('labelAndSort()', () => {
  it('returns empty array for empty input', () => {
    expect(labelAndSort([], makeReq())).toEqual([]);
  });

  it('a single itinerary gets all four labels', () => {
    const out = labelAndSort([it1()], makeReq());
    expect(out).toHaveLength(1);
    expect(out[0].labels.sort()).toEqual(
      ['fastest', 'fewest-transfers', 'most-bike', 'recommended'].sort()
    );
  });

  it('two itineraries: fastest and most-bike split correctly', () => {
    const fast = it1({ totalTimeMin: 40, bikeKm: 5 });
    const bikey = it1({ totalTimeMin: 60, bikeKm: 12 });
    const out = labelAndSort([bikey, fast], makeReq());
    expect(out[0].totalTimeMin).toBe(40);
    expect(out[0].labels).toContain('fastest');
    expect(out[0].labels).toContain('recommended');
    expect(out[1].labels).toContain('most-bike');
  });

  it('dedupes identical itineraries by leg-equality and merges labels', () => {
    const a = it1({ totalTimeMin: 50, bikeKm: 8 });
    const b = it1({ totalTimeMin: 50, bikeKm: 8 });
    const out = labelAndSort([a, b], makeReq());
    expect(out).toHaveLength(1);
  });

  it('near-miss: when no itinerary meets minBikeKm, returns single closest with violation tag', () => {
    const a = it1({ totalTimeMin: 40, bikeKm: 5 });
    const b = it1({ totalTimeMin: 60, bikeKm: 6 });
    const out = labelAndSort([a, b], makeReq({ minBikeKm: 10 }));
    expect(out).toHaveLength(1);
    expect(out[0].constraintsViolated).toEqual(['min_bike_km']);
    expect(out[0].bikeKm).toBe(6); // closest to min by absolute distance
  });

  it('sort is stable: earliest arrival first', () => {
    const slow = it1({ totalTimeMin: 80, bikeKm: 8 });
    const med = it1({ totalTimeMin: 50, bikeKm: 8 });
    const fast = it1({ totalTimeMin: 30, bikeKm: 8 });
    const out = labelAndSort([slow, med, fast], makeReq());
    expect(out.map((i) => i.totalTimeMin)).toEqual([30, 50, 80]);
  });

  it('most-bike only assigned among itineraries satisfying minBikeKm', () => {
    const under = it1({ totalTimeMin: 30, bikeKm: 15 });
    const over = it1({ totalTimeMin: 60, bikeKm: 12 });
    // minBikeKm=10: both pass; most-bike → 15
    const out = labelAndSort([over, under], makeReq({ minBikeKm: 10 }));
    const winner = out.find((i) => i.labels.includes('most-bike'));
    expect(winner?.bikeKm).toBe(15);
  });

  it('assigns most-bike-path to itinerary with max bikeKmOnPath', () => {
    const a = it1({ totalTimeMin: 50, bikeKm: 10, bikeKmOnPath: 3 });
    const b = it1({ totalTimeMin: 60, bikeKm: 10, bikeKmOnPath: 7 });
    const c = it1({ totalTimeMin: 70, bikeKm: 10, bikeKmOnPath: 5 });
    const out = labelAndSort([a, b, c], makeReq());
    const winner = out.find((i) => i.labels.includes('most-bike-path'));
    expect(winner?.bikeKmOnPath).toBe(7);
  });

  it('does not assign most-bike-path when no itinerary has bikeKmOnPath', () => {
    const a = it1({ totalTimeMin: 50, bikeKm: 10 });
    const b = it1({ totalTimeMin: 60, bikeKm: 10 });
    const out = labelAndSort([a, b], makeReq());
    for (const it of out) {
      expect(it.labels).not.toContain('most-bike-path');
    }
  });

  it('--prefer-bike-path changes recommended to maximize path km', () => {
    // a: cost = 50 - 5*3 = 35
    // b: cost = 60 - 5*7 = 25  ← min
    // c: cost = 70 - 5*5 = 45
    const a = it1({ totalTimeMin: 50, bikeKm: 10, bikeKmOnPath: 3 });
    const b = it1({ totalTimeMin: 60, bikeKm: 10, bikeKmOnPath: 7 });
    const c = it1({ totalTimeMin: 70, bikeKm: 10, bikeKmOnPath: 5 });
    const out = labelAndSort([a, b, c], makeReq({ preferBikePath: true }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.bikeKmOnPath).toBe(7);
  });

  it('--prefer-bike-path falls back gracefully when no itinerary has bikeKmOnPath', () => {
    const a = it1({ totalTimeMin: 50, bikeKm: 10 });
    const b = it1({ totalTimeMin: 60, bikeKm: 10 });
    const out = labelAndSort([a, b], makeReq({ preferBikePath: true }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.totalTimeMin).toBe(50);
  });
});
