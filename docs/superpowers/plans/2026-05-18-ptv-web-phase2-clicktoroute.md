# Web Phase 2 — Click-to-route + Geolocation + URL State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add map click-to-route, geolocation button, and shareable URL state to the Atlas web shell, so a trip can be planned with two map taps and a copied URL replays the trip.

**Architecture:** Two new vanilla JS modules in `src/server/static-assets/`: `url-state.js` (pure encoder/decoder) and `atlas.js` (state machine + projectors to map/form/URL + event handlers). A single `state` object is the source of truth; mutations flow through `setState(patch)` which fans out to three projectors. The existing HTMX form-submit path is intercepted by atlas.js and routed through a JSON-mode `firePlan()` for state consistency, but HTMX attributes remain on the form as a no-JS fallback. The existing `src/plan/map.ts` (used by `renderMapInit` for HTMX server-baked scripts and by `writeMapHtml` for `--html` CLI output) is **not refactored** in this slice — atlas.js carries an independent client-side renderer. The slight duplication is justified by the different execution contexts (one-shot inline script with fresh map vs. persistent state machine reusing one map instance).

**Tech Stack:** TypeScript (server), vanilla JS ES modules (client), Fastify, Leaflet 1.9.4 (vendored), HTMX 1.x (vendored, fallback only), vitest (unit + integration), Playwright (e2e). No new runtime deps; no new dev deps.

**Reference:** `docs/superpowers/specs/2026-05-18-ptv-web-phase2-clicktoroute-design.md`

---

## Pre-flight

The branch has in-progress work for bead **ptv-6yf** (web `/api/plan` depart/arrive-by parsing). Uncommitted edits to:

- `src/server/routes/plan.ts`
- `src/server/templates/page.html`
- `tests/integration/server/plan.test.ts`
- `tests/e2e/atlas.spec.ts`

That work has its own plan (`docs/superpowers/plans/2026-05-18-web-plan-depart-arrive.md`) and is the parent feature blocking direct departure/arrival input in the web form. **Finish it before starting Phase 2.** If you don't, this plan's edits to the same files (`page.html`, `atlas.spec.ts`) will conflict.

### Task 0: Resolve in-flight ptv-6yf work

- [ ] **Step 1: Check what's uncommitted**

Run: `git status -sb`
Expected: Only `M` lines for the four files above (plus untracked `.beads/`, `test-results/`, `AGENTS.md`, `docs/.DS_Store` which we ignore).

- [ ] **Step 2: Either finish ptv-6yf or stash it**

If you (or another session) is finishing ptv-6yf: follow `docs/superpowers/plans/2026-05-18-web-plan-depart-arrive.md` to completion, then return here.

If you're parking it for now: `git stash push -u -m "WIP: ptv-6yf depart/arrive" -- src/server/routes/plan.ts src/server/templates/page.html tests/integration/server/plan.test.ts tests/e2e/atlas.spec.ts`. Confirm with `git status -sb` that the tree is clean before continuing.

- [ ] **Step 3: Verify clean baseline**

Run: `npm run build && npm run test:unit && npm run test:integration`
Expected: build succeeds, all vitest suites pass with pristine output.

---

## File map

| Action | Path | Purpose |
| --- | --- | --- |
| New | `src/server/static-assets/url-state.js` | Pure encoder + decoder + defaults table for query-string trip state |
| New | `src/server/static-assets/atlas.js` | Client state machine, projectors, event handlers, plan caller, renderers |
| Modified | `src/server/templates/page.html` | Add ⌖ geolocation button, × clear button, inline error region, `<script type="module" src="/static/atlas.js">`, remove inline `<script>` block |
| Modified | `src/server/static-assets/app.css` | Styles for the two new buttons and the inline error |
| New | `tests/unit/server/url-state.test.ts` | Unit tests for url-state encoder/decoder |
| New | `tests/unit/server/atlas-helpers.test.ts` | Unit tests for pure helpers exported from atlas.js |
| Modified | `tests/integration/server/plan.test.ts` | Add assertion that JSON response shape matches the contract atlas.js relies on |
| Modified | `tests/e2e/atlas.spec.ts` | Add e2e flows: click-to-route, drag, URL load, geolocation, clear |

**Out of scope this plan:** `src/plan/map.ts` is **not** refactored. atlas.js carries its own renderer. If duplication becomes painful later, file a separate bead.

**Module structure inside `atlas.js` (top-to-bottom):**

1. ES imports (`./url-state.js`)
2. Constants (defaults, palette, debounce ms)
3. Pure helpers (`formatCoord`, `parseDecimalCoord`, `isValidLatLon`, `debounce`, `encodePlanBody`)
4. State object + `setState(patch)` + projector registry
5. Projectors (`projectToForm`, `projectToUrl`, `projectToMap`)
6. Renderers (`renderPlanOnMap`, `renderResultsSheet`)
7. Actions (`firePlan`, `geolocateFrom`, `clearAll`)
8. Event wiring (`wireMapClicks`, `wirePinDrags`, `wireForm`, `wireButtons`, `wirePopstate`, `wireGeocodeSuggest`)
9. Bootstrap (`init()` called on DOMContentLoaded)

Each section is exported (or attached to a small `Atlas` object) so unit tests can import the pure ones.

---

## Task 1: url-state.js — encoder, decoder, defaults

A pure ES module. No DOM, no Leaflet, no fetch. Easy to TDD.

**Files:**
- Create: `src/server/static-assets/url-state.js`
- Test: `tests/unit/server/url-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/server/url-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// vitest resolves .js imports to source under @ts-ignore — we treat this as an opaque module.
// @ts-expect-error - importing untyped JS module
import { encodeUrlState, decodeUrlState, DEFAULTS } from '../../../src/server/static-assets/url-state.js';

describe('url-state', () => {
  describe('encodeUrlState', () => {
    it('encodes just from when only origin is set', () => {
      const s = encodeUrlState({
        origin: { lat: -37.78001, lon: 144.96302 },
        destination: null,
        params: { ...DEFAULTS },
      });
      expect(s).toBe('from=-37.78001,144.96302');
    });

    it('encodes from + to when both set, default params', () => {
      const s = encodeUrlState({
        origin: { lat: -37.78001, lon: 144.96302 },
        destination: { lat: -37.86234, lon: 144.92891 },
        params: { ...DEFAULTS },
      });
      expect(s).toBe('from=-37.78001,144.96302&to=-37.86234,144.92891');
    });

    it('encodes non-default params only', () => {
      const s = encodeUrlState({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { ...DEFAULTS, goal: 'max-path', hillWeight: -1 },
      });
      expect(s).toBe('from=-37.78,144.96&to=-37.86,144.92&goal=max-path&hillWeight=-1');
    });

    it('omits coords when null', () => {
      const s = encodeUrlState({
        origin: null,
        destination: null,
        params: { ...DEFAULTS },
      });
      expect(s).toBe('');
    });

    it('rounds coords to 5 decimal places', () => {
      const s = encodeUrlState({
        origin: { lat: -37.7800123456, lon: 144.9630234 },
        destination: null,
        params: { ...DEFAULTS },
      });
      expect(s).toBe('from=-37.78001,144.96302');
    });

    it('encodes boolean preferBikePath only when true', () => {
      const t = encodeUrlState({
        origin: { lat: -37.78, lon: 144.96 },
        destination: null,
        params: { ...DEFAULTS, preferBikePath: true },
      });
      expect(t).toBe('from=-37.78,144.96&preferBikePath=1');

      const f = encodeUrlState({
        origin: { lat: -37.78, lon: 144.96 },
        destination: null,
        params: { ...DEFAULTS, preferBikePath: false },
      });
      expect(f).toBe('from=-37.78,144.96');
    });
  });

  describe('decodeUrlState', () => {
    it('decodes from + to', () => {
      const r = decodeUrlState('?from=-37.78,144.96&to=-37.86,144.92');
      expect(r).toEqual({
        origin:      { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: {},
      });
    });

    it('decodes leading "?" or no prefix', () => {
      const a = decodeUrlState('from=-37.78,144.96');
      const b = decodeUrlState('?from=-37.78,144.96');
      expect(a).toEqual(b);
    });

    it('decodes non-default params', () => {
      const r = decodeUrlState('?from=-37.78,144.96&to=-37.86,144.92&goal=max-path&hillWeight=-1&preferBikePath=1');
      expect(r).toEqual({
        origin:      { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
        params: { goal: 'max-path', hillWeight: -1, preferBikePath: true },
      });
    });

    it('returns null on malformed coord', () => {
      expect(decodeUrlState('?from=not-a-coord')).toBeNull();
      expect(decodeUrlState('?from=999,144.96')).toBeNull();  // out of range
      expect(decodeUrlState('?from=-37.78,200')).toBeNull();  // out of range
      expect(decodeUrlState('?from=-37.78')).toBeNull();      // missing lon
    });

    it('returns empty state on empty search', () => {
      expect(decodeUrlState('')).toEqual({ origin: null, destination: null, params: {} });
      expect(decodeUrlState('?')).toEqual({ origin: null, destination: null, params: {} });
    });

    it('ignores unknown keys', () => {
      const r = decodeUrlState('?from=-37.78,144.96&unknown=foo&goal=commute');
      expect(r).toEqual({
        origin: { lat: -37.78, lon: 144.96 },
        destination: null,
        params: { goal: 'commute' },
      });
    });
  });

  it('round-trips a fully-specified state', () => {
    const original = {
      origin: { lat: -37.78001, lon: 144.96302 },
      destination: { lat: -37.86234, lon: 144.92891 },
      params: {
        ...DEFAULTS,
        mode: 'bike-train',
        goal: 'max-path',
        depart: '08:00',
        maxTransfers: 2,
        hillWeight: -1,
        preferBikePath: true,
        minOnPathFraction: 0.5,
      },
    };
    const encoded = encodeUrlState(original);
    const decoded = decodeUrlState(encoded);
    expect(decoded?.origin).toEqual(original.origin);
    expect(decoded?.destination).toEqual(original.destination);
    expect(decoded?.params).toMatchObject({
      mode: 'bike-train',
      goal: 'max-path',
      depart: '08:00',
      maxTransfers: 2,
      hillWeight: -1,
      preferBikePath: true,
      minOnPathFraction: 0.5,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/server/url-state.test.ts`
Expected: FAIL — `Cannot find module .../url-state.js`.

- [ ] **Step 3: Implement url-state.js**

Create `src/server/static-assets/url-state.js`:

```js
/**
 * URL query-string state for the Atlas web UI.
 *
 * Encoder writes only fields that differ from DEFAULTS, keeping URLs short
 * for typical trips. Decoder tolerates unknown keys (forward-compat) and
 * returns null on malformed coords.
 */

export const DEFAULTS = Object.freeze({
  mode: 'bike-only',
  goal: 'day-ride',
  depart: '',
  arriveBy: '',
  minBikeKm: 0,
  maxBikeKm: 20,
  maxTransfers: 1,
  hillWeight: 0,
  minOnPathFraction: '',
  preferBikePath: false,
});

// Param fields and how to coerce their string form. Order matters for stable URL output.
const PARAM_SPEC = [
  { key: 'mode',              parse: (s) => s,                    isDefault: (v) => v === DEFAULTS.mode },
  { key: 'goal',              parse: (s) => s,                    isDefault: (v) => v === DEFAULTS.goal },
  { key: 'depart',            parse: (s) => s,                    isDefault: (v) => v === DEFAULTS.depart },
  { key: 'arriveBy',          parse: (s) => s,                    isDefault: (v) => v === DEFAULTS.arriveBy },
  { key: 'minBikeKm',         parse: (s) => Number(s),            isDefault: (v) => v === DEFAULTS.minBikeKm },
  { key: 'maxBikeKm',         parse: (s) => Number(s),            isDefault: (v) => v === DEFAULTS.maxBikeKm },
  { key: 'maxTransfers',      parse: (s) => Number(s),            isDefault: (v) => v === DEFAULTS.maxTransfers },
  { key: 'hillWeight',        parse: (s) => Number(s),            isDefault: (v) => v === DEFAULTS.hillWeight },
  { key: 'minOnPathFraction', parse: (s) => Number(s),            isDefault: (v) => v === DEFAULTS.minOnPathFraction || Number.isNaN(v) },
  { key: 'preferBikePath',    parse: (s) => s === '1',            isDefault: (v) => v === DEFAULTS.preferBikePath, encode: (v) => v ? '1' : '0' },
];

function fmt(n) {
  return Number(n.toFixed(5)).toString();
}

function parseLatLon(s) {
  if (typeof s !== 'string') return null;
  const parts = s.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function encodeUrlState(state) {
  const parts = [];
  if (state.origin)      parts.push(`from=${fmt(state.origin.lat)},${fmt(state.origin.lon)}`);
  if (state.destination) parts.push(`to=${fmt(state.destination.lat)},${fmt(state.destination.lon)}`);
  for (const spec of PARAM_SPEC) {
    const v = state.params?.[spec.key];
    if (v === undefined || v === null) continue;
    if (spec.isDefault(v)) continue;
    const enc = spec.encode ? spec.encode(v) : String(v);
    parts.push(`${spec.key}=${encodeURIComponent(enc)}`);
  }
  return parts.join('&');
}

export function decodeUrlState(search) {
  const trimmed = typeof search === 'string' ? search.replace(/^\?/, '') : '';
  if (trimmed === '') return { origin: null, destination: null, params: {} };

  const usp = new URLSearchParams(trimmed);
  const origin      = usp.has('from') ? parseLatLon(usp.get('from')) : null;
  const destination = usp.has('to')   ? parseLatLon(usp.get('to'))   : null;

  if (usp.has('from') && origin === null)      return null;
  if (usp.has('to')   && destination === null) return null;

  const params = {};
  for (const spec of PARAM_SPEC) {
    if (!usp.has(spec.key)) continue;
    const raw = usp.get(spec.key);
    const v = spec.parse(raw);
    if (spec.isDefault(v)) continue;
    params[spec.key] = v;
  }

  return { origin, destination, params };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/server/url-state.test.ts`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/static-assets/url-state.js tests/unit/server/url-state.test.ts
git commit -m "feat(server): url-state encoder/decoder for Phase 2 (ptv-t3x.2)

Pure ES module: encodeUrlState(state) and decodeUrlState(search) share a
DEFAULTS table so the URL stays short for typical trips. Decoder returns
null on malformed coords; unknown keys are ignored for forward-compat."
```

---

## Task 2: atlas.js — pure helpers + Atlas namespace

Lay down the skeleton of `atlas.js` with the pure helpers exported as named exports so they can be unit-tested without a DOM.

**Files:**
- Create: `src/server/static-assets/atlas.js`
- Test: `tests/unit/server/atlas-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/server/atlas-helpers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - importing untyped JS module
import { formatCoord, parseDecimalCoord, isValidLatLon, debounce, encodePlanBody, DEFAULTS } from '../../../src/server/static-assets/atlas.js';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/server/atlas-helpers.test.ts`
Expected: FAIL — `Cannot find module .../atlas.js`.

- [ ] **Step 3: Implement the helpers (atlas.js skeleton)**

Create `src/server/static-assets/atlas.js`:

```js
/**
 * Atlas — client-side state machine for the ptv plan web UI (Phase 2).
 *
 * Single state object; setState fans out to projectors that sync the map,
 * the form pill, and the URL. Click/drag/geolocate/clear actions mutate state;
 * firePlan posts to /api/plan (JSON mode) and renders the result.
 */

import { encodeUrlState, decodeUrlState } from './url-state.js';

export const DEFAULTS = Object.freeze({
  mode: 'bike-only',
  goal: 'day-ride',
  depart: '',
  arriveBy: '',
  minBikeKm: 0,
  maxBikeKm: 20,
  maxTransfers: 1,
  hillWeight: 0,
  minOnPathFraction: '',
  preferBikePath: false,
});

export const DEBOUNCE_MS = 300;
export const MELBOURNE_CENTER = { lat: -37.8136, lon: 144.9631 };
export const MELBOURNE_ZOOM = 11;

// --- pure helpers ---

export function formatCoord(v) {
  if (typeof v === 'number') return Number(v.toFixed(5)).toString();
  if (v && typeof v === 'object' && 'lat' in v && 'lon' in v) {
    return `${formatCoord(v.lat)}, ${formatCoord(v.lon)}`;
  }
  throw new Error('formatCoord: bad input');
}

export function parseDecimalCoord(s) {
  if (typeof s !== 'string') return null;
  const parts = s.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function isValidLatLon(p) {
  if (!p || typeof p !== 'object') return false;
  const { lat, lon } = p;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function debounce(fn, ms) {
  let t = null;
  return function debounced(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}

export function encodePlanBody(state) {
  if (!state.origin)      throw new Error('origin missing');
  if (!state.destination) throw new Error('destination missing');
  const p = state.params;
  const body = {
    origin:      { lat: state.origin.lat,      lon: state.origin.lon },
    destination: { lat: state.destination.lat, lon: state.destination.lon },
    mode:           p.mode,
    goal:           p.goal,
    minBikeKm:      p.minBikeKm,
    maxBikeKm:      p.maxBikeKm,
    maxTransfers:   p.maxTransfers,
    hillWeight:     p.hillWeight,
    preferBikePath: p.preferBikePath,
  };
  if (p.depart)            body.depart            = p.depart;
  if (p.arriveBy)          body.arriveBy          = p.arriveBy;
  if (p.minOnPathFraction !== '' && p.minOnPathFraction != null) {
    body.minOnPathFraction = Number(p.minOnPathFraction);
  }
  return body;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/server/atlas-helpers.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/static-assets/atlas.js tests/unit/server/atlas-helpers.test.ts
git commit -m "feat(server): atlas.js skeleton + pure helpers (ptv-t3x.2)

Stand up the new client state-machine module with the testable pure
parts: formatCoord, parseDecimalCoord, isValidLatLon, debounce,
encodePlanBody. DOM/Leaflet/network wiring lands in later tasks."
```

---

## Task 3: atlas.js — state object + setState + projector registry

Add the central state and the `setState(patch)` function. Projectors are pluggable so the wiring tasks can register them one at a time. Tests use spy projectors to verify the registry contract.

**Files:**
- Modify: `src/server/static-assets/atlas.js`
- Test: `tests/unit/server/atlas-helpers.test.ts` (add a new `describe` block)

- [ ] **Step 1: Extend the test**

Append to `tests/unit/server/atlas-helpers.test.ts` (inside the top-level `describe('atlas helpers', () => { ... })` — add before the closing brace, or wrap in its own top-level describe block beside it):

```ts
// (top-level, beside the existing describe)
// @ts-expect-error - importing untyped JS module
import { createStateMachine } from '../../../src/server/static-assets/atlas.js';

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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/server/atlas-helpers.test.ts`
Expected: FAIL — `createStateMachine is not exported`.

- [ ] **Step 3: Add the state machine to atlas.js**

Append to `src/server/static-assets/atlas.js`:

```js
// --- state machine ---

export function createStateMachine() {
  const state = {
    origin:      null,
    destination: null,
    params:      { ...DEFAULTS },
    pendingPlan: false,
    lastResult:  null,
  };
  const projectors = [];

  function setState(patch) {
    if (patch.params) {
      state.params = { ...state.params, ...patch.params };
    }
    for (const k of Object.keys(patch)) {
      if (k === 'params') continue;
      state[k] = patch[k];
    }
    for (const p of projectors) p(state, patch);
  }

  function registerProjector(fn) {
    projectors.push(fn);
  }

  return { state, setState, registerProjector };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/server/atlas-helpers.test.ts`
Expected: all tests pass, including the new state-machine block.

- [ ] **Step 5: Commit**

```bash
git add src/server/static-assets/atlas.js tests/unit/server/atlas-helpers.test.ts
git commit -m "feat(server): atlas state machine — setState + projector registry (ptv-t3x.2)

Central state object with shallow-merged params. setState fans out to
every registered projector. Projectors are pluggable so map/form/URL
sync can be wired one at a time."
```

---

## Task 4: atlas.js — projectToForm + projectToUrl

Both projectors touch the DOM / window globals. We won't unit-test them with jsdom; e2e (Task 13) covers them. Implement and wire here.

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Append projectToForm**

Append to `src/server/static-assets/atlas.js`:

```js
// --- projectors ---

/**
 * Sync the form pill's visible coord text inputs and hidden lat/lon inputs
 * from state.origin / state.destination. Param fields are NOT projected from
 * state (the form is the source-of-truth for them; state mirrors form on submit).
 */
export function projectToForm(state) {
  const setPair = (prefix, point) => {
    const queryEl = document.getElementById(`${prefix}-query`);
    const latEl   = document.getElementById(`${prefix}-lat`);
    const lonEl   = document.getElementById(`${prefix}-lon`);
    if (!queryEl || !latEl || !lonEl) return;
    if (point) {
      queryEl.value = formatCoord(point);
      latEl.value   = String(point.lat);
      lonEl.value   = String(point.lon);
    } else {
      queryEl.value = '';
      latEl.value   = '';
      lonEl.value   = '';
    }
  };
  setPair('origin',      state.origin);
  setPair('destination', state.destination);
}
```

- [ ] **Step 2: Append projectToUrl**

Append to `src/server/static-assets/atlas.js`:

```js
/**
 * Sync the browser URL's query string from state.
 *
 * Uses replaceState for in-progress edits (first pin, drag-in-progress) and
 * pushState when the plan fires (transition to a "completed trip" history entry).
 * Distinction is signaled via patch.__pushHistory in the projector call.
 */
export function projectToUrl(state, patch) {
  const search = encodeUrlState(state);
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
  if (patch && patch.__pushHistory) {
    window.history.pushState(null, '', url);
  } else {
    window.history.replaceState(null, '', url);
  }
}
```

Note: `__pushHistory` is a sentinel on the patch object used to mark history-boundary transitions. The plan-firing flow (Task 7) sets it; routine mutations (placing the first pin, in-flight drag) leave it off.

- [ ] **Step 3: Build to check for syntax errors**

Run: `npm run build`
Expected: build succeeds. No tsc errors (the JS file is excluded from typecheck since it's in static-assets).

- [ ] **Step 4: Run unit tests (regression check)**

Run: `npm run test:unit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/server/static-assets/atlas.js
git commit -m "feat(server): atlas projectToForm + projectToUrl (ptv-t3x.2)

projectToForm writes coords to the visible #origin-query/#destination-query
inputs and to the hidden lat/lon inputs the HTMX fallback still reads.
projectToUrl writes ?from=...&to=... using url-state.js; uses pushState
only on plan-fire boundaries (patch.__pushHistory)."
```

---

## Task 5: atlas.js — projectToMap (markers only)

Marker drawing. Polyline drawing is in the next task (renderPlanOnMap).

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Append projectToMap**

Append to `src/server/static-assets/atlas.js`:

```js
/**
 * Sync map markers from state. Polylines are handled separately by renderPlanOnMap
 * because they only change when a plan result arrives, not on every state change.
 *
 * Markers are kept on window.__atlasMarkers = { origin, destination } and replaced
 * (not mutated) on every projector call, so dragging the existing pin is handled
 * by the Leaflet dragend handler binding to whatever pin is current.
 */
export function projectToMap(state) {
  const map = window.__atlasMap;
  if (!map) return;
  const L = window.L;
  const layer = window.__atlasMarkerLayer;
  if (!layer) return;

  layer.clearLayers();

  if (state.origin) {
    const m = L.marker([state.origin.lat, state.origin.lon], {
      draggable: true,
      icon: L.divIcon({ className: 'pin pin--origin', html: '', iconSize: [22, 22], iconAnchor: [11, 11] }),
    });
    m.on('dragend', (e) => window.__atlasOnDragend('origin', e.target.getLatLng()));
    layer.addLayer(m);
  }

  if (state.destination) {
    const pending = state.pendingPlan ? ' pin--pending' : '';
    const m = L.marker([state.destination.lat, state.destination.lon], {
      draggable: true,
      icon: L.divIcon({ className: `pin pin--destination${pending}`, html: '', iconSize: [22, 22], iconAnchor: [11, 11] }),
    });
    m.on('dragend', (e) => window.__atlasOnDragend('destination', e.target.getLatLng()));
    layer.addLayer(m);
  }
}
```

The `pin pin--origin` etc. classes are styled in `app.css` (Task 11). `window.__atlasOnDragend` is registered by the event-wiring task (Task 8).

- [ ] **Step 2: Build to verify syntax**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/server/static-assets/atlas.js
git commit -m "feat(server): atlas projectToMap — marker rendering (ptv-t3x.2)

Drop/clear origin + destination markers based on state. Markers are
draggable; dragend dispatches to a window-registered handler so the
projector stays stateless. Polylines are not handled here — see
renderPlanOnMap in the next task."
```

---

## Task 6: atlas.js — renderPlanOnMap (polylines + station markers)

This is the client-side counterpart of `src/plan/map.ts`'s `renderMapInit`. It draws bike polylines (green) and train polylines (red dashed) for every itinerary, with toggleable layer control. Independent of `projectToMap` (which only does the from/to pins).

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Append renderPlanOnMap**

Append to `src/server/static-assets/atlas.js`:

```js
// --- renderers ---

/**
 * Draw a plan result's itineraries onto the persistent map. Idempotent:
 * each call clears and redraws the route layer. Pins (from/to) are not
 * touched — projectToMap handles those.
 */
export function renderPlanOnMap(result) {
  const map = window.__atlasMap;
  if (!map) return;
  const L = window.L;

  // Tear down any previous route layers + layer control.
  if (window.__atlasRouteLayers) {
    for (const g of Object.values(window.__atlasRouteLayers)) map.removeLayer(g);
  }
  if (window.__atlasLayerControl) {
    map.removeControl(window.__atlasLayerControl);
    window.__atlasLayerControl = null;
  }

  const labeled = result.itineraries.filter((i) => i.labels.length > 0);
  labeled.sort((a, b) => a.totalTimeMin - b.totalTimeMin);

  const layers = {};
  const allBounds = [];

  for (const it of labeled) {
    const group = L.featureGroup();
    for (const leg of it.legs) {
      if (leg.mode === 'bike') {
        const coords = leg.geometry && leg.geometry.coordinates
          ? leg.geometry.coordinates.map((c) => [c[1], c[0]])
          : [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]];
        const line = L.polyline(coords, { color: '#2a7', weight: 4 });
        let popup = `bike: ${leg.km.toFixed(1)} km, ${leg.min.toFixed(0)} min`;
        if (typeof leg.kmOnPath === 'number' && leg.km > 0) {
          const pct = (100 * leg.kmOnPath / leg.km).toFixed(0);
          popup += ` (${leg.kmOnPath.toFixed(1)} km on paths, ${pct}%)`;
        }
        line.bindPopup(popup);
        group.addLayer(line);
        coords.forEach((c) => allBounds.push(c));
      } else {
        const fromCoord = (typeof leg.fromLat === 'number' && typeof leg.fromLon === 'number')
          ? [leg.fromLat, leg.fromLon] : null;
        const toCoord = (typeof leg.toLat === 'number' && typeof leg.toLon === 'number')
          ? [leg.toLat, leg.toLon] : null;
        if (fromCoord && toCoord) {
          const line = L.polyline([fromCoord, toCoord], { color: '#c33', weight: 4, dashArray: '8,6' });
          line.bindPopup(`train: ${leg.routeName}<br>${leg.fromStopName} → ${leg.toStopName}<br>${leg.departUtc} → ${leg.arriveUtc}`);
          group.addLayer(line);
          L.circleMarker(fromCoord, { radius: 5, color: '#c33', fillOpacity: 1 }).bindPopup(leg.fromStopName).addTo(group);
          L.circleMarker(toCoord,   { radius: 5, color: '#c33', fillOpacity: 1 }).bindPopup(leg.toStopName).addTo(group);
          allBounds.push(fromCoord);
          allBounds.push(toCoord);
        }
      }
    }
    const label = it.labels.join(', ') || 'unlabeled';
    let layerName = `${label} — ${it.totalTimeMin.toFixed(0)} min`;
    if (typeof it.bikeKmOnPath === 'number' && it.bikeKm > 0) {
      const pct = (100 * it.bikeKmOnPath / it.bikeKm).toFixed(0);
      layerName += ` — ${pct}% path`;
    }
    layers[layerName] = group;
  }

  // Add the "recommended" layer (or the first) to the map by default.
  const recommendedKey = Object.keys(layers).find((k) => k.includes('recommended'));
  const defaultKey = recommendedKey || Object.keys(layers)[0];
  if (defaultKey) layers[defaultKey].addTo(map);

  window.__atlasRouteLayers = layers;
  if (Object.keys(layers).length > 0) {
    window.__atlasLayerControl = L.control.layers(null, layers, { collapsed: false }).addTo(map);
  }

  if (allBounds.length > 0) {
    map.fitBounds(allBounds, { padding: [40, 40] });
  }
}
```

- [ ] **Step 2: Build to verify syntax**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/server/static-assets/atlas.js
git commit -m "feat(server): atlas renderPlanOnMap — polylines + layer control (ptv-t3x.2)

Client-side polyline renderer for plan results. Mirrors the server-baked
script body in src/plan/map.ts but reuses the persistent map instance
and supports idempotent re-draw on result updates."
```

---

## Task 7: atlas.js — renderResultsSheet + firePlan

`renderResultsSheet` writes the bottom-sheet cards client-side. `firePlan` posts to `/api/plan` with JSON, then calls both `renderPlanOnMap` and `renderResultsSheet`.

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Append renderResultsSheet**

Append to `src/server/static-assets/atlas.js`:

```js
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function renderResultsSheet(result) {
  const root = document.getElementById('results');
  if (!root) return;
  const cards = result.itineraries.filter((i) => i.labels.length > 0).map((it) => {
    const labels = escHtml(it.labels.join(', '));
    return `<article class="itinerary-card">
      <header class="itinerary-card__label">${labels}</header>
      <div class="itinerary-card__time"><span class="mono">${it.totalTimeMin.toFixed(0)}</span> min</div>
      <div class="itinerary-card__meta">
        <span class="mono">${it.bikeKm.toFixed(1)}</span> km bike ·
        <span class="mono">${it.transfers}</span> transfers ·
        <span class="mono">${it.trainMin.toFixed(0)}</span> min train
      </div>
    </article>`;
  }).join('');
  root.innerHTML = `<div id="results-inner">${cards}</div>`;
}

export function renderResultsError(message) {
  const root = document.getElementById('results');
  if (!root) return;
  root.innerHTML = `<div class="error"><strong>plan failed:</strong> ${escHtml(message)}</div>`;
}
```

- [ ] **Step 2: Append firePlan**

Append to `src/server/static-assets/atlas.js`:

```js
// --- actions ---

export async function firePlan(sm, opts = {}) {
  // Mark history-boundary on this projection cycle so projectToUrl uses pushState.
  sm.setState({ pendingPlan: true, __pushHistory: !opts.fromPopstate });
  try {
    const body = encodePlanBody(sm.state);
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const err = await res.json();
        if (err?.error?.message) msg = err.error.message;
      } catch { /* ignore body-parse failure */ }
      sm.setState({ pendingPlan: false });
      renderResultsError(msg);
      return;
    }
    const result = await res.json();
    sm.setState({ pendingPlan: false, lastResult: result });
    renderPlanOnMap(result);
    renderResultsSheet(result);
  } catch (e) {
    sm.setState({ pendingPlan: false });
    renderResultsError(e instanceof Error ? e.message : String(e));
  }
}
```

Note: the `__pushHistory` patch field is consumed by `projectToUrl` and stripped before merging into state. Update `setState` in `createStateMachine` to skip `__pushHistory` when copying onto state:

Edit the `setState` body in `createStateMachine` (Task 3) — find:

```js
    for (const k of Object.keys(patch)) {
      if (k === 'params') continue;
      state[k] = patch[k];
    }
```

Replace with:

```js
    for (const k of Object.keys(patch)) {
      if (k === 'params') continue;
      if (k === '__pushHistory') continue;  // sentinel, not state
      state[k] = patch[k];
    }
```

- [ ] **Step 3: Build to verify syntax**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Update the state-machine test to verify sentinel handling**

Append a test to the `describe('state machine', ...)` block in `tests/unit/server/atlas-helpers.test.ts`:

```ts
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
```

- [ ] **Step 5: Run unit tests**

Run: `npm run test:unit`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/server/static-assets/atlas.js tests/unit/server/atlas-helpers.test.ts
git commit -m "feat(server): atlas firePlan + renderResultsSheet (ptv-t3x.2)

POST /api/plan with JSON, render polylines and bottom-sheet cards on
success; render an inline error on failure. firePlan flags the URL
projector to pushState (history boundary), suppressed during popstate
re-runs to avoid duplicating history entries."
```

---

## Task 8: atlas.js — event handlers (map click, dragend, geocode-suggest, geolocate, clear, submit, popstate)

A single section that wires all the event handlers. Each handler is small enough to be one mental unit; they share `sm` (the state machine).

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Append wire functions**

Append to `src/server/static-assets/atlas.js`:

```js
// --- event wiring ---

export function wireMapClicks(map, sm) {
  map.on('click', (e) => {
    // Inert when both pins exist (per design — change pins by drag or clear).
    if (sm.state.origin && sm.state.destination) return;
    const point = { lat: e.latlng.lat, lon: e.latlng.lng };
    if (!sm.state.origin) {
      sm.setState({ origin: point });
      return;
    }
    sm.setState({ destination: point });
    firePlan(sm);
  });
}

export function wirePinDrags(sm) {
  const debouncedFire = debounce(() => {
    if (sm.state.origin && sm.state.destination) firePlan(sm);
  }, DEBOUNCE_MS);
  window.__atlasOnDragend = (which, latlng) => {
    const point = { lat: latlng.lat, lon: latlng.lng };
    sm.setState({ [which]: point });
    debouncedFire();
  };
}

export function wireGeolocate(sm) {
  const btn = document.getElementById('geolocate-from');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      showInlineError('origin', 'geolocation unavailable in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        sm.setState({ origin: point });
        window.__atlasMap?.setView([point.lat, point.lon], 13);
        if (sm.state.destination) firePlan(sm);
      },
      (err) => showInlineError('origin', err.message || 'geolocation failed'),
      { timeout: 10000, maximumAge: 60000 },
    );
  });
}

export function wireClear(sm) {
  const btn = document.getElementById('clear-trip');
  if (!btn) return;
  btn.addEventListener('click', () => {
    sm.setState({ origin: null, destination: null, lastResult: null, __pushHistory: true });
    // Tear down any rendered polyline layers and bottom-sheet cards.
    if (window.__atlasRouteLayers) {
      for (const g of Object.values(window.__atlasRouteLayers)) window.__atlasMap?.removeLayer(g);
      window.__atlasRouteLayers = null;
    }
    if (window.__atlasLayerControl) {
      window.__atlasMap?.removeControl(window.__atlasLayerControl);
      window.__atlasLayerControl = null;
    }
    const results = document.getElementById('results');
    if (results) results.innerHTML = '';
  });
}

export function wireForm(sm) {
  const form = document.getElementById('plan-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    // Read current form values into params.
    const fd = new FormData(form);
    const params = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (fd.has(k)) {
        const raw = fd.get(k);
        params[k] = typeof DEFAULTS[k] === 'number'
          ? (raw === '' ? DEFAULTS[k] : Number(raw))
          : (typeof DEFAULTS[k] === 'boolean' ? raw === 'true' || raw === 'on' : String(raw));
      } else if (typeof DEFAULTS[k] === 'boolean') {
        // Unchecked checkboxes don't appear in FormData.
        params[k] = false;
      }
    }

    // Read endpoints. Prefer hidden lat/lon (set by pin drops or geocode-suggest).
    // Fallback: parse the visible text input as raw coords.
    const origLat = fd.get('origin[lat]');
    const origLon = fd.get('origin[lon]');
    const destLat = fd.get('destination[lat]');
    const destLon = fd.get('destination[lon]');
    let origin = (origLat && origLon) ? { lat: Number(origLat), lon: Number(origLon) } : parseDecimalCoord(String(fd.get('origin-query') || ''));
    let destination = (destLat && destLon) ? { lat: Number(destLat), lon: Number(destLon) } : parseDecimalCoord(String(fd.get('destination-query') || ''));

    if (!origin || !isValidLatLon(origin) || !destination || !isValidLatLon(destination)) {
      // Let the HTMX fallback handle this case — its server-side validator returns
      // a friendly error. We pre-empted the submit; re-fire the native one so HTMX picks it up.
      e.preventDefault();
      showInlineError('origin', 'pick a from and to first (click the map or type a place)');
      return;
    }

    e.preventDefault();
    sm.setState({ origin, destination, params });
    firePlan(sm);
  });
}

export function wireGeocodeSuggest(sm) {
  // The geocode-suggest dropdown items are server-rendered by /api/geocode (HTMX swap).
  // Click on an item: copy lat/lon/label into the form + state.
  document.addEventListener('click', (e) => {
    const item = e.target.closest('[data-lat][data-lon][data-label]');
    if (!item) return;
    const suggest = item.closest('.geocode-suggest');
    if (!suggest) return;
    const parentRow = suggest.closest('.field-row');
    if (!parentRow) return;
    const which = parentRow.classList.contains('field-row--origin') ? 'origin' : 'destination';
    const point = { lat: Number(item.dataset.lat), lon: Number(item.dataset.lon) };
    if (!isValidLatLon(point)) return;
    sm.setState({ [which]: point });
    // Display the label (place name) instead of raw coords in the visible input.
    const queryEl = document.getElementById(`${which}-query`);
    if (queryEl) queryEl.value = item.dataset.label;
    suggest.innerHTML = '';
    if (sm.state.origin && sm.state.destination) firePlan(sm);
  });
}

export function wirePopstate(sm) {
  window.addEventListener('popstate', () => {
    const decoded = decodeUrlState(window.location.search);
    if (!decoded) return;
    sm.setState({
      origin: decoded.origin,
      destination: decoded.destination,
      params: { ...DEFAULTS, ...decoded.params },
      lastResult: null,
    });
    if (decoded.origin && decoded.destination) firePlan(sm, { fromPopstate: true });
  });
}

function showInlineError(prefix, message) {
  const el = document.getElementById(`${prefix}-error`);
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(showInlineError._t);
  showInlineError._t = setTimeout(() => el.classList.remove('is-visible'), 4000);
}
```

- [ ] **Step 2: Build to verify syntax**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/server/static-assets/atlas.js
git commit -m "feat(server): atlas event handlers — clicks, drag, geolocate, clear, submit, popstate (ptv-t3x.2)

Map click drops from then to (inert after both pins); drag re-fires plan
after 300ms debounce; ⌖ geolocates origin; × clears the trip; form
submit is intercepted and routed through firePlan; popstate replays the
URL state without pushing a duplicate history entry."
```

---

## Task 9: atlas.js — bootstrap (init on DOMContentLoaded)

The entry point that ties everything together and runs on page load.

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Append init + bootstrap**

Append to `src/server/static-assets/atlas.js`:

```js
// --- bootstrap ---

export function init() {
  const L = window.L;
  if (!L) {
    console.error('atlas: Leaflet (window.L) not loaded — check script order in page.html');
    return;
  }

  // Initialize the map.
  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
  map.setView([MELBOURNE_CENTER.lat, MELBOURNE_CENTER.lon], MELBOURNE_ZOOM);
  window.__atlasMap = map;
  window.__atlasMarkerLayer = L.layerGroup().addTo(map);

  // Build the state machine and register projectors.
  const sm = createStateMachine();
  sm.registerProjector(projectToMap);
  sm.registerProjector(projectToForm);
  sm.registerProjector(projectToUrl);

  // Wire events.
  wireMapClicks(map, sm);
  wirePinDrags(sm);
  wireGeolocate(sm);
  wireClear(sm);
  wireForm(sm);
  wireGeocodeSuggest(sm);
  wirePopstate(sm);

  // Load initial state from the URL.
  const decoded = decodeUrlState(window.location.search);
  if (decoded) {
    sm.setState({
      origin: decoded.origin,
      destination: decoded.destination,
      params: { ...DEFAULTS, ...decoded.params },
    });
    if (decoded.origin && decoded.destination) firePlan(sm);
  }

  // Suppress HTMX submit on the form (we intercept it ourselves). Keep the
  // hx-* attrs as a no-JS fallback — they're inert when JS is loaded because
  // our submit handler preventDefaults.

  // Expose for debugging.
  window.__atlas = { sm, map };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
```

- [ ] **Step 2: Build to verify syntax**

Run: `npm run build`
Expected: build succeeds. Confirm `dist/server/static-assets/atlas.js` exists.

```bash
ls -la dist/server/static-assets/atlas.js dist/server/static-assets/url-state.js
```

Expected: both files present.

- [ ] **Step 3: Commit**

```bash
git add src/server/static-assets/atlas.js
git commit -m "feat(server): atlas bootstrap — init map + wire on DOMContentLoaded (ptv-t3x.2)

Entry point that initializes the Leaflet map, registers all three
projectors, wires every event handler, and replays initial URL state
(auto-firing the plan when both endpoints are present)."
```

---

## Task 10: page.html — add Phase 2 UI elements

Add the two new buttons (⌖ geolocate, × clear), the inline error region, and the `<script type="module">` tag. Remove the inline `<script>` block (its logic moved to atlas.js).

**Files:**
- Modify: `src/server/templates/page.html`
- Modify: `tests/integration/server/page.test.ts` (likely an assertion adjustment)

- [ ] **Step 1: Add elements + script tag**

Open `src/server/templates/page.html`. Replace the `<!-- from row -->` block:

Find:
```html
      <!-- from row -->
      <div class="field-row field-row--origin">
        <label for="origin-query">from</label>
        <input
          id="origin-query"
          name="origin-query"
          type="text"
          autocomplete="off"
          placeholder="suburb, station, or -lat,lon"
          hx-get="/api/geocode"
          hx-trigger="keyup changed delay:300ms"
          hx-target="#origin-suggest"
          hx-vals='js:{q: document.getElementById("origin-query").value}'
          hx-headers='{"Accept":"text/html"}'
        >
        <input type="hidden" name="origin[lat]" id="origin-lat">
        <input type="hidden" name="origin[lon]" id="origin-lon">
        <div id="origin-suggest" class="geocode-suggest"></div>
      </div>
```

Replace with:
```html
      <!-- from row -->
      <div class="field-row field-row--origin">
        <label for="origin-query">from</label>
        <div class="field-row__input-with-button">
          <input
            id="origin-query"
            name="origin-query"
            type="text"
            autocomplete="off"
            placeholder="suburb, station, or -lat,lon"
            hx-get="/api/geocode"
            hx-trigger="keyup changed delay:300ms"
            hx-target="#origin-suggest"
            hx-vals='js:{q: document.getElementById("origin-query").value}'
            hx-headers='{"Accept":"text/html"}'
          >
          <button type="button" id="geolocate-from" class="btn--icon" title="use my current location" aria-label="use my current location">⌖</button>
        </div>
        <input type="hidden" name="origin[lat]" id="origin-lat">
        <input type="hidden" name="origin[lon]" id="origin-lon">
        <div id="origin-suggest" class="geocode-suggest"></div>
        <div id="origin-error" class="inline-error" aria-live="polite"></div>
      </div>
```

- [ ] **Step 2: Add × clear button next to the plan button**

Find:
```html
      <div style="padding:6px 12px 10px;">
        <button id="plan-btn" class="btn--cta" type="submit">
          <span class="btn-label">plan</span>
          <span class="btn-spinner" aria-hidden="true"></span>
        </button>
      </div>
```

Replace with:
```html
      <div class="form-actions">
        <button id="plan-btn" class="btn--cta" type="submit">
          <span class="btn-label">plan</span>
          <span class="btn-spinner" aria-hidden="true"></span>
        </button>
        <button id="clear-trip" type="button" class="btn--secondary" title="clear trip" aria-label="clear trip">×</button>
      </div>
```

- [ ] **Step 3: Remove the inline `<script>` block (logic now in atlas.js)**

Find and delete the entire block:
```html
  <!-- geocode item click handler — fills hidden lat/lon inputs and the visible text input -->
  <script>
    (function () {
      function onGeocodeClick(e) {
        ...
      });
    })();
  </script>
```

(The full block runs from the comment `<!-- geocode item click handler` down to the closing `</script>` tag.)

- [ ] **Step 4: Add the atlas.js module script tag before `</body>`**

Just before `</body>`, insert:
```html
  <!-- Phase 2 client: state machine, click-to-route, URL state, geolocation -->
  <script type="module" src="/static/atlas.js"></script>
```

- [ ] **Step 5: Add a `data-no-htmx-submit` hint (defense in depth)**

The form's `hx-post="/api/plan"` etc. attributes stay as a no-JS fallback. Atlas.js's submit handler calls `e.preventDefault()` which suppresses HTMX. No template change needed; just leave the HTMX attrs intact.

Confirm with: `grep -n "hx-post" src/server/templates/page.html`
Expected: one match — the `<form>` tag, unchanged.

- [ ] **Step 6: Build and check the page template renders**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Update page integration test if asserting on inline script content**

Run: `npx vitest run tests/integration/server/page.test.ts`

If the test asserts on the now-removed inline `<script>` content (e.g. searches for `onGeocodeClick`), update it to assert on the new `<script type="module" src="/static/atlas.js">` tag instead.

Open `tests/integration/server/page.test.ts` and search for `onGeocodeClick` or `htmx:beforeSwap`. If found, replace with assertions that the page contains:
- `<script type="module" src="/static/atlas.js">`
- `id="geolocate-from"`
- `id="clear-trip"`
- `id="origin-error"`

Re-run the test until green.

- [ ] **Step 8: Commit**

```bash
git add src/server/templates/page.html tests/integration/server/page.test.ts
git commit -m "feat(server): page.html — Phase 2 UI elements + atlas.js module (ptv-t3x.2)

Add ⌖ geolocate button on the from row, × clear button beside plan,
inline error region under origin, and load /static/atlas.js as a module.
Remove the inline geocode-click handler (moved to atlas.js)."
```

---

## Task 11: app.css — styles for new buttons and inline error

**Files:**
- Modify: `src/server/static-assets/app.css`

- [ ] **Step 1: Append the styles**

Append to `src/server/static-assets/app.css`:

```css
/* ──────────────────────────────────────────────────────────────
   Phase 2 — geolocate button, clear button, inline error, pin states
   ────────────────────────────────────────────────────────────── */

.field-row__input-with-button {
  display: flex;
  gap: 4px;
  align-items: center;
}
.field-row__input-with-button input {
  flex: 1;
  min-width: 0;
}

.btn--icon {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--rmai-border);
  border-radius: 6px;
  background: var(--rmai-white);
  color: var(--rmai-fg-1);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.btn--icon:hover {
  background: var(--rmai-lavender);
  border-color: var(--rmai-purple);
}

.btn--secondary {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--rmai-border);
  border-radius: 6px;
  background: var(--rmai-white);
  color: var(--rmai-fg-2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.btn--secondary:hover {
  background: var(--rmai-stone);
}

.form-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 12px 10px;
}

.inline-error {
  display: none;
  margin-top: 4px;
  padding: 4px 8px;
  font: 11px var(--sans);
  color: #b00;
  background: #fee;
  border-radius: 4px;
}
.inline-error.is-visible {
  display: block;
}

/* Pin styling — divIcon-based markers. */
.pin {
  border-radius: 50%;
  border: 2px solid var(--rmai-white);
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  width: 22px;
  height: 22px;
  box-sizing: border-box;
}
.pin--origin {
  background: var(--rmai-green);
}
.pin--destination {
  background: var(--rmai-orange);
}
.pin--pending {
  opacity: 0.5;
}

.error {
  padding: 10px 14px;
  background: #fff5f5;
  border-left: 3px solid #c33;
  color: var(--rmai-fg-1);
  font: 13px var(--sans);
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/server/static-assets/app.css
git commit -m "style(server): atlas Phase 2 buttons, pins, inline error (ptv-t3x.2)

⌖ icon button, × clear button, inline error visibility toggle, and
divIcon pin styles (green origin, orange destination, half-opacity
while plan is pending)."
```

---

## Task 12: integration test — assert /api/plan JSON shape stays stable

`atlas.js`'s `renderPlanOnMap` and `renderResultsSheet` depend on specific fields of the `PlanResult` JSON. Lock the shape down with an integration test so a future server refactor can't silently break the client.

**Files:**
- Modify: `tests/integration/server/plan.test.ts`

- [ ] **Step 1: Read the current test to see what's there**

Run: `head -60 tests/integration/server/plan.test.ts`

Note the existing test style (Fastify app setup, mocked planFn).

- [ ] **Step 2: Add a JSON-shape assertion test**

Add to `tests/integration/server/plan.test.ts` (inside the existing top-level describe, after the last `it` block):

```ts
  it('JSON response exposes fields atlas.js renders', async () => {
    // Minimal fake plan result with all the fields renderPlanOnMap + renderResultsSheet read.
    const fakeResult = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [
        {
          labels: ['recommended'],
          totalTimeMin: 30,
          bikeKm: 10.5,
          bikeMin: 30,
          bikeKmOnPath: 8,
          trainKm: 0,
          trainMin: 0,
          waitMin: 0,
          transfers: 0,
          legs: [
            {
              mode: 'bike',
              from: { lat: -37.78, lon: 144.96 },
              to:   { lat: -37.86, lon: 144.92 },
              km: 10.5,
              min: 30,
              kmOnPath: 8,
              geometry: { type: 'LineString', coordinates: [[144.96, -37.78], [144.92, -37.86]] },
            },
          ],
        },
      ],
    };

    const app = await buildApp({ planFn: async () => fakeResult as any });
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: JSON.stringify({
        origin: { lat: -37.78, lon: 144.96 },
        destination: { lat: -37.86, lon: 144.92 },
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Top-level shape:
    expect(body).toHaveProperty('itineraries');
    expect(Array.isArray(body.itineraries)).toBe(true);
    const it0 = body.itineraries[0];
    // Card fields:
    expect(it0).toMatchObject({
      labels: ['recommended'],
      totalTimeMin: 30,
      bikeKm: 10.5,
      transfers: 0,
      trainMin: 0,
    });
    // Polyline fields:
    const bike = it0.legs[0];
    expect(bike.mode).toBe('bike');
    expect(bike).toHaveProperty('km');
    expect(bike).toHaveProperty('kmOnPath');
    expect(bike.geometry.coordinates[0]).toEqual([144.96, -37.78]);
    await app.close();
  });
```

Adapt `buildApp(...)` to match whatever helper the existing tests use (look at the top of the file). If the existing pattern is `registerPlan(app, deps)` directly, use that instead.

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run tests/integration/server/plan.test.ts`
Expected: new test passes; existing tests still green.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/server/plan.test.ts
git commit -m "test(server): lock /api/plan JSON shape atlas.js depends on (ptv-t3x.2)

Assert that the JSON response exposes itineraries[].labels, totalTimeMin,
bikeKm, transfers, trainMin, and legs[].mode/km/kmOnPath/geometry — the
exact fields renderPlanOnMap + renderResultsSheet consume."
```

---

## Task 13: e2e — Playwright tests for the new flows

Extend `tests/e2e/atlas.spec.ts` with full click-to-route flows. These run via `npm run test:e2e:browser` (Playwright, separate from vitest).

**Files:**
- Modify: `tests/e2e/atlas.spec.ts`

- [ ] **Step 1: Add e2e tests**

Append to `tests/e2e/atlas.spec.ts`, after the existing tests:

```ts
test('click-to-route: two map clicks fire a plan', async ({ page }) => {
  // Stub /api/plan to a deterministic result so the test doesn't depend on
  // a live planner. This isolates the client-side wiring.
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 30,
        bikeKm: 10.5,
        bikeMin: 30,
        trainKm: 0,
        trainMin: 0,
        waitMin: 0,
        transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 10.5, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(BASE);
  await page.waitForSelector('#map', { state: 'visible' });
  // Wait for atlas.js bootstrap.
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Two map clicks (rough pixel coords inside the map div).
  const map = page.locator('#map');
  const box = await map.boundingBox();
  if (!box) throw new Error('map not laid out');
  await map.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await map.click({ position: { x: box.width * 0.7, y: box.height * 0.6 } });

  // Results sheet should populate.
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.itinerary-card__label')).toContainText('recommended');

  // URL should now have ?from=...&to=...
  await expect.poll(() => page.url()).toMatch(/\?from=.+&to=.+/);
});

test('URL load: ?from=...&to=... auto-fires the plan', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'],
        totalTimeMin: 25, bikeKm: 8, bikeMin: 25,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 8, min: 25 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(`${BASE}/?from=-37.78,144.96&to=-37.86,144.92`);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Plan fires automatically.
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('#origin-query')).toHaveValue(/-37\.78/);
  await expect(page.locator('#destination-query')).toHaveValue(/-37\.86/);
});

test('clear button removes pins, results, and URL state', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'], totalTimeMin: 30, bikeKm: 10, bikeMin: 30,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 10, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(`${BASE}/?from=-37.78,144.96&to=-37.86,144.92`);
  await page.waitForFunction(() => !!(window as any).__atlas);
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });

  await page.locator('#clear-trip').click();
  await expect(page.locator('#results .itinerary-card')).toHaveCount(0);
  await expect(page.locator('#origin-query')).toHaveValue('');
  await expect.poll(() => page.url()).not.toMatch(/\?from=/);
});

test('geolocation button fills origin with stubbed position', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: -37.81, longitude: 144.96 });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  await page.locator('#geolocate-from').click();

  await expect(page.locator('#origin-query')).toHaveValue(/-37\.81/, { timeout: 3000 });
  await expect.poll(() => page.url()).toMatch(/\?from=-37\.81/);
});

test('regression: typed search + form submit still produces a plan via JS-intercept path', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const fake = {
      query: { from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 } },
      itineraries: [{
        labels: ['recommended'], totalTimeMin: 30, bikeKm: 10, bikeMin: 30,
        trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
        legs: [{ mode: 'bike', from: { lat: -37.78, lon: 144.96 }, to: { lat: -37.86, lon: 144.92 }, km: 10, min: 30 }],
      }],
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fake) });
  });

  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);

  // Type raw coords (skipping geocode-suggest).
  await page.locator('#origin-query').fill('-37.78, 144.96');
  await page.locator('#destination-query').fill('-37.86, 144.92');
  await page.locator('#plan-btn').click();

  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });
});
```

- [ ] **Step 2: Run e2e**

Build first so dist/ has the latest atlas.js + url-state.js:

```bash
npm run build
npm run test:e2e:browser
```

Expected: all e2e tests pass — both the existing Phase 1 ones and the new Phase 2 ones.

If Playwright reports `chromium` is missing, run `npx playwright install chromium` and retry.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/atlas.spec.ts
git commit -m "test(e2e): Phase 2 click-to-route, URL load, clear, geolocate, form submit (ptv-t3x.2)

Five new Playwright flows covering the wiring atlas.js sets up. /api/plan
is stubbed so tests don't depend on a live planner — the live planner is
covered by integration tests."
```

---

## Task 14: docker compose + deploy verification

Phase 2 is purely client-side new files in `static-assets/`. The existing Dockerfile copies `dist/server/static-assets` already; no compose changes needed. But verify the dockerized image picks up the new files.

**Files:**
- (no source files)

- [ ] **Step 1: Rebuild the docker image locally**

Run:
```bash
docker compose -f docker-compose.totoro.yml build ptv-web
```
(Or whatever the project's compose file is — check `git log -1 --format=%s -- 'docker*'` to confirm.)

Expected: build completes; final image contains `dist/server/static-assets/atlas.js` and `url-state.js`.

Verify:
```bash
docker compose -f docker-compose.totoro.yml run --rm ptv-web ls /app/dist/server/static-assets/
```
Expected: list includes `atlas.js` and `url-state.js` alongside the existing vendored files.

- [ ] **Step 2: Smoke-test the built image**

Run the container locally with credentials stubbed:
```bash
docker compose -f docker-compose.totoro.yml run --rm -p 18086:8080 \
  -e PTV_DEV_ID=x -e PTV_API_KEY=x -e NOMINATIM_URL=http://x -e REDIS_URL= \
  ptv-web
```

In another terminal, `curl -s http://127.0.0.1:18086/ | grep -E 'atlas\.js|geolocate-from|clear-trip'`
Expected: all three matches present.

`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18086/static/atlas.js`
Expected: `200`.

Stop the container with Ctrl-C.

- [ ] **Step 3: Final commit if anything was tweaked**

If the Dockerfile or compose needed changes for the new assets:

```bash
git add Dockerfile docker-compose.totoro.yml
git commit -m "build(server): verify atlas.js shipped in image (ptv-t3x.2)"
```

Otherwise skip this step. The build pipeline already handled it.

---

## Wrap-up

After the last task is committed:

- [ ] **Step 1: Run the full test suite**

```bash
npm run build && npm test && npm run test:e2e:browser
```

Expected: all green. Pristine output (no warnings).

- [ ] **Step 2: Update the bead**

```bash
bd update ptv-t3x.2 --status closed
```

(Or use whatever bd command closes an issue; check `bd --help` if unsure.)

File follow-up beads if the duplication with `src/plan/map.ts` started feeling painful during implementation — capture it as a candidate consolidation bead. Also file reverse-geocoding, PWA, and offline-shell as separate sub-beads under `ptv-t3x.2.next`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

(Or to a feature branch if you prefer — `git push origin HEAD:ptv-t3x.2-clicktoroute` and open a PR.)

- [ ] **Step 4: Deploy to totoro**

Follow the totoro deploy pattern from Phase 1 (the `linux-servers` skill has the conventions). Typically `docker compose -f docker-compose.totoro.yml up -d --build ptv-web` on totoro. Smoke-test by opening `https://ptv.magpie-inconnu.ts.net/?from=-37.78,144.96&to=-37.86,144.92` on a phone within the tailnet and confirming the plan auto-fires.
