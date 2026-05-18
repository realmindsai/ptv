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
