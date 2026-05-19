# bike-rail v3 · unified-sheet redesign

**Status:** Design approved (pending spec review)
**Source:** Claude Design handoff bundle `bike-rail v3.html` (Option A)
**Worktree:** `worktree-bike-rail-v2`
**Date:** 2026-05-19

## Problem

The current Atlas web shell (`src/server/templates/page.html`) has three independent
control surfaces fighting for the bottom of the viewport:

- `#from-to-pill` — floating at top of map, holds origin/destination
- `.trip-chips` — floating below the pill, opens `#params-sheet` on tap
- `#params-sheet` — bottom sheet, holds when/goal/flags settings
- `#results-sheet` — bottom sheet, holds active trip + alternates + (recents stub)

Tapping a chip animates a sheet up from the bottom that the chip does not visibly
own. The user's complaint: *"settings are accessed by buttons at the top, which is
crazy because the settings live below."* Two `<div class="sheet">` nodes also fight
for the same screen region without a shared model of who owns it.

The fix is not to move the chips. The fix is to admit there is one bottom region
with three concerns (active trip, settings, recents) and design one expansion model
so each can be opened and closed independently from one consistent surface.

## Solution

One unified bottom sheet with three snap heights and chips embedded in its sticky
header. Chips double as section-jumps into accordions inside the sheet. The handle
is for free expansion when the user does not know what they want; chips are for
direct jumps when the user does.

### DOM (page.html)

```html
<div class="map" id="map"></div>
<div class="from-to-pill" id="from-to-pill" data-state="empty">…</div>
<button class="fab" id="fab-geolocate">…</button>

<section class="sheet" id="sheet" data-snap="peek" aria-label="trip details">
  <header class="sheet__header">
    <button class="sheet__handle" id="sheet-handle"
      aria-label="cycle sheet height" aria-controls="sheet"></button>

    <div class="trip-chips" id="trip-chips" role="toolbar">
      <span class="trip-chips__prefix mono">trip ·</span>
      <button class="chip" data-chip="when"    aria-controls="acc-when">…</button>
      <button class="chip" data-chip="goal"    aria-controls="acc-goal">…</button>
      <button class="chip" data-chip="flags"   aria-controls="acc-flags">…</button>
      <span class="trip-chips__spacer"></span>
      <button class="chip" data-chip="recents" aria-controls="acc-recents">↻</button>
    </div>

    <div class="sheet__indicator" aria-live="polite">…stages…</div>
  </header>

  <div class="sheet__body">
    <div id="results"><!-- htmx target: trip card + alternates --></div>
    <details class="accordion" id="acc-when"    data-acc="when">…</details>
    <details class="accordion" id="acc-goal"    data-acc="goal">…</details>
    <details class="accordion" id="acc-flags"   data-acc="flags">…</details>
    <details class="accordion" id="acc-recents" data-acc="recents">…</details>
  </div>
</section>
```

**Deleted:** `#params-sheet`, `.sheet--params`, `.sheet--peek`, the standalone
floating `.trip-chips`, `params-sheet.html` partial, `#params-done` button, any
server route that served the partial.

**Unchanged:** `#from-to-pill` and its `data-state` machine, `#fab-geolocate`,
`<div id="map">`, `#plan-form` with its hidden inputs, the htmx submit flow
(`hx-post="/api/plan" hx-target="#results"`), the staged-loader indicator markup
(it just moves into `.sheet__header`).

### CSS (app.css)

```css
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--rmai-white);
  border-top-left-radius: 22px; border-top-right-radius: 22px;
  box-shadow: 0 -8px 32px rgba(26,27,37,0.10);
  display: flex; flex-direction: column; overflow: hidden;
  transition: height 280ms cubic-bezier(.2,.8,.2,1);
  z-index: 40;
}
.sheet[data-snap="peek"] { height: 260px; }
.sheet[data-snap="mid"]  { height: 540px; }
.sheet[data-snap="full"] { height: min(750px, 92vh); }

.sheet__header { flex: 0 0 auto; padding: 6px 14px 8px;
  border-bottom: 1px solid var(--rmai-border); background: var(--rmai-white); }
.sheet__handle { display: block; width: 36px; height: 4px; margin: 0 auto 10px;
  border: 0; padding: 0; border-radius: 2px; background: #D9D7D2; cursor: pointer; }
.sheet__handle:focus-visible { outline: 2px solid var(--rmai-purple); }
.sheet__body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; }

.accordion { border-top: 1px solid var(--rmai-border); }
.accordion__head { list-style: none; cursor: pointer;
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  background: var(--rmai-white);
  border-left: 2px solid transparent; }
.accordion__head::-webkit-details-marker { display: none; }
.accordion__head::after { content: '▾'; margin-left: auto; color: var(--rmai-fg-mut);
  transition: transform 200ms; }
.accordion[open] > .accordion__head::after { transform: rotate(180deg); }

.accordion[data-acc-active] > .accordion__head {
  background: var(--rmai-lavender); border-left-color: var(--rmai-purple); }
.accordion[data-acc-active] > .accordion__body {
  background: var(--rmai-lavender); border-left: 2px solid var(--rmai-purple); }
.accordion__body { padding: 12px 14px; }

.chip[data-active] { background: var(--rmai-lavender); border-color: var(--rmai-purple); }
.chip[data-active] .chip__sublabel { color: var(--rmai-purple-d); }

.trip-chips { display: flex; gap: 5px; align-items: center; overflow-x: auto;
  margin-top: 4px; -webkit-overflow-scrolling: touch; }
.trip-chips__spacer { flex: 1; }
```

**Deleted CSS:** `.sheet--peek`, `.sheet--params`, `.params-sheet__head`,
`.params-sheet__body`, old `position: fixed` rules for `.trip-chips` (now inside
the sheet), old `#params-sheet` animation keyframes.

### JS (atlas.js)

Two pure setters plus event wiring. Independent accordions (opening one does not
close siblings). Tap-to-snap only — no pointer/touch drag handling.

```js
const SNAP_HEIGHTS = ['peek', 'mid', 'full'];

function snapSheet(target) {
  const sheet = document.getElementById('sheet');
  if (!SNAP_HEIGHTS.includes(target)) return;
  sheet.dataset.snap = target;
  sheet.dispatchEvent(new CustomEvent('sheet:snap', { detail: { target } }));
}

function cycleSnap() {
  const sheet = document.getElementById('sheet');
  const cur = sheet.dataset.snap || 'peek';
  const next = SNAP_HEIGHTS[(SNAP_HEIGHTS.indexOf(cur) + 1) % SNAP_HEIGHTS.length];
  snapSheet(next);
}

function expandAccordion(name, { scroll = true } = {}) {
  const acc = document.querySelector(`.accordion[data-acc="${name}"]`);
  if (!acc) return;
  acc.open = true;
  document.querySelectorAll('.accordion[data-acc-active]')
    .forEach(a => { if (a !== acc) delete a.dataset.accActive; });
  acc.dataset.accActive = '';
  document.querySelectorAll('.chip[data-chip]').forEach(c => {
    if (c.dataset.chip === name) c.dataset.active = '';
    else delete c.dataset.active;
  });
  if (scroll) acc.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function collapseAccordion(name) {
  const acc = document.querySelector(`.accordion[data-acc="${name}"]`);
  if (!acc) return;
  acc.open = false;
  delete acc.dataset.accActive;
  const chip = document.querySelector(`.chip[data-chip="${name}"]`);
  if (chip) delete chip.dataset.active;
}

// Wiring
document.getElementById('sheet-handle').addEventListener('click', cycleSnap);

document.getElementById('trip-chips').addEventListener('click', (e) => {
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
});

document.querySelectorAll('.accordion').forEach(acc => {
  acc.addEventListener('toggle', () => {
    if (acc.open) acc.dataset.accActive = '';
    else {
      delete acc.dataset.accActive;
      const chip = document.querySelector(`.chip[data-chip="${acc.dataset.acc}"]`);
      if (chip) delete chip.dataset.active;
    }
  });
});

// × clear pill → sheet to full + recents auto-opens (empty-state behavior)
document.getElementById('clear-trip').addEventListener('click', () => {
  snapSheet('full');
  expandAccordion('recents');
});
```

**Removed from atlas.js:** `openParamsSheet`, `closeParamsSheet`, any existing
chip-click handler that targets `#params-sheet`, the old sheet expand/collapse
helpers tied to `.sheet--peek`. The form-submit/htmx wiring and the
`#from-to-pill` `data-state` machine stay as-is.

### State transitions

| App state              | Sheet snap | Accordion behavior                                                 |
|------------------------|------------|---------------------------------------------------------------------|
| `empty` (no plan yet)  | `full`     | `recents` open + active — recents IS the empty-state content       |
| `editing` (pill input) | `peek`     | all closed                                                          |
| `planning` (htmx)      | `peek`     | all closed; `.sheet__indicator` shows stages                        |
| `result` (plan back)   | `peek`     | all closed; trip card visible in `#results`                         |
| `chip-tap <name>`      | `full`     | accordion `<name>` open + active; chip lilac                        |
| `chip-tap-again`       | `peek`     | accordion `<name>` collapses; chip clears                           |
| `recent row tap`       | `peek`     | recents collapses; trip card replaces in `#results`                 |
| `× clear pill`         | `full`     | trip card cleared; recents auto-opens + active                      |
| `handle tap`           | cycles     | peek → mid → full → peek; accordions unchanged                      |

### Settings body — content port

The current `params-sheet.html` partial splits across three accordion bodies:

- `#acc-when` — segmented control (now / depart-at / arrive-by) + time input. Writes
  to existing hidden inputs `#param-depart`, `#param-arriveBy` in `#plan-form`.
- `#acc-goal` — three-radio card list (commute / day-ride / max-path). Writes to
  `#param-goal`.
- `#acc-flags` — hill-weight slider, min-on-path-fraction input, prefer-bike-path
  toggle. Writes to `#param-hillWeight`, `#param-minOnPathFraction`,
  `#param-preferBikePath`.
- `#acc-recents` — rows rendered from `listRecents()` in `recents.js`. Row click
  fills pill, submits form, snaps sheet to peek, collapses accordion.

The form payload submitted by `#plan-form` does not change; only the DOM containers
of the inputs move.

### Server changes

- Delete `src/server/static-assets/params-sheet.html` (served by the static-assets
  middleware at `/static/params-sheet.html`; no dedicated route to remove).
- Remove the `fetch('/static/params-sheet.html')` call and surrounding
  open/close logic in `src/server/static-assets/atlas.js`.
- Inline the three accordion bodies as static HTML in
  `src/server/templates/page.html` (the partial currently has no server-side
  state, so this is a pure relocation).

## Testing

- **Unit (vitest, jsdom):** new `tests/unit/sheet.test.ts` covering `snapSheet`,
  `cycleSnap`, `expandAccordion`, `collapseAccordion`. Asserts: `data-snap`
  mutates correctly through the cycle; chip `data-active` syncs with accordion
  `data-acc-active`; `expandAccordion` does NOT close siblings; `collapseAccordion`
  clears the chip's `data-active`.
- **Unit (vitest):** update `tests/unit/page.test.ts` (or equivalent template
  test) to assert: exactly one `<section class="sheet">`, exactly four
  `.accordion[data-acc=…]` elements (when/goal/flags/recents), `.trip-chips`
  inside `.sheet__header`, no `#params-sheet` node. The inline `--rmai-purple:
  #A77ACD` assertion already in `page.test.ts` stays.
- **E2e (playwright):** new `tests/e2e/unified-sheet.spec.ts`:
  1. Load `/` → sheet `[data-snap=full]`, `#acc-recents[open][data-acc-active]`.
  2. Type origin + destination → sheet collapses to `[data-snap=peek]`.
  3. Submit → loader stages run inside `.sheet__header`; result lands in `#results`.
  4. Tap `goal` chip → sheet animates to `[data-snap=full]`, `#acc-goal[open]
     [data-acc-active]`, chip has `data-active`.
  5. Tap `goal` chip again → accordion closes, chip clears, sheet returns to
     `[data-snap=peek]`.
  6. Tap handle three times → snap cycles peek → mid → full → peek.
  7. Tap × in pill → sheet snaps to `[data-snap=full]`, recents auto-opens +
     active.
- **Retire:** existing params-sheet e2e spec (whichever filename) — rewrite to the
  above or delete if fully subsumed.

Test output must be pristine (per CLAUDE.md): no warnings, expected errors must be
asserted, no console noise.

## Commit sequence

Single PR / single worktree branch, eight commits:

1. **dom** — page.html: replace `.trip-chips`, `#params-sheet`, `#results-sheet`
   with the unified `<section id="sheet">` skeleton + four empty
   `<details class="accordion">` shells.
2. **css** — app.css: add `.sheet[data-snap]` rules + accordion lilac states;
   remove `.sheet--peek`, `.sheet--params`, floating `.trip-chips` rules.
3. **js** — atlas.js: add `snapSheet`/`cycleSnap`/`expandAccordion`/
   `collapseAccordion`; wire handle + chip + `details` toggle listeners; remove
   `openParamsSheet`/`closeParamsSheet` and old sheet-state code.
4. **ports** — inline when/goal/flags HTML into accordion bodies in page.html;
   delete `src/server/static-assets/params-sheet.html` and its route.
5. **recents** — render rows from `listRecents()` into `#acc-recents` body; wire
   row click → load trip, collapse accordion, snap sheet to peek.
6. **tests** — `tests/unit/sheet.test.ts`, update `tests/unit/page.test.ts`,
   add `tests/e2e/unified-sheet.spec.ts`, delete the old params-sheet e2e.
7. **chore** — update `web/README.md` and any other prose that references the
   v2 three-surface layout.
8. **bd close** — close any beads that this PR resolves (e.g. "settings
   accessed from above" if one exists); open a follow-up bead for the future
   Option B tablet variant.

## Out of scope (future work)

- **Option B (split panel with map on top)** — design canvas mocks four states
  but Option A's recommendation is to keep B as a future `@media (min-width:
  900px)` tablet variant. Open as a separate bead after Option A ships.
- **Real drag gesture** on the handle — tap-to-cycle is the chosen interaction
  model. A future bead could add pointer/touch drag with snap-to-nearest if
  desired.
- **Single-open accordion mode** — design lists this as an "optional pref"; not
  built now. Could be a localStorage toggle later if multi-open feels noisy.
- **Map polylines for train legs** — already out of scope per existing beads.

## Decisions log (from brainstorming)

- **Sheet gesture:** tap-to-snap only (no pointer/touch drag).
- **Option B scope:** Option A only; B deferred to a future tablet bead.
- **Accordion behavior:** independent — opening one does not close siblings.
- **Settings structure:** four accordions (when / goal / flags / recents), one per
  chip, not a single combined "settings" accordion.
- **`#params-sheet` fate:** delete entirely; migrate tests to the unified sheet.
- **Build sequence:** one PR, full cutover (eight commits as listed above).
