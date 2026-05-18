/**
 * URL query-string state for the Atlas web UI.
 *
 * Encoder writes only fields that differ from DEFAULTS, keeping URLs short
 * for typical trips. Decoder tolerates unknown keys (forward-compat) and
 * returns null on malformed coords.
 */

export const DEFAULTS = Object.freeze({
  mode: 'bike-train',
  goal: 'commute',
  depart: '',
  arriveBy: '',
  minBikeKm: 0,
  maxBikeKm: 40,
  maxTransfers: 0,
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
  if (state.origin      && Number.isFinite(state.origin.lat)      && Number.isFinite(state.origin.lon))      parts.push(`from=${fmt(state.origin.lat)},${fmt(state.origin.lon)}`);
  if (state.destination && Number.isFinite(state.destination.lat) && Number.isFinite(state.destination.lon)) parts.push(`to=${fmt(state.destination.lat)},${fmt(state.destination.lon)}`);
  // Round-trip _label so reload / back-nav keeps the place name in the pill
  // instead of falling back to raw coords. Only emit if non-empty.
  if (state.origin      && typeof state.origin._label      === 'string' && state.origin._label.length)      parts.push(`from_l=${encodeURIComponent(state.origin._label)}`);
  if (state.destination && typeof state.destination._label === 'string' && state.destination._label.length) parts.push(`to_l=${encodeURIComponent(state.destination._label)}`);
  for (const spec of PARAM_SPEC) {
    const v = state.params?.[spec.key];
    if (v === undefined || v === null) continue;
    if (spec.isDefault(v)) continue;
    const enc = spec.encode ? spec.encode(v) : String(v);
    parts.push(`${spec.key}=${encodeURIComponent(enc)}`);
  }
  return parts.join('&');
}

export function shareUrlFor(state) {
  const q = encodeUrlState(state);
  return `${window.location.origin}${window.location.pathname}${q ? '?' + q : ''}`;
}

export function decodeUrlState(search) {
  const trimmed = typeof search === 'string' ? search.replace(/^\?/, '') : '';
  if (trimmed === '') return { origin: null, destination: null, params: {} };

  const usp = new URLSearchParams(trimmed);
  const origin      = usp.has('from') ? parseLatLon(usp.get('from')) : null;
  const destination = usp.has('to')   ? parseLatLon(usp.get('to'))   : null;

  if (usp.has('from') && origin === null)      return null;
  if (usp.has('to')   && destination === null) return null;
  // Re-attach human-readable labels so projectToForm / projectToPill show
  // place names rather than coords after popstate.
  if (origin      && usp.has('from_l')) origin._label      = usp.get('from_l') || '';
  if (destination && usp.has('to_l'))   destination._label = usp.get('to_l')   || '';

  const params = {};
  for (const spec of PARAM_SPEC) {
    if (!usp.has(spec.key)) continue;
    const raw = usp.get(spec.key);
    const v = spec.parse(raw);
    if (typeof v === 'number' && Number.isNaN(v)) continue;
    if (spec.isDefault(v)) continue;
    params[spec.key] = v;
  }

  return { origin, destination, params };
}
