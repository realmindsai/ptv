import { describe, it, expect, vi } from 'vitest';
import { makePlanTool } from '../../../../src/chat/tools/plan';
import type { ChatCtx, SseEvent } from '../../../../src/chat/types';

describe('plan tool', () => {
  it('emits one path_add per itinerary and returns a compact summary', async () => {
    const events: SseEvent[] = [];
    const ctx: ChatCtx = { emit: (e) => events.push(e) };
    const planFn = vi.fn().mockResolvedValue({
      query: {} as any,
      itineraries: [
        {
          labels: ['recommended'], totalTimeMin: 65, bikeKm: 14, bikeMin: 50,
          bikeKmOnPath: 12, trainKm: 4, trainMin: 10, waitMin: 5,
          transfers: 0, legs: [],
        },
        {
          labels: ['fastest'], totalTimeMin: 55, bikeKm: 6, bikeMin: 25,
          bikeKmOnPath: 4, trainKm: 10, trainMin: 25, waitMin: 5,
          transfers: 1, legs: [],
        },
      ],
    });
    const t = makePlanTool(ctx, planFn, () => 'fixed-id');
    const out = await t.handler({
      from: { lat: -37.8, lon: 144.96 },
      to: { lat: -37.74, lon: 145.19 },
    });

    const paths = events.filter(e => e.type === 'path_add');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ type: 'path_add', label: 'recommended' });

    expect(out).toEqual({
      ok: true,
      itineraryCount: 2,
      summaries: [
        { label: 'recommended', totalTimeMin: 65, bikeKm: 14, trainKm: 4, transfers: 0, bikeKmOnPath: 12 },
        { label: 'fastest',     totalTimeMin: 55, bikeKm: 6,  trainKm: 10, transfers: 1, bikeKmOnPath: 4  },
      ],
    });
  });

  it('returns ok:false with empty result', async () => {
    const ctx: ChatCtx = { emit: vi.fn() };
    const planFn = vi.fn().mockResolvedValue({ query: {} as any, itineraries: [] });
    const t = makePlanTool(ctx, planFn, () => 'id');
    const out = await t.handler({
      from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 },
    });
    expect(out).toEqual({ ok: false, error: 'No itineraries found' });
  });

  it('filters out unlabeled candidates (labelAndSort leftovers), only emits finalists', async () => {
    const events: SseEvent[] = [];
    const ctx: ChatCtx = { emit: (e) => events.push(e) };
    const planFn = vi.fn().mockResolvedValue({
      query: {} as any,
      itineraries: [
        // Finalist:
        { labels: ['fastest'], totalTimeMin: 55, bikeKm: 8, bikeMin: 30, trainKm: 6,
          trainMin: 20, waitMin: 5, transfers: 0, legs: [] },
        // Unlabeled candidates (orchestrator leftovers — should NOT render):
        { labels: [], totalTimeMin: 70, bikeKm: 9,  bikeMin: 35, trainKm: 4, trainMin: 25, waitMin: 10, transfers: 1, legs: [] },
        { labels: [], totalTimeMin: 72, bikeKm: 10, bikeMin: 40, trainKm: 3, trainMin: 25, waitMin: 7,  transfers: 1, legs: [] },
        { labels: [], totalTimeMin: 80, bikeKm: 12, bikeMin: 50, trainKm: 2, trainMin: 20, waitMin: 10, transfers: 1, legs: [] },
      ],
    });
    const t = makePlanTool(ctx, planFn, () => 'id');
    const out = await t.handler({
      from: { lat: -37.8, lon: 144.96 }, to: { lat: -37.7, lon: 145.1 },
    });
    expect(events.filter(e => e.type === 'path_add')).toHaveLength(1);
    expect(out).toMatchObject({ ok: true, itineraryCount: 1 });
  });

  it('returns a feasibility-specific error when itineraries exist but none labeled', async () => {
    const ctx: ChatCtx = { emit: vi.fn() };
    const planFn = vi.fn().mockResolvedValue({
      query: {} as any,
      itineraries: [
        { labels: [], totalTimeMin: 200, bikeKm: 1, bikeMin: 5, trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0, legs: [] },
      ],
    });
    const t = makePlanTool(ctx, planFn, () => 'id');
    const out = await t.handler({ from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 } });
    expect(out).toEqual({ ok: false, error: 'No feasible itinerary matched the constraints' });
  });

  it('coerces maxTransfers=0 in bike-only mode (orchestrator invariant)', async () => {
    const ctx: ChatCtx = { emit: vi.fn() };
    const planFn = vi.fn().mockResolvedValue({ query: {} as any, itineraries: [] });
    const t = makePlanTool(ctx, planFn, () => 'id');
    await t.handler({
      from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 },
      mode: 'bike-only',
      maxTransfers: 1,  // should be coerced to 0
    });
    expect(planFn).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'bike-only',
      maxTransfers: 0,
    }));
  });
});
