import type { State } from './types';

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

export function renderLog(container: HTMLElement, state: State): void {
  container.hidden = !state.logOpen;
  if (!state.logOpen) return;
  container.innerHTML = '';
  for (const e of state.logEntries) {
    const row = document.createElement('div');
    row.className = 'log__entry';
    const head = document.createElement('div');
    head.innerHTML =
      `<span class="name">${escape(e.name)}</span> ` +
      `<span class="args">${escape(JSON.stringify(e.args))}</span>`;
    row.appendChild(head);
    if (e.result) {
      const res = document.createElement('div');
      res.className = 'result';
      res.textContent = `→ ${e.result.ok ? '' : 'ERR '}${e.result.summary}`;
      row.appendChild(res);
    }
    container.appendChild(row);
  }
}
