import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeGeocodeTool } from '../../../../src/chat/tools/geocode';
import { parsePhotonFeatures } from '../../../../src/server/photon';
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
      confident: true,
    });
  });

  it('returns {ok:false} on no match (Nominatim only)', async () => {
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim);
    const out = (await t.handler({ query: 'xyzzy' })) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^No match for "xyzzy"\./);
  });

  // Photon's alt_name matching still earns its keep, but the words it matched
  // ("CERES") no longer cover the query, so the hit is corroborated against
  // Nominatim before being returned — and returned flagged when nothing
  // corroborates it. Photon cannot distinguish this good rescue from the bad
  // one in ptv-qjz, so the caller is told rather than guessed at.
  it('keeps a fuzzy Photon alt-name hit, flagged, once Nominatim adds nothing', async () => {
    const photon = {
      search: vi.fn().mockResolvedValue([
        { label: 'CERES Community Gardens, Brunswick East', lat: -37.77, lon: 144.99 },
      ]),
    } as any;
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);
    const out = (await t.handler({ query: 'CERES Environmental Park' })) as any;
    expect(photon.search).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({
      ok: true,
      lat: -37.77,
      lon: 144.99,
      displayName: 'CERES Community Gardens, Brunswick East',
      source: 'photon',
      confident: false,
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
    const out = (await t.handler({ query: 'xyzzy nowhere' })) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^No match for "xyzzy nowhere"\./);
  });
});

// ---------------------------------------------------------------------------
// ptv-qjz / ptv-q97: Photon returns the right words in the wrong place.
// These drive the tool with VERBATIM recorded Photon payloads (see
// tests/fixtures/photon/) so the assertions are about real ranking, not a mock
// that agrees with itself.
// ---------------------------------------------------------------------------

function photonFixture(name: string) {
  const p = resolve(__dirname, '../../../fixtures/photon', `${name}.json`);
  return parsePhotonFeatures(JSON.parse(readFileSync(p, 'utf8')));
}

const photonFrom = (name: string) =>
  ({ search: vi.fn().mockResolvedValue(photonFixture(name)) }) as any;

describe('geocode tool — wrong-suburb and wrong-state results (ptv-qjz, ptv-q97)', () => {
  it('ptv-qjz: "St Kilda library" resolves in St Kilda, not Brunswick East', async () => {
    const photon = photonFrom('st-kilda-library');
    const nominatim = { search: vi.fn() } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);

    const out = (await t.handler({ query: 'St Kilda library' })) as any;

    expect(out.ok).toBe(true);
    expect(out.displayName).toContain('St Kilda');
    expect(out.displayName).not.toContain('Brunswick East');
    expect(out.lat).toBeLessThan(-37.85); // south-east of the CBD, not north
    expect(out.confident).toBe(true);
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('asks Photon for several candidates, not just the top one', async () => {
    const photon = photonFrom('st-kilda-library');
    const t = makeGeocodeTool(ctx, { search: vi.fn() } as any, photon);
    await t.handler({ query: 'St Kilda library' });
    expect(photon.search.mock.calls[0][1]).toBeGreaterThan(1);
  });

  it('ptv-q97: "Flinders Street Station" never returns the Townsville hit', async () => {
    const photon = photonFrom('flinders-street-station');
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);

    const out = (await t.handler({ query: 'Flinders Street Station' })) as any;

    expect(out.ok).toBe(false);
    expect(nominatim.search).toHaveBeenCalledTimes(1);
    // The error has to tell the model what to do instead — every model in the
    // eval suite detected the bad hit and none recovered from it.
    expect(out.error).toMatch(/search_stops/);
  });

  it('falls through to Nominatim when Photon is only a fuzzy word match', async () => {
    const photon = photonFrom('no-such-suburb');
    const nominatim = {
      search: vi.fn().mockResolvedValue([
        { label: 'Zzyzxville Library, VIC', lat: -37.9, lon: 145.1, rank: 30 },
      ]),
    } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);

    const out = (await t.handler({ query: 'library in Zzyzxville' })) as any;

    expect(nominatim.search).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, source: 'nominatim', confident: true });
  });

  it('returns the weak Photon hit flagged, when Nominatim has nothing better', async () => {
    const photon = photonFrom('no-such-suburb');
    const nominatim = { search: vi.fn().mockResolvedValue([]) } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);

    const out = (await t.handler({ query: 'library in Zzyzxville' })) as any;

    expect(out.ok).toBe(true);
    expect(out.confident).toBe(false);
    expect(out.note).toMatch(/suburb/i);
    expect(out.source).toBe('photon');
  });

  it('leaves an already-correct Photon answer alone', async () => {
    const photon = photonFrom('hurstbridge');
    const nominatim = { search: vi.fn() } as any;
    const t = makeGeocodeTool(ctx, nominatim, photon);

    const out = (await t.handler({ query: 'Hurstbridge' })) as any;

    expect(out).toMatchObject({ ok: true, source: 'photon', confident: true });
    expect(out.displayName).toContain('Hurstbridge');
    expect(nominatim.search).not.toHaveBeenCalled();
  });

  it('is stable when run twice', async () => {
    const t = makeGeocodeTool(ctx, { search: vi.fn() } as any, photonFrom('st-kilda-library'));
    const a = await t.handler({ query: 'St Kilda library' });
    const b = await t.handler({ query: 'St Kilda library' });
    expect(a).toEqual(b);
  });
});
