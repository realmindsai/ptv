import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Nominatim, type GeocodeResult } from '../../../src/server/nominatim';

describe('Nominatim', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('search() hits /search with countrycodes=au + Victoria viewbox (bounded)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        display_name: 'Hurstbridge, Shire of Nillumbik, Victoria',
        lat: '-37.64', lon: '145.19', place_rank: 18,
      }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const nom = new Nominatim('http://nominatim:8080');
    const results: GeocodeResult[] = await nom.search('hurstbridge', 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('hurstbridge');
    expect(url.searchParams.get('countrycodes')).toBe('au');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('viewbox')).toBeTruthy();
    expect(url.searchParams.get('bounded')).toBe('1');
    expect(url.searchParams.get('dedupe')).toBe('1');
    expect(results[0]).toEqual({
      label: 'Hurstbridge, Shire of Nillumbik, Victoria',
      lat: -37.64, lon: 145.19, rank: 18,
    });
  });

  it('reverse() hits /reverse and returns label or null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: '11 Melbourne Rd, Williamstown' }),
    }));
    const nom = new Nominatim('http://nominatim:8080');
    expect(await nom.reverse(-37.86, 144.89)).toBe('11 Melbourne Rd, Williamstown');
  });

  it('search() returns [] when fetch fails (degrade silently)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('econnrefused')));
    expect(await new Nominatim('http://x').search('foo')).toEqual([]);
  });
});
