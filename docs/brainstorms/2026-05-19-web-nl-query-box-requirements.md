---
date: 2026-05-19
topic: web-nl-query-box
---

# Web Natural-Language Query Box

## Summary

A natural-language query box on the existing web map: rider types a sentence ("Hurstbridge by 9am"), the server parses prose to a `PlanRequest`, runs the existing planner, and the front-end renders the result on the map plus a short rationale and refinement chips. First-cut backend is a two-stage stateless flow (parse → plan → explain) with two LLM calls per turn, designed so a future tool-using agent loop is an additive upgrade rather than a rewrite.

---

## Problem Frame

The web front-end today is form-driven: dropdowns, sliders, chips, a params sheet. Every plan flag the CLI exposes (goal, hill-weight, prefer-bike-path, min-on-path-fraction, max-transfers, mode) is a UI control the rider must locate and adjust. Submitting a real query — "fastest way from home to Hurstbridge arriving 9am, train OK" — requires translating intent into a small grid of controls, then iterating by tweaking those controls.

This is friction at the moment of highest motivation: when the rider sits down with a destination and a deadline. The strategy doc names the web front-end as a co-equal surface to the CLI/agent toolkit — but today the form-driven UX makes the web surface materially less expressive than the CLI, and far less expressive than handing the same question to an AI assistant via prose. The rider can already pose the question naturally to Claude; the web map cannot accept the same shape of input.

The first concrete situation is deadline-commute planning: a single bike+train+bike trip with an arrival constraint. Today the rider opens the form, fills origin and destination, sets arrive-by, picks goal=commute, submits. The NL box collapses that into one sentence.

---

## Actors

- A1. **Rider** — a Melbourne cyclist using the web map to plan a bike+train trip. Types prose into the query box; reads rationale; clicks refinement chips or types follow-up prose.
- A2. **Parse stage** — server-side LLM call that turns prose plus prior conversation state into a structured `PlanRequest` (and resolution requests for any non-coordinate place names).
- A3. **Planner** — the existing `orchestrator.plan()` and friends. Deterministic; not part of this work.
- A4. **Explain stage** — server-side LLM call that takes `(parsed request, plan results)` and produces a short rationale plus refinement-chip specs.

---

## Key Flows

- F1. **First query, happy path**
  - **Trigger:** Rider focuses the query box on a fresh map and types "Hurstbridge by 9am"
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Rider submits → server runs Parse on the prose (with any saved home/default origin in scope) → Parse emits a `PlanRequest` and any geocode lookups it needs → server resolves geocodes → server calls Planner → Planner returns itineraries → server runs Explain on `(request, results)` → Explain emits a rationale and 2–3 refinement chips → response sent back → front-end renders map + form fields + rationale + chips
  - **Outcome:** Rider sees a planned route on the map, with form fields populated to match the parsed intent, a one-line explanation, and clickable refinements.
  - **Covered by:** R1, R2, R3, R4, R5, R8, R12

- F2. **Refinement via chip**
  - **Trigger:** After F1, rider clicks a chip ("Try 10min earlier")
  - **Actors:** A1, A4, A3
  - **Steps:** Chip carries a structured delta against the current `PlanRequest` → server applies the delta (no Parse stage needed) → Planner re-runs → Explain re-runs → response renders
  - **Outcome:** Map updates; rationale reflects the change; new chips offered.
  - **Covered by:** R6, R7, R12

- F3. **Refinement via prose follow-up**
  - **Trigger:** After F1, rider types "actually try Lilydale instead" into the same box
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Front-end sends prose plus prior `PlanRequest` and prior result summary → Parse merges the follow-up into a new `PlanRequest` → Planner runs → Explain runs → response renders
  - **Outcome:** Same as F1 but with the follow-up applied.
  - **Covered by:** R1, R3, R4, R5, R8

- F4. **Parse-time failure / low confidence**
  - **Trigger:** Parse cannot produce a complete `PlanRequest` (missing destination, ambiguous place name, missing time when arrive-by is implied)
  - **Actors:** A1, A2
  - **Steps:** Parse returns a structured "need-clarification" payload identifying which field(s) are missing or ambiguous → front-end shows the partial parse populated into the form, plus a one-line question in the rationale slot ("Did you mean Hurstbridge station or Hurstbridge town?") → rider either types a clarifying sentence or edits the form directly and submits
  - **Outcome:** Either Parse succeeds on the next turn (back to F1), or the rider falls back to the form.
  - **Covered by:** R9, R10, R11

---

## Requirements

**Query input and conversation state**

- R1. The web map shall display a natural-language query box positioned so it is visible on first paint without scrolling, on both desktop and the existing mobile pill layout.
- R2. The box shall accept prose of at least 500 characters and be the primary submit affordance for a typed query (Enter submits; the existing form's submit button continues to work independently).
- R3. The front-end shall maintain per-page-load conversation state: the most recent `PlanRequest` and a compact summary of the most recent result. This state is sent to the server with each follow-up and resets on page reload. Cross-session persistence is out of scope.
- R4. Each turn (initial or follow-up) shall consist of exactly one Parse call followed by one planner run followed by one Explain call. No iterative tool-loop in v1.

**Parse stage behavior**

- R5. Parse shall be capable of producing a `PlanRequest` from prose for the deadline-commute query class: an origin (possibly a shortcut like "home"), a destination (place name or coords), an arrive-by or depart-at time (absolute or relative), and any explicit flags the user names (goal, hill preference, on-path preference, mode).
- R8. Parse shall resolve non-coordinate origin and destination references — including the "home" shortcut and place-name phrases — to coordinates before producing the final `PlanRequest`. The "home" shortcut resolves against a single coordinate persisted in browser `localStorage`, set by the rider through an explicit "save current as home" affordance in the form UI; place names resolve via geocoding. When "home" is referenced but not yet set, Parse returns a clarification payload prompting the rider to set it.
- R9. When Parse cannot complete a `PlanRequest` (missing required field, ambiguous reference, unresolvable place name), it shall return a structured clarification payload naming the field and offering candidate interpretations when available, instead of guessing.
- R10. When Parse succeeds, the front-end shall populate the existing form fields with the parsed values so the rider can see what was inferred and edit if needed.

**Explain stage behavior**

- R6. Explain shall emit a short rationale (one to two sentences) describing the chosen itinerary in the rider's terms — e.g., naming the train line, departure time, and any notable trade-off — not a JSON dump.
- R7. Explain shall emit two to three refinement chips per response. Each chip carries a structured delta against the current `PlanRequest` (e.g., `{ arriveBy: "-10min" }`, `{ excludeLine: "Hurstbridge" }`), not opaque prose. Clicking a chip applies the delta without invoking Parse.
- R12. When the planner returns no feasible itineraries, Explain shall produce a rationale that says so plainly and offer chips that loosen the most restrictive constraint(s) (e.g., "Allow 1 transfer", "Try 15min earlier").

**Failure surfaces**

- R11. When the LLM provider is unreachable or returns an unparseable response, the front-end shall continue to function as a form-driven UI without the box: the form remains submittable, the existing planner path works, and an inline notice tells the rider that NL is temporarily unavailable.

---

## Acceptance Examples

- AE1. **Covers R5, R6, R7.** Given the rider has set a "home" shortcut and the planner is healthy, when they type "Hurstbridge by 9am" and submit, then the map renders an itinerary arriving at or before 09:00, the rationale names the chosen train line and departure time, and at least two refinement chips appear with structured deltas.
- AE2. **Covers R3, R7.** Given a prior plan rendered for "Hurstbridge by 9am", when the rider clicks a "Try 10min earlier" chip, then the planner re-runs with `arriveBy = "08:50"` and the map and rationale update without Parse being invoked.
- AE3. **Covers R3, R8.** Given a prior plan rendered for "Hurstbridge by 9am", when the rider types "actually try Lilydale instead" into the box and submits, then Parse uses the prior request as context, the new request keeps the original arrive-by and origin, and the Lilydale-line itinerary renders.
- AE4. **Covers R9, R10.** Given the rider types "by 9am" with no destination, when they submit, then no plan is rendered, the form populates with the inferred arrive-by, and the rationale slot asks for a destination.
- AE5. **Covers R11.** Given the LLM provider is down, when the rider types into the box and submits, then the front-end shows an inline notice that NL is unavailable, the box stays present, and the form remains fully submittable for a manual plan.
- AE6. **Covers R12.** Given the rider asks for "Eltham by 7am" on a Sunday morning when no direct train runs, when the planner returns no feasible itineraries, then the rationale states that no route was found and chips offer to allow a transfer or shift the time.

---

## Success Criteria

- The rider can plan a real deadline-commute trip end-to-end by typing one sentence, without touching the form, on at least 80% of attempts on a fixed probe set of ten representative origin/destination/time inputs.
- Median latency from submit to rendered route is no worse than 2× the current form-driven path. (Cost ceilings and provider choice are planning concerns; this is a felt-quality constraint.)
- The "Agent-driven success rate" metric in `STRATEGY.md` can be measured against this box: every Parse failure mode is observable and categorisable.
- A downstream planning agent can read this document and produce an implementation plan without needing to invent: which query types are in scope, what failure surfaces exist, where conversation state lives, or whether the form remains.

---

## Scope Boundaries

- Compare/contrast queries ("Lilydale vs Hurstbridge from home to Warrandyte") — first cut accepts a single trip per turn; comparison is a v2 expansion of the parse schema.
- Discover/exploration queries ("find me a 3hr ride I haven't done") — requires breadth-search behavior the two-stage shape does not naturally support.
- True tool-using agent loop (the approach-A alternative) — deferred behind the same backend boundary; Parse can grow a "route to agent" output later without disturbing the v1 flow.
- "Box is the UI" — hiding or removing the existing form once the box is proven; held until v1 is in real use.
- Persistent conversation history across page reloads or sessions — per-page-load state only.
- Voice input — not in scope.
- Multi-rider personalisation, sharing prose queries between accounts — single-rider product.
- LLM provider choice, exact prompt design, response schema versioning, rate limiting, observability of token spend — implementation decisions for planning.

---

## Key Decisions

- **Two-stage stateless flow over a tool-using agent loop in v1.** Rationale: the deadline-commute query class is structurally a single `PlanRequest`. A tool-loop buys no behaviour the two-stage flow can't deliver for this query class, but it does add unbounded per-turn cost. Two fixed LLM calls is a predictable budget. The parse stage can later emit a "route to agent" output type when richer query classes are introduced; that path is additive.
- **Box augments the form rather than replacing it.** Rationale: when the LLM misreads, the rider needs a fast escape hatch. Populating the form with parsed values gives the rider a visible "what did it understand" surface and a manual override. The "Box is the UI" challenger is held until v1 has been used in anger.
- **Refinement chips are first-class in v1.** Rationale: the felt-intelligence of the box comes from the explain stage. Chips are the cheapest way to expose iterative refinement without a true conversation loop, and they let the rider drive the planner without re-engaging Parse. Removing them would make v1 feel one-shot rather than agentic.
- **Per-page-load conversation state, no persistence.** Rationale: keeps the v1 surface area minimal and avoids cross-cutting auth/storage decisions. Persistence can be added later without breaking the current contract.
- **Plain English place names resolve via geocoding before Parse emits a `PlanRequest`.** Rationale: the planner already takes coords. Doing the resolution inside Parse keeps the planner's contract unchanged and consolidates failure handling (ambiguous place name) in one place.
- **"Home" is an explicit, rider-set localStorage coordinate, not last-used-origin or live geolocation.** Rationale: predictability beats convenience for the highest-frequency shortcut. Last-used-origin produces surprises after a day-ride that started elsewhere; geolocation injects a permission prompt and bad behaviour when planning from a remote location. An explicit "save current as home" button is one extra setup step in exchange for a stable, debuggable shortcut. Other named shortcuts (e.g., "work") can follow the same pattern later but are not in v1.

---

## Dependencies / Assumptions

- The existing Fastify server (`src/server/`) and orchestrator (`src/plan/orchestrator.ts`) are the foundation; this work adds a new endpoint alongside `/api/plan`, not in place of it.
- A geocoding service is already deployed (Nominatim on totoro per `web/README.md`); no new geocoder is required.
- The rider sets a "home" coordinate explicitly via a "save current as home" affordance in the form UI; this coordinate is persisted in `localStorage` and read by Parse on every turn.
- An LLM provider with structured-output capability is available and reachable from the server. Choice of provider, model, and prompt design is a planning decision.
- The two-stage shape assumes parse failures are observable enough to support the success-rate metric in `STRATEGY.md`; this depends on Parse returning structured failure payloads (R9), which is itself a requirement.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R6, R7][Technical] Which LLM provider and model class — and whether Parse and Explain share a model or use different tiers — is a cost/latency trade-off best evaluated against real probe queries.
- [Affects R7][Technical] Exact schema for chip deltas (subset of `PlanRequest` fields, vs free-form patch) — should follow whatever shape the parsed `PlanRequest` takes.
- [Affects R11][Technical] How the inline "NL unavailable" notice surfaces in the existing pill / params-sheet UI — a UI integration detail.
- [Affects R3][Needs research] Whether per-page-load state should also survive a same-tab refresh via sessionStorage, or strictly reset on reload. Worth checking how the existing recents/URL-hash state behaves.
