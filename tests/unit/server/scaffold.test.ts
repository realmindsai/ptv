import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('createApp()', () => {
  it('boots a Fastify instance that 404s unknown routes', async () => {
    const app = createApp();
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
