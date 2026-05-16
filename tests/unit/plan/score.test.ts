import { describe, it, expect } from 'vitest';
import { labelAndSort } from '../../../src/plan/score';
import type { Itinerary, PlanRequest } from '../../../src/plan/types';

function makeReq(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    from: { lat: 0, lon: 0 },
    to: { lat: 0, lon: 0 },
    minBikeKm: 0, maxBikeKm: 20, maxTransfers: 0, enrich: true,
    preferBikePath: false, hillWeight: 0, goal: 'commute', mode: 'bike-train',
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

  it('--min-on-path-fraction filters out itineraries below threshold', () => {
    // 5km bike, 1km on path → 20% on path. With threshold 0.5, filtered.
    const a = it1({ totalTimeMin: 40, bikeKm: 5, bikeKmOnPath: 1 });
    // 5km bike, 4km on path → 80%, kept
    const b = it1({ totalTimeMin: 60, bikeKm: 5, bikeKmOnPath: 4 });
    const out = labelAndSort([a, b], makeReq({ minOnPathFraction: 0.5 }));
    expect(out).toHaveLength(1);
    expect(out[0].bikeKmOnPath).toBe(4);
  });

  it('--min-on-path-fraction near-miss when all filtered', () => {
    const a = it1({ totalTimeMin: 40, bikeKm: 5, bikeKmOnPath: 1 });
    const b = it1({ totalTimeMin: 60, bikeKm: 5, bikeKmOnPath: 1.5 });
    const out = labelAndSort([a, b], makeReq({ minOnPathFraction: 0.8 }));
    expect(out).toHaveLength(1);
    expect(out[0].constraintsViolated).toContain('min_on_path_fraction');
  });

  it('--hill-weight 0 (default) is neutral: recommended is still fastest', () => {
    const fast = it1({ totalTimeMin: 40, bikeKm: 5, ascendM: 200 });
    const hilly = it1({ totalTimeMin: 60, bikeKm: 5, ascendM: 500 });
    const out = labelAndSort([fast, hilly], makeReq({ hillWeight: 0 }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.totalTimeMin).toBe(40);
  });

  it('--hill-weight -1 prefers flat: recommended changes to flatter itinerary', () => {
    // fast: ascendM=300, flatFraction=0.2 → hilliness = 0.05*300 - 0.3*(100*0.2) = 15 - 6 = 9
    // flat: ascendM=50,  flatFraction=0.9 → hilliness = 0.05*50  - 0.3*(100*0.9) = 2.5 - 27 = -24.5
    // hillWeight=-1: cost(fast) = 40 - (-1)*9 = 49, cost(flat) = 60 - (-1)*(-24.5) = 35.5  ← min
    const fast = it1({ totalTimeMin: 40, bikeKm: 8, ascendM: 300, flatFraction: 0.2 });
    const flat = it1({ totalTimeMin: 60, bikeKm: 8, ascendM: 50,  flatFraction: 0.9 });
    const out = labelAndSort([fast, flat], makeReq({ hillWeight: -1 }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.totalTimeMin).toBe(60); // flat route preferred despite slower
  });

  it('--hill-weight +1 prefers hills: recommended changes to hillier itinerary', () => {
    // fast: ascendM=50,  flatFraction=0.9 → hilliness = 2.5 - 27 = -24.5
    // hilly: ascendM=300, flatFraction=0.2 → hilliness = 15 - 6 = 9
    // hillWeight=+1: cost(fast) = 40 - 1*(-24.5) = 64.5, cost(hilly) = 60 - 1*9 = 51  ← min
    const fast  = it1({ totalTimeMin: 40, bikeKm: 8, ascendM: 50,  flatFraction: 0.9 });
    const hilly = it1({ totalTimeMin: 60, bikeKm: 8, ascendM: 300, flatFraction: 0.2 });
    const out = labelAndSort([fast, hilly], makeReq({ hillWeight: 1 }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.totalTimeMin).toBe(60); // hilly route preferred despite slower
  });

  it('--hill-weight composes with --prefer-bike-path', () => {
    // a: time=50, pathKm=3, ascendM=300, flatFraction=0.2 → hilliness=9
    //    hillWeight=-1: cost = 50 - 5*3 - (-1)*9 = 50 - 15 + 9 = 44
    // b: time=60, pathKm=7, ascendM=50,  flatFraction=0.9 → hilliness=-24.5
    //    hillWeight=-1: cost = 60 - 5*7 - (-1)*(-24.5) = 60 - 35 - 24.5 = 0.5  ← min
    const a = it1({ totalTimeMin: 50, bikeKm: 10, bikeKmOnPath: 3, ascendM: 300, flatFraction: 0.2 });
    const b = it1({ totalTimeMin: 60, bikeKm: 10, bikeKmOnPath: 7, ascendM: 50,  flatFraction: 0.9 });
    const out = labelAndSort([a, b], makeReq({ preferBikePath: true, hillWeight: -1 }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.bikeKmOnPath).toBe(7); // flat + more path wins
  });

  it('--hill-weight falls back gracefully when elevation data absent', () => {
    // No ascendM / flatFraction / maxSustainedGradePercent on either — hilliness=0 for both
    // hillWeight=-5 but hilliness=0, so cost == totalTimeMin → fastest wins
    const fast = it1({ totalTimeMin: 40, bikeKm: 8 });
    const slow = it1({ totalTimeMin: 60, bikeKm: 8 });
    const out = labelAndSort([fast, slow], makeReq({ hillWeight: -5 }));
    const recommended = out.find((i) => i.labels.includes('recommended'));
    expect(recommended?.totalTimeMin).toBe(40);
  });
});
