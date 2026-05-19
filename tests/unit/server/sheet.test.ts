// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
// @ts-expect-error - importing untyped JS module
import { snapSheet, cycleSnap, expandAccordion, collapseAccordion } from '../../../src/server/static-assets/atlas.js';

function setupDom() {
  document.body.innerHTML = `
    <section class="sheet" id="sheet" data-snap="peek">
      <header class="sheet__header">
        <button class="sheet__handle" id="sheet-handle"></button>
        <div class="trip-chips" id="trip-chips">
          <button class="chip" data-chip="when" id="chip-when"></button>
          <button class="chip" data-chip="goal" id="chip-goal"></button>
          <button class="chip" data-chip="flags" id="chip-flags"></button>
          <button class="chip" data-chip="recents" id="chip-recents"></button>
        </div>
      </header>
      <div class="sheet__body">
        <details class="accordion" id="acc-when" data-acc="when"><summary></summary><div class="accordion__body"></div></details>
        <details class="accordion" id="acc-goal" data-acc="goal"><summary></summary><div class="accordion__body"></div></details>
        <details class="accordion" id="acc-flags" data-acc="flags"><summary></summary><div class="accordion__body"></div></details>
        <details class="accordion" id="acc-recents" data-acc="recents"><summary></summary><div class="accordion__body"></div></details>
      </div>
    </section>
  `;
}

describe('snapSheet', () => {
  beforeEach(setupDom);

  it('sets data-snap to peek/mid/full', () => {
    snapSheet('mid');
    expect(document.getElementById('sheet')!.dataset.snap).toBe('mid');
    snapSheet('full');
    expect(document.getElementById('sheet')!.dataset.snap).toBe('full');
    snapSheet('peek');
    expect(document.getElementById('sheet')!.dataset.snap).toBe('peek');
  });

  it('ignores invalid targets', () => {
    snapSheet('mid');
    snapSheet('huge');
    expect(document.getElementById('sheet')!.dataset.snap).toBe('mid');
  });

  it('dispatches a sheet:snap event with target detail', () => {
    let captured: string | null = null;
    document.getElementById('sheet')!.addEventListener('sheet:snap',
      (e) => { captured = (e as CustomEvent).detail.target; });
    snapSheet('full');
    expect(captured).toBe('full');
  });
});

describe('cycleSnap', () => {
  beforeEach(setupDom);

  it('cycles peek → mid → full → peek', () => {
    const sheet = document.getElementById('sheet')!;
    expect(sheet.dataset.snap).toBe('peek');
    cycleSnap(); expect(sheet.dataset.snap).toBe('mid');
    cycleSnap(); expect(sheet.dataset.snap).toBe('full');
    cycleSnap(); expect(sheet.dataset.snap).toBe('peek');
  });
});

describe('expandAccordion', () => {
  beforeEach(setupDom);

  it('opens the named accordion and marks it active', () => {
    expandAccordion('goal', { scroll: false });
    const acc = document.getElementById('acc-goal') as HTMLDetailsElement;
    expect(acc.open).toBe(true);
    expect('accActive' in acc.dataset).toBe(true);
  });

  it('syncs the matching chip data-active', () => {
    expandAccordion('goal', { scroll: false });
    expect('active' in document.getElementById('chip-goal')!.dataset).toBe(true);
    expect('active' in document.getElementById('chip-when')!.dataset).toBe(false);
  });

  it('does NOT close other open accordions (independent)', () => {
    expandAccordion('when', { scroll: false });
    expandAccordion('goal', { scroll: false });
    const when = document.getElementById('acc-when') as HTMLDetailsElement;
    const goal = document.getElementById('acc-goal') as HTMLDetailsElement;
    expect(when.open).toBe(true);
    expect(goal.open).toBe(true);
  });

  it('clears prior data-acc-active when a new one is expanded', () => {
    expandAccordion('when', { scroll: false });
    expandAccordion('goal', { scroll: false });
    const when = document.getElementById('acc-when')!;
    const goal = document.getElementById('acc-goal')!;
    expect('accActive' in when.dataset).toBe(false);
    expect('accActive' in goal.dataset).toBe(true);
  });

  it('is a no-op for unknown names', () => {
    expandAccordion('nope', { scroll: false });
    const opened = document.querySelectorAll('.accordion[open]').length;
    expect(opened).toBe(0);
  });
});

describe('collapseAccordion', () => {
  beforeEach(setupDom);

  it('closes the accordion and clears active state on accordion and chip', () => {
    expandAccordion('flags', { scroll: false });
    collapseAccordion('flags');
    const acc = document.getElementById('acc-flags') as HTMLDetailsElement;
    expect(acc.open).toBe(false);
    expect('accActive' in acc.dataset).toBe(false);
    expect('active' in document.getElementById('chip-flags')!.dataset).toBe(false);
  });
});
