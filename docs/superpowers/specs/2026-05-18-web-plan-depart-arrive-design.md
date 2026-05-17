# Design — web /api/plan: parse depart / arrive-by (ptv-6yf)

**Status:** draft
**Bead:** [ptv-6yf](../../../.beads) — *feat: web /api/plan — parse depart/arrive-by in PlanBody using parseMelbourneHHMM*
**Parent:** ptv-t3x.1 (Phase 1 HTMX web UI) — this is the last unwired field in Phase 1's form
**Date:** 2026-05-18

## Problem

The Atlas web shell (`src/server/templates/page.html`) renders `depart` and `arriveBy` text inputs with `pattern="\d{2}:\d{2}"`, but the route at `src/server/routes/plan.ts` explicitly stubs both fields as `undefined` with the comment `// depart/arriveBy parsing is deferred`. Users can type a time, but the planner always plans for "now". The CLI already parses these via `parseMelbourneHHMM` and `parseTime` in `src/commands/plan.ts`; the web just needs to call the same helper.

## Goals

- `/api/plan` accepts `depart` and `arriveBy` and resolves them to UTC `Date` values on the `PlanRequest`.
- Same input grammar as the CLI: `HH:MM` (Melbourne local) or ISO8601 (timezone-aware).
- Surfacing of bad input is consistent with the route's existing 400 + `error.html` pattern.
- No regression: empty/missing fields still mean "now".

## Non-goals

- Changing the form UI to make depart/arriveBy mutually exclusive at the input level (server defends; UI follow-up is its own bead).
- Cross-midnight or "tomorrow at 8am" semantics. We keep the CLI's contract: `HH:MM` is today's Melbourne date.
- Calendar/time pickers, timezone selectors, anything beyond text input.
- A new schema-validator dependency (zod/ajv).

## Approach

Three small moves:

1. **Extract** `parseTime` and `parseMelbourneHHMM` from `src/commands/plan.ts` into `src/plan/parse_time.ts` so both the CLI and the web route can import without crossing a `commands/` → other-layer dependency.
2. **Wire** the helper into `resolveRequest()` in `src/server/routes/plan.ts` via a private `parseOptionalTime(raw, field)` that turns blank/missing into `undefined`, parses non-blank, and rethrows with a field-qualified message on failure.
3. **Reject** requests that supply both `depart` and `arriveBy` non-empty (mirrors CLI's mutually-exclusive-flag posture).

All errors flow through the existing `try { resolveRequest } catch { 400 + error.html | { error: BAD_INPUT } }` branch in `registerPlan`. HTML clients see the friendly fragment (which HTMX swaps into `#results` via the `htmx:beforeSwap` listener already added to `page.html`); JSON clients see `{ error: { code: 'BAD_INPUT', message } }`.

Form-side validation stays as defense-in-depth: the `pattern="\d{2}:\d{2}"` attribute on the inputs keeps casual browser users from sending garbage; the server still validates because curl/scripts/JSON clients bypass HTML5 validation.

## Files

### New: `src/plan/parse_time.ts`

Move the two functions from `src/commands/plan.ts` verbatim — no behavioral change:

```ts
export function parseTime(s: string | undefined): Date | undefined { /* ... */ }
function parseMelbourneHHMM(hhmm: string): Date { /* ... */ }
```

`parseMelbourneHHMM` stays file-local (not exported); `parseTime` is the public surface.

### Modified: `src/commands/plan.ts`

Delete the two functions; add `import { parseTime } from '../plan/parse_time'` at the top. The `.option('--depart <iso>', ...)` Commander wiring continues to call `parseTime` unchanged.

### Modified: `src/server/routes/plan.ts`

Import `parseTime` from `../../plan/parse_time`. Add inside `resolveRequest()`, just before the `return`:

```ts
const departUtc   = parseOptionalTime(body.depart,    'depart');
const arriveByUtc = parseOptionalTime(body.arriveBy,  'arriveBy');
if (departUtc && arriveByUtc) {
  throw new Error('specify either depart or arriveBy, not both');
}
```

Return them on the `PlanRequest` (replacing the current `departUtc: undefined, arriveByUtc: undefined` stubs). Delete the `// depart/arriveBy parsing is deferred` comment.

Add a private helper at the bottom of the file:

```ts
function parseOptionalTime(raw: unknown, field: string): Date | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (s === '') return undefined;
  try { return parseTime(s); }
  catch { throw new Error(`${field}: invalid time (use HH:MM or ISO8601)`); }
}
```

Empty-string-as-blank matters because HTML forms submit `depart=""` rather than omitting the field; without the trim+empty check we'd hand `""` to `parseTime`, which would route to the ISO branch and throw `invalid date:`.

### Modified: `tests/unit/plan/parse_time.test.ts`

One-line change: `import { parseTime } from '../../../src/plan/parse_time'` (was `../../../src/commands/plan`). Test bodies unchanged. All 5 existing cases continue to cover the helper.

### Modified: `tests/integration/server/plan.test.ts`

Add five cases for the new behavior:

| Input | Expected |
|---|---|
| `depart: "08:00"` | 200; `planFn` called with `departUtc` ≠ undefined; Melbourne hour of that Date is `8` |
| `depart: ""` | 200; `planFn` called with `departUtc: undefined` |
| `depart: "garbage"` | 400; JSON `{ error: { code: 'BAD_INPUT', message: /depart: invalid time/ } }` |
| `depart: "08:00", arriveBy: "09:00"` | 400; message matches `/either depart or arriveBy/` |
| `arriveBy: "17:30"` | 200; `planFn` called with `arriveByUtc` set, `departUtc: undefined` |

The existing test harness already mocks `planFn` and asserts on `planFn.mock.calls[0][0]`, so these slot in next to the `coerces maxTransfers` case.

### Modified: `tests/e2e/atlas.spec.ts`

One happy-path case: re-use the geocode-autocomplete helper that the existing tests employ to populate origin/destination, then type `08:00` into `input[name="depart"]`, click `#plan-btn`, and assert that the `page.route('**/api/plan', ...)` interceptor received a request whose body parses to `{ depart: "08:00", ... }`. We do not assert on parsed-Date correctness here — that's integration's job.

## Data flow

```
HTMX submit
  → POST /api/plan {origin, destination, depart: "08:00", ...}
  → resolveRequest()
      resolvePoint(origin) / resolvePoint(destination)
      parseOptionalTime(depart)    → Date | undefined | throw
      parseOptionalTime(arriveBy)  → Date | undefined | throw
      mutual-exclusion check       → throw if both
  → PlanRequest { ..., departUtc, arriveByUtc }
  → planCacheKey(resolved)         (already keys off the full request — no change)
  → planFn(req)
  → 200 + results fragment / JSON
```

Cache impact: `planCacheKey` already serializes the resolved request, so distinct `departUtc` values produce distinct cache entries automatically. No code change to caching.

## Error matrix

| Condition | Status | HTML body (HTMX swap-on-error → `#results`) | JSON body |
|---|---|---|---|
| Both depart and arriveBy non-empty | 400 | `error.html` with `specify either depart or arriveBy, not both` | `{ error: { code: BAD_INPUT, message: "specify either depart or arriveBy, not both" } }` |
| Malformed depart | 400 | `error.html` with `depart: invalid time (use HH:MM or ISO8601)` | `{ error: { code: BAD_INPUT, ...} }` |
| Malformed arriveBy | 400 | as above with `arriveBy:` | as above |
| Empty / missing | n/a | proceeds as if "now" | proceeds as if "now" |

All three malformed paths re-use the same `catch` in `registerPlan` that handles invalid coordinates today.

## Out of scope (parked for follow-up beads)

- **Mutually-exclusive radio toggle in the form.** Server still defends, but UI can be made clearer; small UX bead.
- **"Tomorrow at 8am" semantics.** If you ask for `08:00` at 14:00 today, you get a past-time. CLI has the same behavior. Fix requires a contract decision (does the planner roll to next-day?), so defer.
- **DST-transition ambiguous hour.** Same caveat the CLI carries. JSON clients can pass full ISO8601 to disambiguate; this is documented behavior, not a bug to fix here.

## Risk / rollback

Risk is low: extraction is mechanical, the wiring touches one function in one route file, and the helper is already test-covered. Rollback is `git revert` of the implementation commit — the spec doc itself is independent.

The one risk worth flagging: the move means `src/commands/plan.ts` now imports from `src/plan/parse_time.ts`. There is already a `src/plan/types.ts` import in `src/commands/plan.ts`, so the direction `commands → plan` is established and fine. No new cycles.
