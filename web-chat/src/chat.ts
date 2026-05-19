import { marked } from 'marked';
import type { State } from './types';

marked.setOptions({ gfm: true, breaks: false });

function renderAssistant(content: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'msg msg--assistant';
  // marked.parse output. Content originates from our own Claude invocation,
  // so we trust it enough not to run a heavy sanitizer. User-typed input is
  // echoed back as user messages with textContent (no HTML execution path).
  div.innerHTML = marked.parse(content) as string;
  return div;
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
    container.appendChild(m.role === 'user' ? renderUser(m.content) : renderAssistant(m.content));
  }
  if (state.assistantBuffer) {
    container.appendChild(renderAssistant(state.assistantBuffer));
  }
  container.scrollTop = container.scrollHeight;
}
