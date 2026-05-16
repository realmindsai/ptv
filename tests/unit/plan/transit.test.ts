import { describe, it, expect, vi } from 'vitest';
import { departuresFrom } from '../../../src/plan/transit';

describe('departuresFrom()', () => {
  it('returns empty array when PTV reports no departures', async () => {
    const fakePtv = vi.fn(async () => ({ departures: [], runs: {}, stops: {} }));
    const out = await departuresFrom(1071, 0, new Date('2026-05-16T22:00:00Z'), 90, { ptv: fakePtv });
    expect(out).toEqual([]);
  });

  it('filters departures whose departure time is before notBefore', async () => {
    const fakePtv = vi.fn(async () => ({
      departures: [
        { route_id: 6, run_ref: 'R1',
          scheduled_departure_utc: '2026-05-16T22:00:00Z',
          estimated_departure_utc: '2026-05-16T22:01:00Z',
          stop_id: 1071 },
        { route_id: 6, run_ref: 'R2',
          scheduled_departure_utc: '2026-05-16T22:30:00Z',
          estimated_departure_utc: null,
          stop_id: 1071 },
      ],
      runs: {
        R1: { run_ref: 'R1', route_id: 6 },
        R2: { run_ref: 'R2', route_id: 6 },
      },
    }));
    const out = await departuresFrom(
      1071, 0, new Date('2026-05-16T22:15:00Z'), 90,
      { ptv: fakePtv },
    );
    expect(out.map((d) => d.runRef)).toEqual(['R2']);
  });

  it('uses estimated_departure_utc when present, else scheduled', async () => {
    const fakePtv = vi.fn(async () => ({
      departures: [
        { route_id: 6, run_ref: 'R1',
          scheduled_departure_utc: '2026-05-16T22:00:00Z',
          estimated_departure_utc: '2026-05-16T22:30:00Z',
          stop_id: 1071 },
      ],
      runs: { R1: { run_ref: 'R1', route_id: 6 } },
    }));
    const out = await departuresFrom(
      1071, 0, new Date('2026-05-16T22:10:00Z'), 90,
      { ptv: fakePtv },
    );
    expect(out).toHaveLength(1);
    expect(out[0].departUtc).toBe('2026-05-16T22:30:00Z');
  });

  it('populates routeName from the routes map keyed by route_id', async () => {
    const fakePtv = vi.fn(async () => ({
      departures: [
        { route_id: 6, run_ref: 'R1',
          scheduled_departure_utc: '2026-05-16T22:30:00Z',
          estimated_departure_utc: null,
          stop_id: 1071 },
      ],
      runs: { R1: { run_ref: 'R1', route_id: 6 } },
      routes: { 6: { route_id: 6, route_name: 'Frankston' } },
    }));
    const out = await departuresFrom(
      1071, 0, new Date('2026-05-16T22:10:00Z'), 90,
      { ptv: fakePtv },
    );
    expect(out).toHaveLength(1);
    expect(out[0].routeName).toBe('Frankston');
  });

  it('routeName falls back to empty string when routes map is missing', async () => {
    const fakePtv = vi.fn(async () => ({
      departures: [
        { route_id: 6, run_ref: 'R1',
          scheduled_departure_utc: '2026-05-16T22:30:00Z',
          estimated_departure_utc: null,
          stop_id: 1071 },
      ],
    }));
    const out = await departuresFrom(
      1071, 0, new Date('2026-05-16T22:10:00Z'), 90,
      { ptv: fakePtv },
    );
    expect(out[0].routeName).toBe('');
  });
});
