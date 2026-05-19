# bike-rail v3 unified-sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-surface web shell (`#from-to-pill` + floating `.trip-chips` + `#params-sheet` + `#results-sheet`) with one unified bottom sheet that has three snap heights (peek/mid/full), chips embedded in its sticky header, and four independent `<details>` accordions (when / goal / flags / recents). Tap-to-snap only; no drag gesture.

**Architecture:** One `<section class="sheet" id="sheet" data-snap="peek|mid|full">` element in `page.html`. Snap height driven by CSS `[data-snap]` selectors. Accordions are native `<details>` with a `data-acc-active` attribute layered on top for the lilac left-bar state (independent of `open`). Two pure JS setters — `snapSheet(name)` and `expandAccordion(name)` — drive everything. Chip clicks call both. Handle click cycles snap heights. `#params-sheet` and its `params-sheet.html` partial are deleted entirely; their content is inlined into accordion bodies.

**Tech Stack:** Vanilla JS (no framework), HTMX 1.x for form submit, Leaflet (untouched), Fastify backend (untouched), vitest + jsdom for unit tests, vitest + cheerio for template integration tests, Playwright for browser e2e.

**Spec source of truth:** `docs/superpowers/specs/2026-05-19-bike-rail-v3-unified-sheet-design.md` (commits `f3bdfe4`, `feabeb1`).

---

## File Structure

**Modified:**
- `src/server/templates/page.html` — replace `.trip-chips` (floating), `#params-sheet`, `#results-sheet` with one `<section id="sheet">` containing sticky header (handle + chips + indicator) + body (`#results` + 4 accordions).
- `src/server/static-assets/app.css` — add `.sheet[data-snap]`, accordion rules, chip `[data-active]` rules; remove `.sheet--peek`, `.sheet--params`, `.params-sheet__head`, `.params-sheet__body`, floating `.trip-chips` positioning.
- `src/server/static-assets/atlas.js` — add `snapSheet` / `cycleSnap` / `expandAccordion` / `collapseAccordion` (exported for unit tests); rewire `wireTripChips` to call those; delete `ensureParamsSheetLoaded`, `bindParamsSheet`, `syncSheetControlsFromState` (settings are now static DOM); wire handle click; wire `clear-trip` to snap full + expand recents; wire `details` toggle to sync chip `data-active`; render recents into `#acc-recents` body (replaces the old `renderRecentsIfEmpty` stub).
- `tests/integration/server/page.test.ts` — update structural assertions to expect unified sheet (no `.sheet--peek`, no `#params-sheet`, chips inside `.sheet__header`, four `.accordion[data-acc=…]`).
- `tests/e2e/atlas.spec.ts` — rewrite the two params-sheet-driven tests (lines ~210–240 and ~410–445) to drive the chips → accordion flow.

**Deleted:**
- `src/server/static-assets/params-sheet.html` — content is inlined into accordion bodies.

**Created:**
- `tests/unit/server/sheet.test.ts` — unit tests for `snapSheet` / `cycleSnap` / `expandAccordion` / `collapseAccordion`.

---

## Conventions

- Each task corresponds to one commit. Commit message format: `<type>(web): <subject>` matching the existing log (`feat(web):`, `style(web):`, `fix(web):`, `refactor(web):`, `test(web):`).
- After every change, run the relevant test suite **before** committing — never commit on red.
- TDD where it fits: tests for `snapSheet` / `expandAccordion` go in the same commit as the code, with the failing test written first (Task 3).
- Test output must be pristine (no console noise, no unhandled promise warnings) per `CLAUDE.md`.
- No `--no-verify`, no skipping hooks. If pre-commit fails, fix the underlying issue.
- Throughout the plan, "the sheet" = `<section id="sheet">`. "The accordion `<name>`" = `<details data-acc="<name>">`.

---

### Task 1: DOM skeleton — unified sheet replaces #params-sheet and #results-sheet

**Files:**
- Modify: `src/server/templates/page.html` (lines ~109–155: trip-chips block, params-sheet block, results-sheet block)

- [ ] **Step 1: Replace the floating `.trip-chips`, `#params-sheet`, and `#results-sheet` blocks**

Open `src/server/templates/page.html`. Delete lines 109–155 (the `<!-- trip chips -->` block, the `<!-- params sheet shell -->` block, and the `<!-- bottom sheet — results -->` block — i.e. everything between the FAB `</button>` and the inline `<script>` for `htmx:beforeSwap`). Replace with:

```html
  <!-- unified bottom sheet — one element, three snap heights -->
  <section class="sheet" id="sheet" data-snap="peek" aria-label="trip details">

    <header class="sheet__header">
      <button type="button" class="sheet__handle" id="sheet-handle"
        aria-label="cycle sheet height" aria-controls="sheet"></button>

      <div class="trip-chips" id="trip-chips" role="toolbar" aria-label="trip parameters">
        <span class="trip-chips__prefix mono">trip ·</span>
        <button type="button" class="chip" data-chip="when" id="chip-when" aria-controls="acc-when">
          <span class="chip__dot chip__dot--now" id="chip-when-dot"></span>
          <span id="chip-when-text">now</span>
          <span class="chip__chev">▾</span>
        </button>
        <button type="button" class="chip" data-chip="goal" id="chip-goal" aria-controls="acc-goal">
          <span id="chip-goal-text">commute</span>
          <span class="chip__chev">▾</span>
        </button>
        <button type="button" class="chip" data-chip="flags" id="chip-flags" aria-controls="acc-flags">
          <span class="mono">ƒ</span>
          <span id="chip-flags-count" class="chip__badge"></span>
        </button>
        <span class="trip-chips__spacer"></span>
        <button type="button" class="chip" data-chip="recents" id="chip-recents" aria-controls="acc-recents">
          <span class="mono">↻</span>
          <span id="chip-recents-text">recents</span>
        </button>
      </div>

      <div class="sheet__indicator" aria-live="polite">
        <div class="stages">
          <div class="stage" data-stage="geocode"><span class="stage__dot"></span> geocode</div>
          <div class="stage" data-stage="osrm"><span class="stage__dot"></span> bike route · osrm-au</div>
          <div class="stage" data-stage="ptv"><span class="stage__dot"></span> ptv departures</div>
          <div class="stage" data-stage="enrich"><span class="stage__dot"></span> enrich · gh-route</div>
          <div class="stage" data-stage="rank"><span class="stage__dot"></span> rank</div>
        </div>
      </div>
    </header>

    <div class="sheet__body">
      <div id="results"></div>

      <details class="accordion" id="acc-when" data-acc="when">
        <summary class="accordion__head"><span class="accordion__icon mono">⏱</span><span class="accordion__title">when</span></summary>
        <div class="accordion__body" id="acc-when-body"><!-- inlined in Task 4 --></div>
      </details>

      <details class="accordion" id="acc-goal" data-acc="goal">
        <summary class="accordion__head"><span class="accordion__icon mono">◆</span><span class="accordion__title">goal</span></summary>
        <div class="accordion__body" id="acc-goal-body"><!-- inlined in Task 4 --></div>
      </details>

      <details class="accordion" id="acc-flags" data-acc="flags">
        <summary class="accordion__head"><span class="accordion__icon mono">ƒ</span><span class="accordion__title">flags</span></summary>
        <div class="accordion__body" id="acc-flags-body"><!-- inlined in Task 4 --></div>
      </details>

      <details class="accordion" id="acc-recents" data-acc="recents">
        <summary class="accordion__head"><span class="accordion__icon mono">↻</span><span class="accordion__title">recents</span></summary>
        <div class="accordion__body" id="acc-recents-body"><!-- populated in Task 5 --></div>
      </details>
    </div>
  </section>
```

The HTMX form indicator selector (`hx-indicator="#results-sheet"`) higher in the file still points at `#results-sheet`. Find it (inside the `<form id="plan-form" …>` opening tag, around line 47) and change it to `hx-indicator="#sheet"`. Leave every other attribute on that form alone.

- [ ] **Step 2: Verify the template still parses and renders**

Run: `npm run test:unit -- tests/unit/server/scaffold.test.ts`
Expected: 1 passed (Fastify boots, `/does-not-exist` 404s).

Run: `npm run test -- tests/integration/server/page.test.ts`
Expected: FAIL on `.sheet--peek`, `#params-sheet[hidden]`, and the chip-count assertion (this is expected — those assertions will be updated in Task 6). Status code should still be 200 and the `#A77ACD` token check should still pass. If the response is 500, the template has a Mustache/HTML syntax error — fix it before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/server/templates/page.html
git commit -m "$(cat <<'EOF'
feat(web): unified sheet skeleton — one bottom region, four accordions

Replaces #params-sheet + #results-sheet + floating .trip-chips with one
<section id="sheet" data-snap="peek"> containing a sticky header (handle +
chips + staged-loader indicator) and a scrollable body (htmx #results target +
four empty <details> accordions: when/goal/flags/recents). Accordion bodies
will be filled in Task 4. JS wiring lands in Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: CSS — snap heights, accordion lilac states, chip active

**Files:**
- Modify: `src/server/static-assets/app.css`

- [ ] **Step 1: Locate and delete the obsolete rules**

In `src/server/static-assets/app.css`, find and **delete**:
- The `.sheet--peek` block(s) (the old results-sheet height/position rules)
- The `.sheet--params` block(s)
- `.params-sheet__head` and `.params-sheet__body` (around lines 444–449)
- Any `position: fixed` rules targeting the standalone `.trip-chips` (the chips were floating above the map; now they're inside `.sheet__header` and inherit positioning)

Run `grep -n 'sheet--peek\|sheet--params\|params-sheet__' src/server/static-assets/app.css` after the deletion — it must return zero matches.

- [ ] **Step 2: Append the new unified-sheet rules**

Append to the end of `src/server/static-assets/app.css`:

```css
/* ─── unified sheet (v3) ──────────────────────────────────────────────── */

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--rmai-white);
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  box-shadow: 0 -8px 32px rgba(26, 27, 37, 0.10);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: height 280ms cubic-bezier(.2, .8, .2, 1);
  z-index: 40;
}

.sheet[data-snap="peek"] { height: 260px; }
.sheet[data-snap="mid"]  { height: 540px; }
.sheet[data-snap="full"] { height: min(750px, 92vh); }

.sheet__header {
  flex: 0 0 auto;
  padding: 6px 14px 8px;
  border-bottom: 1px solid var(--rmai-border);
  background: var(--rmai-white);
}

.sheet__handle {
  display: block;
  width: 36px;
  height: 4px;
  margin: 0 auto 10px;
  border: 0;
  padding: 0;
  border-radius: 2px;
  background: #D9D7D2;
  cursor: pointer;
}
.sheet__handle:focus-visible { outline: 2px solid var(--rmai-purple); outline-offset: 2px; }

.sheet__body {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* trip chips — now inside .sheet__header (not floating) */
.trip-chips {
  display: flex;
  gap: 5px;
  align-items: center;
  overflow-x: auto;
  margin-top: 4px;
  -webkit-overflow-scrolling: touch;
}
.trip-chips__spacer { flex: 1; }

.chip[data-active] {
  background: var(--rmai-lavender);
  border-color: var(--rmai-purple);
}
.chip[data-active] .chip__chev,
.chip[data-active] .chip__badge { color: var(--rmai-purple-d); }

/* accordions — native <details> with lilac active overlay */
.accordion { border-top: 1px solid var(--rmai-border); }

.accordion__head {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--rmai-white);
  border-left: 2px solid transparent;
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--rmai-fg-1);
}
.accordion__head::-webkit-details-marker { display: none; }
.accordion__head::after {
  content: '▾';
  margin-left: auto;
  color: var(--rmai-fg-mut);
  transition: transform 200ms;
}
.accordion[open] > .accordion__head::after { transform: rotate(180deg); }

.accordion__icon { width: 18px; text-align: center; color: var(--rmai-fg-mut); }
.accordion__title { letter-spacing: -0.01em; }

.accordion[data-acc-active] > .accordion__head {
  background: var(--rmai-lavender);
  border-left-color: var(--rmai-purple);
}
.accordion[data-acc-active] > .accordion__head .accordion__icon { color: var(--rmai-purple-d); }

.accordion__body {
  padding: 12px 14px;
  background: var(--rmai-white);
  border-left: 2px solid transparent;
}
.accordion[data-acc-active] > .accordion__body {
  background: var(--rmai-lavender);
  border-left-color: var(--rmai-purple);
}
```

- [ ] **Step 3: Verify CSS is well-formed**

Run: `node -e "const css=require('fs').readFileSync('src/server/static-assets/app.css','utf8'); const open=(css.match(/\{/g)||[]).length; const close=(css.match(/\}/g)||[]).length; console.log({open,close}); if(open!==close) process.exit(1);"`
Expected: `{ open: N, close: N }` with both numbers equal. Exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/static-assets/app.css
git commit -m "$(cat <<'EOF'
style(web): v3 sheet snap heights, accordions, chip active state

Adds .sheet[data-snap=peek|mid|full] (260/540/min(750,92vh)),
.accordion rules with lilac [data-acc-active] overlay, and chip[data-active]
matching purple. Drops .sheet--peek/.sheet--params/.params-sheet__*/floating
.trip-chips rules.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: JS — snapSheet / expandAccordion + unit tests

**Files:**
- Create: `tests/unit/server/sheet.test.ts`
- Modify: `src/server/static-assets/atlas.js` (add new exports)

- [ ] **Step 1: Write failing unit tests for snapSheet / cycleSnap / expandAccordion / collapseAccordion**

Create `tests/unit/server/sheet.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npm run test -- tests/unit/server/sheet.test.ts`
Expected: FAIL with "snapSheet is not exported" / "is not a function" (the functions don't exist yet).

- [ ] **Step 3: Implement the four functions in atlas.js**

In `src/server/static-assets/atlas.js`, add a new section near the existing exports (above `// --- bootstrap ---` is a good home). Insert:

```js
// --- v3 unified sheet ---

const SNAP_HEIGHTS = ['peek', 'mid', 'full'];

export function snapSheet(target) {
  const sheet = document.getElementById('sheet');
  if (!sheet || !SNAP_HEIGHTS.includes(target)) return;
  sheet.dataset.snap = target;
  sheet.dispatchEvent(new CustomEvent('sheet:snap', { detail: { target } }));
}

export function cycleSnap() {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  const cur = sheet.dataset.snap || 'peek';
  const next = SNAP_HEIGHTS[(SNAP_HEIGHTS.indexOf(cur) + 1) % SNAP_HEIGHTS.length];
  snapSheet(next);
}

export function expandAccordion(name, { scroll = true } = {}) {
  const acc = document.querySelector(`.accordion[data-acc="${name}"]`);
  if (!acc) return;
  acc.open = true;
  document.querySelectorAll('.accordion[data-acc-active]').forEach((a) => {
    if (a !== acc) delete a.dataset.accActive;
  });
  acc.dataset.accActive = '';
  document.querySelectorAll('.chip[data-chip]').forEach((c) => {
    if (c.dataset.chip === name) c.dataset.active = '';
    else delete c.dataset.active;
  });
  if (scroll && typeof acc.scrollIntoView === 'function') {
    acc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export function collapseAccordion(name) {
  const acc = document.querySelector(`.accordion[data-acc="${name}"]`);
  if (!acc) return;
  acc.open = false;
  delete acc.dataset.accActive;
  const chip = document.querySelector(`.chip[data-chip="${name}"]`);
  if (chip) delete chip.dataset.active;
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `npm run test -- tests/unit/server/sheet.test.ts`
Expected: all 8 tests pass, no warnings.

- [ ] **Step 5: Make sure no existing unit test broke**

Run: `npm run test:unit`
Expected: full unit suite passes (sheet.test.ts adds 8; everything else unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/server/static-assets/atlas.js tests/unit/server/sheet.test.ts
git commit -m "$(cat <<'EOF'
feat(web): snapSheet/cycleSnap/expandAccordion/collapseAccordion

Four pure setters for the unified sheet:
  • snapSheet(name)         — peek/mid/full; dispatches sheet:snap event
  • cycleSnap()             — handle-tap helper, peek→mid→full→peek
  • expandAccordion(name)   — opens accordion, marks active, syncs chip;
                              does NOT close siblings (independent accordions)
  • collapseAccordion(name) — closes, clears active on accordion + chip

Wiring (chip listeners, handle listener, clear button) lands in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Inline settings sections into accordion bodies

**Files:**
- Modify: `src/server/templates/page.html` (the three empty `<div class="accordion__body" id="acc-{when,goal,flags}-body">` placeholders)
- Delete: `src/server/static-assets/params-sheet.html`

The content comes verbatim from `src/server/static-assets/params-sheet.html` (read it first to confirm field IDs). The current partial has four sections — `when`, `goal`, `mode`, `flags` (which itself contains hill-weight, min-on-path, bike-km range, max-transfers, prefer-bike-path). Per the spec amendment, `mode` folds into the flags accordion.

- [ ] **Step 1: Inline the `when` accordion body**

In `src/server/templates/page.html`, replace `<!-- inlined in Task 4 -->` inside `#acc-when-body` with:

```html
<div class="seg-buttons">
  <button type="button" class="seg-btn" data-when="now">now</button>
  <button type="button" class="seg-btn is-active" data-when="depart">depart at</button>
  <button type="button" class="seg-btn" data-when="arriveBy">arrive by</button>
</div>
<div class="time-input">
  <input type="text" id="ps-time" inputmode="numeric" pattern="\d{2}:\d{2}" placeholder="HH:MM">
</div>
```

- [ ] **Step 2: Inline the `goal` accordion body**

Replace `<!-- inlined in Task 4 -->` inside `#acc-goal-body` with:

```html
<div class="goal-cards">
  <label class="goal-card"><input type="radio" name="ps-goal" value="commute"><div><b>commute</b><small>shortest reasonable time door-to-door</small></div></label>
  <label class="goal-card"><input type="radio" name="ps-goal" value="day-ride"><div><b>day-ride</b><small>prefer dedicated cycleways, accept longer routes</small></div></label>
  <label class="goal-card"><input type="radio" name="ps-goal" value="max-path"><div><b>max-path</b><small>maximise on-path mileage at any cost</small></div></label>
</div>
```

- [ ] **Step 3: Inline the `flags` accordion body (includes mode, hill-weight, min-on-path, bike-km range, max-transfers, prefer-bike-path)**

Replace `<!-- inlined in Task 4 -->` inside `#acc-flags-body` with:

```html
<div class="eyebrow">— mode</div>
<div class="seg-buttons">
  <button type="button" class="seg-btn" data-mode="bike-only">bike-only</button>
  <button type="button" class="seg-btn is-active" data-mode="bike-train">bike-train</button>
</div>

<div class="eyebrow">— hill weight · -2 flat · +2 hilly</div>
<input type="range" id="ps-hillWeight" min="-2" max="2" step="0.5" value="0">
<output id="ps-hillWeight-out" class="mono">0</output>

<div class="eyebrow">— min on-path fraction</div>
<input type="range" id="ps-minOnPath" min="0" max="1" step="0.05" value="0">
<output id="ps-minOnPath-out" class="mono">0%</output>

<div class="eyebrow">— bike km range</div>
<div class="range-row">
  <input type="number" id="ps-minBikeKm" min="0" max="50" step="1" value="0" class="mono">
  <span>—</span>
  <input type="number" id="ps-maxBikeKm" min="0" max="50" step="1" value="20" class="mono">
  <span class="mono">km</span>
</div>

<div class="eyebrow">— max transfers</div>
<div class="seg-buttons" id="ps-maxTransfers">
  <button type="button" class="seg-btn" data-transfers="0">0</button>
  <button type="button" class="seg-btn is-active" data-transfers="1">1</button>
  <button type="button" class="seg-btn" data-transfers="2">2</button>
  <button type="button" class="seg-btn" data-transfers="3">3</button>
</div>

<label class="check-row">
  <input type="checkbox" id="ps-preferBikePath"> prefer-bike-path
</label>
```

(The `eyebrow` and section-frame styling that used to wrap each section in `params-sheet.html` is no longer needed — each section is now an accordion in its own right.)

- [ ] **Step 4: Delete the orphaned partial**

```bash
rm src/server/static-assets/params-sheet.html
```

Run: `grep -rn 'params-sheet.html' src/ 2>/dev/null | grep -v Binary`
Expected: only the line inside `src/server/static-assets/atlas.js` that fetches it (`fetch('/static/params-sheet.html')`) — that fetch will be removed in Task 6. No other references.

- [ ] **Step 5: Verify the integration test still loads the page**

Run: `npm run test -- tests/integration/server/page.test.ts`
Expected: the first test (`serves the Atlas shell with required structural elements`) still fails on `.sheet--peek` and the third test fails on `#params-sheet[hidden]` and the chip-count assertion. Those failures will be fixed in Task 6 by rewriting the assertions. **What must pass here:** the page renders with status 200, contains `#A77ACD`, and has no template-parsing errors (no 500 status). If any test errors out with a 500, fix the template before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/server/templates/page.html src/server/static-assets/params-sheet.html
git commit -m "$(cat <<'EOF'
feat(web): inline settings sections into accordion bodies; delete params-sheet partial

Moves the when/goal/mode/flags controls from /static/params-sheet.html into
#acc-when-body / #acc-goal-body / #acc-flags-body in page.html. Mode segmented
control folds into the flags accordion per the spec amendment (chip strip is
when/goal/flags/recents — no mode chip).

The async fetch('/static/params-sheet.html') and bind/sync helpers in atlas.js
are removed in Task 6 (now Task 5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire chips + handle + clear + details-toggle; delete params-sheet code from atlas.js

**Files:**
- Modify: `src/server/static-assets/atlas.js`

- [ ] **Step 1: Delete the obsolete params-sheet code**

In `src/server/static-assets/atlas.js`, delete these blocks entirely:

1. The `// --- params-sheet ---` section (currently lines ~734–916): the `__paramsSheetHtml` cache, `ensureParamsSheetLoaded`, the current `wireTripChips` implementation, `bindParamsSheet`, `syncSheetControlsFromState`.

(We keep `refreshChipLabels` — it's used by the new wiring. It currently lives right after `syncSheetControlsFromState`. Make sure your deletion stops *before* the `export function refreshChipLabels()` line.)

Run after deletion: `grep -n 'paramsSheet\|params-sheet\|bindParamsSheet\|syncSheetControlsFromState\|ensureParamsSheetLoaded' src/server/static-assets/atlas.js`
Expected: zero matches.

- [ ] **Step 2: Add the new wireTripChips (chips → snap + expand) plus wireSheetHandle, wireClearForRecents, wireAccordionToggleSync**

Insert these exports where the deleted block used to be (above `refreshChipLabels`):

```js
// --- v3 unified sheet wiring ---

export function wireTripChips(sm) {
  const chips = document.getElementById('trip-chips');
  if (!chips) return;
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-chip]');
    if (!chip) return;
    const name = chip.dataset.chip;
    if ('active' in chip.dataset) {
      collapseAccordion(name);
      snapSheet('peek');
    } else {
      snapSheet('full');
      expandAccordion(name);
    }
    // Settings inputs are static DOM now; bind their listeners once on first
    // chip-tap (idempotent — guarded inside bindStaticParamControls).
    bindStaticParamControls(sm);
    refreshChipLabels();
  });
}

export function wireSheetHandle() {
  const handle = document.getElementById('sheet-handle');
  if (!handle) return;
  handle.addEventListener('click', cycleSnap);
}

export function wireClearForRecents() {
  const clearBtn = document.getElementById('clear-trip');
  if (!clearBtn) return;
  clearBtn.addEventListener('click', () => {
    snapSheet('full');
    expandAccordion('recents');
  });
}

export function wireAccordionToggleSync() {
  document.querySelectorAll('.accordion').forEach((acc) => {
    acc.addEventListener('toggle', () => {
      if (acc.open) {
        acc.dataset.accActive = '';
      } else {
        delete acc.dataset.accActive;
        const name = acc.dataset.acc;
        const chip = document.querySelector(`.chip[data-chip="${name}"]`);
        if (chip) delete chip.dataset.active;
      }
    });
  });
}

// Replaces the old bindParamsSheet — same control wiring, but the controls now
// live in static DOM (accordion bodies) instead of an async-fetched partial.
function bindStaticParamControls(sm) {
  const root = document.getElementById('sheet');
  if (!root || root.__paramControlsBound) return;

  const p = sm.state.params;

  // WHEN
  const activeWhen = p.arriveBy ? 'arriveBy' : p.depart ? 'depart' : 'now';
  document.querySelectorAll('[data-when]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.when === activeWhen);
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-when]').forEach((x) => x.classList.toggle('is-active', x === b));
      const which = b.dataset.when;
      const v = document.getElementById('ps-time')?.value || '';
      document.getElementById('param-depart').value   = (which === 'depart')   ? v : '';
      document.getElementById('param-arriveBy').value = (which === 'arriveBy') ? v : '';
    });
  });
  const tEl = document.getElementById('ps-time');
  if (tEl) {
    tEl.value = p.depart || p.arriveBy || '';
    tEl.addEventListener('input', () => {
      const which = document.querySelector('[data-when].is-active')?.dataset.when;
      const v = tEl.value;
      document.getElementById('param-depart').value   = (which === 'depart')   ? v : '';
      document.getElementById('param-arriveBy').value = (which === 'arriveBy') ? v : '';
    });
  }

  // GOAL
  document.querySelectorAll('input[name="ps-goal"]').forEach((r) => {
    r.checked = r.value === p.goal;
    r.addEventListener('change', () => { document.getElementById('param-goal').value = r.value; });
  });

  // MODE (now lives inside the flags accordion)
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === p.mode);
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('is-active', x === b));
      document.getElementById('param-mode').value = b.dataset.mode;
    });
  });

  // HILL WEIGHT
  const hw = document.getElementById('ps-hillWeight');
  if (hw) {
    hw.value = String(p.hillWeight);
    const out = document.getElementById('ps-hillWeight-out');
    if (out) out.textContent = String(p.hillWeight);
    hw.addEventListener('input', () => {
      if (out) out.textContent = hw.value;
      document.getElementById('param-hillWeight').value = hw.value;
    });
  }

  // MIN ON PATH
  const mp = document.getElementById('ps-minOnPath');
  if (mp) {
    const v = typeof p.minOnPathFraction === 'number' ? p.minOnPathFraction
            : (p.minOnPathFraction === '' || p.minOnPathFraction == null ? 0 : Number(p.minOnPathFraction));
    mp.value = String(v);
    const out = document.getElementById('ps-minOnPath-out');
    if (out) out.textContent = `${Math.round(v * 100)}%`;
    mp.addEventListener('input', () => {
      if (out) out.textContent = `${Math.round(Number(mp.value) * 100)}%`;
      document.getElementById('param-minOnPathFraction').value = mp.value === '0' ? '' : mp.value;
    });
  }

  // BIKE KM RANGE
  const minK = document.getElementById('ps-minBikeKm');
  const maxK = document.getElementById('ps-maxBikeKm');
  if (minK) {
    minK.value = String(p.minBikeKm);
    minK.addEventListener('input', () => { document.getElementById('param-minBikeKm').value = minK.value; });
  }
  if (maxK) {
    maxK.value = String(p.maxBikeKm);
    maxK.addEventListener('input', () => { document.getElementById('param-maxBikeKm').value = maxK.value; });
  }

  // TRANSFERS
  document.querySelectorAll('[data-transfers]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.transfers === String(p.maxTransfers));
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-transfers]').forEach((x) => x.classList.toggle('is-active', x === b));
      document.getElementById('param-maxTransfers').value = b.dataset.transfers;
    });
  });

  // PREFER BIKE PATH
  const pbp = document.getElementById('ps-preferBikePath');
  if (pbp) {
    pbp.checked = !!p.preferBikePath;
    pbp.addEventListener('change', () => {
      document.getElementById('param-preferBikePath').value = String(pbp.checked);
    });
  }

  root.__paramControlsBound = true;
}
```

- [ ] **Step 3: Register the new wirings in `init()`**

In `src/server/static-assets/atlas.js`, find the `export function init() {` block (around line 946). Inside, find the line `wireTripChips(sm);` (it already exists — same function name, new implementation). **Immediately after** that line, add:

```js
  wireSheetHandle();
  wireClearForRecents();
  wireAccordionToggleSync();
  bindStaticParamControls(sm);
```

Also, the old `init()` calls `renderRecentsIfEmpty(sm)` after `refreshChipLabels()`. Leave that line in place for now — Task 7 replaces it with `renderRecentsAccordion(sm)`.

- [ ] **Step 4: Run unit tests**

Run: `npm run test:unit`
Expected: all unit tests pass — `sheet.test.ts` still green; `atlas-helpers.test.ts` still green (it doesn't import any of the deleted symbols — verify by `grep -n 'bindParamsSheet\|paramsSheet' tests/unit/server/atlas-helpers.test.ts` returning nothing).

- [ ] **Step 5: Commit**

```bash
git add src/server/static-assets/atlas.js
git commit -m "$(cat <<'EOF'
refactor(web): wire chips→snap+expand, handle→cycle, clear→recents

Replaces the old chip→params-sheet flow with chip→(snap full + expand
accordion) using snapSheet/expandAccordion from Task 3. Wires the sheet handle
(cycle peek→mid→full), the clear-trip × button (snap full + expand recents),
and a <details> toggle listener that keeps chip [data-active] in sync with
manual accordion taps.

Deletes the params-sheet code: ensureParamsSheetLoaded (and its fetch),
bindParamsSheet, syncSheetControlsFromState. The setting controls now live in
static DOM (accordion bodies) and are bound once via bindStaticParamControls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update template integration test for the unified sheet

**Files:**
- Modify: `tests/integration/server/page.test.ts`

- [ ] **Step 1: Rewrite the structural assertions**

Open `tests/integration/server/page.test.ts`. Replace the body of `describe('GET /', () => { … })` with these three tests (this fully supersedes the existing three tests):

```ts
describe('GET /', () => {
  it('serves the Atlas shell with required structural elements', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);

    const $ = load(res.body);
    expect($('script[src*="htmx"]').length).toBeGreaterThan(0);
    expect($('link[href*="leaflet"]').length).toBeGreaterThan(0);
    expect($('link[href*="app.css"]').length).toBeGreaterThan(0);
    expect($('#map').length).toBe(1);
    expect($('.from-to-pill').length).toBe(1);
    expect($('input[name="origin-query"]').length).toBe(1);
    expect($('input[name="destination-query"]').length).toBe(1);
    expect($('section.sheet#sheet').length).toBe(1);     // unified sheet
    expect($('#results').length).toBe(1);                 // htmx swap target
    expect($('form[hx-post*="/api/plan"]').length).toBe(1);
    await app.close();
  });

  it('embeds the Atlas palette token in CSS', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('#A77ACD');
    expect(res.body).toContain('#1A1B25');
    await app.close();
  });

  it('serves the v3 shell — unified sheet, four accordions, four chips, no params-sheet', async () => {
    const app = createApp({ logger: false, nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    const $ = load(res.body);

    // collapsing pill stays
    expect($('#from-to-pill[data-state]').length).toBe(1);
    expect($('.pill-edit').length).toBe(1);
    expect($('.pill-collapsed').length).toBe(1);

    // unified sheet
    const sheet = $('section.sheet#sheet');
    expect(sheet.length).toBe(1);
    expect(sheet.attr('data-snap')).toBe('peek');

    // chips live inside the sheet header (not floating)
    expect($('.sheet__header #trip-chips').length).toBe(1);
    // four chips: when, goal, flags, recents
    expect($('#trip-chips .chip[data-chip]').length).toBe(4);
    ['when','goal','flags','recents'].forEach((name) => {
      expect($(`#trip-chips .chip[data-chip="${name}"]`).length).toBe(1);
    });

    // map FAB stays
    expect($('#fab-geolocate').length).toBe(1);

    // params-sheet is gone
    expect($('#params-sheet').length).toBe(0);
    expect($('.sheet--params').length).toBe(0);
    expect($('.sheet--peek').length).toBe(0);
    expect($('#params-done').length).toBe(0);

    // four accordions, exactly
    const accs = $('.accordion[data-acc]');
    expect(accs.length).toBe(4);
    ['when','goal','flags','recents'].forEach((name) => {
      expect($(`.accordion[data-acc="${name}"]`).length).toBe(1);
    });

    // staged loader stays (now inside .sheet__header)
    expect($('.sheet__header .sheet__indicator .stage').length).toBe(5);

    // clear button moved into collapsed pill (unchanged)
    expect($('#clear-trip').length).toBe(1);

    // no orange Plan CTA
    expect($('#plan-btn').length).toBe(0);
    expect($('.btn--cta').length).toBe(0);

    // hidden inputs for params (still inside #plan-form, unchanged)
    ['mode','goal','depart','arriveBy','minBikeKm','maxBikeKm','maxTransfers','hillWeight','minOnPathFraction','preferBikePath']
      .forEach((n) => expect($(`input[type=hidden][name="${n}"]`).length).toBe(1));

    // settings controls live inside the accordion bodies
    expect($('#acc-when-body [data-when="depart"]').length).toBe(1);
    expect($('#acc-goal-body input[name="ps-goal"][value="max-path"]').length).toBe(1);
    expect($('#acc-flags-body #ps-hillWeight').length).toBe(1);
    expect($('#acc-flags-body [data-mode="bike-only"]').length).toBe(1);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the updated integration test**

Run: `npm run test -- tests/integration/server/page.test.ts`
Expected: 3 passed, no warnings.

- [ ] **Step 3: Run the full unit + integration suite**

Run: `npm run test:unit && npm run test:integration`
Expected: every suite passes.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/server/page.test.ts
git commit -m "$(cat <<'EOF'
test(web): update page integration test for unified sheet

Asserts: one <section.sheet#sheet data-snap=peek>, chips live inside
.sheet__header (not floating), four chips (when/goal/flags/recents) and four
matching .accordion[data-acc=…] elements. No #params-sheet, no .sheet--peek,
no .sheet--params, no #params-done. Settings controls (ps-time, ps-goal,
ps-hillWeight, ps-mode) live inside the accordion bodies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Render recents into the recents accordion (replaces renderRecentsIfEmpty)

**Files:**
- Modify: `src/server/static-assets/atlas.js`
- Modify: `src/server/static-assets/recents.js` (only if a small helper is needed — likely no change)

- [ ] **Step 1: Find and read the existing `renderRecentsIfEmpty`**

Run: `grep -n 'renderRecentsIfEmpty' src/server/static-assets/atlas.js`

Read the function definition (a few lines starting at the matched line). The existing implementation renders into an empty-state slot inside `#results-sheet`. We're replacing it with one that:
- Always renders the rows (not "if empty")
- Targets `#acc-recents-body`
- Each row triggers a re-plan on click (origin/destination → state machine → submit form)
- After a successful click, the recents accordion collapses and the sheet snaps to peek

- [ ] **Step 2: Replace `renderRecentsIfEmpty` with `renderRecentsAccordion`**

In `src/server/static-assets/atlas.js`, replace the body of `renderRecentsIfEmpty` (function name included) with:

```js
export function renderRecentsAccordion(sm) {
  const body = document.getElementById('acc-recents-body');
  if (!body) return;
  const rows = listRecents();
  if (!rows.length) {
    body.innerHTML = '<div class="recents-empty mono">no recent trips yet</div>';
    return;
  }
  body.innerHTML = rows.map((r, i) => `
    <button type="button" class="recents-row" data-recent="${i}">
      <span class="recents-row__dots">
        <span class="dot dot--origin">A</span>
        <span class="recents-row__connector"></span>
        <span class="dot dot--destination">B</span>
      </span>
      <span class="recents-row__labels">
        <span class="recents-row__from">${escapeText(r.originLabel || formatCoord(r.origin))}</span>
        <span class="recents-row__to">${escapeText(r.destinationLabel || formatCoord(r.destination))}</span>
        <span class="recents-row__ago mono">${formatAgo(r.ts)}</span>
      </span>
    </button>
  `).join('');

  body.querySelectorAll('.recents-row[data-recent]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.recent);
      const t = rows[idx];
      if (!t) return;
      sm.setState({
        origin: t.origin,
        destination: t.destination,
        params: { ...sm.state.params, ...(t.params || {}) },
      });
      collapseAccordion('recents');
      snapSheet('peek');
      firePlan(sm);
    });
  });
}

function escapeText(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

function formatAgo(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

If `listRecents` isn't already imported at the top of `atlas.js`, add it. Search for an existing import line that names `recents.js` (`grep -n 'from .recents' src/server/static-assets/atlas.js`). If one exists, append `listRecents` to its named imports. If none exists, add at the top of the file (after any existing imports):

```js
import { listRecents, addRecent } from './recents.js';
```

If `addRecent` is already imported elsewhere in `atlas.js`, do not add it again. If `firePlan` and `formatCoord` are not imported/defined in this file's scope, they already are — verify with `grep -n 'function firePlan\|function formatCoord' src/server/static-assets/atlas.js` (both should be defined locally).

- [ ] **Step 3: Update `init()` to call the renamed function**

In `init()`, find `renderRecentsIfEmpty(sm);` and replace with:

```js
  renderRecentsAccordion(sm);
```

Also, find any other callers of `renderRecentsIfEmpty` (post-plan hook, clear hook, etc.) with:

`grep -n 'renderRecentsIfEmpty' src/server/static-assets/atlas.js`

Rename each remaining call site to `renderRecentsAccordion`. The behavior is broader (always renders), so callers that previously only ran "when empty" are now allowed to run unconditionally.

- [ ] **Step 4: Append minimal styles for recents rows**

In `src/server/static-assets/app.css`, append:

```css
.recents-empty { padding: 16px; color: var(--rmai-fg-mut); text-align: center; }
.recents-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 12px 14px;
  border: 0; border-bottom: 1px solid rgba(167, 122, 205, 0.18);
  background: transparent; cursor: pointer; text-align: left;
  font-family: var(--sans);
}
.recents-row:last-child { border-bottom: 0; }
.recents-row__dots { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.recents-row__connector { width: 1px; height: 10px; background: var(--rmai-border); }
.recents-row__labels { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; font-weight: 600; color: var(--rmai-fg-1); }
.recents-row__ago { font-size: 10px; color: var(--rmai-fg-mut); font-weight: 500; }
```

- [ ] **Step 5: Run unit + integration suites**

Run: `npm run test:unit && npm run test:integration`
Expected: everything still passes. The unit suite doesn't directly exercise `renderRecentsAccordion`, but the page integration test's static assertions still hold.

- [ ] **Step 6: Commit**

```bash
git add src/server/static-assets/atlas.js src/server/static-assets/app.css
git commit -m "$(cat <<'EOF'
feat(web): render recents into #acc-recents-body; row click → re-plan

Replaces renderRecentsIfEmpty (which rendered into an empty-state slot inside
the old #results-sheet) with renderRecentsAccordion: always renders, targets
#acc-recents-body. Each row is a button that restores origin/destination/params
into the state machine, collapses the recents accordion, snaps the sheet to
peek, and fires a fresh plan.

Minimal .recents-row styles in app.css.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Rewrite the e2e atlas spec for the unified sheet

**Files:**
- Modify: `tests/e2e/atlas.spec.ts`

There are two existing tests in the file that drive the old `#params-sheet` flow (around lines 210–240 and 410–445). They click `chip-when` / `chip-goal`, expect `#params-sheet` to become visible, then click `#params-done`. Both must be rewritten to drive the unified-sheet flow. Other tests in the file (Atlas shell smoke, click-to-route, URL load, clear, geolocate, form-submit) reference `.sheet--peek` in one place (line ~64) — that single locator also needs updating.

The `#params-sheet` selector also appears on line ~441 in a "sheet should be hidden again" assertion — that asserts post-`done` behavior which no longer exists.

- [ ] **Step 1: Update the single `.sheet--peek` reference in the Atlas-shell smoke test**

Find line ~64 (`await expect(page.locator('.sheet--peek')).toBeVisible();`) and replace with:

```ts
  await expect(page.locator('section.sheet#sheet')).toBeVisible();
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'peek');
```

Also, the smoke test currently asserts `#chip-when, #chip-goal, #chip-flags` `.toHaveCount(3)`. Update to expect 4 chips including recents:

```ts
  await expect(page.locator('#trip-chips .chip[data-chip]')).toHaveCount(4);
```

- [ ] **Step 2: Rewrite the first params-sheet-driven test (the "depart at 08:00" one, around lines 210–240)**

Replace the block from `await page.evaluate(() => document.getElementById('chip-when')?.click());` down to `expect(parsed.depart).toBe('08:00');` with:

```ts
  // Click the "when" chip → sheet should snap to full, when accordion opens + active
  await page.evaluate(() => document.getElementById('chip-when')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#acc-when')).toHaveAttribute('open', '');
  await expect(page.locator('#acc-when')).toHaveAttribute('data-acc-active', '');
  await expect(page.locator('#chip-when')).toHaveAttribute('data-active', '');

  // Pick depart-at, type 08:00, then close by tapping the chip again
  await page.locator('#acc-when-body [data-when="depart"]').click();
  await page.locator('#acc-when-body #ps-time').fill('08:00');
  // Tapping the active chip again collapses the accordion + snaps to peek
  await page.evaluate(() => document.getElementById('chip-when')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'peek');

  // Fire the plan explicitly (no auto-fire on close in v3)
  await page.evaluate(() => {
    const f = document.getElementById('plan-form') as HTMLFormElement | null;
    if (f) f.requestSubmit();
  });
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });

  const parsed = JSON.parse(capturedJsonBody);
  expect(parsed.depart).toBe('08:00');
```

- [ ] **Step 3: Rewrite the second params-sheet-driven test (the "goal=max-path" one, around lines 410–445)**

Replace the block from `await page.evaluate(() => document.getElementById('chip-goal')?.click());` down to `expect(parsed.goal).toBe('max-path');` with:

```ts
  await page.evaluate(() => document.getElementById('chip-goal')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#acc-goal')).toHaveAttribute('open', '');

  // Select max-path and verify the hidden input updated
  await page.locator('#acc-goal-body input[name="ps-goal"][value="max-path"]').check();
  await expect(page.locator('#param-goal')).toHaveValue('max-path');

  // Tap the chip again to close (replaces the old "done" button)
  await page.evaluate(() => document.getElementById('chip-goal')?.click());
  await expect(page.locator('#acc-goal')).not.toHaveAttribute('open', '');

  // Fire the plan explicitly
  await page.evaluate(() => {
    const f = document.getElementById('plan-form') as HTMLFormElement | null;
    if (f) f.requestSubmit();
  });
  await expect(page.locator('#results .itinerary-card')).toHaveCount(1, { timeout: 5000 });

  const parsed = JSON.parse(capturedBody);
  expect(parsed.goal).toBe('max-path');
```

- [ ] **Step 4: Add three new tests covering v3-specific gestures**

At the bottom of `tests/e2e/atlas.spec.ts`, add:

```ts
test('handle cycles peek → mid → full → peek', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);
  const sheet = page.locator('section.sheet#sheet');
  // Initial state can vary (full if empty recents flow; peek if loaded with state).
  // Force peek by clicking the handle until we land there.
  for (let i = 0; i < 3; i++) {
    if (await sheet.getAttribute('data-snap') === 'peek') break;
    await page.locator('#sheet-handle').click();
  }
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
  await page.locator('#sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'mid');
  await page.locator('#sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'full');
  await page.locator('#sheet-handle').click();
  await expect(sheet).toHaveAttribute('data-snap', 'peek');
});

test('clear-trip × snaps sheet to full and opens recents accordion', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);
  // Put the pill in a "set" state so the × button is in the DOM and clickable
  await page.evaluate(() => {
    (window as any).__atlas.sm.setState({
      origin:      { lat: -37.64, lon: 145.19 },
      destination: { lat: -37.86, lon: 144.89 },
    });
  });
  await page.evaluate(() => document.getElementById('clear-trip')?.click());
  await expect(page.locator('section.sheet#sheet')).toHaveAttribute('data-snap', 'full');
  await expect(page.locator('#acc-recents')).toHaveAttribute('open', '');
  await expect(page.locator('#chip-recents')).toHaveAttribute('data-active', '');
});

test('accordions are independent — opening one does not close another', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window as any).__atlas);
  await page.evaluate(() => document.getElementById('chip-when')?.click());
  await expect(page.locator('#acc-when')).toHaveAttribute('open', '');
  await page.evaluate(() => document.getElementById('chip-goal')?.click());
  // Both should now be open; only the most-recent one is "active"
  await expect(page.locator('#acc-when')).toHaveAttribute('open', '');
  await expect(page.locator('#acc-goal')).toHaveAttribute('open', '');
  await expect(page.locator('#acc-goal')).toHaveAttribute('data-acc-active', '');
  await expect(page.locator('#acc-when')).not.toHaveAttribute('data-acc-active', '');
});
```

- [ ] **Step 5: Make sure no `#params-sheet`/`#params-done`/`.sheet--peek`/`.sheet--params` references remain anywhere in the file**

Run: `grep -n 'params-sheet\|params-done\|sheet--peek\|sheet--params' tests/e2e/atlas.spec.ts`
Expected: zero matches.

- [ ] **Step 6: Build, start the server, run the e2e suite**

Run: `npm run build`
Expected: 0 errors.

Run: `npm run test:e2e:browser`
Expected: all browser tests pass. (Some Playwright tests boot their own server; if `BASE` is hardcoded to a port, ensure the server is running first via the existing test fixture — do not change that pattern, just trust it.)

If a test fails because of a timing issue around `data-snap` toggling, add a small `await page.waitForFunction` checking the attribute before the assertion — but only as a real fix to a real flake, not preemptively.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/atlas.spec.ts
git commit -m "$(cat <<'EOF'
test(web): rewrite e2e for unified sheet — chip→snap+expand flow

Rewrites the two params-sheet-driven tests to drive the v3 flow: chip click
snaps the sheet to full + opens + marks active the matching accordion; tapping
the chip again collapses + snaps back to peek. Adds three new tests covering
the handle cycle (peek→mid→full→peek), the clear-× → recents auto-open
behavior, and accordion independence.

Drops the .sheet--peek/.params-sheet/#params-done references; updates the chip
count assertion from 3 to 4 (recents added).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Final verification — full test suite + manual sanity + bd housekeeping

**Files:**
- (Possibly) `web/README.md` if it mentions the three-surface layout
- (Possibly) a `bd` issue closure

- [ ] **Step 1: Full test sweep**

Run: `npm test`
Expected: every suite passes. Output must be pristine — no unhandled promise rejections, no console warnings, no skipped tests other than those that auto-skip without credentials (the integration suite skips itself when `PTV_DEV_ID` is unset; that's expected).

If anything fails, fix it and re-run before moving to the next step. Do not skip or `it.skip` to "get green" — fix the underlying issue.

- [ ] **Step 2: Update web/README.md (if needed)**

Run: `grep -in 'params-sheet\|results-sheet\|trip-chips floating\|three-surface\|two sheets' web/README.md 2>/dev/null`
If any matches, edit `web/README.md` to describe the v3 single-sheet model instead. If there are no matches, skip this step.

- [ ] **Step 3: Manual sanity (developer-side; one-time)**

Run: `npm run build && node dist/server/index.js` (or whatever start command is in `package.json scripts.start` — check with `grep '"start"' package.json`).

In a browser at the local URL:
1. Page loads — sheet shows in peek state with empty results, recents accordion either auto-open (if first load) or closed (if not).
2. Tap the `goal` chip — sheet animates upward to full, goal accordion opens with lilac left-bar; chip is lilac.
3. Tap `goal` chip again — sheet snaps back to peek, accordion closes.
4. Tap the handle three times — sheet cycles peek → mid → full → peek.
5. Open `goal`, then open `when` — both stay open (independent). Tap `when` chip a second time — only `when` collapses; `goal` stays.
6. Enter origin + destination, hit Enter — plan fires (staged loader visible inside `.sheet__header`), trip card lands in `#results`, sheet stays at peek.
7. Tap × — sheet snaps to full, recents accordion auto-opens with lilac.
8. Click a recents row — sheet snaps to peek, accordion closes, plan fires.

Note any visual regressions (lilac edges missing, chip count off, etc.) and fix before continuing.

- [ ] **Step 4: bd housekeeping (per CLAUDE.md convention)**

Run: `bd list 2>/dev/null | grep -i 'params-sheet\|three-surface\|two sheets\|settings at top'`
If any open bead matches the problem this PR solves, close it:
```bash
bd close <id> --comment "Resolved by v3 unified-sheet redesign (worktree-bike-rail-v2)."
```

Open a follow-up bead for Option B (tablet variant):
```bash
bd create "v3 Option B: tablet split-panel @media variant" --type feature --labels v3-followup
```

If `bd` isn't on PATH or the project's bead state isn't initialized for this user, skip and note manually.

- [ ] **Step 5: Final commit (chore + bd)**

If anything was changed in Step 2 or Step 4 (or Step 3 found a small fix), commit it:

```bash
git status -sb
git add <files>
git commit -m "$(cat <<'EOF'
chore(web): close out v3 unified-sheet PR — readme + bead housekeeping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip the commit.

- [ ] **Step 6: Confirm branch is ready**

Run: `git log --oneline origin/main..HEAD`
Expected: 8 (or 9 if Step 5 commit happened) commits, each scoped per the plan. Branch is on `worktree-bike-rail-v2`.

Run: `git status -sb`
Expected: clean tree (apart from possibly the gitignored `test-results/` directory).

The branch is ready for PR / merge. Per CLAUDE.md, do NOT push or open a PR without explicit instruction.

---

## Self-Review

**Spec coverage:**

- DOM (spec § "DOM (page.html)") → Task 1.
- CSS (spec § "CSS (app.css)") → Task 2.
- JS setters (`snapSheet`/`cycleSnap`/`expandAccordion`/`collapseAccordion`) → Task 3.
- JS event wiring (chip, handle, details toggle, clear) → Task 5.
- Settings body content port (when/goal/flags incl. mode) → Task 4.
- Server changes (delete partial, remove fetch+open/close logic) → Task 4 deletes the file; Task 5 deletes the JS that fetched it.
- State transitions (empty/editing/planning/result/chip-tap/handle/×) → covered piecewise: peek default in Task 1; chip → full + expand in Task 5; × → full + recents in Task 5; handle cycle in Task 5; recents row click → peek + collapse in Task 7. The `editing`/`planning` transitions are unchanged from current behavior (pill `data-state` machine + htmx indicator), so no new code; verified by manual sanity in Task 9.
- Test plan (unit sheet.test.ts, page.test.ts update, e2e new spec) → Tasks 3, 6, 8.
- Retire old params-sheet e2e → Task 8 rewrites both in-place rather than deleting (the same spec file is reused, which the spec allows: "rewrite to the above or delete").
- Commit sequence (8 commits) → Tasks 1–8. Task 9 is a verification gate not in the 8-commit spec list; it covers spec items "chore" and "bd close" with a 9th commit only if work was actually done in Step 2/Step 4.

**Placeholder scan:** No "TBD"/"TODO"/"fill in details"/"similar to Task N" patterns. Every step shows the exact code to write. Every command shows the exact form and expected outcome.

**Type/name consistency:**
- `snapSheet`, `cycleSnap`, `expandAccordion`, `collapseAccordion` — used consistently across Tasks 3 (definitions), 5 (callers), 7 (recents row click), and 8 (e2e selectors).
- `bindStaticParamControls` — defined in Task 5, called from the new `wireTripChips` in Task 5. No other references.
- `renderRecentsAccordion` — defined in Task 7, replaces all call sites of `renderRecentsIfEmpty` per Step 3 of that task.
- DOM IDs: `#sheet`, `#sheet-handle`, `#trip-chips`, `#chip-{when,goal,flags,recents}`, `#acc-{when,goal,flags,recents}`, `#acc-{when,goal,flags,recents}-body`, `#results`, `#clear-trip`. All match between Tasks 1, 2, 3, 5, 6, 7, 8.
- `data-snap` values: only `'peek'`, `'mid'`, `'full'`. `SNAP_HEIGHTS` constant in Task 3 enforces this; CSS in Task 2 has rules for the same three; e2e in Task 8 asserts on the same three.
- `data-acc-active` (attribute presence, value `''`) and `data-active` on chips: both used as boolean presence checks. Tests in Task 3 verify with `'accActive' in dataset` / `'active' in dataset`; e2e in Task 8 uses `toHaveAttribute('data-acc-active', '')` — consistent.

No outstanding gaps; plan is ready.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-bike-rail-v3-unified-sheet.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
