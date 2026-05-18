// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { addRecent, listRecents, clearRecents, MAX_RECENTS } from '../../../src/server/static-assets/recents.js';

beforeEach(() => { localStorage.clear(); });

describe('addRecent / listRecents', () => {
  it('records a trip and lists it', () => {
    addRecent({
      origin: { lat: -37, lon: 144, label: 'a' },
      destination: { lat: -38, lon: 145, label: 'b' },
      totalTimeMin: 92, bikeKm: 16,
    });
    const recents = listRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0].origin.label).toBe('a');
  });

  it('deduplicates by coord pair, refreshing the timestamp', () => {
    addRecent({ origin: { lat: -37, lon: 144 }, destination: { lat: -38, lon: 145 }, totalTimeMin: 90 });
    addRecent({ origin: { lat: -37, lon: 144 }, destination: { lat: -38, lon: 145 }, totalTimeMin: 95 });
    const recents = listRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0].totalTimeMin).toBe(95);
  });

  it('caps at MAX_RECENTS, dropping the oldest', () => {
    for (let i = 0; i < MAX_RECENTS + 3; i++) {
      addRecent({
        origin: { lat: i, lon: 0 },
        destination: { lat: -i, lon: 0 },
        totalTimeMin: i,
      });
    }
    expect(listRecents()).toHaveLength(MAX_RECENTS);
  });
});

describe('clearRecents', () => {
  it('empties the store', () => {
    addRecent({ origin: { lat: 1, lon: 1 }, destination: { lat: 2, lon: 2 }, totalTimeMin: 10 });
    clearRecents();
    expect(listRecents()).toHaveLength(0);
  });
});
