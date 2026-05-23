// src/chat-eval/renderers/terminal.ts
import { Marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// Use a private Marked instance so installing the TerminalRenderer here
// doesn't taint the shared `marked` singleton that the HTML renderer uses.
const marked = new Marked();
(marked as any).setOptions({ renderer: new (TerminalRenderer as any)() });

export interface TerminalRenderInput {
  prompt: string;
  results: Array<{
    model: string;
    final_text: string;
    total_ms: number;
    tool_total_ms: number;
    tool_calls: Array<{ tool: string; ok: boolean; duration_ms: number }>;
    error: string | null;
  }>;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function renderTerminal(input: TerminalRenderInput): string {
  const lines: string[] = [];
  lines.push(`\n┌─ prompt ─────────────────────────────────────────`);
  lines.push(`│ ${input.prompt}`);
  lines.push(`└──────────────────────────────────────────────────\n`);

  for (const r of input.results) {
    lines.push(`◆ ${r.model}`);
    if (r.error) {
      lines.push(`  ERROR: ${r.error}`);
    } else {
      lines.push(String(marked.parse(r.final_text)).trimEnd());
    }
    lines.push('');
  }

  // Summary table.
  const rows = input.results.map((r) => [
    r.model,
    `${r.total_ms} ms`,
    `${r.tool_total_ms} ms`,
    String(r.tool_calls.length),
  ]);
  const headers = ['model', 'total', 'tools', 'calls'];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const sep = '  ';
  lines.push(headers.map((h, i) => pad(h, widths[i])).join(sep));
  lines.push(widths.map((w) => '─'.repeat(w)).join(sep));
  for (const row of rows) lines.push(row.map((c, i) => pad(c, widths[i])).join(sep));
  lines.push('');

  return lines.join('\n');
}
