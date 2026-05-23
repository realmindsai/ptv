# Chat eval harness + OpenRouter migration — design

**Status:** spec
**Author:** Dennis (dw) with Claude
**Date:** 2026-05-23
**Scope:** one PR for the harness + agent rewrite, a follow-up PR for prod cutover

## Goal

1. Stand up a CLI eval harness on top of the existing `src/chat` agent so we can run regression suites, fan a prompt across multiple LLMs in one command, and replay logged production conversations against new models.
2. Replace the `@anthropic-ai/claude-agent-sdk` driver inside `src/chat/agent.ts` with our own agent loop talking to OpenRouter's OpenAI-compatible chat completions API. One engine drives both the HTTP server and the CLI.

## Non-goals

- Interactive REPL chat mode (deliberately omitted).
- LLM-as-judge answer scoring.
- Multimodal prompts.
- A web UI for eval results.
- Cost dashboard (we persist `usage`; rendering is a follow-up).
- OpenRouter prompt-caching tuning (worth testing once shipped).

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Surfaces                                                          │
│  ┌──────────────────┐    ┌────────────────────────────────────┐    │
│  │ HTTP /api/chat   │    │ ptv chat-eval (new subcommand)     │    │
│  │ (web-chat)       │    │   suite | run | replay             │    │
│  └────────┬─────────┘    └──────────────┬─────────────────────┘    │
│           │                             │                          │
│           ▼                             ▼                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  src/chat/agent.ts                                          │   │
│  │  runTurn(req, opts) -> AsyncGenerator<SseEvent>             │   │
│  │  (public contract unchanged)                                │   │
│  └──────────────┬──────────────────────────────────────────────┘   │
│                 ▼                                                  │
│  ┌──────────────────────────┐   ┌──────────────────────────────┐   │
│  │ src/llm/openrouter.ts    │   │ src/chat/tools/* (unchanged) │   │
│  │ chat completions stream  │   │ geocode | plan | bike_route  │   │
│  │ + tool-use cycle         │◄──┤ | search/nearby_stops |      │   │
│  │                          │   │   schedule                   │   │
│  └──────────────────────────┘   └──────────────────────────────┘   │
│                 ▼                                                  │
│  OpenRouter API (openrouter.ai/api/v1/chat/completions)            │
│  Models: anthropic/claude-haiku-4.5, google/gemini-3-flash,        │
│    openai/gpt-5, deepseek/deepseek-v3, ...                         │
└────────────────────────────────────────────────────────────────────┘

Eval storage (CLI only):
  ./eval.db (SQLite, in cwd, gitignored)
  Tables: runs, turns, tool_calls
```

### Invariants this preserves

- `SseEvent` shape (`turn_start`, `tool_call`, `tool_result`, `text_delta`, `turn_end`, `error`) is unchanged. Web-chat keeps working.
- Conversation logger (`src/chat/log/`) keeps writing the same `events` table in postgres. No schema change.
- Tool factories (`src/chat/tools/*.ts`) keep their `{name, description, schema, handler}` shape. The consumer changes from `createSdkMcpServer` to a thin OpenAI-style adapter.
- Timing instrumentation (`ptv-chat:tool`, `ptv-chat:sdk_gap`, `ptv-chat:turn_summary`) stays in place.

## Approach

**Minimal-surface rewrite.** Pull the OpenRouter HTTP client into `src/llm/openrouter.ts` so it is unit-testable, but do not build a multi-provider abstraction. OpenRouter already abstracts providers; we should not abstract OpenRouter.

## CLI surface

```
ptv chat-eval run <prompt>          [--models a,b,...] [--origin lat,lon] \
                                    [--html OUT.html] [--json] [--db PATH]
ptv chat-eval suite <file.yaml>     [--models a,b,...] [--html OUT.html] [--json] [--db PATH]
ptv chat-eval replay <conversation> [--model X] [--from-turn N] [--db PATH]
```

- `--models` defaults to `$MODEL`; comma-separated → fan-out. Multi-model `run` or `suite` is what "comparison mode" means throughout this doc — there is no separate `compare` subcommand.
- Default DB is `./eval.db`, gitignored.
- Terminal renderer is default; `--json` switches stdout to JSONL.
- `--html` always supplements (never replaces) terminal or JSONL output.

### Suite YAML

```yaml
name: melbourne_bike_train_v1
prompts:
  - id: simple_short
    prompt: "From Fitzroy to Hawthorn by bike"
    origin: {lat: -37.80, lon: 144.97}
  - id: arriveby
    prompt: "Get me to Box Hill by 7am Sunday"
    origin: {lat: -37.80, lon: 144.97}
expect_keywords:        # optional, cheap regression check
  simple_short: ["Fitzroy", "Hawthorn"]
```

`expect_keywords` is a per-prompt allowlist; absence in `final_text` flags a warning but does not fail the run.

## Eval storage (SQLite)

File: `./eval.db`. Library: `better-sqlite3` (synchronous, fast, single file dep).

```sql
CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,        -- uuid
  started_at  TEXT NOT NULL,
  cmd         TEXT NOT NULL,           -- 'run'|'suite'|'replay'
  suite_name  TEXT,
  notes       TEXT
);

CREATE TABLE turns (
  id            INTEGER PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(run_id),
  prompt_id     TEXT,
  prompt        TEXT NOT NULL,
  model         TEXT NOT NULL,
  origin_lat    REAL,
  origin_lon    REAL,
  started_at    TEXT NOT NULL,
  total_ms      INTEGER,
  tool_total_ms INTEGER,
  non_tool_ms   INTEGER,
  sdk_msg_count INTEGER,
  final_text    TEXT,
  usage_json    TEXT,                  -- OpenRouter usage block
  error         TEXT
);

CREATE TABLE tool_calls (
  id          INTEGER PRIMARY KEY,
  turn_id     INTEGER NOT NULL REFERENCES turns(id),
  seq         INTEGER NOT NULL,
  tool        TEXT NOT NULL,
  args_json   TEXT NOT NULL,
  result_json TEXT,                    -- truncated to ~10 KB
  duration_ms INTEGER NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_turns_run ON turns(run_id);
CREATE INDEX idx_tools_turn ON tool_calls(turn_id);
```

## Renderers

- **Terminal (default).** Final answer rendered as markdown via `marked-terminal`. Trailing summary table: model | total_ms | tool_ms | tool_count. In comparison mode, one block per model plus a two-column comparison table.
- **JSONL (`--json`).** One line per turn: `{run_id, model, prompt, total_ms, tool_total_ms, final_text, tool_calls, usage}`.
- **HTML (`--html out.html`).** Self-contained file rendered from the SQLite rows of the matching `run_id`. Per-prompt columns of model outputs, expandable tool-call trace, per-model timing bars. One inline `<style>`, no external assets.

## Replay semantics

Replay reads from the production postgres logger, not from SQLite.

1. Connect via `PTV_CHAT_PG_URL`. Unset → friendly error message and exit 2.
2. `SELECT type, payload FROM events WHERE conversation_id = $1 ORDER BY turn_seq, event_seq`.
3. Reconstruct the chronological message list: `user_msg` events → user turns; `assistant_msg` events → recorded assistant turns (the "golden" reference, displayed alongside the new run for visual diff).
4. `--from-turn N` truncates history. Default replays from turn 0.
5. Feed reconstructed history to `runTurn()` with the chosen model. Persist the result as one row in SQLite with `cmd='replay'`; record the source `conversation_id` in `notes`.

Side-by-side output shows the original assistant message above the new one. A naive word-set Jaccard score is printed; semantic comparison is out of scope.

## OpenRouter loop (`src/llm/openrouter.ts`)

POST `https://${OPENROUTER_BASE_URL}/chat/completions` with `stream: true`. Parse SSE chunks, accumulate `delta.tool_calls` until the stream finishes for that round, dispatch tools in parallel via `Promise.all`, append tool results as `role:'tool'` messages, post again, repeat until the model finishes a round without tool calls.

```
runTurn(req, opts):
  messages = [system, ...history, user(req)]
  yield turn_start
  loop:
    stream = await POST(messages, tools, model, stream=true)
    for chunk in stream:
      if delta.content: yield text_delta
      accumulate delta.tool_calls
      track gap-since-last-chunk → ptv-chat:sdk_gap log
    if no tool_calls in this round:
      break
    messages.push(assistant with tool_calls)
    for tc in parallel:
      yield tool_call(name, args)
      result = await handler(args)              # timed
      messages.push(tool result)
      yield tool_result(...)
  emit ptv-chat:turn_summary log
  yield turn_end
```

Headers:
- `Authorization: Bearer $OPENROUTER_API_KEY`
- `HTTP-Referer: https://bike-rail.realmindsai.com.au` (optional, helps OpenRouter analytics)
- `X-Title: ptv-chat` (optional, same)

## Tool bridge (`src/llm/tool_bridge.ts`)

Existing tool factories return `{name, description, schema, handler}`. Conversion to OpenAI's function-calling shape is identity:

```ts
export function toOpenAITool(t) {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema },
  };
}
```

The dispatch table — `Record<toolName, handler>` — is built from the same factories the HTTP server already uses. No new tool definitions.

## Configuration

| Var | Purpose | Where |
|-----|---------|-------|
| `OPENROUTER_API_KEY` | auth | `.env.sops` (added), prod compose env |
| `OPENROUTER_BASE_URL` | optional override | default `https://openrouter.ai/api/v1` |
| `MODEL` | default model slug | `anthropic/claude-haiku-4.5` post-cutover |
| `PTV_CHAT_PG_URL` | replay source | already exists |

Pre-cutover `MODEL` was `claude-haiku-4-5-20251001` (Anthropic-direct ID). Post-cutover is the OpenRouter slug `anthropic/claude-haiku-4.5`. Exact slug is verified against `openrouter.ai/models` at implementation time.

The `claude-creds` docker volume (Claude Agent SDK OAuth state) becomes unused after Phase 2 and is removed from the compose snippet.

## Migration plan

**Phase 1 — Harness + new agent loop (one PR).**

1. Add deps: `better-sqlite3`, `marked-terminal`. Drop nothing yet.
2. `src/llm/openrouter.ts` — streaming client + tool-use cycle.
3. `src/llm/tool_bridge.ts` — schema converter + handler dispatcher.
4. `src/chat/agent.ts` — replace internals to use the OpenRouter loop. Keep `runTurn → AsyncGenerator<SseEvent>` byte-for-byte identical so the HTTP server is untouched.
5. `src/commands/chat-eval.ts` — three subcommands; SQLite writer; renderers.
6. Tests (see Testing section).
7. Validate against an in-memory mock OpenRouter stream + one real integration test.

**Phase 2 — Prod cutover (one PR, after Phase 1 merged and dogfooded).**

1. Add `OPENROUTER_API_KEY` to `.env.sops`.
2. Change compose `MODEL` to OpenRouter slug; redeploy.
3. Smoke-test prod via curl + web-chat.
4. Run a small eval suite head-to-head against pre-cutover Haiku output.
5. Remove `@anthropic-ai/claude-agent-sdk` from `package.json`; remove `claude-creds` volume.

**Cutover criteria:** harness suite shows no keyword-presence regression on the golden set; `/api/chat` wall time on the 5 golden prompts is within ±20% of pre-cutover Haiku 4.5 measured the same day. Keyword presence is a deliberately weak proxy for "quality" — a stronger judge is a follow-up.

## Testing

- **Unit:** OpenRouter streaming parser (chunk fixtures), tool bridge schema conversion, SQLite writer (`:memory:`), HTML renderer (snapshot), replay reconstruction from a fixture events array.
- **Integration:** one real OpenRouter call against `google/gemini-2.5-flash` for cheap iteration. Tool round-trip via `geocode`. `it.skipIf(!process.env.OPENROUTER_API_KEY)`.
- **E2e:** `ptv chat-eval run --prompt "..." --models a,b` exits 0 and writes 2 rows. `suite` runs the fixture YAML end-to-end. `replay` reconstructs from a fixture events JSON.
- **Golden set:** `tests/fixtures/eval-suite.yaml` with 5 representative Melbourne prompts. Pre-cutover, snapshot Haiku-4.5 keyword presence. Phase 2 must match.

## Risks

- **Tool-use compatibility varies by model.** Some OpenRouter-routed models do not support function calling, or implement it inconsistently. Harness fans out across models the user picks; if a model returns no tool calls when the task clearly needs them, the run is flagged but not retried.
- **Streaming format quirks.** OpenRouter normalizes most providers to OpenAI's chunk shape, but Anthropic-routed responses occasionally batch deltas differently than direct Anthropic. Streaming-fidelity is part of the smoke test in Phase 2.
- **Claude Agent SDK's automatic context features (cache, compaction).** We are replacing them with plain stateless calls. If conversations grow long we may need explicit prompt-cache headers; deferred to a follow-up.
- **Tool-call argument JSON drift.** Some models emit malformed JSON in `tool_calls.function.arguments`. The dispatcher must JSON-parse defensively and emit an `error` SseEvent if parse fails, without aborting the turn.
