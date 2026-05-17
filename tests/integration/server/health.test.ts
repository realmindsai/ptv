import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('GET /healthz', () => {
  it('returns 200 with status ok and uptime', async () => {
    const app = createApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    await app.close();
  });
});
