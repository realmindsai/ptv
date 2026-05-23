// src/chat-eval/renderers/html.ts
import { marked } from 'marked';
import type { ExtractedItinerary } from '../extract';

export interface HtmlRenderTurn {
  model: string;
  final_text: string;
  total_ms: number;
  tool_total_ms: number;
  tool_calls: Array<{
    tool: string; ok: boolean; duration_ms: number;
    args_json: string; result_json: string | null;
  }>;
  error: string | null;
  // Optional fields — Task 7 fills these in from the CLI wiring.
  // Defaults: usd → null, usage → null, itineraries → []
  usd?: number | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  itineraries?: ExtractedItinerary[];
}

export interface HtmlRenderInput {
  run_id: string;
  title: string;
  prompts: Array<{ prompt: string; turns: HtmlRenderTurn[] }>;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function usdStr(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return '$' + usd.toFixed(4);
}

function tokStr(usage: HtmlRenderTurn['usage']): string {
  if (!usage || usage.prompt_tokens == null) return '—';
  return `${usage.prompt_tokens}/${usage.completion_tokens ?? '?'}`;
}

const STYLE = `
body { font: 14px/1.5 system-ui, sans-serif; margin: 16px; color: #222; }
h1 { font-size: 18px; margin: 0 0 12px; }
.prompt-section { margin: 24px 0; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
.prompt-header { background: #f4f4f4; padding: 10px 14px; border-bottom: 1px solid #ddd; font-weight: 600; }
.summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.summary-table th, .summary-table td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #eee; }
.summary-table th { background: #fafafa; font-weight: 500; color: #555; }
.summary-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.model-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; padding: 12px; }
.card { border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px 12px; background: #fff; }
.card .model { font-weight: 600; font-size: 13px; }
.card .answer { margin: 8px 0; }
.segments { font-size: 12px; }
.segments table { width: 100%; border-collapse: collapse; }
.segments td { padding: 2px 6px; vertical-align: top; }
.segments td.label { color: #555; white-space: nowrap; }
.segments td.mode { color: #888; width: 50px; }
details { margin-top: 8px; font-size: 12px; font-family: ui-monospace, monospace; }
pre { background: #fafafa; padding: 6px; overflow-x: auto; }
.err { color: #b00; }
.map { height: 360px; margin: 0 12px 12px; border: 1px solid #ddd; border-radius: 4px; }
.legend { padding: 0 12px 12px; font-size: 12px; color: #666; }
.legend .swatch { display: inline-block; width: 12px; height: 12px; vertical-align: middle; margin-right: 4px; border-radius: 2px; }
`;

function renderSegments(its: ExtractedItinerary[]): string {
  if (!its.length) return '<div class="segments"><em>(no route segments)</em></div>';
  const rows = its.flatMap((it) =>
    it.legs.map((leg) => `
      <tr>
        <td class="label">${esc(it.label)}</td>
        <td class="mode">${esc(leg.mode)}</td>
        <td>${esc(leg.fromName)}</td>
        <td>→ ${esc(leg.toName)}</td>
      </tr>`),
  ).join('');
  return `<div class="segments"><table>${rows}</table></div>`;
}

function renderCard(t: HtmlRenderTurn): string {
  const itineraries = t.itineraries ?? [];
  const body = t.error
    ? `<div class="err">ERROR: ${esc(t.error)}</div>`
    : marked(t.final_text);
  const calls = t.tool_calls.map((c) => `
    <details><summary>${esc(c.tool)} — ${c.duration_ms} ms ${c.ok ? '' : '<span class="err">FAIL</span>'}</summary>
<pre>args: ${esc(c.args_json)}
result: ${esc(c.result_json ?? '')}</pre></details>`).join('');
  return `
<div class="card">
  <div class="model">${esc(t.model)}</div>
  <div class="answer">${body}</div>
  ${renderSegments(itineraries)}
  ${calls}
</div>`;
}

function renderSummary(turns: HtmlRenderTurn[]): string {
  const rows = turns.map((t) => `
    <tr>
      <td>${esc(t.model)}</td>
      <td class="num">${t.total_ms} ms</td>
      <td class="num">${t.tool_total_ms} ms</td>
      <td class="num">${usdStr(t.usd)}</td>
      <td class="num">${tokStr(t.usage)}</td>
      <td class="num">${t.tool_calls.length}</td>
    </tr>`).join('');
  return `
<table class="summary-table">
  <thead><tr>
    <th>model</th><th>total</th><th>tools</th><th>cost</th><th>tokens p/c</th><th>calls</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderLegend(turns: HtmlRenderTurn[]): string {
  const items = turns.flatMap((t) =>
    (t.itineraries ?? []).map((it) =>
      `<span><span class="swatch" style="background:${esc(it.color)}"></span>${esc(t.model)} · ${esc(it.label)}</span>`,
    ),
  );
  if (!items.length) return '';
  return `<div class="legend">${items.join(' &nbsp; ')}</div>`;
}

const MAP_SCRIPT = `
document.querySelectorAll('.map').forEach((el) => {
  const data = JSON.parse(el.getAttribute('data-routes'));
  if (!data.length) { el.innerHTML = '<em style="padding:12px;display:block;">no routes to plot</em>'; return; }
  const map = L.map(el).setView([-37.81, 144.96], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
  const all = [];
  data.forEach((route) => {
    if (!route.latlngs.length) return;
    const opts = { color: route.color, weight: 4, opacity: 0.7, dashArray: route.mode === 'train' ? '6,6' : undefined };
    const line = L.polyline(route.latlngs, opts).addTo(map);
    line.bindTooltip(route.title);
    all.push(...route.latlngs);
  });
  if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.05));
});
`;

export function renderHtml(input: HtmlRenderInput): string {
  const sections = input.prompts.map((p, idx) => {
    const routes = p.turns.flatMap((t) =>
      (t.itineraries ?? []).flatMap((it) =>
        it.legs.map((leg) => ({
          color: it.color,
          mode: leg.mode,
          latlngs: leg.latlngs,
          title: `${t.model} · ${it.label} · ${leg.mode} · ${leg.fromName} → ${leg.toName}`,
        })),
      ),
    );
    return `
<div class="prompt-section">
  <div class="prompt-header">${esc(p.prompt)}</div>
  ${renderSummary(p.turns)}
  <div class="model-cards">${p.turns.map(renderCard).join('')}</div>
  <div class="map" data-prompt-idx="${idx}" data-routes='${JSON.stringify(routes).replace(/'/g, '&#39;')}'></div>
  ${renderLegend(p.turns)}
</div>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>${STYLE}</style>
</head><body>
<h1>${esc(input.title)} — run ${esc(input.run_id)}</h1>
${sections}
<script>${MAP_SCRIPT}</script>
</body></html>`;
}
