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
    expect($('input[name="origin-query"]').length).toBe(1);
    expect($('input[name="destination-query"]').length).toBe(1);
    expect($('.sheet--peek').length).toBe(1);       // bottom results sheet
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
    // #F26541 orange remains in the palette token block but the CTA button is gone
    await app.close();
  });

  it('serves the v2 shell — collapsing pill states, trip chips, FAB, params sheet shell', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    const $ = load(res.body);
    // collapsing pill state container
    expect($('#from-to-pill[data-state]').length).toBe(1);
    // pill-edit and pill-collapsed sub-views both rendered (CSS toggles visibility)
    expect($('.pill-edit').length).toBe(1);
    expect($('.pill-collapsed').length).toBe(1);
    // trip chips
    expect($('#trip-chips').length).toBe(1);
    expect($('#chip-when, #chip-goal, #chip-flags').length).toBe(3);
    // map FAB
    expect($('#fab-geolocate').length).toBe(1);
    // params sheet shell (hidden by default)
    expect($('#params-sheet[hidden]').length).toBe(1);
    // clear button moved into collapsed pill
    expect($('#clear-trip').length).toBe(1);
    // NO orange Plan CTA
    expect($('#plan-btn').length).toBe(0);
    expect($('.btn--cta').length).toBe(0);
    // adv-grid + details summary gone
    expect($('details summary').length).toBe(0);
    expect($('.adv-grid').length).toBe(0);
    expect($('.quick-row').length).toBe(0);
    // hidden inputs for params (synced from params-sheet)
    ['mode','goal','depart','arriveBy','minBikeKm','maxBikeKm','maxTransfers','hillWeight','minOnPathFraction','preferBikePath']
      .forEach((n) => expect($(`input[type=hidden][name="${n}"]`).length).toBe(1));
    await app.close();
  });
});
