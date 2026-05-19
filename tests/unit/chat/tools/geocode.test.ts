import { describe, it, expect, vi } from 'vitest';
import { makeGeocodeTool } from '../../../../src/chat/tools/geocode';
import type { ChatCtx } from '../../../../src/chat/types';

const ctx: ChatCtx = { emit: vi.fn() };

describe('geocode tool', () => {
  it('uses Nominatim only when Photon is not configured', async () => {
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
      source: 'nominatim',
    });
  });

  it('returns {ok:false} on no match (Nominatim only)', async () => {
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim);
    const out = await t.handler({ query: 'xyzzy' });
    expect(out).toEqual({ ok: false, error: 'No match for "xyzzy"' });
  });

  it('prefers Photon when it has a hit; does not call Nominatim', async () => {
    const photon = {
      search: vi.fn().mockResolvedValue([
        { label: 'CERES Community Gardens, Brunswick East', lat: -37.77, lon: 144.99 },
      ]),
    } as any;
    const nominatim = { search: vi.fn() } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);
    const out = await t.handler({ query: 'CERES Environmental Park' });
    expect(photon.search).toHaveBeenCalledTimes(1);
    expect(nominatim.search).not.toHaveBeenCalled();
    expect(out).toEqual({
      ok: true,
      lat: -37.77,
      lon: 144.99,
      displayName: 'CERES Community Gardens, Brunswick East',
      source: 'photon',
    });
  });

  it('falls back to Nominatim when Photon returns nothing', async () => {
    const photon = { search: vi.fn().mockResolvedValue([]) } as any;
    const nominatim = {
      search: vi.fn().mockResolvedValue([
        { label: 'Some Address, VIC', lat: -37.8, lon: 145.0, rank: 30 },
      ]),
    } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);
    const out = await t.handler({ query: 'something obscure' });
    expect(photon.search).toHaveBeenCalledTimes(1);
    expect(nominatim.search).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, source: 'nominatim', displayName: 'Some Address, VIC' });
  });

  it('returns ok:false when both Photon and Nominatim miss', async () => {
    const photon = { search: vi.fn().mockResolvedValue([]) } as any;
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);
    const out = await t.handler({ query: 'xyzzy nowhere' });
    expect(out).toEqual({ ok: false, error: 'No match for "xyzzy nowhere"' });
  });
});
