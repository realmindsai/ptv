import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerHealth } from '../../../src/chat/routes/health';
import { createChatApp } from '../../../src/chat/server';

describe('GET /healthz', () => {
  it('returns ok with uptime', async () => {
    const app = Fastify({ logger: false });
    registerHealth(app);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    await app.close();
  });
});

describe('createChatApp', () => {
  it('creates an app with /healthz wired', async () => {
    const app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('POST /api/chat', () => {
  it('streams events from a fake runTurn', async () => {
    const fakeRunTurn = async function* () {
      yield { type: 'turn_start' };
      yield { type: 'text_delta', delta: 'hi' };
      yield { type: 'turn_end' };
    };
    const app = createChatApp({
      logger: false,
      runTurnFn: fakeRunTurn as any,
      buildTools: () => ({}) as any,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.body).toContain(`data: {"type":"turn_start"}\n\n`);
    expect(res.body).toContain(`data: {"type":"text_delta","delta":"hi"}\n\n`);
    expect(res.body).toContain(`data: {"type":"turn_end"}\n\n`);
    await app.close();
  });

  it('emits an emit-fired path_add event via ctx.emit even when runTurn does not yield it', async () => {
    // Tools fire path_add via ctx.emit (side-channel); runTurn never yields one itself.
    // Confirm that ctx.emit threads through to the SSE response.
    const fakeRunTurn = async function* ({}: any, opts: any) {
      opts.tools.geocode?.(); // call a "tool" that emits via ctx
      yield { type: 'turn_end' };
    };
    const app = createChatApp({
      logger: false,
      runTurnFn: fakeRunTurn as any,
      buildTools: (ctx) => ({
        // Each "tool" here is just a function for the test; in production it's a {handler} bag.
        geocode: () => ctx.emit({
          type: 'path_add', pathId: 'p1', label: 'demo', color: '#fff',
          itinerary: { legs: [] } as any,
        }),
      }) as any,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.body).toContain(`"type":"path_add"`);
    await app.close();
  });
});
