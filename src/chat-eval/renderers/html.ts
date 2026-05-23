// src/chat-eval/renderers/html.ts
import { marked } from 'marked';

export interface HtmlRenderInput {
  run_id: string;
  title: string;
  prompts: Array<{
    prompt: string;
    turns: Array<{
      model: string;
      final_text: string;
      total_ms: number;
      tool_total_ms: number;
      tool_calls: Array<{
        tool: string; ok: boolean; duration_ms: number;
        args_json: string; result_json: string | null;
      }>;
      error: string | null;
    }>;
  }>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const STYLE = `
body { font: 14px/1.5 system-ui, sans-serif; max-width: none; margin: 16px; color: #222; }
h1 { font-size: 18px; }
.prompt { background: #f4f4f4; padding: 8px 12px; border-left: 3px solid #888; margin: 16px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
.card { border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
.model { font-weight: 600; }
.timing { color: #666; font-size: 12px; margin-bottom: 6px; }
.bar { height: 6px; background: #eee; border-radius: 3px; overflow: hidden; margin: 4px 0 8px; }
.bar > span { display: block; height: 100%; background: #4c8; }
details { margin-top: 8px; font-family: ui-monospace, monospace; font-size: 12px; }
pre { background: #fafafa; padding: 6px; overflow-x: auto; }
.err { color: #b00; }
`;

export function renderHtml(input: HtmlRenderInput): string {
  const maxMs = Math.max(
    1,
    ...input.prompts.flatMap((p) => p.turns.map((t) => t.total_ms)),
  );
  const sections = input.prompts.map((p) => {
    const cards = p.turns.map((t) => {
      const widthPct = (t.total_ms / maxMs) * 100;
      const calls = t.tool_calls
        .map((c) => `<details><summary>${esc(c.tool)} — ${c.duration_ms} ms ${c.ok ? '' : '<span class="err">FAIL</span>'}</summary>
<pre>args: ${esc(c.args_json)}\nresult: ${esc(c.result_json ?? '')}</pre></details>`)
        .join('\n');
      const body = t.error
        ? `<div class="err">ERROR: ${esc(t.error)}</div>`
        : marked(t.final_text);
      return `
<div class="card">
  <div class="model">${esc(t.model)}</div>
  <div class="timing">${t.total_ms} ms total · ${t.tool_total_ms} ms tools</div>
  <div class="bar"><span style="width:${widthPct.toFixed(1)}%"></span></div>
  <div class="answer">${body}</div>
  ${calls}
</div>`;
    }).join('');
    return `
<div class="prompt">${esc(p.prompt)}</div>
<div class="grid">${cards}</div>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<style>${STYLE}</style></head><body>
<h1>${esc(input.title)} — run ${esc(input.run_id)}</h1>
${sections}
</body></html>`;
}
