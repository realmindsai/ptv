/**
 * Atlas — client-side state machine for the ptv plan web UI (Phase 2).
 *
 * Single state object; setState fans out to projectors that sync the map,
 * the form pill, and the URL. Click/drag/geolocate/clear actions mutate state;
 * firePlan posts to /api/plan (JSON mode) and renders the result.
 */

import { encodeUrlState, decodeUrlState, shareUrlFor } from './url-state.js';
import { segmentBarHtml, segmentsFromItinerary } from './segment-bar.js';

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

// --- state machine ---

export function createStateMachine() {
  const state = {
    origin:      null,
    destination: null,
    params:      { ...DEFAULTS },
    pendingPlan:  false,
    lastResult:   null,
    lastPlanKey:  null,
  };
  const projectors = [];

  function setState(patch) {
    if (patch.params) {
      state.params = { ...state.params, ...patch.params };
    }
    for (const k of Object.keys(patch)) {
      if (k === 'params') continue;
      if (k === '__pushHistory') continue;  // sentinel, not state
      state[k] = patch[k];
    }
    for (const p of projectors) p(state, patch);
  }

  function registerProjector(fn) {
    projectors.push(fn);
  }

  return { state, setState, registerProjector };
}

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

/**
 * Sync the pill's collapsed/edit state based on whether both endpoints are set.
 * Mirrors origin/destination labels (or raw coords) into the collapsed-view spans.
 */
export function projectToPill(state) {
  const pill = document.getElementById('from-to-pill');
  if (!pill) return;
  const both = !!(state.origin && state.destination);
  pill.dataset.state = both ? 'set' : 'edit';
  if (!both) return;
  const labelFor = (p) => p._label || formatCoord(p);
  const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  setText('origin-label-collapsed',      labelFor(state.origin));
  setText('destination-label-collapsed', labelFor(state.destination));
}

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

/**
 * Sync map markers from state. Polylines are handled separately by renderPlanOnMap
 * because they only change when a plan result arrives, not on every state change.
 *
 * Markers are kept on window.__atlasMarkerLayer = L.layerGroup() and replaced
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

  // Tear down any previous route layers.
  if (window.__atlasRouteLayers) {
    for (const g of Object.values(window.__atlasRouteLayers)) map.removeLayer(g);
  }

  // Resolve palette colors from CSS custom properties.
  const css = getComputedStyle(document.documentElement);
  const BIKE_COLOR  = css.getPropertyValue('--rmai-purple').trim() || '#A77ACD';
  const TRAIN_COLOR = css.getPropertyValue('--rmai-fg-1').trim()   || '#1A1B25';

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
        const line = L.polyline(coords, { color: BIKE_COLOR, weight: 4 });
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
          const line = L.polyline([fromCoord, toCoord], { color: TRAIN_COLOR, weight: 4, dashArray: '8,6' });
          line.bindPopup(`train: ${leg.routeName}<br>${leg.fromStopName} → ${leg.toStopName}<br>${leg.departUtc} → ${leg.arriveUtc}`);
          group.addLayer(line);
          L.circleMarker(fromCoord, { radius: 5, color: TRAIN_COLOR, fillOpacity: 1 }).bindPopup(leg.fromStopName).addTo(group);
          L.circleMarker(toCoord,   { radius: 5, color: TRAIN_COLOR, fillOpacity: 1 }).bindPopup(leg.toStopName).addTo(group);
          allBounds.push(fromCoord);
          allBounds.push(toCoord);
        }
      }
    }
    const label = it.labels.join(', ') || 'unlabeled';
    layers[label] = group;
  }

  window.__atlasRouteLayers = layers;
  const labels = Object.keys(layers);
  const defaultLabel = labels.find((k) => k.includes('recommended')) || labels[0];
  if (defaultLabel) activateItinerary(defaultLabel);

  if (allBounds.length > 0) {
    map.fitBounds(allBounds, { padding: [40, 40] });
  }
}

/**
 * Activate one itinerary: add its polyline group to the map, remove the rest,
 * and toggle the .itinerary-card--active class on result cards.
 */
export function activateItinerary(label) {
  const layers = window.__atlasRouteLayers || {};
  const map = window.__atlasMap;
  if (!map) return;
  for (const [k, g] of Object.entries(layers)) {
    const active = k === label;
    if (active && !map.hasLayer(g)) g.addTo(map);
    if (!active && map.hasLayer(g))  map.removeLayer(g);
  }
  document.querySelectorAll('.itinerary-card').forEach((card) => {
    card.classList.toggle('itinerary-card--active', card.dataset.label === label);
  });
}

/**
 * Delegated click handler on #results: clicking an itinerary card activates it
 * (switches the active polyline + active-card highlight). Skip clicks inside
 * .action-btn — Task 4.3 wires those separately.
 */
export function wireItineraryActivation() {
  const root = document.getElementById('results');
  if (!root) return;
  root.addEventListener('click', (e) => {
    if (e.target.closest('.action-btn')) return;
    const card = e.target.closest('.itinerary-card[data-label]');
    if (!card) return;
    activateItinerary(card.dataset.label);
  });
}

export function wireActionButtons(sm) {
  const root = document.getElementById('results');
  if (!root) return;
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('.action-btn[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'share')  return actShare(sm);
    if (action === 'gpx')    return actGpx(sm);
    if (action === 'osmand') return actOsmand(sm);
    if (action === 'equiv')  return actEquiv(sm);
  });
}

async function actShare(sm) {
  const url = shareUrlFor(sm.state);
  if (navigator.share) {
    try { await navigator.share({ title: 'ptv plan', url }); return; } catch { /* fallthrough */ }
  }
  await copyToClipboardOrPrompt(url, 'link copied');
}

function actGpx(sm) {
  if (!sm.state.lastPlanKey) { flashToast('plan not cached — re-plan first'); return; }
  window.location.href = `/api/plan/${encodeURIComponent(sm.state.lastPlanKey)}/gpx`;
}

function actOsmand(sm) {
  if (!sm.state.lastPlanKey) { flashToast('plan not cached — re-plan first'); return; }
  const abs = `${window.location.origin}/api/plan/${encodeURIComponent(sm.state.lastPlanKey)}/gpx`;
  window.location.href = `osmand://gpx?url=${encodeURIComponent(abs)}`;
}

async function actEquiv(sm) {
  const cmd = buildCliEquivalent(sm.state);
  await copyToClipboardOrPrompt(cmd, '$ equiv copied');
}

export function buildCliEquivalent(state) {
  if (!state.origin || !state.destination) return 'ptv plan';
  const fmt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const args = ['ptv plan', fmt(state.origin), fmt(state.destination)];
  const p = state.params;
  if (p.depart)              args.push('--depart', p.depart);
  if (p.arriveBy)            args.push('--arrive-by', p.arriveBy);
  if (p.goal !== 'commute')  args.push('--goal', p.goal);
  if (p.mode !== 'bike-train') args.push('--mode', p.mode);
  if (p.minBikeKm !== 0)     args.push('--min-bike-km', String(p.minBikeKm));
  if (p.maxBikeKm !== 20)    args.push('--max-bike-km', String(p.maxBikeKm));
  if (p.maxTransfers !== 1)  args.push('--max-transfers', String(p.maxTransfers));
  if (p.hillWeight !== 0)    args.push('--hill-weight', String(p.hillWeight));
  if (p.preferBikePath)      args.push('--prefer-bike-path');
  if (p.minOnPathFraction != null && p.minOnPathFraction !== '') {
    args.push('--min-on-path-fraction', String(p.minOnPathFraction));
  }
  return args.join(' ');
}

async function copyToClipboardOrPrompt(text, successMsg) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); flashToast(successMsg); return; } catch { /* fallthrough */ }
  }
  window.prompt('copy with ⌘C:', text);
}

function flashToast(msg) {
  let toast = document.getElementById('__atlas_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '__atlas_toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('toast--visible');
  clearTimeout(toast.__t);
  toast.__t = setTimeout(() => toast.classList.remove('toast--visible'), 1500);
}

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
    const segs = segmentsFromItinerary(it);
    const trainLegs = it.legs.filter((l) => l.mode === 'train');
    const firstTrain = trainLegs[0];
    const lastTrain  = trainLegs[trainLegs.length - 1];
    const headTimes = (firstTrain && lastTrain)
      ? `<div class="itinerary-card__times">dep <time class="itin__dep mono" datetime="${firstTrain.departUtc}">${firstTrain.departUtc}</time> · arr <time class="itin__arr mono" datetime="${lastTrain.arriveUtc}">${lastTrain.arriveUtc}</time></div>`
      : '';
    const ascendM = typeof it.ascendM === 'number' ? Math.round(it.ascendM) : null;
    const onPathPct = (typeof it.bikeKmOnPath === 'number' && it.bikeKm > 0)
      ? Math.round(100 * it.bikeKmOnPath / it.bikeKm) : null;
    const metaTail =
      (ascendM != null   ? ` · <span class="mono">${ascendM}</span> m ↑` : '') +
      (onPathPct != null ? ` · <span class="mono">${onPathPct}%</span> path` : '');
    const legendHtml = segs.map((s) => `<span class="seg-legend"><span class="seg-legend__chip seg-legend__chip--${s.kind}"></span>${escHtml(s.label)}</span>`).join('');
    return `<article class="itinerary-card" data-label="${labels}">
      <header class="itinerary-card__head">
        <span class="itinerary-card__label">${labels}</span>
        <span class="itinerary-card__time"><span class="mono">${it.totalTimeMin.toFixed(0)}</span> min</span>
      </header>
      ${headTimes}
      ${segmentBarHtml(segs)}
      <div class="seg-bar__legend">${legendHtml}</div>
      <div class="itinerary-card__meta">
        <span class="mono">${it.bikeKm.toFixed(1)}</span> km bike ·
        <span class="mono">${it.transfers}</span> transfers ·
        <span class="mono">${it.trainMin.toFixed(0)}</span> min train${metaTail}
      </div>
      <div class="itinerary-card__actions">
        <button type="button" class="action-btn" data-action="share" data-label="${labels}">↗ share</button>
        <button type="button" class="action-btn" data-action="gpx" data-label="${labels}">⤓ gpx</button>
        <button type="button" class="action-btn" data-action="osmand" data-label="${labels}">◐ osmand</button>
        <button type="button" class="action-btn action-btn--mono" data-action="equiv" data-label="${labels}">$ equiv</button>
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
    const planKey = res.headers.get('x-plan-key') || null;
    sm.setState({ pendingPlan: false, lastResult: result, lastPlanKey: planKey });
    renderPlanOnMap(result);
    renderResultsSheet(result);
  } catch (e) {
    sm.setState({ pendingPlan: false });
    renderResultsError(e instanceof Error ? e.message : String(e));
  }
}

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
  const btn = document.getElementById('fab-geolocate');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      showInlineError('origin', 'geolocation unavailable in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const labeled = { ...point, _label: 'my location' };
        sm.setState({ origin: labeled });
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
    sm.setState({ origin: null, destination: null, lastResult: null, lastPlanKey: null, __pushHistory: true });
    // Tear down any rendered polyline layers and bottom-sheet cards.
    if (window.__atlasRouteLayers) {
      for (const g of Object.values(window.__atlasRouteLayers)) window.__atlasMap?.removeLayer(g);
      window.__atlasRouteLayers = null;
    }
    const results = document.getElementById('results');
    if (results) results.innerHTML = '';
  });
}

/**
 * Pill collapsed → edit transition. Clicking either label button re-opens
 * the edit view and focuses that field for re-entry.
 */
export function wirePillEdit() {
  document.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.getAttribute('data-edit');
      const pill = document.getElementById('from-to-pill');
      if (!pill) return;
      pill.dataset.state = 'edit';
      const input = document.getElementById(`${which}-query`);
      if (input) input.focus();
    });
  });
}

/**
 * Block accidental form submits (e.g. pressing Enter inside an input).
 * Auto-fire happens via state transitions, not via form submission.
 */
export function wireFormSubmitGuard() {
  const form = document.getElementById('plan-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  });
}

/**
 * Read the ten hidden #param-* inputs into state.params, then auto-fire if
 * both endpoints are set. Called by the params-sheet "done" button (Task 2.4).
 */
export function syncParamsFromHiddenInputs(sm) {
  const form = document.getElementById('plan-form');
  if (!form) return;
  const fd = new FormData(form);
  const params = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (fd.has(k)) {
      const raw = fd.get(k);
      params[k] = typeof DEFAULTS[k] === 'number'
        ? (raw === '' ? DEFAULTS[k] : Number(raw))
        : (typeof DEFAULTS[k] === 'boolean' ? raw === 'true' || raw === 'on' : String(raw));
    } else if (typeof DEFAULTS[k] === 'boolean') {
      params[k] = false;
    }
  }
  sm.setState({ params });
  if (sm.state.origin && sm.state.destination) firePlan(sm);
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
    const labeled = { ...point, _label: item.dataset.label };
    sm.setState({ [which]: labeled });
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

// --- params-sheet ---

let __paramsSheetHtml = null;
async function ensureParamsSheetLoaded() {
  if (__paramsSheetHtml) return __paramsSheetHtml;
  const res = await fetch('/static/params-sheet.html');
  __paramsSheetHtml = await res.text();
  const body = document.getElementById('params-sheet-body');
  if (body) body.innerHTML = __paramsSheetHtml;
  return __paramsSheetHtml;
}

export function wireTripChips(sm) {
  const sheet = document.getElementById('params-sheet');
  const doneBtn = document.getElementById('params-done');
  if (!sheet || !doneBtn) return;
  document.querySelectorAll('#trip-chips .chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      await ensureParamsSheetLoaded();
      bindParamsSheet(sm);
      sheet.hidden = false;
      const section = chip.dataset.chip;
      const target = document.querySelector(`.ps-section[data-section="${section}"]`);
      if (target) target.scrollIntoView({ block: 'start' });
    });
  });
  doneBtn.addEventListener('click', () => {
    sheet.hidden = true;
    syncParamsFromHiddenInputs(sm);
    refreshChipLabels();
  });
}

function bindParamsSheet(sm) {
  const sheet = document.getElementById('params-sheet');
  if (sheet && sheet.__paramsSheetBound) {
    // Already bound — just re-sync current values from sm.state.params into the controls.
    syncSheetControlsFromState(sm);
    return;
  }

  const p = sm.state.params;

  // WHEN — segmented buttons for now/depart/arriveBy
  const activeWhen = p.arriveBy ? 'arriveBy' : p.depart ? 'depart' : 'now';
  document.querySelectorAll('[data-when]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.when === activeWhen);
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-when]').forEach((x) => x.classList.toggle('is-active', x === b));
      const which = b.dataset.when;
      const v = document.getElementById('ps-time')?.value || '';
      document.getElementById('param-depart').value   = (which === 'depart')   ? v : '';
      document.getElementById('param-arriveBy').value = (which === 'arriveBy') ? v : '';
    });
  });
  const tEl = document.getElementById('ps-time');
  if (tEl) {
    tEl.value = p.depart || p.arriveBy || '';
    tEl.addEventListener('input', () => {
      const which = document.querySelector('[data-when].is-active')?.dataset.when;
      const v = tEl.value;
      document.getElementById('param-depart').value   = (which === 'depart')   ? v : '';
      document.getElementById('param-arriveBy').value = (which === 'arriveBy') ? v : '';
    });
  }

  // GOAL — radio cards
  document.querySelectorAll('input[name="ps-goal"]').forEach((r) => {
    r.checked = r.value === p.goal;
    r.addEventListener('change', () => {
      document.getElementById('param-goal').value = r.value;
    });
  });

  // MODE — segmented
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === p.mode);
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('is-active', x === b));
      document.getElementById('param-mode').value = b.dataset.mode;
    });
  });

  // HILL
  const hw = document.getElementById('ps-hillWeight');
  if (hw) {
    hw.value = String(p.hillWeight);
    const out = document.getElementById('ps-hillWeight-out');
    if (out) out.textContent = String(p.hillWeight);
    hw.addEventListener('input', () => {
      if (out) out.textContent = hw.value;
      document.getElementById('param-hillWeight').value = hw.value;
    });
  }

  // MIN ON PATH
  const mp = document.getElementById('ps-minOnPath');
  if (mp) {
    const v = typeof p.minOnPathFraction === 'number' ? p.minOnPathFraction
            : (p.minOnPathFraction === '' || p.minOnPathFraction == null ? 0 : Number(p.minOnPathFraction));
    mp.value = String(v);
    const out = document.getElementById('ps-minOnPath-out');
    if (out) out.textContent = `${Math.round(v * 100)}%`;
    mp.addEventListener('input', () => {
      if (out) out.textContent = `${Math.round(Number(mp.value) * 100)}%`;
      document.getElementById('param-minOnPathFraction').value = mp.value === '0' ? '' : mp.value;
    });
  }

  // BIKE KM RANGE
  const minK = document.getElementById('ps-minBikeKm');
  const maxK = document.getElementById('ps-maxBikeKm');
  if (minK) {
    minK.value = String(p.minBikeKm);
    minK.addEventListener('input', () => { document.getElementById('param-minBikeKm').value = minK.value; });
  }
  if (maxK) {
    maxK.value = String(p.maxBikeKm);
    maxK.addEventListener('input', () => { document.getElementById('param-maxBikeKm').value = maxK.value; });
  }

  // TRANSFERS
  document.querySelectorAll('[data-transfers]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.transfers === String(p.maxTransfers));
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-transfers]').forEach((x) => x.classList.toggle('is-active', x === b));
      document.getElementById('param-maxTransfers').value = b.dataset.transfers;
    });
  });

  // PREFER BIKE PATH
  const pbp = document.getElementById('ps-preferBikePath');
  if (pbp) {
    pbp.checked = !!p.preferBikePath;
    pbp.addEventListener('change', () => {
      document.getElementById('param-preferBikePath').value = String(pbp.checked);
    });
  }

  if (sheet) sheet.__paramsSheetBound = true;
}

function syncSheetControlsFromState(sm) {
  const p = sm.state.params;
  const activeWhen = p.arriveBy ? 'arriveBy' : p.depart ? 'depart' : 'now';
  document.querySelectorAll('[data-when]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.when === activeWhen);
  });
  const tEl = document.getElementById('ps-time');
  if (tEl) tEl.value = p.depart || p.arriveBy || '';

  document.querySelectorAll('input[name="ps-goal"]').forEach((r) => {
    r.checked = r.value === p.goal;
  });

  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === p.mode);
  });

  const hw = document.getElementById('ps-hillWeight');
  const hwOut = document.getElementById('ps-hillWeight-out');
  if (hw) hw.value = String(p.hillWeight);
  if (hwOut) hwOut.textContent = String(p.hillWeight);

  const mp = document.getElementById('ps-minOnPath');
  const mpOut = document.getElementById('ps-minOnPath-out');
  const mpV = typeof p.minOnPathFraction === 'number' ? p.minOnPathFraction
            : (p.minOnPathFraction === '' || p.minOnPathFraction == null ? 0 : Number(p.minOnPathFraction));
  if (mp) mp.value = String(mpV);
  if (mpOut) mpOut.textContent = `${Math.round(mpV * 100)}%`;

  const minK = document.getElementById('ps-minBikeKm');
  const maxK = document.getElementById('ps-maxBikeKm');
  if (minK) minK.value = String(p.minBikeKm);
  if (maxK) maxK.value = String(p.maxBikeKm);

  document.querySelectorAll('[data-transfers]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.transfers === String(p.maxTransfers));
  });

  const pbp = document.getElementById('ps-preferBikePath');
  if (pbp) pbp.checked = !!p.preferBikePath;
}

export function refreshChipLabels() {
  const goalEl = document.getElementById('param-goal');
  const departEl = document.getElementById('param-depart');
  const arriveByEl = document.getElementById('param-arriveBy');
  const goal = goalEl ? goalEl.value : 'commute';
  const depart = departEl ? departEl.value : '';
  const arriveBy = arriveByEl ? arriveByEl.value : '';
  const when = arriveBy ? `arr ${arriveBy}` : (depart || 'now');
  const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  setText('chip-when-text', when);
  const dot = document.getElementById('chip-when-dot');
  if (dot) dot.classList.toggle('chip__dot--now', when === 'now');
  setText('chip-goal-text', goal);

  // Flags badge: count any params that deviate from the form's hidden defaults.
  let flags = 0;
  const v = (id) => document.getElementById(id)?.value ?? '';
  if (v('param-hillWeight') !== '0') flags++;
  if (v('param-minOnPathFraction') !== '') flags++;
  if (v('param-preferBikePath') === 'true') flags++;
  if (v('param-minBikeKm') !== '0' || v('param-maxBikeKm') !== '20') flags++;
  if (v('param-maxTransfers') !== '1') flags++;
  const badge = document.getElementById('chip-flags-count');
  if (badge) badge.textContent = flags > 0 ? String(flags) : '';
}

// --- bootstrap ---

export function init() {
  const L = window.L;
  if (!L) {
    console.error('atlas: Leaflet (window.L) not loaded — check script order in page.html');
    return;
  }

  // Initialize the map.
  const map = L.map('map', { zoomControl: true });
  const TILE_URL  = 'https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia</a> &copy; <a href="https://stamen.com/">Stamen</a> &copy; <a href="https://openmaptiles.org/">OMT</a> &copy; OSM';
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
  map.setView([MELBOURNE_CENTER.lat, MELBOURNE_CENTER.lon], MELBOURNE_ZOOM);
  window.__atlasMap = map;
  window.__atlasMarkerLayer = L.layerGroup().addTo(map);

  // Build the state machine and register projectors.
  const sm = createStateMachine();
  sm.registerProjector(projectToMap);
  sm.registerProjector(projectToForm);
  sm.registerProjector(projectToPill);
  sm.registerProjector(projectToUrl);

  // Wire events.
  wireMapClicks(map, sm);
  wirePinDrags(sm);
  wireGeolocate(sm);
  wireClear(sm);
  wireFormSubmitGuard();
  wirePillEdit();
  wireTripChips(sm);
  wireItineraryActivation();
  wireActionButtons(sm);
  refreshChipLabels();
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
