// Pure helpers. Browser ES module. No DOM, no Leaflet — just data → HTML string.

export function segmentsFromItinerary(it) {
  if (!it || !Array.isArray(it.legs)) return [];
  return it.legs.map((leg) => {
    if (leg.mode === 'bike') {
      const min = Math.max(1, Math.round(leg.min ?? 0));
      const km = typeof leg.km === 'number' ? `${leg.km.toFixed(1)}km` : 'bike';
      return { kind: 'bike', min, label: km };
    }
    // train
    const dep = leg.departUtc ? new Date(leg.departUtc).getTime() : 0;
    const arr = leg.arriveUtc ? new Date(leg.arriveUtc).getTime() : 0;
    const min = Math.max(1, Math.round((arr - dep) / 60000));
    return { kind: 'train', min, label: leg.routeName ?? 'train' };
  });
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function segmentBarHtml(segments) {
  if (!segments || segments.length === 0) return '<div class="seg-bar seg-bar--empty"></div>';
  const cells = segments.map((s) => {
    const min = Math.max(1, Math.round(s.min ?? 1));
    return `<div class="seg seg--${escHtml(s.kind)}" style="flex:${min}" title="${escHtml(s.label)}">${min >= 12 ? `<span class="seg__min">${min}m</span>` : ''}</div>`;
  }).join('');
  return `<div class="seg-bar">${cells}</div>`;
}
