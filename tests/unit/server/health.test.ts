import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('Atlas GET /readyz', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is 200 when Nominatim /status answers', async () => {
    const f = vi.fn(async () => new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const app = createApp({ logger: false, nominatimUrl: 'http://nom.example:8080', cache: null });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { nominatim: { ok: true } } });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('http://nom.example:8080/status');
    await app.close();
  });

  it('is 503 when Nominatim is unreachable, while /healthz stays 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const app = createApp({ logger: false, nominatimUrl: 'http://nom.example:8080', cache: null });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.nominatim).toEqual({ ok: false, reason: 'fetch failed' });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });

  it('is 503 on a non-2xx Nominatim /status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));
    const app = createApp({ logger: false, nominatimUrl: 'http://nom.example:8080', cache: null });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.json().checks.nominatim).toEqual({ ok: false, reason: 'nominatim /status returned 500' });
    await app.close();
  });
});
