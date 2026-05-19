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
