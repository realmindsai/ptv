import { describe, it, expect } from 'vitest';
import { planCacheKey } from '../../../src/server/plan-cache-key';

describe('planCacheKey', () => {
  it('rounds coords to 5 dp (sub-meter precision)', () => {
    const a = planCacheKey({
      from: { lat: -37.64012345, lon: 145.1976543 },
      to:   { lat: -37.86,        lon: 144.89 },
      mode: 'bike-only', goal: 'commute',
    });
    const b = planCacheKey({
      from: { lat: -37.64012999, lon: 145.1976501 },
      to:   { lat: -37.86,        lon: 144.89 },
      mode: 'bike-only', goal: 'commute',
    });
    expect(a).toBe(b);
  });

  it('is independent of key order', () => {
    expect(planCacheKey({ mode: 'bike-only', goal: 'commute',
      from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 } }))
    .toBe(planCacheKey({ to: { lat: 1, lon: 1 }, from: { lat: 0, lon: 0 },
      goal: 'commute', mode: 'bike-only' }));
  });

  it('different inputs produce different keys', () => {
    expect(planCacheKey({ goal: 'commute' })).not.toBe(planCacheKey({ goal: 'day-ride' }));
  });
});
