// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - importing untyped JS module
import { formatCoord, parseDecimalCoord, isValidLatLon, debounce, encodePlanBody, DEFAULTS, createStateMachine, projectToPill, activateItinerary } from '../../../src/server/static-assets/atlas.js';

describe('atlas helpers', () => {
  describe('formatCoord', () => {
    it('formats a single coordinate to 5dp', () => {
      expect(formatCoord(-37.7800123456)).toBe('-37.78001');
      expect(formatCoord(144.96302)).toBe('144.96302');
      expect(formatCoord(0)).toBe('0');
    });

    it('formats a {lat,lon} pair as "lat, lon"', () => {
      expect(formatCoord({ lat: -37.78001, lon: 144.96302 })).toBe('-37.78001, 144.96302');
    });
  });

  describe('parseDecimalCoord', () => {
    it('parses "lat,lon" with optional whitespace', () => {
      expect(parseDecimalCoord('-37.78,144.96')).toEqual({ lat: -37.78, lon: 144.96 });
      expect(parseDecimalCoord('-37.78001, 144.96302')).toEqual({ lat: -37.78001, lon: 144.96302 });
    });

    it('returns null on garbage', () => {
      expect(parseDecimalCoord('Hurstbridge')).toBeNull();
      expect(parseDecimalCoord('-37.78')).toBeNull();
      expect(parseDecimalCoord('')).toBeNull();
    });
  });

  describe('isValidLatLon', () => {
    it('accepts valid ranges', () => {
      expect(isValidLatLon({ lat: -37.78, lon: 144.96 })).toBe(true);
      expect(isValidLatLon({ lat: 0, lon: 0 })).toBe(true);
    });

    it('rejects out-of-range', () => {
      expect(isValidLatLon({ lat: 91, lon: 144.96 })).toBe(false);
      expect(isValidLatLon({ lat: -37.78, lon: 181 })).toBe(false);
      expect(isValidLatLon({ lat: NaN, lon: 144.96 })).toBe(false);
      expect(isValidLatLon(null)).toBe(false);
    });
  });

  describe('debounce', () => {
    it('fires after the delay; coalesces rapid calls', async () => {
      vi.useFakeTimers();
      const spy = vi.fn();
      const d = debounce(spy, 300);
      d(1); d(2); d(3);
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(299);
      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(3);
      vi.useRealTimers();
    });
  });

  describe('encodePlanBody', () => {
    it('builds the /api/plan body from state', () => {
      const body = encodePlanBody({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { ...DEFAULTS, mode: 'bike-train', goal: 'max-path', maxTransfers: 2 },
      });
      expect(body).toEqual({
        origin:      { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        mode: 'bike-train',
        goal: 'max-path',
        minBikeKm: 0,
        maxBikeKm: 20,
        maxTransfers: 2,
        hillWeight: 0,
        preferBikePath: false,
      });
    });

    it('omits empty depart/arriveBy and empty minOnPathFraction', () => {
      const body = encodePlanBody({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { ...DEFAULTS },
      });
      expect(body).not.toHaveProperty('depart');
      expect(body).not.toHaveProperty('arriveBy');
      expect(body).not.toHaveProperty('minOnPathFraction');
    });

    it('throws when origin or destination missing', () => {
      expect(() => encodePlanBody({ origin: null, destination: { lat: -37.86, lon: 144.92 }, params: DEFAULTS }))
        .toThrow(/origin/);
      expect(() => encodePlanBody({ origin: { lat: -37.78, lon: 144.96 }, destination: null, params: DEFAULTS }))
        .toThrow(/destination/);
    });
  });
});

describe('state machine', () => {
  it('starts with null endpoints and DEFAULTS params', () => {
    const sm = createStateMachine();
    expect(sm.state.origin).toBeNull();
    expect(sm.state.destination).toBeNull();
    expect(sm.state.params).toEqual(DEFAULTS);
    expect(sm.state.lastResult).toBeNull();
    expect(sm.state.pendingPlan).toBe(false);
  });

  it('setState merges patches', () => {
    const sm = createStateMachine();
    sm.setState({ origin: { lat: -37.78, lon: 144.96 } });
    expect(sm.state.origin).toEqual({ lat: -37.78, lon: 144.96 });
    expect(sm.state.destination).toBeNull();
    sm.setState({ destination: { lat: -37.86, lon: 144.92 } });
    expect(sm.state.origin).toEqual({ lat: -37.78, lon: 144.96 });
    expect(sm.state.destination).toEqual({ lat: -37.86, lon: 144.92 });
  });

  it('setState merges params shallowly', () => {
    const sm = createStateMachine();
    sm.setState({ params: { goal: 'max-path' } });
    expect(sm.state.params).toEqual({ ...DEFAULTS, goal: 'max-path' });
    sm.setState({ params: { hillWeight: -1 } });
    expect(sm.state.params).toEqual({ ...DEFAULTS, goal: 'max-path', hillWeight: -1 });
  });

  it('calls every registered projector after each mutation', () => {
    const sm = createStateMachine();
    const a = vi.fn();
    const b = vi.fn();
    sm.registerProjector(a);
    sm.registerProjector(b);
    sm.setState({ origin: { lat: -37.78, lon: 144.96 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(sm.state, expect.objectContaining({ origin: { lat: -37.78, lon: 144.96 } }));
  });

  it('does not call projectors during construction', () => {
    const a = vi.fn();
    const sm = createStateMachine();
    sm.registerProjector(a);
    expect(a).not.toHaveBeenCalled();
  });

  it('does not merge __pushHistory sentinel into state', () => {
    const sm = createStateMachine();
    const a = vi.fn();
    sm.registerProjector(a);
    sm.setState({ origin: { lat: -37.78, lon: 144.96 }, __pushHistory: true });
    expect(sm.state.origin).toEqual({ lat: -37.78, lon: 144.96 });
    expect(sm.state).not.toHaveProperty('__pushHistory');
    // Projector still sees it on the patch:
    expect(a).toHaveBeenCalledWith(sm.state, expect.objectContaining({ __pushHistory: true }));
  });
});

describe('activateItinerary', () => {
  it('adds the target layer, removes others, and toggles .itinerary-card--active', () => {
    const layerA = { __isOn: false, addTo: (m: any) => { m.addLayer(layerA); return layerA; } };
    const layerB = { __isOn: true,  addTo: (m: any) => { m.addLayer(layerB); return layerB; } };
    const fakeMap = {
      hasLayer:    (g: any) => g.__isOn === true,
      addLayer:    (g: any) => { g.__isOn = true; },
      removeLayer: (g: any) => { g.__isOn = false; },
    };
    (window as any).__atlasMap          = fakeMap;
    (window as any).__atlasRouteLayers  = { recommended: layerA, fastest: layerB };
    document.body.innerHTML = `
      <div id="results">
        <article class="itinerary-card" data-label="recommended"></article>
        <article class="itinerary-card itinerary-card--active" data-label="fastest"></article>
      </div>`;
    activateItinerary('recommended');
    expect(layerA.__isOn).toBe(true);
    expect(layerB.__isOn).toBe(false);
    const cards = document.querySelectorAll('.itinerary-card');
    expect(cards[0].classList.contains('itinerary-card--active')).toBe(true);
    expect(cards[1].classList.contains('itinerary-card--active')).toBe(false);
  });
});

describe('projectToPill', () => {
  it('switches data-state and updates label spans', async () => {
    document.body.innerHTML = `
      <div id="from-to-pill" data-state="empty"></div>
      <span id="origin-label-collapsed"></span>
      <span id="destination-label-collapsed"></span>`;
    projectToPill({ origin: null, destination: null });
    expect(document.getElementById('from-to-pill').dataset.state).toBe('edit');
    projectToPill({
      origin: { lat: -37.64, lon: 145.19, _label: 'Hurstbridge' },
      destination: { lat: -37.86, lon: 144.89 },
    });
    expect(document.getElementById('from-to-pill').dataset.state).toBe('set');
    expect(document.getElementById('origin-label-collapsed').textContent).toBe('Hurstbridge');
    expect(document.getElementById('destination-label-collapsed').textContent).toContain('-37.86');
  });
});
