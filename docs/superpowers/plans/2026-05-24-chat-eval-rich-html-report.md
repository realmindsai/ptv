# chat-eval rich HTML report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ptv chat-eval`'s HTML report genuinely useful for evaluating routing answers. Per prompt, render an embedded Leaflet map overlaying every model's chosen route polylines, a per-leg segment table (from → to stop names), and a top-line summary table that includes both per-model wall time and per-model USD cost (computed from OpenRouter token usage × current model prices).

**Architecture:** Three new capture paths feed the renderer:
1. **Side-event capture.** Wire `ctx.emit` in the CLI to push `path_add` events into a per-turn buffer; the runner drains the buffer into a new `turns.path_adds_json` column.
2. **Usage capture.** Request `stream_options.include_usage` in the OpenRouter request, surface the final-chunk `usage` block on the existing `turn_end` SseEvent, and persist into the already-present `turns.usage_json` column.
3. **Pricing.** Fetch `/api/v1/models` once per CLI invocation, look up each model's prompt/completion price, multiply by captured tokens, store on the in-memory turn record (HTML-only — no schema change).

The HTML renderer is rewritten to consume these three new data sources alongside the existing tool-call / final-text data. Leaflet ships from CDN (one external script + stylesheet — the report stays readable offline minus the basemap tiles).

**Tech Stack:** TypeScript, vitest, Leaflet 1.9 (via CDN), existing OpenRouter / Zod / better-sqlite3 stack. No new npm deps.

**Spec source:** This plan is its own spec — no separate design doc. Sources of truth:
- Existing chat-eval design: `docs/superpowers/specs/2026-05-23-chat-eval-openrouter-design.md`
- Existing renderers + types: `src/chat-eval/renderers/html.ts`, `src/chat/types.ts`, `src/plan/types.ts`
- Existing in-repo map writer (for the Leaflet pattern to copy): `src/plan/map.ts`

---

## File map

**New:**
- `src/chat-eval/cost.ts` — fetch `/api/v1/models` prices; compute USD given usage block
- `src/chat-eval/extract.ts` — parse captured `path_add` events → per-itinerary leg geometry + names
- `tests/unit/chat-eval/cost.test.ts`
- `tests/unit/chat-eval/extract.test.ts`

**Modified:**
- `src/chat/types.ts` — add optional `usage` to `turn_end` SseEvent
- `src/llm/types.ts` — re-export `UsageBlock` (already there) for downstream use
- `src/llm/openrouter.ts` — add `stream_options.include_usage = true` to request body; capture `usage` from final chunk; attach to `turn_end`
- `src/chat-eval/db.ts` — idempotent `ALTER TABLE turns ADD COLUMN path_adds_json TEXT`; raise `result_json` truncation from 1000 to 200000 chars (geometry is long)
- `src/chat-eval/runner.ts` — accept `getSideEvents` callback in `RunnerDeps`; capture `turn_end.usage`; persist `path_adds_json` + `usage_json`
- `src/chat-eval/renderers/html.ts` — replace per-prompt layout with summary table, per-model card, segment table, embedded Leaflet map
- `src/commands/chat-eval.ts` — wire `ctx.emit` to per-turn buffer; fetch prices once; pass usage + extracted geometry + names + cost into HTML renderer
- `tests/unit/chat-eval/renderers/html.test.ts` — extend snapshots for new sections
- `tests/unit/chat-eval/runner.test.ts` — extend for side-event + usage capture

---

## Task 1: Plumb `usage` into the `turn_end` SseEvent

**Files:**
- Modify: `src/chat/types.ts`
- Modify: `src/llm/openrouter.ts`
- Test: `tests/unit/llm/openrouter.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append to openrouter.test.ts)**

```typescript
import type { UsageBlock } from '../../../src/llm/types';

describe('runAgentLoop usage capture', () => {
  it('attaches the final chunk usage block to turn_end', async () => {
    const opts: AgentLoopOptions = {
      model: 'test/model', systemPrompt: 's', history: [], tools: [], apiKey: 'k',
      fetchImpl: fakeFetch([
        streamFrom([
          { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
        ]),
      ]),
    };
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop('hi', opts)) events.push(ev);
    const end = events.find((e) => e.type === 'turn_end') as any;
    expect(end.usage).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/llm/openrouter.test.ts`
Expected: FAIL — current `turn_end` has no `usage` field; current request body doesn't ask for it; current loop doesn't capture it.

- [ ] **Step 3: Extend `turn_end` SseEvent**

Edit `src/chat/types.ts`:

```typescript
import type { Itinerary } from '../plan/types';
import type { UsageBlock } from '../llm/types';
export type { Itinerary };

export type SseEvent =
  | { type: 'turn_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string }
  | { type: 'path_add'; pathId: string; label: string; color: string; itinerary: Itinerary }
  | { type: 'turn_end'; usage?: UsageBlock }
  | { type: 'error'; message: string };
```

- [ ] **Step 4: Capture usage in openrouter.ts**

Open `src/llm/openrouter.ts`. In the request body (currently around line 36–41), add `stream_options`:

```typescript
const body = {
  model: opts.model,
  stream: true,
  stream_options: { include_usage: true },
  messages,
  ...(oaTools.length ? { tools: oaTools, tool_choice: 'auto' } : {}),
};
```

Add a tracker in `runAgentLoop` (right after `let lastChunkMs = turnStartMs;`):

```typescript
let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
```

Inside the chunk loop, immediately AFTER the `sdkMsgCount++;` line, before the `const ch = chunk.choices?.[0];` check, add:

```typescript
if (chunk.usage) lastUsage = chunk.usage;
```

(OpenRouter sends a separate chunk with `choices: []` and `usage: {…}` at the very end; we must not skip it just because `choices[0]` is undefined.)

Finally, change the trailing `yield { type: 'turn_end' };` to:

```typescript
yield { type: 'turn_end', ...(lastUsage ? { usage: lastUsage } : {}) };
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/llm/openrouter.test.ts`
Expected: 7/7 pass (3 parser + 3 loop + 1 usage).

Also run: `npx vitest run tests/unit/chat tests/integration/chat-route-smoke.test.ts` — must stay green (the `turn_end` shape change is backward-compatible since `usage` is optional).

- [ ] **Step 6: Commit**

```bash
git add src/chat/types.ts src/llm/openrouter.ts tests/unit/llm/openrouter.test.ts
git commit -m "feat(llm): capture OpenRouter usage block on turn_end"
```

Use a HEREDOC. Append `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 2: Persist usage + capture side-channel `path_add` events

**Files:**
- Modify: `src/chat-eval/db.ts`
- Modify: `src/chat-eval/runner.ts`
- Test: `tests/unit/chat-eval/runner.test.ts` (extend)
- Test: `tests/unit/chat-eval/db.test.ts` (extend)

The runner currently captures only events that flow through the agent's generator. `path_add` events are emitted *out-of-band* via `ctx.emit` (synchronously, from inside tool handlers). We add a `getSideEvents` callback that the runner drains after the generator ends.

- [ ] **Step 1: Write the failing test (extend runner.test.ts)**

```typescript
describe('runOne side-channel capture', () => {
  it('captures path_add events and turn_end.usage into the persisted turn row', async () => {
    const db = openEvalDb(':memory:');
    db.insertRun({ run_id: 'rC', started_at: 'now', cmd: 'run' });

    const sideEvents: SseEvent[] = [
      { type: 'path_add', pathId: 'p1', label: 'recommended', color: '#e6194b',
        itinerary: { labels: ['recommended'], totalTimeMin: 45, bikeKm: 5, bikeMin: 20,
                     trainKm: 10, trainMin: 15, waitMin: 5, transferDwellMin: 5, transfers: 1,
                     legs: [] } as any },
    ];

    const events: SseEvent[] = [
      { type: 'turn_start' },
      { type: 'text_delta', delta: 'Here you go.' },
      { type: 'turn_end', usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 } },
    ];

    const deps: RunnerDeps = {
      db,
      runTurn: async () => { async function* g() { for (const e of events) yield e; } return g(); },
      getSideEvents: () => sideEvents.splice(0),
      nowMs: () => 0,
    };

    await runOne(deps, { run_id: 'rC', prompt_id: null, prompt: 'p', model: 'm/x', origin: null });

    const turn = db.raw.prepare('SELECT path_adds_json, usage_json FROM turns WHERE run_id = ?').get('rC') as any;
    const paths = JSON.parse(turn.path_adds_json);
    expect(paths).toHaveLength(1);
    expect(paths[0].label).toBe('recommended');
    const usage = JSON.parse(turn.usage_json);
    expect(usage.total_tokens).toBe(80);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/runner.test.ts`
Expected: FAIL — `getSideEvents` not a recognized field; `path_adds_json` column doesn't exist; runner doesn't read `turn_end.usage`.

- [ ] **Step 3: Add the column + bump truncation in `src/chat-eval/db.ts`**

Find the `SCHEMA` const and append a column to the `turns` table:

```sql
CREATE TABLE IF NOT EXISTS turns (
  ...existing columns...,
  usage_json    TEXT,
  error         TEXT,
  path_adds_json TEXT
);
```

Because `CREATE TABLE IF NOT EXISTS` does NOT alter existing tables, also run an idempotent `ALTER TABLE` right after `raw.exec(SCHEMA);`:

```typescript
try {
  raw.exec(`ALTER TABLE turns ADD COLUMN path_adds_json TEXT`);
} catch (e) {
  // ignore: column already exists from a previous run
  if (!/duplicate column/i.test((e as Error).message)) throw e;
}
```

Add a typed insert path. Replace the `TurnRow` interface to include the optional new field:

```typescript
export interface TurnRow {
  ...existing fields...
  error: string | null;
  path_adds_json: string | null;
}
```

And the `insTurn` prepared statement string — add `path_adds_json` to the column list and `@path_adds_json` to the values list, in both the column list and the `VALUES (…)` section. Pass `path_adds_json: null` as the default everywhere the row is built without one.

- [ ] **Step 4: Update db.test.ts**

In the existing "inserts a run + turn + tool_call" test, pass `path_adds_json: null` in the `insertTurn` arg so it still compiles. Add a new test:

```typescript
it('round-trips path_adds_json blob', () => {
  const db = openEvalDb(':memory:');
  db.insertRun({ run_id: 'r2', started_at: 'x', cmd: 'run' });
  db.insertTurn({
    run_id: 'r2', prompt_id: null, prompt: 'p', model: 'm',
    origin_lat: null, origin_lon: null, started_at: 'x',
    total_ms: 1, tool_total_ms: 0, non_tool_ms: 1, sdk_msg_count: 0,
    final_text: '', usage_json: '{"total_tokens":42}', error: null,
    path_adds_json: '[{"label":"recommended"}]',
  });
  const row = db.raw.prepare('SELECT path_adds_json, usage_json FROM turns').get() as any;
  expect(JSON.parse(row.path_adds_json)[0].label).toBe('recommended');
  expect(JSON.parse(row.usage_json).total_tokens).toBe(42);
});
```

- [ ] **Step 5: Update `src/chat-eval/runner.ts`**

In `RunnerDeps`, add the optional callback:

```typescript
export interface RunnerDeps {
  db: EvalDb;
  runTurn: (input: { prompt: string; model: string; origin?: ...; history?: ... }) => Promise<AsyncGenerator<SseEvent>>;
  /** Returns + drains any path_add events that landed via ctx.emit during this turn. */
  getSideEvents?: () => SseEvent[];
  nowMs?: () => number;
}
```

In `runOne`, after the `for await (const ev of gen)` loop, BEFORE the `total_ms = now() - start;` line, add:

```typescript
const sideEvents = deps.getSideEvents?.() ?? [];
const pathAdds = sideEvents.filter((e): e is Extract<SseEvent, { type: 'path_add' }> => e.type === 'path_add');
```

Inside the for-await loop, add a case to capture usage from `turn_end`:

```typescript
case 'turn_end':
  if ((ev as any).usage) usage = (ev as any).usage;
  break;
```

Declare `let usage: any = null;` at the top of `runOne` (alongside `let finalText`).

Change the `db.insertTurn({...})` call to include the two new fields:

```typescript
const turn_id = deps.db.insertTurn({
  ...existing fields...,
  usage_json: usage ? JSON.stringify(usage) : null,
  error,
  path_adds_json: pathAdds.length ? JSON.stringify(pathAdds) : null,
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/chat-eval/db.test.ts tests/unit/chat-eval/runner.test.ts`
Expected: 5/5 pass (2 existing db + 1 new db + 2 existing runner + 1 new runner).

Run `npm run build`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/chat-eval/db.ts src/chat-eval/runner.ts tests/unit/chat-eval/db.test.ts tests/unit/chat-eval/runner.test.ts
git commit -m "feat(chat-eval): persist usage_json + side-channel path_add events per turn"
```

---

## Task 3: Raise the `result_json` truncation cap

**Files:**
- Modify: `src/chat-eval/runner.ts`

Right now `runner.ts` calls `JSON.stringify(payload).slice(0, 10000)` on tool results (via `result_summary`). Some tool returns (especially `plan` and `bike_route`) are short, BUT the polyline arrays we will start reading in Task 4 can each be ~5–15 KB. To be safe, the limit moves from 10000 → 200000. The same applies to `summary` in the `tool_result` SseEvent already exposed by `runAgentLoop`.

- [ ] **Step 1: Find the existing 1000 / 10000 limits**

Run: `grep -n '\.slice(0, 1000)\|\.slice(0, 10000)' src/llm/openrouter.ts src/chat-eval/runner.ts`

You will find one site in `runAgentLoop` (`summary: JSON.stringify(payload).slice(0, 1000)`) and one in `runner.ts` (`result_summary` capture). Both need bumping.

- [ ] **Step 2: Bump both**

In `src/llm/openrouter.ts`, change `.slice(0, 1000)` → `.slice(0, 200000)`.

In `src/chat-eval/runner.ts`, find where `result_summary` is assigned (inside the `tool_result` case) and confirm it stores `ev.summary` directly — if it does, no change here; the bump in openrouter.ts already covers it. If it re-truncates, change to the new cap.

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run tests/unit`
Expected: all green; no test asserts the 1000-char cap (verify by grepping for `1000` in tests if you find a failure).

- [ ] **Step 4: Commit**

```bash
git add src/llm/openrouter.ts src/chat-eval/runner.ts
git commit -m "feat(llm): raise tool-result summary cap to 200KB so polylines fit"
```

---

## Task 4: `extract.ts` — pull leg geometry + names from path_add events

**Files:**
- Create: `src/chat-eval/extract.ts`
- Create: `tests/unit/chat-eval/extract.test.ts`

Pure function (no IO). Given the captured `path_add` events for a single turn, produce a flat list of itineraries each with `{label, color, legs: [{mode, fromName, toName, latlngs: [lat,lon][]}]}`. Bike legs use `geometry.coordinates` (GeoJSON [lon,lat] → Leaflet [lat,lon]). Train legs use the (optional) `fromLat/fromLon/toLat/toLon` station coords as a straight line.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-eval/extract.test.ts
import { describe, it, expect } from 'vitest';
import { extractItineraries } from '../../../src/chat-eval/extract';
import type { SseEvent } from '../../../src/chat/types';

const pathAdds: SseEvent[] = [
  {
    type: 'path_add', pathId: 'p1', label: 'recommended', color: '#e6194b',
    itinerary: {
      labels: ['recommended'], totalTimeMin: 30, bikeKm: 5, bikeMin: 20,
      trainKm: 8, trainMin: 12, waitMin: 5, transferDwellMin: 0, transfers: 0,
      legs: [
        { mode: 'bike', from: { lat: -37.8, lon: 144.97 }, to: { lat: -37.81, lon: 144.99 },
          km: 5, min: 20,
          geometry: { type: 'LineString', coordinates: [[144.97, -37.8], [144.98, -37.805], [144.99, -37.81]] } },
        { mode: 'train', routeId: 1, routeType: 0 as any, routeName: 'Lilydale',
          fromStopId: 1, toStopId: 2, fromStopName: 'Flinders Street', toStopName: 'Hawthorn',
          fromLat: -37.818, fromLon: 144.967, toLat: -37.822, toLon: 145.035,
          departUtc: '2026-05-24T08:00:00Z', arriveUtc: '2026-05-24T08:12:00Z', runRef: 'r1' },
      ],
    } as any,
  },
];

describe('extractItineraries', () => {
  it('returns one itinerary record per path_add event', () => {
    const out = extractItineraries(pathAdds);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('recommended');
    expect(out[0].color).toBe('#e6194b');
    expect(out[0].legs).toHaveLength(2);
  });

  it('converts bike leg GeoJSON [lon,lat] to Leaflet [lat,lon]', () => {
    const [it] = extractItineraries(pathAdds);
    const bike = it.legs[0];
    expect(bike.mode).toBe('bike');
    expect(bike.latlngs).toEqual([[-37.8, 144.97], [-37.805, 144.98], [-37.81, 144.99]]);
    expect(bike.fromName).toMatch(/-?37\./);
    expect(bike.toName).toMatch(/-?37\./);
  });

  it('uses station coords for train leg straight line', () => {
    const [it] = extractItineraries(pathAdds);
    const train = it.legs[1];
    expect(train.mode).toBe('train');
    expect(train.fromName).toBe('Flinders Street');
    expect(train.toName).toBe('Hawthorn');
    expect(train.latlngs).toEqual([[-37.818, 144.967], [-37.822, 145.035]]);
  });

  it('skips non-path_add events gracefully', () => {
    const mixed: SseEvent[] = [
      { type: 'turn_start' },
      ...pathAdds,
      { type: 'turn_end' },
    ];
    expect(extractItineraries(mixed)).toHaveLength(1);
  });

  it('omits train legs whose station coords are missing rather than emitting [[]] junk', () => {
    const noCoord: SseEvent[] = [{
      type: 'path_add', pathId: 'p2', label: 'fastest', color: '#3cb44b',
      itinerary: {
        labels: ['fastest'], totalTimeMin: 1, bikeKm: 0, bikeMin: 0,
        trainKm: 1, trainMin: 1, waitMin: 0, transferDwellMin: 0, transfers: 0,
        legs: [{
          mode: 'train', routeId: 1, routeType: 0 as any, routeName: 'X',
          fromStopId: 1, toStopId: 2, fromStopName: 'A', toStopName: 'B',
          departUtc: 'x', arriveUtc: 'y', runRef: 'r',
        }],
      } as any,
    }];
    const out = extractItineraries(noCoord);
    expect(out[0].legs[0].latlngs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/extract.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `extract.ts`**

```typescript
// src/chat-eval/extract.ts
import type { SseEvent } from '../chat/types';
import type { Itinerary, Leg, BikeLeg, TrainLeg } from '../plan/types';

export interface ExtractedLeg {
  mode: 'bike' | 'train';
  fromName: string;
  toName: string;
  km?: number;
  min?: number;
  /** Leaflet-style [[lat, lon], ...]. Empty for train legs without station coords. */
  latlngs: Array<[number, number]>;
}

export interface ExtractedItinerary {
  label: string;
  color: string;
  totalTimeMin: number;
  legs: ExtractedLeg[];
}

function fmtLatLon(p: { lat: number; lon: number }): string {
  return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

function extractLeg(leg: Leg): ExtractedLeg {
  if (leg.mode === 'bike') {
    const coords = leg.geometry?.coordinates ?? [];
    const latlngs = coords.map(([lon, lat]) => [lat, lon] as [number, number]);
    return {
      mode: 'bike',
      fromName: fmtLatLon(leg.from),
      toName: fmtLatLon(leg.to),
      km: leg.km,
      min: leg.min,
      latlngs,
    };
  }
  const t = leg as TrainLeg;
  const latlngs: Array<[number, number]> =
    t.fromLat != null && t.fromLon != null && t.toLat != null && t.toLon != null
      ? [[t.fromLat, t.fromLon], [t.toLat, t.toLon]]
      : [];
  return {
    mode: 'train',
    fromName: t.fromStopName,
    toName: t.toStopName,
    latlngs,
  };
}

export function extractItineraries(events: SseEvent[]): ExtractedItinerary[] {
  const adds = events.filter((e): e is Extract<SseEvent, { type: 'path_add' }> => e.type === 'path_add');
  return adds.map((ev) => ({
    label: ev.label,
    color: ev.color,
    totalTimeMin: ev.itinerary.totalTimeMin,
    legs: ev.itinerary.legs.map(extractLeg),
  }));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/chat-eval/extract.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat-eval/extract.ts tests/unit/chat-eval/extract.test.ts
git commit -m "feat(chat-eval): extract per-leg geometry + names from path_add events"
```

---

## Task 5: `cost.ts` — fetch OpenRouter prices, compute USD

**Files:**
- Create: `src/chat-eval/cost.ts`
- Create: `tests/unit/chat-eval/cost.test.ts`

OpenRouter exposes per-model `pricing.prompt` and `pricing.completion` (USD per token, as strings). We fetch once, cache in-process, then compute `prompt_tokens × prompt_price + completion_tokens × completion_price` per turn.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-eval/cost.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPrices, computeCost, type PriceTable } from '../../../src/chat-eval/cost';

describe('fetchPrices', () => {
  it('returns USD-per-token prices for the requested model slugs', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
        { id: 'google/gemini-3.5-flash',   pricing: { prompt: '0.0000002', completion: '0.000001' } },
        { id: 'openai/gpt-5',              pricing: { prompt: '0.000003', completion: '0.00001' } },
      ],
    }), { status: 200 }));
    const prices = await fetchPrices(
      ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash'],
      { fetchImpl: fakeFetch as any },
    );
    expect(prices['anthropic/claude-haiku-4.5']).toEqual({ prompt: 1e-6, completion: 5e-6 });
    expect(prices['google/gemini-3.5-flash']).toEqual({ prompt: 2e-7, completion: 1e-6 });
    expect(prices['openai/gpt-5']).toBeUndefined();   // not asked
  });

  it('returns an empty table on fetch failure (degrades silently)', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    const prices = await fetchPrices(['anthropic/claude-haiku-4.5'], { fetchImpl: fakeFetch as any });
    expect(prices).toEqual({});
  });
});

describe('computeCost', () => {
  const prices: PriceTable = {
    'anthropic/claude-haiku-4.5': { prompt: 1e-6, completion: 5e-6 },
  };
  it('multiplies tokens by price', () => {
    const usd = computeCost('anthropic/claude-haiku-4.5', { prompt_tokens: 1000, completion_tokens: 200 }, prices);
    expect(usd).toBeCloseTo(1000 * 1e-6 + 200 * 5e-6, 9);
  });
  it('returns null when the model has no entry', () => {
    expect(computeCost('mystery/model', { prompt_tokens: 100, completion_tokens: 50 }, prices)).toBeNull();
  });
  it('returns null when tokens are missing', () => {
    expect(computeCost('anthropic/claude-haiku-4.5', {} as any, prices)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/cost.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `cost.ts`**

```typescript
// src/chat-eval/cost.ts
import type { UsageBlock } from '../llm/types';

export interface ModelPrice {
  prompt: number;
  completion: number;
}
export type PriceTable = Record<string, ModelPrice>;

export interface FetchPricesOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

export async function fetchPrices(
  modelSlugs: string[],
  opts: FetchPricesOptions = {},
): Promise<PriceTable> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? DEFAULT_BASE}/models`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return {};
    const body = await res.json() as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
    const wanted = new Set(modelSlugs);
    const out: PriceTable = {};
    for (const m of body.data ?? []) {
      if (!wanted.has(m.id) || !m.pricing) continue;
      const p = parseFloat(m.pricing.prompt ?? 'NaN');
      const c = parseFloat(m.pricing.completion ?? 'NaN');
      if (Number.isFinite(p) && Number.isFinite(c)) out[m.id] = { prompt: p, completion: c };
    }
    return out;
  } catch {
    return {};
  }
}

export function computeCost(model: string, usage: UsageBlock, prices: PriceTable): number | null {
  const p = prices[model];
  if (!p) return null;
  if (typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') return null;
  return usage.prompt_tokens * p.prompt + usage.completion_tokens * p.completion;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/chat-eval/cost.test.ts`
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat-eval/cost.ts tests/unit/chat-eval/cost.test.ts
git commit -m "feat(chat-eval): fetch OpenRouter model prices + computeCost helper"
```

---

## Task 6: Rewrite the HTML renderer for maps + segments + cost

**Files:**
- Modify: `src/chat-eval/renderers/html.ts`
- Modify: `tests/unit/chat-eval/renderers/html.test.ts`

Per-prompt section now lays out:

```
┌── prompt: "From X to Y" ─────────────────────────────────────┐
│  ┌──── summary ───────────────────────────────────────────┐  │
│  │ model            total_ms   usd     tokens p/c   tools │  │
│  │ haiku-4.5         9,615    $0.014   1234/567     5    │  │
│  │ gemini-3.5-flash 22,903    $0.001    890/420     3    │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌── model card: anthropic/claude-haiku-4.5 ────────────┐    │
│  │  <markdown final_text>                                │    │
│  │  segments:                                            │    │
│  │   recommended  bike: -37.8014,144.9676 → -37.7951,…   │    │
│  │   recommended  train: Flinders Street → Hawthorn      │    │
│  │  ▸ tool calls (collapsible)                           │    │
│  └───────────────────────────────────────────────────────┘    │
│  ┌── model card: google/gemini-3.5-flash ─────...───────┐    │
│  │  <markdown final_text>                                │    │
│  │  segments: …                                          │    │
│  └───────────────────────────────────────────────────────┘    │
│  ┌── map (Leaflet, polylines colored by model) ─────────┐    │
│  │                                                       │    │
│  │       ░░░░░ haiku route in #e6194b                    │    │
│  │       ▒▒▒▒▒ gemini route in #3cb44b                   │    │
│  │                                                       │    │
│  └───────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

Leaflet ships via CDN (one `<link>` + one `<script>` in `<head>`). Map data is inlined as a JSON array per prompt; an inline script reads each `data-prompt-idx` div, creates an L.Map, plots polylines, fits bounds.

- [ ] **Step 1: Extend `HtmlRenderInput` and per-turn shape**

The current `HtmlRenderInput.prompts[i].turns[j]` has `model, final_text, total_ms, tool_total_ms, tool_calls, error`. Add:

- `usd: number | null`
- `usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null`
- `itineraries: ExtractedItinerary[]` (from Task 4)

- [ ] **Step 2: Update the existing snapshot test**

Replace `tests/unit/chat-eval/renderers/html.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../../../src/chat-eval/renderers/html';

const baseTurn = {
  model: 'a/x', final_text: '**hi**', total_ms: 1000, tool_total_ms: 50,
  tool_calls: [{ tool: 'plan', ok: true, duration_ms: 30, args_json: '{}', result_json: '{}' }],
  error: null,
  usd: 0.0123,
  usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
  itineraries: [{
    label: 'recommended', color: '#e6194b', totalTimeMin: 25,
    legs: [
      { mode: 'bike', fromName: '-37.8,144.97', toName: '-37.81,144.99', km: 5, min: 20,
        latlngs: [[-37.8, 144.97], [-37.81, 144.99]] },
      { mode: 'train', fromName: 'Flinders Street', toName: 'Hawthorn', latlngs: [[-37.818, 144.967], [-37.822, 145.035]] },
    ],
  }],
};

describe('renderHtml v2', () => {
  it('produces a self-contained html document with Leaflet CDN + per-prompt map', () => {
    const html = renderHtml({
      run_id: 'r1',
      title: 'eval — golden',
      prompts: [{ prompt: 'From A to B', turns: [baseTurn] }],
    });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('unpkg.com/leaflet');
    expect(html).toContain('<style>');
    expect(html).toContain('From A to B');
    expect(html).toContain('a/x');
    expect(html).toContain('$0.0123');
    expect(html).toContain('1000');                          // total_ms
    expect(html).toContain('Flinders Street');               // train from
    expect(html).toContain('Hawthorn');                      // train to
    expect(html).toContain('data-prompt-idx="0"');           // map mount
    expect(html).toContain('"latlngs":');                    // map data inlined
  });

  it('emits "—" instead of $NaN when usd is null', () => {
    const html = renderHtml({
      run_id: 'r2', title: 't',
      prompts: [{ prompt: 'p', turns: [{ ...baseTurn, usd: null, usage: null }] }],
    });
    expect(html).toContain('—');
    expect(html).not.toContain('$NaN');
    expect(html).not.toContain('null');
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/renderers/html.test.ts`
Expected: FAIL.

- [ ] **Step 4: Replace the renderer**

```typescript
// src/chat-eval/renderers/html.ts
import { marked } from 'marked';
import type { ExtractedItinerary } from '../extract';

export interface HtmlRenderTurn {
  model: string;
  final_text: string;
  total_ms: number;
  tool_total_ms: number;
  tool_calls: Array<{
    tool: string; ok: boolean; duration_ms: number;
    args_json: string; result_json: string | null;
  }>;
  error: string | null;
  usd: number | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  itineraries: ExtractedItinerary[];
}

export interface HtmlRenderInput {
  run_id: string;
  title: string;
  prompts: Array<{ prompt: string; turns: HtmlRenderTurn[] }>;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function usdStr(usd: number | null): string {
  if (usd == null) return '—';
  return '$' + usd.toFixed(4);
}

function tokStr(usage: HtmlRenderTurn['usage']): string {
  if (!usage || usage.prompt_tokens == null) return '—';
  return `${usage.prompt_tokens}/${usage.completion_tokens ?? '?'}`;
}

const STYLE = `
body { font: 14px/1.5 system-ui, sans-serif; margin: 16px; color: #222; }
h1 { font-size: 18px; margin: 0 0 12px; }
.prompt-section { margin: 24px 0; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
.prompt-header { background: #f4f4f4; padding: 10px 14px; border-bottom: 1px solid #ddd; font-weight: 600; }
.summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.summary-table th, .summary-table td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #eee; }
.summary-table th { background: #fafafa; font-weight: 500; color: #555; }
.summary-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.model-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; padding: 12px; }
.card { border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px 12px; background: #fff; }
.card .model { font-weight: 600; font-size: 13px; }
.card .answer { margin: 8px 0; }
.segments { font-size: 12px; }
.segments table { width: 100%; border-collapse: collapse; }
.segments td { padding: 2px 6px; vertical-align: top; }
.segments td.label { color: #555; white-space: nowrap; }
.segments td.mode { color: #888; width: 50px; }
details { margin-top: 8px; font-size: 12px; font-family: ui-monospace, monospace; }
pre { background: #fafafa; padding: 6px; overflow-x: auto; }
.err { color: #b00; }
.map { height: 360px; margin: 0 12px 12px; border: 1px solid #ddd; border-radius: 4px; }
.legend { padding: 0 12px 12px; font-size: 12px; color: #666; }
.legend .swatch { display: inline-block; width: 12px; height: 12px; vertical-align: middle; margin-right: 4px; border-radius: 2px; }
`;

function renderSegments(its: ExtractedItinerary[]): string {
  if (!its.length) return '<div class="segments"><em>(no route segments)</em></div>';
  const rows = its.flatMap((it) =>
    it.legs.map((leg) => `
      <tr>
        <td class="label">${esc(it.label)}</td>
        <td class="mode">${esc(leg.mode)}</td>
        <td>${esc(leg.fromName)}</td>
        <td>→ ${esc(leg.toName)}</td>
      </tr>`),
  ).join('');
  return `<div class="segments"><table>${rows}</table></div>`;
}

function renderCard(t: HtmlRenderTurn): string {
  const body = t.error
    ? `<div class="err">ERROR: ${esc(t.error)}</div>`
    : marked(t.final_text);
  const calls = t.tool_calls.map((c) => `
    <details><summary>${esc(c.tool)} — ${c.duration_ms} ms ${c.ok ? '' : '<span class="err">FAIL</span>'}</summary>
<pre>args: ${esc(c.args_json)}
result: ${esc(c.result_json ?? '')}</pre></details>`).join('');
  return `
<div class="card">
  <div class="model">${esc(t.model)}</div>
  <div class="answer">${body}</div>
  ${renderSegments(t.itineraries)}
  ${calls}
</div>`;
}

function renderSummary(turns: HtmlRenderTurn[]): string {
  const rows = turns.map((t) => `
    <tr>
      <td>${esc(t.model)}</td>
      <td class="num">${t.total_ms} ms</td>
      <td class="num">${t.tool_total_ms} ms</td>
      <td class="num">${usdStr(t.usd)}</td>
      <td class="num">${tokStr(t.usage)}</td>
      <td class="num">${t.tool_calls.length}</td>
    </tr>`).join('');
  return `
<table class="summary-table">
  <thead><tr>
    <th>model</th><th>total</th><th>tools</th><th>cost</th><th>tokens p/c</th><th>calls</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderLegend(turns: HtmlRenderTurn[]): string {
  const items = turns.flatMap((t) =>
    t.itineraries.map((it) =>
      `<span><span class="swatch" style="background:${esc(it.color)}"></span>${esc(t.model)} · ${esc(it.label)}</span>`,
    ),
  );
  if (!items.length) return '';
  return `<div class="legend">${items.join(' &nbsp; ')}</div>`;
}

const MAP_SCRIPT = `
document.querySelectorAll('.map').forEach((el) => {
  const data = JSON.parse(el.getAttribute('data-routes'));
  if (!data.length) { el.innerHTML = '<em style="padding:12px;display:block;">no routes to plot</em>'; return; }
  const map = L.map(el).setView([-37.81, 144.96], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
  const all = [];
  data.forEach((route) => {
    if (!route.latlngs.length) return;
    const opts = { color: route.color, weight: 4, opacity: 0.7, dashArray: route.mode === 'train' ? '6,6' : null };
    const line = L.polyline(route.latlngs, opts).addTo(map);
    line.bindTooltip(route.title);
    all.push(...route.latlngs);
  });
  if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.05));
});
`;

export function renderHtml(input: HtmlRenderInput): string {
  const sections = input.prompts.map((p, idx) => {
    const routes = p.turns.flatMap((t) =>
      t.itineraries.flatMap((it) =>
        it.legs.map((leg) => ({
          color: it.color,
          mode: leg.mode,
          latlngs: leg.latlngs,
          title: `${t.model} · ${it.label} · ${leg.mode} · ${leg.fromName} → ${leg.toName}`,
        })),
      ),
    );
    return `
<div class="prompt-section">
  <div class="prompt-header">${esc(p.prompt)}</div>
  ${renderSummary(p.turns)}
  <div class="model-cards">${p.turns.map(renderCard).join('')}</div>
  <div class="map" data-prompt-idx="${idx}" data-routes='${esc(JSON.stringify(routes))}'></div>
  ${renderLegend(p.turns)}
</div>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>${STYLE}</style>
</head><body>
<h1>${esc(input.title)} — run ${esc(input.run_id)}</h1>
${sections}
<script>${MAP_SCRIPT}</script>
</body></html>`;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/chat-eval/renderers/html.test.ts`
Expected: 2/2 pass.

- [ ] **Step 6: Build full**

Run: `npm run build && npm test`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/chat-eval/renderers/html.ts tests/unit/chat-eval/renderers/html.test.ts
git commit -m "feat(chat-eval): HTML report — summary table, segment lists, Leaflet map per prompt"
```

---

## Task 7: Wire it in `src/commands/chat-eval.ts`

**Files:**
- Modify: `src/commands/chat-eval.ts`

The CLI now has to:

1. Build the per-turn side-event buffer + `ctx.emit` that writes to it.
2. Drain that buffer via `getSideEvents` in `RunnerDeps`.
3. Fetch model prices ONCE per CLI invocation (before any `runPromptAcrossModels` calls).
4. For each captured turn: compute USD (cost.ts), extract itineraries (extract.ts), pass into the HTML renderer input.

- [ ] **Step 1: Read the current shape**

Run: `cat src/commands/chat-eval.ts | head -110` and study how `buildTools(ctx)`, `sseGen`, and `runPromptAcrossModels` work today. The new code preserves the public CLI surface — only internals change.

- [ ] **Step 2: Refactor `runPromptAcrossModels`**

Each model invocation must own its own `sideEvents` buffer; `ctx.emit` writes to that buffer; `runOne` gets a `getSideEvents` callback. The function now also takes a `PriceTable` (Task 5) and an extractor (Task 4) so it can return turns with `usd` + `itineraries` populated.

Replace the existing `runPromptAcrossModels` with:

```typescript
import { extractItineraries, type ExtractedItinerary } from '../chat-eval/extract';
import { computeCost, type PriceTable } from '../chat-eval/cost';
import type { SseEvent, ChatCtx } from '../chat/types';

interface FullTurn {
  model: string;
  final_text: string;
  total_ms: number;
  tool_total_ms: number;
  tool_calls: Array<{ tool: string; ok: boolean; duration_ms: number; args_json: string; result_json: string | null }>;
  error: string | null;
  usd: number | null;
  usage: any;
  itineraries: ExtractedItinerary[];
}

interface RunGroupInput {
  db: EvalDb;
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  models: string[];
  origin: { lat: number; lon: number } | null;
  prices: PriceTable;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

async function runPromptAcrossModels(input: RunGroupInput): Promise<FullTurn[]> {
  return Promise.all(input.models.map(async (model) => {
    const sideEvents: SseEvent[] = [];
    const ctx: ChatCtx = {
      emit: (ev) => sideEvents.push(ev),
      origin: input.origin ?? undefined,
    };
    const tools = buildTools(ctx);

    async function* gen(): AsyncGenerator<SseEvent> {
      const messages = [
        ...(input.history ?? []),
        { role: 'user' as const, content: input.prompt },
      ];
      yield* runTurn(
        { messages, origin: input.origin ?? undefined, model } as any,
        { tools, model } as any,
      );
    }

    let usage: any = null;
    const cap = await runOne(
      {
        db: input.db,
        runTurn: async () => {
          // Wrap the generator so we can sniff the turn_end.usage before it's consumed by the runner.
          const inner = gen();
          async function* tap() {
            for await (const ev of inner) {
              if (ev.type === 'turn_end' && (ev as any).usage) usage = (ev as any).usage;
              yield ev;
            }
          }
          return tap();
        },
        getSideEvents: () => sideEvents.splice(0),
      },
      {
        run_id: input.run_id,
        prompt_id: input.prompt_id,
        prompt: input.prompt,
        model,
        origin: input.origin,
        history: input.history,
      },
    );

    const usd = usage ? computeCost(model, usage, input.prices) : null;
    const itineraries = extractItineraries(sideEvents);   // sideEvents already drained by runner; this returns []
    // The runner already drained sideEvents via getSideEvents; we need a second collection.
    // FIX: the runner's getSideEvents callback can be wrapped to copy-and-drain.
    // (see Step 3 below for the correct wiring)

    return {
      model,
      final_text: cap.final_text,
      total_ms: cap.total_ms,
      tool_total_ms: cap.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
      tool_calls: cap.tool_calls.map((tc) => ({
        tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms,
        args_json: JSON.stringify(tc.args),
        result_json: tc.result_summary,
      })),
      error: cap.error,
      usd,
      usage,
      itineraries,
    };
  }));
}
```

- [ ] **Step 3: Fix the side-event double-drain bug noted inline**

The runner consumes side events via `getSideEvents()` which `splice(0)`s the buffer. After the runner returns, the buffer is empty — so the second `extractItineraries(sideEvents)` call returns `[]`. Two options:

a. Copy-then-drain in the callback: `getSideEvents: () => sideEvents.slice()`, then drain ourselves afterwards: `sideEvents.length = 0`. But the runner is supposed to *consume*, not peek.
b. Make `runOne` return the side events alongside the captured turn.

Pick (b) — it keeps the runner authoritative. In Task 2 you added `getSideEvents` to `RunnerDeps`; now extend `CapturedTurn`:

```typescript
// src/chat-eval/runner.ts
export interface CapturedTurn {
  turn_id: number;
  final_text: string;
  tool_calls: CapturedToolCall[];
  total_ms: number;
  error: string | null;
  side_events: SseEvent[];          // NEW
}
```

And in `runOne`, change the assignment site to also include:

```typescript
return { turn_id, final_text: finalText, tool_calls: ordered, total_ms, error, side_events: sideEvents };
```

Where `sideEvents` is the local `const sideEvents = deps.getSideEvents?.() ?? [];` from Task 2.

Update `tests/unit/chat-eval/runner.test.ts` to assert `side_events.length === 1` in the new test from Task 2 step 1. Then in `chat-eval.ts` replace the buggy block:

```typescript
const itineraries = extractItineraries(cap.side_events);
// remove the duplicate getSideEvents drain in this file
```

- [ ] **Step 4: Hoist the price fetch to once-per-invocation**

In each of the three action handlers (`run`, `suite`, `replay`), BEFORE the first `runPromptAcrossModels` call, fetch prices once:

```typescript
const prices = await fetchPrices(models, { fetchImpl: undefined });
```

Pass `prices` into every `runPromptAcrossModels` call. (For `replay`, `models = [opts.model]` — same pattern.)

- [ ] **Step 5: Update HTML render-input construction**

Wherever the existing code builds `htmlInput` / `renderHtml(...)`, swap to the new `HtmlRenderTurn` shape:

```typescript
const htmlSections.push({
  prompt: p.prompt,
  turns: results.map((r) => ({
    model: r.model,
    final_text: r.final_text,
    total_ms: r.total_ms,
    tool_total_ms: r.tool_total_ms,
    tool_calls: r.tool_calls,
    error: r.error,
    usd: r.usd,
    usage: r.usage,
    itineraries: r.itineraries,
  })),
});
```

The plan tool's `path_add` events fire per `runPromptAcrossModels` invocation, so the colours might collide across models (the in-module `paletteCursor` increments globally). That's fine for now — the legend keys each polyline by `model · label` so the user can tell which is which.

- [ ] **Step 6: Build + run a fake suite**

Run: `npm run build`. Expected: clean.

Then drive the live CLI against a real OpenRouter key:

```bash
./scripts/decrypt-env.sh && set -a && source .env && set +a
node dist/index.js chat-eval run "From Fitzroy to Hawthorn by bike" \
  --models anthropic/claude-haiku-4.5,google/gemini-3.5-flash \
  --html /tmp/rich.html --db /tmp/rich.db
open /tmp/rich.html
```

Expected: the HTML opens, shows two cards, a segment table per card, a Leaflet map at the bottom with overlaid polylines, summary table with non-null USD figures.

If the map is blank: check that the `plan` tool was actually invoked (the prompt is bike-only by default; you may need a prompt that forces a `plan` call, e.g. "From Fitzroy to Hawthorn — bike or train, whichever is faster"). Bike-only routes flow through `bike_route` which does NOT emit `path_add` today — that's a known gap, see Task 8.

- [ ] **Step 7: Commit**

```bash
git add src/commands/chat-eval.ts src/chat-eval/runner.ts tests/unit/chat-eval/runner.test.ts
git commit -m "feat(chat-eval): pipe usage + path_adds + cost into HTML renderer input"
```

---

## Task 8: Emit `path_add` from `bike_route` too

**Files:**
- Modify: `src/chat/tools/bike_route.ts`

The `plan` tool emits `path_add` for each finalist itinerary. The `bike_route` tool returns geometry in its result but does NOT emit a side-channel `path_add`, so pure-bike queries render no map.

Fix: wrap the single bike route as a one-leg `Itinerary` shape and emit `path_add` from inside the handler.

- [ ] **Step 1: Read the existing tool**

Run: `cat src/chat/tools/bike_route.ts`. Confirm the handler returns `{ ok, km, min, geometry, ... }` and does NOT call `ctx.emit`. The `ctx: ChatCtx` is already in the factory signature — just unused.

- [ ] **Step 2: Emit a path_add at the end of a successful handler call**

Inside `makeBikeRouteTool`'s handler, after the route is computed and BEFORE returning, add:

```typescript
ctx.emit({
  type: 'path_add',
  pathId: `br-${Math.random().toString(36).slice(2, 10)}`,
  label: `bike (${args.goal})`,
  color: PALETTE[(cursor++) % PALETTE.length],
  itinerary: {
    labels: [`bike-${args.goal}`],
    totalTimeMin: r.min,
    bikeKm: r.km,
    bikeMin: r.min,
    trainKm: 0,
    trainMin: 0,
    waitMin: 0,
    transferDwellMin: 0,
    transfers: 0,
    legs: [{
      mode: 'bike',
      from: args.from,
      to: args.to,
      km: r.km,
      min: r.min,
      geometry: r.geometry,
      kmOnPath: r.kmOnPath,
      ascendM: r.ascendM,
      descendM: r.descendM,
    }],
  } as any,
});
```

Reuse the `PALETTE` + `cursor` already defined at the top of the file.

- [ ] **Step 3: Update the existing bike_route test**

Run: `cat tests/unit/chat/tools/bike_route.test.ts`. Add an assertion that `ctx.emit` was called once with a `path_add` of the right shape. Use vitest's `vi.fn()` for `ctx.emit`.

- [ ] **Step 4: Run, build, commit**

Run: `npx vitest run tests/unit/chat/tools && npm run build`
Expected: green.

```bash
git add src/chat/tools/bike_route.ts tests/unit/chat/tools/bike_route.test.ts
git commit -m "feat(chat): bike_route emits path_add so pure-bike answers render on the map"
```

---

## Task 9: Manual verification + deploy

**Files:** none (manual)

This task validates everything end-to-end and ships to totoro.

- [ ] **Step 1: Run a real two-model comparison**

```bash
set -a && source .env && set +a
node dist/index.js chat-eval run \
  "Plan a leisurely day ride from Lilydale to Hurstbridge with maximum cycleways" \
  --models anthropic/claude-haiku-4.5,google/gemini-3.5-flash \
  --html /tmp/dayride.html --db /tmp/dayride.db
open /tmp/dayride.html
```

Verify in the browser:
- Two model cards side-by-side.
- Each card shows the markdown answer, then a segment table listing route(s) and per-leg from→to.
- The summary table at the top shows non-null `$X.XXXX` per model.
- The Leaflet map at the bottom shows polylines from both models in distinct colors; the legend identifies which line belongs to which model+route.

- [ ] **Step 2: Run the golden suite**

```bash
node dist/index.js chat-eval suite tests/fixtures/eval-suite.yaml \
  --models anthropic/claude-haiku-4.5 \
  --html /tmp/golden.html --db /tmp/golden.db
open /tmp/golden.html
```

Five prompt sections, each with a map. The "Walking directions from Federation Square to MCG" prompt is short enough that `bike_route` may not fire at all — that's acceptable; the segment table simply reads `(no route segments)`.

- [ ] **Step 3: Push the branch and deploy to totoro**

```bash
git push origin feat/ptv-chat
ssh totoro 'cd /tank/code/ptv && git pull --ff-only origin feat/ptv-chat && docker compose build ptv-chat && docker compose up -d ptv-chat'
sleep 3
ssh totoro 'docker logs ptv-chat --tail 8 2>&1'
```

Expected: container restarts cleanly, logs show the server listening. The HTTP route's behavior is unchanged (the only chat/agent-touching change is the optional `usage` field on `turn_end` — backward-compatible).

- [ ] **Step 4 (optional): Hit the live URL and confirm no regression**

```bash
curl -sN --max-time 30 -X POST https://bike-rail.realmindsai.com.au/api/chat \
  -H "content-type: application/json" \
  -d '{"messages":[{"role":"user","content":"From Fitzroy to Hawthorn by bike"}]}' | tail -c 200
```

Should end with `"type":"turn_end"`. Optionally `data: ... "usage":{...}` if OpenRouter included it.

---

# Self-review summary

- **Spec coverage:** maps embedded per prompt (Task 6 + 8), per-leg segment names (Task 4 → 6), cost per turn (Tasks 1 + 5), summary table (Task 6), "see what was generated" (existing markdown render + new segments table). All four asks from the user's prompt are covered.
- **Placeholder scan:** every step has either a full code block, a verified file path, or an explicit `cat <file>` instruction. No "TBD" / "TODO" / "similar to Task N" stubs.
- **Type consistency:** `ExtractedItinerary`/`ExtractedLeg` are defined once (Task 4) and re-used by `HtmlRenderTurn.itineraries` (Task 6) and the CLI wiring (Task 7). `UsageBlock` from `src/llm/types.ts` is the single token-count type. `PriceTable` is a `Record<string, ModelPrice>` consumed only by `computeCost`. Function names match across tasks (`extractItineraries`, `computeCost`, `fetchPrices`, `getSideEvents`).
- **Test discipline:** every implementation task starts with a failing test and uses real value assertions (no `toBeTruthy` substitutions where a value check applies).
- **Known gaps deferred:** the `paletteCursor` in `plan.ts` and `bike_route.ts` is module-global, so colors may collide across parallel model invocations. The HTML legend disambiguates via `model · label`, so this is cosmetic. Untruncated `result_json` may grow eval.db significantly; if it becomes a problem, add a max-row-size guard in a follow-up.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-24-chat-eval-rich-html-report.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.

**2. Inline Execution** — `superpowers:executing-plans` here in this session, batched with checkpoints.

Which approach?
