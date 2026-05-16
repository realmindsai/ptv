import { describe, it, expect } from 'vitest';
import { HUB_STOP_IDS, isHub } from '../../../src/plan/hubs';

describe('hubs', () => {
  it('HUB_STOP_IDS has exactly 13 entries', () => {
    expect(HUB_STOP_IDS).toHaveLength(13);
  });

  it('HUB_STOP_IDS has no duplicates', () => {
    expect(new Set(HUB_STOP_IDS).size).toBe(HUB_STOP_IDS.length);
  });

  it('isHub returns true for IDs in the list', () => {
    for (const id of HUB_STOP_IDS) {
      expect(isHub(id)).toBe(true);
    }
  });

  it('isHub returns false for IDs not in the list', () => {
    const unknown = Math.max(...HUB_STOP_IDS) + 99999;
    expect(isHub(unknown)).toBe(false);
    expect(isHub(0)).toBe(false);
    expect(isHub(-1)).toBe(false);
  });
});
