import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('GET /static/*', () => {
  it('serves htmx.min.js with text/javascript', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/static/htmx.min.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body.length).toBeGreaterThan(1000);
    await app.close();
  });

  it('serves app.css', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/static/app.css' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/css/);
    expect(res.body).toContain('--rmai-purple');
    await app.close();
  });

  it('serves leaflet.css', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/static/leaflet.css' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/css/);
    await app.close();
  });
});
