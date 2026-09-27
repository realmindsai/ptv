import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import {
  registerHealth, openRouterCheck, loggingCheck, graphHopperCheck,
} from '../../../src/chat/routes/health';
import { createChatApp } from '../../../src/chat/server';
import { _resetPoolForTests } from '../../../src/chat/log/pool';

function fetchReturning(status: number) {
  return vi.fn(async () => new Response(JSON.stringify({}), { status }));
}

function queryable(ok: boolean) {
  return { query: vi.fn(async () => ({ rows: [{ ok }] })) };
}

async function appWith(checks: Parameters<typeof registerHealth>[1]) {
  const app = Fastify({ logger: false });
  registerHealth(app, checks);
  await app.ready();
  return app;
}

describe('openRouterCheck', () => {
  it('hits the free /key endpoint with the bearer key, never a completion', async () => {
    const f = fetchReturning(200);
    const check = openRouterCheck({ apiKey: 'sk-test', baseUrl: 'https://or.example/api/v1', fetchImpl: f as any });
    expect(await check.run()).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://or.example/api/v1/key');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('fails with the upstream status on 401', async () => {
    const check = openRouterCheck({ apiKey: 'sk-revoked', fetchImpl: fetchReturning(401) as any });
    expect(await check.run()).toEqual({ ok: false, reason: 'openrouter /key returned 401' });
  });

  it('fails without calling out when the key is unset', async () => {
    const f = fetchReturning(200);
    const check = openRouterCheck({ apiKey: undefined, fetchImpl: f as any });
    expect(await check.run()).toEqual({ ok: false, reason: 'OPENROUTER_API_KEY is not set' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('graphHopperCheck', () => {
  it('probes /health on the host GH_REST_URL points at, from outside graphhopper', async () => {
    const f = fetchReturning(200);
    const check = graphHopperCheck('http://graphhopper-vic-bike:8989/route', f as any);
    expect(await check.run()).toEqual({ ok: true });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('http://graphhopper-vic-bike:8989/health');
  });

  it('fails readiness with the network cause when graphhopper is unreachable (ptv-519)', async () => {
    // The shape Node's fetch really throws: a bare TypeError, reason on .cause.
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND graphhopper-vic-bike'), { code: 'ENOTFOUND' });
    const f = vi.fn(async () => { throw new TypeError('fetch failed', { cause }); });
    const app = await appWith([graphHopperCheck('http://graphhopper-vic-bike:8989/route', f as any)]);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.graphhopper).toEqual({
      ok: false, reason: 'fetch failed: getaddrinfo ENOTFOUND graphhopper-vic-bike (ENOTFOUND)',
    });
    await app.close();
  });

  it('fails on a non-2xx /health', async () => {
    expect(await graphHopperCheck('http://gh:8989/route', fetchReturning(503) as any).run())
      .toEqual({ ok: false, reason: 'graphhopper /health returned 503' });
  });
});

describe('loggingCheck', () => {
  it('passes when the role holds every privilege the writer needs', async () => {
    const q = queryable(true);
    expect(await loggingCheck(q).run()).toEqual({ ok: true });
    const sql = (q.query.mock.calls[0] as unknown as [string])[0];
    expect(sql).toMatch(/has_table_privilege\(current_user, 'public\.events', 'INSERT'\)/);
    expect(sql).toMatch(/has_table_privilege\(current_user, 'public\.conversations', 'INSERT'\)/);
  });

  it('fails when the role lacks a privilege', async () => {
    expect(await loggingCheck(queryable(false)).run()).toEqual({
      ok: false, reason: 'logging role lacks a privilege the writer needs (see src/chat/log/schema.sql)',
    });
  });

  it('fails, rather than crashing, when PTV_CHAT_PG_URL is unset', async () => {
    expect(await loggingCheck(null).run()).toEqual({ ok: false, reason: 'PTV_CHAT_PG_URL is not set' });
  });

  it('reports the SQLSTATE when the query itself errors', async () => {
    const err = Object.assign(new Error('relation "public.events" does not exist'), { code: '42P01' });
    const q = { query: vi.fn(async () => { throw err; }) };
    expect(await loggingCheck(q).run()).toEqual({
      ok: false, reason: 'relation "public.events" does not exist (SQLSTATE 42P01)',
    });
  });
});

describe('GET /healthz and /readyz', () => {
  it('readiness is 200 and liveness 200 when every check passes', async () => {
    const app = await appWith([
      openRouterCheck({ apiKey: 'k', fetchImpl: fetchReturning(200) as any }),
      loggingCheck(queryable(true)),
    ]);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      checks: { openrouter: { ok: true }, logging: { ok: true } },
    });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });

  it('readiness is 503 on an OpenRouter 401, liveness stays 200', async () => {
    const app = await appWith([
      openRouterCheck({ apiKey: 'k', fetchImpl: fetchReturning(401) as any }),
      loggingCheck(queryable(true)),
    ]);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().status).toBe('not_ready');
    expect(ready.json().checks.openrouter).toEqual({ ok: false, reason: 'openrouter /key returned 401' });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });

  it('readiness is 503 when the logging role lacks INSERT, liveness stays 200', async () => {
    const app = await appWith([
      openRouterCheck({ apiKey: 'k', fetchImpl: fetchReturning(200) as any }),
      loggingCheck(queryable(false)),
    ]);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.logging.ok).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });

  it('a check that hangs past its timeout fails readiness instead of hanging it', async () => {
    const hang = { name: 'slow', run: () => new Promise<never>(() => {}) };
    const app = Fastify({ logger: false });
    registerHealth(app, [hang], { timeoutMs: 20 });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.slow).toEqual({ ok: false, reason: 'timed out after 20ms' });
    await app.close();
  });
});

describe('createChatApp readiness wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    _resetPoolForTests();
  });

  it('empty PTV_CHAT_PG_URL and OPENROUTER_API_KEY give 503, never a crash', async () => {
    vi.stubEnv('PTV_CHAT_PG_URL', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const f = vi.fn(async () => new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', f);
    _resetPoolForTests();
    const app = createChatApp({ logger: false });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks).toMatchObject({
      openrouter: { ok: false, reason: 'OPENROUTER_API_KEY is not set' },
      logging:    { ok: false, reason: 'PTV_CHAT_PG_URL is not set' },
    });
    // graphhopper is the only check that still calls out, and only to /health.
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/\/health$/)]);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });
});
