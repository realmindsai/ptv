import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/plan/transit', () => ({
  departuresFrom: vi.fn(),
  runPattern: vi.fn(),
}));

import { departuresFrom, runPattern } from '../../../../src/plan/transit';
import { makeScheduleTool } from '../../../../src/chat/tools/schedule';

describe('schedule tool', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns departures with Melbourne local times', async () => {
    (departuresFrom as any).mockResolvedValue([
      { routeId: 8, routeType: 0, routeName: 'Hurstbridge',
        runRef: '41677', departUtc: '2026-05-23T18:37:00Z', pattern: [] },
      { routeId: 8, routeType: 0, routeName: 'Hurstbridge',
        runRef: '41678', departUtc: '2026-05-23T19:07:00Z', pattern: [] },
    ]);
    const t = makeScheduleTool();
    const out = await t.handler({
      fromStopId: 1168,
      fromTime: '2026-05-24T04:00:00+10:00',
      windowMin: 180,
      routeType: 0,
      maxResults: 10,
    });
    expect(out).toMatchObject({
      ok: true,
      count: 2,
      departures: [
        expect.objectContaining({ departLocal: '04:37 (Sun)', route: 'Hurstbridge', runRef: '41677' }),
        expect.objectContaining({ departLocal: '05:07 (Sun)', route: 'Hurstbridge', runRef: '41678' }),
      ],
    });
    // No toStopId → no arriveLocal
    expect((out as any).departures[0].arriveLocal).toBeUndefined();
  });

  it('joins with pattern to add arriveLocal when toStopId is given, filtering wrong-direction runs', async () => {
    (departuresFrom as any).mockResolvedValue([
      { routeId: 8, routeType: 0, routeName: 'Hurstbridge',
        runRef: 'A', departUtc: '2026-05-23T18:37:00Z', pattern: [] },
      { routeId: 8, routeType: 0, routeName: 'Hurstbridge',
        runRef: 'B', departUtc: '2026-05-23T19:00:00Z', pattern: [] },
    ]);
    (runPattern as any).mockImplementation(async (ref: string) => {
      if (ref === 'A') {
        return [
          { stopId: 1168, arriveUtc: '2026-05-23T18:37:00Z' },  // Rosanna
          { stopId: 1071, arriveUtc: '2026-05-23T19:05:00Z' },  // Flinders
        ];
      }
      // run B goes the OTHER direction — Flinders before Rosanna; should be filtered.
      return [
        { stopId: 1071, arriveUtc: '2026-05-23T18:30:00Z' },
        { stopId: 1168, arriveUtc: '2026-05-23T19:00:00Z' },
      ];
    });
    const t = makeScheduleTool();
    const out = await t.handler({
      fromStopId: 1168,
      toStopId: 1071,
      fromTime: '2026-05-24T04:00:00+10:00',
      windowMin: 180,
      routeType: 0,
      maxResults: 10,
    });
    expect(out).toMatchObject({
      ok: true,
      count: 1,
      departures: [
        expect.objectContaining({
          departLocal: '04:37 (Sun)',
          arriveLocal: '05:05 (Sun)',
          durationMin: 28,
          runRef: 'A',
        }),
      ],
    });
  });

  it('returns ok:false when no departures in window', async () => {
    (departuresFrom as any).mockResolvedValue([]);
    const t = makeScheduleTool();
    const out = await t.handler({
      fromStopId: 1168,
      fromTime: '2026-05-24T04:00:00+10:00',
      windowMin: 180,
      routeType: 0,
      maxResults: 10,
    });
    expect(out).toEqual({ ok: false, error: 'No departures in that window' });
  });
});
