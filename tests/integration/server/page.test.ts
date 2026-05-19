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
    expect($('section.sheet#sheet').length).toBe(1);     // unified sheet
    expect($('#results').length).toBe(1);                 // htmx swap target
    expect($('form[hx-post*="/api/plan"]').length).toBe(1);
    await app.close();
  });

  it('embeds the Atlas palette token in CSS', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('#A77ACD');
    expect(res.body).toContain('#1A1B25');
    await app.close();
  });

  it('serves the v3 shell — unified sheet, four accordions, four chips, no params-sheet', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    const $ = load(res.body);

    // collapsing pill stays
    expect($('#from-to-pill[data-state]').length).toBe(1);
    expect($('.pill-edit').length).toBe(1);
    expect($('.pill-collapsed').length).toBe(1);

    // unified sheet
    const sheet = $('section.sheet#sheet');
    expect(sheet.length).toBe(1);
    expect(sheet.attr('data-snap')).toBe('peek');

    // chips live inside the sheet header (not floating)
    expect($('.sheet__header #trip-chips').length).toBe(1);
    // four chips: when, goal, flags, recents
    expect($('#trip-chips .chip[data-chip]').length).toBe(4);
    ['when','goal','flags','recents'].forEach((name) => {
      expect($(`#trip-chips .chip[data-chip="${name}"]`).length).toBe(1);
    });

    // map FAB stays
    expect($('#fab-geolocate').length).toBe(1);

    // params-sheet is gone
    expect($('#params-sheet').length).toBe(0);
    expect($('.sheet--params').length).toBe(0);
    expect($('.sheet--peek').length).toBe(0);
    expect($('#params-done').length).toBe(0);

    // four accordions, exactly
    const accs = $('.accordion[data-acc]');
    expect(accs.length).toBe(4);
    ['when','goal','flags','recents'].forEach((name) => {
      expect($(`.accordion[data-acc="${name}"]`).length).toBe(1);
    });

    // staged loader stays (now inside .sheet__header)
    expect($('.sheet__header .sheet__indicator .stage').length).toBe(5);

    // clear button moved into collapsed pill (unchanged)
    expect($('#clear-trip').length).toBe(1);

    // no orange Plan CTA
    expect($('#plan-btn').length).toBe(0);
    expect($('.btn--cta').length).toBe(0);

    // hidden inputs for params (still inside #plan-form, unchanged)
    ['mode','goal','depart','arriveBy','minBikeKm','maxBikeKm','maxTransfers','hillWeight','minOnPathFraction','preferBikePath']
      .forEach((n) => expect($(`input[type=hidden][name="${n}"]`).length).toBe(1));

    // settings controls live inside the accordion bodies
    expect($('#acc-when-body [data-when="depart"]').length).toBe(1);
    expect($('#acc-goal-body input[name="ps-goal"][value="max-path"]').length).toBe(1);
    expect($('#acc-flags-body #ps-hillWeight').length).toBe(1);
    expect($('#acc-flags-body [data-mode="bike-only"]').length).toBe(1);
    await app.close();
  });
});
