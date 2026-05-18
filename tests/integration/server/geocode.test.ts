import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../../src/server/index';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{
      display_name: 'Hurstbridge, Vic',
      lat: '-37.64', lon: '145.19', place_rank: 18,
    }],
  }));
});

describe('GET /api/geocode', () => {
  it('returns JSON when Accept: application/json', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({
      method: 'GET', url: '/api/geocode?q=hurst',
      headers: { accept: 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].label).toContain('Hurstbridge');
    await app.close();
  });

  it('returns an HTML fragment when Accept: text/html', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({
      method: 'GET', url: '/api/geocode?q=hurst',
      headers: { accept: 'text/html' },
    });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Hurstbridge');
    expect(res.body).toMatch(/data-lat="-37\.64"/);
    await app.close();
  });

  it('returns empty results (200) for q shorter than 3 chars', async () => {
    // Was previously a 400 with Q_TOO_SHORT — that error fragment was sticky in
    // the suggest box on every keypress while typing/deleting under HTMX. Empty
    // 200 lets the dropdown clear cleanly instead.
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/api/geocode?q=hu' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [] });
    await app.close();
  });

  it('returns empty HTML fragment (200) for short q when Accept: text/html', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({
      method: 'GET', url: '/api/geocode?q=h',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<ul class="geocode-list"');
    expect(res.body).not.toContain('Q_TOO_SHORT');
    await app.close();
  });
});
