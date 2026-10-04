---
name: PTV CLI
last_updated: 2026-05-19
---

# PTV CLI Strategy

## Target problem

A Melbourne cyclist sits at home with a bicycle and a destination. They either need to get there fast (commute, deadline) or they want a nice ride that uses the train as a stretch. Existing routers (Google) only walk the first/last leg and don't model Melbourne's bikes-on-trains policy, so bike + train + bike isn't routable today.

## Our approach

Expose composable routing primitives — multiple bike engines, transit data, tunable scoring — as CLI tools designed to be driven by AI agents or humans. Rather than ship one "best route" function with hidden defaults, let the caller pose any question against the same primitives — fastest with a deadline, hilliest within 80km, most-cycleway between two stations, compare three options side-by-side. Bike+train+bike is the first concrete use case and Melbourne is the first deployment, but the engine generalises.

## Who it's for

**Primary:** A Melbourne cyclist planning a bike+train trip, commute or day ride. They're hiring the product to answer route questions that combine bike + train + bike with tunable preferences (speed, hills, on-path %, station choice) and to *see* and compare the answers on a map.

The rider accesses this through two co-equal surfaces:

- A **CLI / agent toolkit** — text/JSON in, JSON out, composable by AI agents.
- A **web map front-end** — natural-language query box on a map, exposing the full power of the CLI visually.

The primitives layer is the same underneath; the two surfaces are co-equal faces of one product.

## Key metrics

- **Trips planned per week** — actual bike+train trips routed for real use, commute or day-ride. Leading; tells us the product is part of life.
- **Trip-follow-through rate** — % of planned routes that get ridden without needing to re-plan mid-ride. Lagging on real-world correctness.
- **Goal coverage** — number of `--goal` × preference combinations (commute / day-ride / max-path / hills / flat / min-on-path) that return non-degenerate routes on a fixed probe set of OD pairs. Quality regression detector.
- **Agent-driven success rate** — given a natural-language route question handed to an AI assistant using these tools, % that yield a usable answer without falling back to manual CLI editing. Tests the "composable primitives" bet directly.
- **CLI ↔ map parity** — % of CLI capabilities exposed in the web UI. Lagging on the "two co-equal surfaces" claim.

## Tracks

### Routing primitives & scoring

The engine itself: multi-engine bike routing (OSRM, GraphHopper), PTV transit data, tunable scoring/feasibility, K=N transfer search, on-path / elevation / preference dimensions.

_Why it serves the approach:_ this is the primitives layer. Without it there's nothing to compose.

### Agent surface

CLI ergonomics, JSON schemas, tool descriptions, MCP/agent packaging, prompt patterns that compose primitives well.

_Why it serves the approach:_ makes the toolkit usable by an AI assistant out of the box — the central bet that "an agent should be able to ask any question."

### Web map front-end

A visual surface co-equal with the CLI: map view, layer toggles per itinerary, natural-language query box, on-map preference controls, side-by-side comparison.

_Why it serves the approach:_ delivers the second co-equal surface, so a rider can *see* and compare routes, not just receive JSON.
