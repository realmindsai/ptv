import { describe, it, expect, vi } from 'vitest';
import { makeGeocodeTool } from '../../../../src/chat/tools/geocode';
import type { ChatCtx } from '../../../../src/chat/types';

const ctx: ChatCtx = { emit: vi.fn() };

describe('geocode tool', () => {
  it('returns lat/lon + displayName on hit', async () => {
    const nominatim = {
      search: vi.fn().mockResolvedValue([
        { label: 'Hurstbridge, VIC', lat: -37.74, lon: 145.19, rank: 22 },
      ]),
    } as any;
    const t = makeGeocodeTool(ctx, nominatim);
    const out = await t.handler({ query: 'Hurstbridge' });
    expect(out).toEqual({
      ok: true,
      lat: -37.74,
      lon: 145.19,
      displayName: 'Hurstbridge, VIC',
    });
  });

  it('returns {ok:false} on no match', async () => {
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim);
    const out = await t.handler({ query: 'xyzzy' });
    expect(out).toEqual({ ok: false, error: 'No match for "xyzzy"' });
  });
});
