import type { State } from './types';

export function renderMessages(container: HTMLElement, state: State): void {
  container.innerHTML = '';
  for (const m of state.messages) {
    const div = document.createElement('div');
    div.className = `msg msg--${m.role}`;
    div.textContent = m.content;
    container.appendChild(div);
  }
  if (state.assistantBuffer) {
    const div = document.createElement('div');
    div.className = 'msg msg--assistant';
    div.textContent = state.assistantBuffer;
    container.appendChild(div);
  }
  if (state.currentTurnPaths.length > 0) {
    const row = document.createElement('div');
    row.className = 'chip-row';
    for (const p of state.currentTurnPaths) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.pathId = p.id;
      chip.dataset.active = String(state.activePathId === p.id);
      chip.style.setProperty('--c', p.color);
      chip.textContent = p.label;
      chip.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('chat:set-active', { detail: p.id }));
      });
      row.appendChild(chip);
    }
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}
