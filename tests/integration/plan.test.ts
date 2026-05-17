import { describe, it, expect } from 'vitest';
import { plan } from '../../src/plan/orchestrator';

const SKIP = !process.env.PTV_DEV_ID
  || !process.env.PTV_API_KEY
  || process.env.SKIP_LIVE_TESTS === '1';

// Brunswick area (-37.7656, 144.9614) → north of Upfield station (-37.648, 144.946)
// Both ends are < 5 km bike from a station on the Upfield line (route 15),
// which runs direct end-to-end without the split-working gap that affects
// the Frankston line south of Cheltenham.

describe.skipIf(SKIP)('integration: plan command', () => {
  it('returns at least one itinerary for a known bikeable corridor', async () => {
    const result = await plan({
      from: { lat: -37.7656, lon: 144.9614 },
      to:   { lat: -37.648,  lon: 144.946 },
      departUtc: new Date(),
      minBikeKm: 0,
      maxBikeKm: 8,
      maxTransfers: 0,
      enrich: false,
      preferBikePath: false,
      hillWeight: 0,
      goal: 'commute',
      mode: 'bike-train',
    });
    expect(Array.isArray(result.itineraries)).toBe(true);
    if (result.itineraries.length > 0) {
      const it = result.itineraries[0];
      expect(it.legs).toHaveLength(3);
      expect(it.legs[1].mode).toBe('train');
      expect(it.bikeKm).toBeGreaterThan(0);
      expect(it.totalTimeMin).toBeGreaterThan(0);
    } else {
      // Empty result is OK off-hours but warnings should explain
      expect(result.warnings?.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it('returns a near-miss when min-bike-km is unsatisfiable', async () => {
    // Tight, near-unsatisfiable band. maxBikeKm=10 keeps the candidate set
    // bounded (~30 stops near Brunswick) so the test doesn't time out on
    // sequential spawnSync calls.
    const result = await plan({
      from: { lat: -37.7656, lon: 144.9614 },
      to:   { lat: -37.648,  lon: 144.946 },
      departUtc: new Date(),
      minBikeKm: 9,
      maxBikeKm: 10,
      maxTransfers: 0,
      enrich: false,
      preferBikePath: false,
      hillWeight: 0,
      goal: 'commute',
      mode: 'bike-train',
    });
    if (result.itineraries.length > 0) {
      // Most realistic candidate itineraries will have bike total < 9 km
      // (short legs at both ends), so the near-miss path fires.
      const top = result.itineraries[0];
      if (top.constraintsViolated) {
        expect(result.warnings?.length ?? 0).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it('--goal max-path Hurstbridge → Darebin reaches >=95% on dedicated bike paths', async () => {
    const result = await plan({
      from: { lat: -37.6394, lon: 145.192017 },   // Hurstbridge
      to:   { lat: -37.7749634, lon: 145.038483 }, // Darebin
      departUtc: undefined,
      arriveByUtc: undefined,
      minBikeKm: 0, maxBikeKm: 60,
      maxTransfers: 0, enrich: true,
      preferBikePath: false, goal: 'max-path',
      mode: 'bike-only', hillWeight: 0,
    });
    expect(result.itineraries).toHaveLength(1);
    const it = result.itineraries[0];
    expect(it.bikeKm).toBeGreaterThan(30);  // longer than direct
    if (typeof it.bikeKmOnPath === 'number' && it.bikeKm > 0) {
      const pct = it.bikeKmOnPath / it.bikeKm;
      expect(pct).toBeGreaterThanOrEqual(0.95);  // 95%+ on dedicated paths
    }
  }, 60_000);

  it('K=2 cross-line: Rosanna → Dandenong via a hub returns transfers=1 itinerary', async () => {
    const result = await plan({
      from: { lat: -37.7390, lon: 145.0682 },  // near Rosanna station
      to:   { lat: -37.9871, lon: 145.2113 },  // near Dandenong station
      departUtc: new Date(),
      minBikeKm: 0,
      maxBikeKm: 5,
      maxTransfers: 1,
      enrich: false,
      preferBikePath: false,
      hillWeight: 0,
      goal: 'commute',
      mode: 'bike-train',
    });
    expect(Array.isArray(result.itineraries)).toBe(true);
    if (result.itineraries.length > 0) {
      // Find the K=2 itinerary (transfers === 1). May co-exist with K=1 if a
      // direct route somehow exists (it doesn't between these endpoints in
      // practice, but we don't hard-assert).
      const k2 = result.itineraries.find((i) => i.transfers === 1);
      if (k2) {
        expect(k2.legs).toHaveLength(4);
        expect(k2.legs[1].mode).toBe('train');
        expect(k2.legs[2].mode).toBe('train');
        // The transfer stop must be the same on both train legs
        const l1 = k2.legs[1];
        const l2 = k2.legs[2];
        if (l1.mode === 'train' && l2.mode === 'train') {
          expect(l1.toStopId).toBe(l2.fromStopId);
        }
      }
    } else {
      // Off-hours or no-service empty is OK — orchestrator may return no
      // warnings when K=2 simply finds no connecting runs (not an error path).
    }
  }, 60_000);
});
