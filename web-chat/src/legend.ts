import type { State } from './types';

export function renderLegend(container: HTMLElement, state: State): void {
  container.innerHTML = '';
  for (const p of state.currentTurnPaths) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.pathId = p.id;
    chip.dataset.active = String(state.activePathId === p.id);
    chip.style.setProperty('--c', p.color);
    const dot = document.createElement('span');
    dot.className = 'chip__dot';
    const label = document.createElement('span');
    label.textContent = p.label;
    chip.appendChild(dot);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('chat:set-active', { detail: p.id }));
    });
    container.appendChild(chip);
  }
}
