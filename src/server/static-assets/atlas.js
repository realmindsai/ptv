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
      // Block the submit entirely and show an inline error. The HTMX fallback only
      // helps when a request reaches the server — with no coords we have nothing to send.
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
