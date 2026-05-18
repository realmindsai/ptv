export const MAX_RECENTS = 8;
const KEY = 'ptv:recents';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

function write(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX_RECENTS))); }
  catch { /* quota or disabled — silently skip */ }
}

function keyFor(t) {
  return `${t.origin.lat.toFixed(4)},${t.origin.lon.toFixed(4)}|${t.destination.lat.toFixed(4)},${t.destination.lon.toFixed(4)}`;
}

export function addRecent(trip) {
  const all = read();
  const k = keyFor(trip);
  const idx = all.findIndex((t) => keyFor(t) === k);
  if (idx >= 0) all.splice(idx, 1);
  all.unshift({ ...trip, ts: Date.now() });
  write(all);
}

export function listRecents() {
  return read();
}

export function clearRecents() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
