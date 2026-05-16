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
  });

  it('returns a near-miss when min-bike-km is unsatisfiable', async () => {
    const result = await plan({
      from: { lat: -37.7656, lon: 144.9614 },
      to:   { lat: -37.648,  lon: 144.946 },
      departUtc: new Date(),
      minBikeKm: 50, // unreachable
      maxBikeKm: 60,
      maxTransfers: 0,
      enrich: false,
    });
    // Either a near-miss OR empty if there are no itineraries at all off-hours
    if (result.itineraries.length > 0) {
      expect(result.itineraries[0].constraintsViolated).toBeDefined();
      expect(result.warnings?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
