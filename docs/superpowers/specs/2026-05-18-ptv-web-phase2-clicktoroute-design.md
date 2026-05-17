# Design — web Phase 2: click-to-route + geolocation + URL state (ptv-t3x.2)

**Status:** draft
**Bead:** [ptv-t3x.2](../../../.beads) — *Phase 2: Click-to-route Leaflet PWA upgrade* (scoped slice; PWA + offline shell deferred)
**Parent:** [ptv-t3x](../../../.beads) — *Web frontend for ptv plan (epic)*
**Date:** 2026-05-18

## Problem

Phase 1 (`ptv-t3x.1`) shipped the Atlas shell: a full-bleed Leaflet map with a floating form pill on top. Today the map is decorative until you submit the form. To plan a trip on a phone, you still have to type two place names (or paste two `lat,lon` strings) and tap "plan". That's three taps too many in the moment a user typically wants to plan a trip — standing outside, deciding whether to ride.

The map is right there. Tapping on it should be enough.

Three pieces close that gap together:

1. **Click-to-route** — tap the empty map to drop `from`, tap again to drop `to`, and the plan auto-fires. Dragging a pin re-fires the plan.
2. **Geolocation** — a small ⌖ button on the `from` row uses `navigator.geolocation` to fill `from` to the user's current position.
3. **URL state** — the current trip's parameters are encoded in `?from=...&to=...&...` so links are shareable and browser back/forward replays prior trips.

Reverse-geocoding pin labels, PWA installability, and offline shell caching are deferred to a later slice (`ptv-t3x.2.next`, to be filed).

## Goals

- Two taps on the empty map produce a plotted trip with no typing.
- Dragging either pin produces an updated trip without typing.
- The browser URL always reflects the current trip; copying and pasting a URL into another tab/device reproduces the trip.
- Loading a URL with `from` and `to` in the query string auto-fires the plan without user action.
- The `from` text input has a one-tap geolocation button that fills it with the current position.
- All existing Phase 1 paths (typed search + form submit via HTMX, manual `lat,lon` paste, advanced-options form fields) continue to work unchanged.

## Non-goals

- Reverse-geocoding the dropped pins to street/suburb names. Pin labels in the form text inputs show raw coords (e.g. `-37.78001, 144.96302`). A future slice can layer reverse-geocoding on top using the existing Nominatim wiring.
- PWA installability — `manifest.webmanifest`, install-prompt criteria, app icons.
- Offline shell — service worker, IndexedDB trip history, app-shell caching.
- Server-side pre-rendering of the plan into the initial HTML response when the URL has `from`/`to`. Adds duplicated logic across `page.ts` and `plan.ts` to save one fast XHR on a tailnet. Easy to add later; not worth it now.
- Mobile-specific gestures (long-press, two-finger gestures, etc.). Default click/tap behavior is sufficient.
- Live re-routing if the user deviates from a planned trip (that path stays GPX-export, bead `ptv-0dm`).
- Trip history beyond what the URL alone preserves.

## Approach

Phase 2 is almost entirely client-side. The server already exposes `/api/plan` with `Accept`-based content negotiation: HTML for HTMX swaps, JSON for everything else. Phase 2 adds a JS client that talks to the JSON path; the HTMX path keeps working as-is for the form-submit users.

The work breaks into four pieces, in roughly the order they get built:

1. **Extract** the map-init logic into a stable client-side function `renderPlanOnMap(planResult)` callable from both the existing HTML-fragment script and the new JS-driven flows.
2. **Add a client state module** (`atlas.js`) that owns the truth of `from`, `to`, and form params, drives a single Leaflet map instance, and keeps the form pill and the URL in sync.
3. **Add a URL-state module** (`url-state.js`) that encodes/decodes form state to/from the query string, omitting fields that match defaults.
4. **Wire** click handlers, drag handlers, geolocation button, URL-load auto-plan, and the `×` clear button on top of the state module.

### State model

A single in-memory object holds the truth:

```js
const state = {
  origin:      null,    // { lat, lon } | null
  destination: null,    // { lat, lon } | null
  params:      {        // mirrors form-pill defaults
    mode:              'bike-only',
    goal:              'day-ride',
    depart:            '',
    arriveBy:          '',
    minBikeKm:         0,
    maxBikeKm:         20,
    maxTransfers:      1,
    hillWeight:        0,
    minOnPathFraction: '',
    preferBikePath:    false,
  },
  pendingPlan: false,   // true between fire and result
  lastResult:  null,    // most recent PlanResult, for re-render
};
```

The state object is the source of truth. Three view layers project from it:

- **Map layer** — Leaflet markers for `state.origin`/`state.destination`; polylines from `state.lastResult.itineraries[].legs[].polyline`.
- **Form-pill layer** — `from-query` / `to-query` text inputs show formatted coords; hidden `from-lat`/`from-lon`/`to-lat`/`to-lon` carry the values used by the existing HTMX form-submit path; param fields reflect `state.params`.
- **URL layer** — `?from=lat,lon&to=lat,lon&mode=...&...` — only fields differing from defaults are included.

Mutations flow through a single `setState(patch)` function. After every mutation it calls three projectors (`projectToMap`, `projectToForm`, `projectToUrl`) and, if both endpoints exist, calls `firePlan()`.

### Interaction flows

#### Flow 1: empty map → first tap (place `from`)

1. User taps map at `(lat, lon)`.
2. Click handler: if `state.origin === null` → `setState({ origin: { lat, lon } })`.
3. `projectToMap` drops a green pin (draggable) at the click point.
4. `projectToForm` writes `-37.78001, 144.96302` (5dp) to `#origin-query`, and the same values to hidden `#origin-lat`/`#origin-lon`.
5. `projectToUrl` calls `history.replaceState(null, '', '?from=-37.78001,144.96302')`.
6. No plan fires (destination still null).

#### Flow 2: one pin placed → second tap (place `to`, auto-plan)

1. User taps map at `(lat2, lon2)`.
2. Click handler: `state.origin` is set, `state.destination` is null → `setState({ destination: { lat: lat2, lon: lon2 } })`.
3. Projectors update map (orange pin, **low opacity while plan is pending**), form (`#destination-query` etc.), and URL.
4. Both endpoints now set → `firePlan()` runs.
5. When the plan result arrives, the pin snaps to full opacity and the polylines draw. No separate map-side spinner — the existing bottom-sheet indicator carries the pending-state UI.

#### Flow 3: both pins placed → further map taps

Per Q3 decision: **inert**. Clicks on the map after both pins exist do nothing. Only drag (existing pins) or the `×` clear button change endpoints.

This is enforced in the click handler: `if (state.origin && state.destination) return;`.

#### Flow 4: drag an existing pin

1. Leaflet `dragend` fires with the new `(lat, lon)`.
2. Handler debounces 300 ms (in case of trailing micro-adjustments — Leaflet's `dragend` is final but the debounce gives the user a moment to drop and re-grab).
3. After the debounce, `setState({ origin: { lat, lon } })` (or `destination`).
4. Projectors run; `firePlan()` re-fires.

#### Flow 5: typed search in the form pill

The Phase 1 path remains: typing into `#origin-query` debounces 300 ms, fires `/api/geocode`, renders a suggest list, click-to-select fills the hidden lat/lon and the visible text. In Phase 2 this also calls `setState({ origin: ... })` to drop the corresponding pin on the map and update the URL. The current `onGeocodeClick` listener in `page.html` is moved into `atlas.js` and updated to dispatch through `setState`.

#### Flow 6: geolocation button

1. User clicks the ⌖ button next to `#origin-query`.
2. Handler calls `navigator.geolocation.getCurrentPosition` with a 10-second timeout.
3. On success: `setState({ origin: { lat: position.coords.latitude, lon: position.coords.longitude } })`. Map recenters on the new pin. If `state.destination` already exists, plan fires.
4. On permission denied / timeout / unavailable: inline error message appears under the `from` row for 4 seconds, then fades. State is unchanged.

The button stays visible whether `from` is set or not — clicking it re-runs geolocation.

#### Flow 7: URL load (auto-plan)

1. On `DOMContentLoaded`, `atlas.js` reads `location.search` and calls `decodeUrlState(query)`.
2. If parse succeeds and `from`/`to` are present: `setState({ origin, destination, params })`. Projectors run. Pins drop. `firePlan()` fires.
3. If only `from` is present: pin drops, no plan fires.
4. If parse fails (malformed coord, unknown param): silently fall back to empty initial state. Don't throw — bad URLs shouldn't break the page.

`hashchange` is irrelevant since we're using query string; instead, the `popstate` event listener handles back/forward by re-running the URL-load logic.

#### Flow 8: clear / reset

1. User clicks the `×` button on the form pill (new in Phase 2).
2. `setState({ origin: null, destination: null, lastResult: null })`. Params are kept (user's tuning shouldn't reset).
3. Projectors run: map removes pins and polylines; form text inputs clear; URL becomes `/` (no query string); results sheet empties.

### URL-state encoding

A new module `src/server/static-assets/url-state.js` exposes:

```js
export function encodeUrlState(state) { /* state → URLSearchParams string */ }
export function decodeUrlState(search) { /* search string → partial state */ }
```

The encoder writes only fields that differ from defaults. Defaults table lives at the top of the file as a single source of truth and matches the `value=` attributes in `page.html`. Coords are formatted to 5dp.

Examples:

```
?from=-37.78001,144.96302&to=-37.86234,144.92891
?from=-37.78,144.96&to=-37.86,144.92&goal=max-path&hillWeight=-1
?from=-37.78,144.96&to=-37.86,144.92&depart=08:00&maxTransfers=2
```

Param name shortening (e.g. `f`/`t`/`g` instead of `from`/`to`/`goal`) is rejected: longer names are still short enough on a tailnet, and the encoded URL doubles as a human-readable trip identifier.

Decoder tolerance: unknown keys are ignored (forward-compat for future params). Malformed coords (non-numeric, out of latitude/longitude range) cause the whole load to be skipped and the page to render empty. Don't throw on parse failure.

### Plan-call path

The Phase 1 HTMX form-submit path is untouched. It still POSTs `multipart/form-data` to `/api/plan` with `Accept: text/html`, gets back the rendered `results.html` fragment, and HTMX swaps it into `#results`.

The new JS-driven path is a separate function `firePlan()` in `atlas.js`:

```js
async function firePlan() {
  state.pendingPlan = true;
  showPendingIndicator();
  const body = buildPlanBody(state);
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  state.pendingPlan = false;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: 'plan failed' } }));
    showInlineError(err.error?.message ?? 'plan failed');
    return;
  }
  const result = await res.json();
  state.lastResult = result;
  renderPlanOnMap(result);
  renderResultsSheet(result);
}
```

`renderResultsSheet(result)` is a small client-side templater that produces the same DOM the existing `results.html` template produces server-side. Both paths converge on the same DOM, just authored in different places. This is a small duplication (the results-card HTML lives twice) and is accepted: the alternative is to ask the server for HTML+JSON in one response, which complicates the response shape for less benefit. If the duplication starts hurting we can move the results-card template to a shared client-side function the server-side path also calls via JS injection — out of scope for this slice.

### `renderPlanOnMap` extraction

Today `src/plan/map.ts` exports `renderMapInit(result)` which returns server-baked JavaScript as a string, embedded inline into the HTMX response. That works but is awkward to call from client JS (you'd `eval` it).

Refactor: split into

- **Server side** (`src/plan/map.ts`): `renderMapInit(result)` keeps its existing signature and behavior, but its `scriptBody` becomes a thin one-liner: `window.__planResult = <json>; if (window.renderPlanOnMap) renderPlanOnMap(window.renderPlanOnMap);`. The actual rendering logic moves out.
- **Client side** (`src/server/static-assets/atlas.js`): `renderPlanOnMap(result)` is a real client function that takes a `PlanResult` and draws polylines/markers onto the existing `#map` Leaflet instance. Called by:
  - the existing HTMX path (via the bootstrap script-tag),
  - the new click-to-route path (called directly after `fetch`),
  - the URL-load path (called after auto-plan completes).

Both paths use one Leaflet instance, kept on `window.__atlasMap`, initialized in `atlas.js` on `DOMContentLoaded`.

The existing `writeMapHtml(path, result)` function — used by `ptv plan --html trip.html` from the CLI — must keep producing a self-contained file. It will inline `renderPlanOnMap` into its output so the file stays standalone (no `<script src="/static/atlas.js">` reference, since the file is opened from disk, not served).

### Server changes

Minimal — almost all Phase 2 is client-side.

- `src/server/routes/plan.ts` — already supports `Accept: application/json` and returns the `PlanResult` directly. **No code changes.** Verify in tests that the JSON path returns the full `PlanResult` shape `atlas.js` expects.
- `src/server/routes/page.ts` — currently serves `page.html` as-is. **No code changes.** The HTML page just adds a `<script type="module" src="/static/atlas.js">` tag.

### Files

| Action | Path |
| --- | --- |
| New | `src/server/static-assets/atlas.js` (~250 lines, the state module + projectors + handlers + `renderPlanOnMap` + `renderResultsSheet`) |
| New | `src/server/static-assets/url-state.js` (~80 lines, encoder + decoder + defaults table) |
| Modified | `src/server/templates/page.html` — add `×` clear button, `⌖` geolocation button, inline error region under `from` row, `<script type="module" src="/static/atlas.js">` tag. Remove the inline `<script>` block (logic moves to `atlas.js`). |
| Modified | `src/plan/map.ts` — slim `renderMapInit` to just inject JSON + a `renderPlanOnMap` call; the rendering body moves to `atlas.js`. `writeMapHtml` inlines `renderPlanOnMap` for the standalone-file case. |
| Modified | `src/server/static-assets/app.css` — styles for the new buttons and inline error. |
| New | `tests/unit/server/url-state.test.ts` |
| New | `tests/unit/server/atlas-state.test.ts` (state machine; jsdom or just plain Node since we keep state pure) |
| Modified | `tests/integration/server/plan.test.ts` — assert JSON response shape stays stable. |
| Modified | `tests/e2e/atlas.spec.ts` — Playwright: click-to-route flow, drag pin, URL load auto-plan, geolocation (stubbed). |

The `atlas.js` file is the largest single new artifact. Internal structure (top-to-bottom):

1. Defaults table (matches `url-state.js`'s)
2. `state` object + `setState(patch)` + projector dispatch
3. `projectToMap` / `projectToForm` / `projectToUrl`
4. `firePlan` (fetch + render)
5. `renderPlanOnMap` (polyline + marker drawing)
6. `renderResultsSheet` (cards templater)
7. Event wiring (click, dragend, geocode-suggest, geolocation button, clear button, form submit interception, `popstate`)
8. Bootstrap (DOMContentLoaded → init map → read URL state)

Keep each piece under ~30 lines. If `renderPlanOnMap` grows past 50, split further.

### Form submit and JS path coexistence

When the user fills the form and hits "plan", the existing HTMX path still fires. To keep state consistent, `atlas.js` intercepts the form `submit` event:

1. Read current form values.
2. `setState({ origin: ..., destination: ..., params: ... })` — this projects to map and URL.
3. Call `firePlan()` directly (via JSON path).
4. `e.preventDefault()` to suppress HTMX.

The HTMX attributes on the form (`hx-post`, `hx-target`, etc.) are kept as a fallback for the "JS failed to load" case. With JS loaded, the intercept ensures the JSON path runs and state stays consistent.

If JS fails to load, the page degrades to Phase 1 behavior: typed search + HTMX form submit. Click-to-route, URL state, and geolocation simply don't function.

## Error handling

Three failure modes:

1. **Geolocation denied / timed out / unavailable.** Inline error under `from` row for 4 seconds. State unchanged. No popup.
2. **Plan request fails** (server returns 4xx/5xx). Response JSON is `{ error: { code, message } }`. Show `message` in the results sheet using the same `error.html` styling. Map state (pins) is unchanged so the user can drag to retry.
3. **URL parse fails** on load. Silently fall back to empty initial state. Log to console for debugging but don't surface to the user — they didn't author the URL.

## Testing

### Unit

- `tests/unit/server/url-state.test.ts` — round-trip every defaultable field; assert defaults are omitted; assert malformed coords return `null` from `decodeUrlState`; assert unknown keys are ignored.
- `tests/unit/server/atlas-state.test.ts` — test `setState` patch semantics + projector calls. Use a fake Leaflet (object with `addLayer`/`removeLayer` spies) and a fake DOM (or jsdom). Pure-state coverage; no real map needed.

### Integration

- `tests/integration/server/plan.test.ts` — extend to assert the JSON response shape (`itineraries[].legs[].polyline` etc.) hasn't changed; `atlas.js` depends on it.

### E2E (Playwright, via `playwright-skill`)

- Click two points on the map → results sheet populates with itinerary cards within 30 s; pins visible; polyline visible.
- Drag the `from` pin → results re-populate; URL query string updates.
- Load page with `?from=-37.78,144.96&to=-37.86,144.92` → pins drop, plan fires automatically; results appear.
- Load page with `?from=-37.78,144.96&to=-37.86,144.92&goal=max-path` → form pill's `goal` select shows `max-path`; plan fires with that goal (assert via mocked `/api/plan` or assert the request body in network capture).
- Geolocation button → stub `navigator.geolocation.getCurrentPosition` to a fixed point; click button; assert `from` text input shows the stubbed coords and pin appears.
- Click `×` clear button → both pins disappear, results clear, URL becomes `/`.
- Phase 1 regressions: typed search + form submit still produces a plan (HTMX path or JS-intercept path, either should work as long as the end result is the same DOM).

E2E tests run against the docker-compose stack on the same Atlas image (see `Dockerfile`). The `playwright-skill` is allowed to stub `/api/plan` for the URL-load test if the live planner is too slow; the click-to-route happy path should hit the real planner at least once.

## Open questions

None blocking. A few small follow-ups worth a bead each, post-ship:

- **Reverse-geocoding pin labels.** Show street/suburb in the form text input instead of raw coords. Uses the existing Nominatim wrapper. File as `ptv-t3x.2.geocode`.
- **PWA manifest + offline shell.** File as `ptv-t3x.2.pwa`.
- **Mobile gesture polish.** Pinch-zoom near a pin shouldn't accidentally drag it. May need Leaflet config tuning. File only if observed.
