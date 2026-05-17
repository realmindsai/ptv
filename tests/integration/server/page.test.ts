import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import { createApp } from '../../../src/server/index';

describe('GET /', () => {
  it('serves the Atlas shell with required structural elements', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    const $ = load(res.body);
    expect($('script[src*="htmx"]').length).toBeGreaterThan(0);
    expect($('link[href*="leaflet"]').length).toBeGreaterThan(0);
    expect($('link[href*="app.css"]').length).toBeGreaterThan(0);
    expect($('#map').length).toBe(1);
    expect($('.from-to-pill').length).toBe(1);
    expect($('input[name="from-query"]').length).toBe(1);
    expect($('input[name="to-query"]').length).toBe(1);
    expect($('.sheet').length).toBe(1);            // bottom sheet
    expect($('#results').length).toBe(1);          // results swap target
    expect($('form[hx-post*="/api/plan"]').length).toBe(1);
    await app.close();
  });

  it('embeds the Atlas palette token in CSS', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    // Either the token is inline in <style>, or it lives in app.css.
    // Verify by fetching app.css if /static/ is wired, otherwise verify inline.
    const res = await app.inject({ method: 'GET', url: '/' });
    const $ = load(res.body);
    // For Task 9 (before /static/ exists), embed the palette inline in <style>.
    expect(res.body).toContain('#A77ACD');         // lilac
    expect(res.body).toContain('#1A1B25');         // ink
    expect(res.body).toContain('#F26541');         // orange CTA
    await app.close();
  });
});
