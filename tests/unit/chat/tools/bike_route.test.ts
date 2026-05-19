import { describe, it, expect, vi } from 'vitest';
import { makeBikeRouteTool } from '../../../../src/chat/tools/bike_route';
import type { ChatCtx, SseEvent } from '../../../../src/chat/types';

describe('bike_route tool', () => {
  it('emits a path_add with a synthesized itinerary and returns route metrics', async () => {
    const events: SseEvent[] = [];
    const ctx: ChatCtx = { emit: (e) => events.push(e) };
    const bikeFn = vi.fn().mockResolvedValue({
      km: 22.4, min: 70, kmOnPath: 18.7,
      ascendM: 180, descendM: 160,
      maxSustainedGradePercent: 4.2, maxSustainedGradeM: 50,
      flatFraction: 0.7, steepFraction: 0.05,
      geometry: { type: 'LineString', coordinates: [[144.96, -37.8], [145.19, -37.74]] },
    });
    const t = makeBikeRouteTool(ctx, bikeFn, () => 'b1');
    const out = await t.handler({
      from: { lat: -37.8, lon: 144.96 },
      to: { lat: -37.74, lon: 145.19 },
      goal: 'day-ride',
    });
    expect(bikeFn).toHaveBeenCalledWith(
      { lat: -37.8, lon: 144.96 },
      { lat: -37.74, lon: 145.19 },
      'day-ride',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'path_add', pathId: 'b1', label: 'bike (day-ride)',
    });
    expect(out).toEqual({
      ok: true,
      km: 22.4, min: 70, kmOnPath: 18.7,
      ascendM: 180, descendM: 160,
      maxSustainedGradePercent: 4.2, maxSustainedGradeM: 50,
      flatFraction: 0.7, steepFraction: 0.05,
    });
  });

  it('returns ok:false when bikeFn returns null (no route)', async () => {
    const ctx: ChatCtx = { emit: vi.fn() };
    const bikeFn = vi.fn().mockResolvedValue(null);
    const t = makeBikeRouteTool(ctx, bikeFn, () => 'b1');
    const out = await t.handler({
      from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 }, goal: 'commute',
    });
    expect(out).toEqual({ ok: false, error: 'No route found' });
  });
});
