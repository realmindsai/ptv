import { marked } from 'marked';
import type { LogEntry, Message, State } from './types';

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

function renderTrace(trace: LogEntry[]): HTMLElement {
  const det = document.createElement('details');
  det.className = 'trace';
  const sum = document.createElement('summary');
  sum.className = 'trace__summary';
  sum.textContent = `trace · ${trace.length} ${trace.length === 1 ? 'call' : 'calls'}`;
  det.appendChild(sum);
  const list = document.createElement('div');
  list.className = 'trace__body';
  for (const e of trace) {
    const row = document.createElement('div');
    row.className = 'trace__entry';
    const args = typeof e.args === 'string' ? e.args : JSON.stringify(e.args);
    const result = e.result?.summary ?? (e.result ? '' : '…');
    const ok = e.result?.ok !== false;
    row.innerHTML =
      `<div class="trace__head">` +
      `<span class="trace__name">${escapeHtml(e.name)}</span> ` +
      `<span class="trace__args">${escapeHtml(args)}</span>` +
      `</div>` +
      `<div class="trace__result trace__result--${ok ? 'ok' : 'err'}">${escapeHtml(result)}</div>`;
    list.appendChild(row);
  }
  det.appendChild(list);
  return det;
}

function renderAssistant(m: Extract<Message, { role: 'assistant' }>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap msg-wrap--assistant';
  if (m.trace && m.trace.length > 0) {
    wrap.appendChild(renderTrace(m.trace));
  }
  if (m.content) {
    const div = document.createElement('div');
    div.className = 'msg msg--assistant';
    // Content originates from our own Claude invocation. User-typed input is
    // echoed only as user messages (textContent — no HTML execution path).
    div.innerHTML = marked.parse(m.content) as string;
    wrap.appendChild(div);
  }
  return wrap;
}

function renderUser(content: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'msg msg--user';
  div.textContent = content;
  return div;
}

export function renderMessages(container: HTMLElement, state: State): void {
  container.innerHTML = '';
  for (const m of state.messages) {
    container.appendChild(m.role === 'user' ? renderUser(m.content) : renderAssistant(m));
  }
  if (state.assistantBuffer) {
    container.appendChild(renderAssistant({ role: 'assistant', content: state.assistantBuffer }));
  }
  container.scrollTop = container.scrollHeight;
}
