import type { State } from './types';
import { downloadGpx } from './gpx';

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
    label.className = 'chip__label';
    label.textContent = p.label;
    label.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('chat:set-active', { detail: p.id }));
    });

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'chip__dl';
    dl.title = 'Download GPX (OsmAnd, Gaia, etc.)';
    dl.textContent = '↓';
    dl.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadGpx(p);
    });

    chip.appendChild(dot);
    chip.appendChild(label);
    chip.appendChild(dl);
    container.appendChild(chip);
  }
}
