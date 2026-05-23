# Chat eval harness + OpenRouter migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a CLI eval harness (regression suites, multi-model fan-out, replay from postgres) on top of a new OpenRouter-driven agent loop that replaces the `@anthropic-ai/claude-agent-sdk` driver inside `src/chat/agent.ts`. One engine drives both the HTTP `/api/chat` route and the new `ptv chat-eval` subcommand.

**Architecture:** Preserve the existing `runTurn(req, opts) → AsyncGenerator<SseEvent>` contract so the Fastify route, web-chat frontend, and conversation logger are untouched. Implement the new loop in `src/llm/openrouter.ts`; convert Zod-based tool factories to OpenAI function-calling schema via `src/llm/tool_bridge.ts`. The CLI lives in `src/commands/chat-eval.ts` and persists each turn into a local SQLite file (`./eval.db`). Migration is two-phase: Phase 1 (Tasks 1–17) ships the harness and the agent rewrite under the same contract; Phase 2 (Tasks 18–22) flips prod `MODEL` env to an OpenRouter slug and removes the SDK.

**Tech Stack:** TypeScript, Node 20, commander, vitest, fastify (existing). New deps: `better-sqlite3`, `marked-terminal`, `yaml`, `zod-to-json-schema`. Removed (Phase 2): `@anthropic-ai/claude-agent-sdk`.

**Spec:** `docs/superpowers/specs/2026-05-23-chat-eval-openrouter-design.md`

---

## File map

**New (Phase 1):**
- `src/llm/types.ts` — shared LLM types (OpenAIMessage, OpenAITool, ToolFactory)
- `src/llm/tool_bridge.ts` — Zod → JSON-Schema conversion + handler dispatcher
- `src/llm/openrouter.ts` — streaming HTTP client + agent loop, emits `SseEvent`
- `src/chat-eval/db.ts` — SQLite schema + writer
- `src/chat-eval/suite.ts` — YAML suite loader
- `src/chat-eval/replay.ts` — postgres → history reconstruction
- `src/chat-eval/runner.ts` — orchestrator that drives `runTurn` and persists results
- `src/chat-eval/renderers/terminal.ts`
- `src/chat-eval/renderers/jsonl.ts`
- `src/chat-eval/renderers/html.ts`
- `src/commands/chat-eval.ts` — commander subcommand
- `tests/fixtures/eval-suite.yaml` — golden 5-prompt suite
- `tests/unit/llm/openrouter.test.ts`
- `tests/unit/llm/tool_bridge.test.ts`
- `tests/unit/chat-eval/db.test.ts`
- `tests/unit/chat-eval/suite.test.ts`
- `tests/unit/chat-eval/replay.test.ts`
- `tests/unit/chat-eval/renderers/terminal.test.ts`
- `tests/unit/chat-eval/renderers/jsonl.test.ts`
- `tests/unit/chat-eval/renderers/html.test.ts`
- `tests/integration/chat-eval-openrouter.test.ts`
- `tests/e2e/chat-eval-cli.test.ts`

**Modified (Phase 1):**
- `package.json` — new deps
- `.gitignore` — `eval.db` and `*.eval.db`
- `src/chat/agent.ts` — replace SDK internals with OpenRouter loop; preserve contract
- `src/index.ts` — register `chatEvalCommand()`
- `tests/unit/chat/agent.test.ts` — adapt to the new loop

**Modified (Phase 2):**
- `.env.sops` — encrypted addition of `OPENROUTER_API_KEY`
- `docker-compose.chat.snippet.yml` — `MODEL` slug, remove `claude-creds`
- `/tank/code/ptv/docker-compose.yml` on totoro — same
- `package.json` — remove `@anthropic-ai/claude-agent-sdk`

---

# Phase 1 — Harness + new agent loop

## Task 1: Add new dependencies and gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add runtime + dev dependencies**

```bash
npm install better-sqlite3 marked-terminal yaml zod-to-json-schema
npm install -D @types/better-sqlite3
```

- [ ] **Step 2: Add eval.db to gitignore**

Append to `.gitignore`:

```
eval.db
*.eval.db
```

- [ ] **Step 3: Verify install succeeded**

Run: `npm ls better-sqlite3 marked-terminal yaml zod-to-json-schema`
Expected: each printed at a non-empty version.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "build(chat-eval): add better-sqlite3, marked-terminal, yaml, zod-to-json-schema"
```

---

## Task 2: LLM types module

**Files:**
- Create: `src/llm/types.ts`

No test — this is a pure declarations file imported by later tasks.

- [ ] **Step 1: Write the types file**

```typescript
import type { ZodTypeAny } from 'zod';

/** Existing tool factory shape used by src/chat/tools/*. */
export interface ToolFactory<TArgs = unknown, TOut = unknown> {
  name: string;
  description: string;
  schema: ZodTypeAny;
  handler: (args: TArgs) => Promise<TOut>;
}

/** OpenAI-compatible chat-completions message. */
export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

/** Options accepted by openrouter.runAgentLoop. */
export interface AgentLoopOptions {
  model: string;
  systemPrompt: string;
  history: OpenAIMessage[];
  tools: ToolFactory[];
  apiKey: string;
  baseUrl?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
  /** Optional clock override for tests. */
  nowMs?: () => number;
}

export interface UsageBlock {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/llm/types.ts
git commit -m "feat(llm): shared types for OpenRouter agent loop"
```

---

## Task 3: Tool bridge — Zod schemas → OpenAI function-calling shape

**Files:**
- Create: `src/llm/tool_bridge.ts`
- Test: `tests/unit/llm/tool_bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/llm/tool_bridge.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toOpenAITool, parseArgs, dispatch } from '../../../src/llm/tool_bridge';
import type { ToolFactory } from '../../../src/llm/types';

describe('toOpenAITool', () => {
  it('converts a zod-schema tool factory to OpenAI function-calling shape', () => {
    const t: ToolFactory = {
      name: 'geocode',
      description: 'Resolve a place name.',
      schema: z.object({ query: z.string().min(1) }),
      handler: async () => ({ ok: true }),
    };
    const out = toOpenAITool(t);
    expect(out.type).toBe('function');
    expect(out.function.name).toBe('geocode');
    expect(out.function.description).toBe('Resolve a place name.');
    expect(out.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
    });
  });
});

describe('parseArgs', () => {
  it('parses valid JSON', () => {
    expect(parseArgs('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('returns ok=false on malformed JSON', () => {
    const r = parseArgs('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/i);
  });
});

describe('dispatch', () => {
  it('calls the registered handler with parsed args', async () => {
    const t: ToolFactory<{ a: number }, { doubled: number }> = {
      name: 'doubler',
      description: 'x2',
      schema: z.object({ a: z.number() }),
      handler: async (args) => ({ doubled: args.a * 2 }),
    };
    const r = await dispatch([t], 'doubler', { a: 21 });
    expect(r).toEqual({ ok: true, result: { doubled: 42 } });
  });

  it('returns ok=false when no tool matches', async () => {
    const r = await dispatch([], 'missing', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown/i);
  });

  it('captures handler errors as ok=false', async () => {
    const t: ToolFactory = {
      name: 'broken', description: '', schema: z.object({}),
      handler: async () => { throw new Error('boom'); },
    };
    const r = await dispatch([t], 'broken', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/llm/tool_bridge.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the bridge**

```typescript
// src/llm/tool_bridge.ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { OpenAITool, ToolFactory } from './types';

export function toOpenAITool(t: ToolFactory): OpenAITool {
  const json = zodToJsonSchema(t.schema, { target: 'openApi3', $refStrategy: 'none' }) as any;
  // zodToJsonSchema wraps under top-level keys we don't need; strip the $schema field.
  delete json.$schema;
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: json },
  };
}

export type ParseResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseArgs(raw: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` };
  }
}

export type DispatchResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export async function dispatch(
  tools: ToolFactory[],
  name: string,
  args: unknown,
): Promise<DispatchResult> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, error: `unknown tool: ${name}` };
  try {
    const result = await t.handler(args as any);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/llm/tool_bridge.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/tool_bridge.ts tests/unit/llm/tool_bridge.test.ts
git commit -m "feat(llm): tool bridge — Zod → OpenAI function-calling + dispatcher"
```

---

## Task 4: OpenRouter SSE chunk parser

**Files:**
- Create: `src/llm/openrouter.ts` (initial skeleton)
- Test: `tests/unit/llm/openrouter.test.ts`

The parser turns a stream of SSE `data:` lines into a structured chunk sequence. Isolated so it can be unit-tested without HTTP.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/llm/openrouter.test.ts
import { describe, it, expect } from 'vitest';
import { parseSseChunks } from '../../../src/llm/openrouter';

function asReadable(body: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) { c.enqueue(enc.encode(body)); c.close(); },
  });
}

describe('parseSseChunks', () => {
  it('extracts JSON chunks and stops at [DONE]', async () => {
    const stream = asReadable(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      'data: [DONE]\n\n',
    );
    const out: any[] = [];
    for await (const c of parseSseChunks(stream)) out.push(c);
    expect(out).toHaveLength(2);
    expect(out[0].choices[0].delta.content).toBe('Hello');
    expect(out[1].choices[0].delta.content).toBe(' world');
  });

  it('handles split-mid-event payloads across reads', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"He'));
        c.enqueue(enc.encode('llo"}}]}\n\ndata: [DONE]\n\n'));
        c.close();
      },
    });
    const out: any[] = [];
    for await (const c of parseSseChunks(stream)) out.push(c);
    expect(out[0].choices[0].delta.content).toBe('Hello');
  });

  it('skips comment lines and empty data lines', async () => {
    const stream = asReadable(
      ': openrouter-comment\n\n' +
      'data: \n\n' +
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
      'data: [DONE]\n\n',
    );
    const out: any[] = [];
    for await (const c of parseSseChunks(stream)) out.push(c);
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/unit/llm/openrouter.test.ts`
Expected: FAIL (module / export missing).

- [ ] **Step 3: Implement the parser**

```typescript
// src/llm/openrouter.ts
export async function* parseSseChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<any> {
  const reader = body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // SSE events are separated by blank lines (\n\n).
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      const payload = dataLines.join('\n').trim();
      if (!payload) continue;
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload);
      } catch {
        // Ignore malformed chunks; OpenRouter occasionally interleaves keepalives.
      }
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/llm/openrouter.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/openrouter.ts tests/unit/llm/openrouter.test.ts
git commit -m "feat(llm): SSE chunk parser for OpenRouter streaming responses"
```

---

## Task 5: OpenRouter agent loop

**Files:**
- Modify: `src/llm/openrouter.ts` (add `runAgentLoop`)
- Modify: `tests/unit/llm/openrouter.test.ts` (extend)

The loop posts to `/chat/completions` with `stream: true`, accumulates `delta.content` (yielding `text_delta` events as it arrives) and `delta.tool_calls` (yielding `tool_call` events when a call resolves), dispatches tools in parallel, appends tool results to the message list, and repeats until the model finishes a round with no tool calls.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/llm/openrouter.test.ts`:

```typescript
import { runAgentLoop } from '../../../src/llm/openrouter';
import type { SseEvent } from '../../../src/chat/types';
import type { AgentLoopOptions } from '../../../src/llm/types';
import { z } from 'zod';

function streamFrom(chunks: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}

function fakeFetch(responses: ReadableStream<Uint8Array>[]): typeof fetch {
  let i = 0;
  return (async () => {
    const body = responses[i++];
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
}

describe('runAgentLoop', () => {
  it('emits text_delta + turn boundaries for a simple no-tool response', async () => {
    const opts: AgentLoopOptions = {
      model: 'test/model',
      systemPrompt: 'sys',
      history: [],
      tools: [],
      apiKey: 'k',
      fetchImpl: fakeFetch([
        streamFrom([
          { choices: [{ delta: { content: 'Hi ' }, finish_reason: null }] },
          { choices: [{ delta: { content: 'there.' }, finish_reason: 'stop' }] },
        ]),
      ]),
    };
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop('greet me', opts)) events.push(ev);
    expect(events[0]).toEqual({ type: 'turn_start' });
    expect(events.find((e) => e.type === 'text_delta' && e.delta === 'Hi ')).toBeTruthy();
    expect(events.find((e) => e.type === 'text_delta' && e.delta === 'there.')).toBeTruthy();
    expect(events[events.length - 1]).toEqual({ type: 'turn_end' });
  });

  it('round-trips a single tool call', async () => {
    const tool = {
      name: 'echo', description: 'echo',
      schema: z.object({ msg: z.string() }),
      handler: async (a: { msg: string }) => ({ echoed: a.msg }),
    };
    const opts: AgentLoopOptions = {
      model: 'test/model', systemPrompt: 's', history: [], tools: [tool], apiKey: 'k',
      fetchImpl: fakeFetch([
        // Round 1: assistant emits a tool call
        streamFrom([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'echo', arguments: '' } }] }, finish_reason: null }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"msg":' } }] }, finish_reason: null }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] }, finish_reason: 'tool_calls' }] },
        ]),
        // Round 2: assistant gives final text
        streamFrom([
          { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
        ]),
      ]),
    };
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop('echo hi', opts)) events.push(ev);
    const call = events.find((e) => e.type === 'tool_call');
    const result = events.find((e) => e.type === 'tool_result');
    expect(call).toMatchObject({ type: 'tool_call', name: 'echo', args: { msg: 'hi' } });
    expect(result).toMatchObject({ type: 'tool_result', ok: true });
    expect(events.find((e) => e.type === 'text_delta' && e.delta === 'Done.')).toBeTruthy();
  });

  it('emits ok=false tool_result on malformed arguments JSON', async () => {
    const tool = {
      name: 'echo', description: 'echo',
      schema: z.object({ msg: z.string() }),
      handler: async () => ({}),
    };
    const opts: AgentLoopOptions = {
      model: 'm', systemPrompt: '', history: [], tools: [tool], apiKey: 'k',
      fetchImpl: fakeFetch([
        streamFrom([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'echo', arguments: '{bad' } }] }, finish_reason: 'tool_calls' }] },
        ]),
        streamFrom([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
      ]),
    };
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop('x', opts)) events.push(ev);
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ type: 'tool_result', ok: false });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/llm/openrouter.test.ts`
Expected: FAIL (export `runAgentLoop` not found).

- [ ] **Step 3: Implement `runAgentLoop`**

Append to `src/llm/openrouter.ts`:

```typescript
import type { SseEvent } from '../chat/types';
import type { AgentLoopOptions, OpenAIMessage, OpenAIToolCall } from './types';
import { toOpenAITool, parseArgs, dispatch } from './tool_bridge';

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

interface PartialToolCall {
  index: number;
  id?: string;
  name?: string;
  arguments: string; // accumulated raw JSON
}

export async function* runAgentLoop(
  userPrompt: string,
  opts: AgentLoopOptions,
): AsyncGenerator<SseEvent> {
  yield { type: 'turn_start' };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowMs ?? (() => Date.now());
  const url = `${opts.baseUrl ?? DEFAULT_BASE}/chat/completions`;
  const oaTools = opts.tools.map(toOpenAITool);

  const messages: OpenAIMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.history,
    { role: 'user', content: userPrompt },
  ];

  const turnStartMs = now();
  const toolDurationsMs: Record<string, number[]> = {};
  let sdkMsgCount = 0;
  let lastChunkMs = turnStartMs;

  while (true) {
    const body = {
      model: opts.model,
      stream: true,
      messages,
      ...(oaTools.length ? { tools: oaTools, tool_choice: 'auto' } : {}),
    };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${opts.apiKey}`,
        'http-referer': 'https://bike-rail.realmindsai.com.au',
        'x-title': 'ptv-chat',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      yield { type: 'error', message: `openrouter http ${res.status}: ${detail.slice(0, 200)}` };
      break;
    }

    let assistantText = '';
    const partials = new Map<number, PartialToolCall>();
    let finishReason: string | null = null;

    for await (const chunk of parseSseChunks(res.body)) {
      sdkMsgCount++;
      const nowMs = now();
      const gap = nowMs - lastChunkMs;
      lastChunkMs = nowMs;
      if (gap >= 250) {
        console.log(JSON.stringify({
          level: 30, msg: 'ptv-chat:sdk_gap', sdkType: 'chunk', gapMs: gap,
        }));
      }
      const ch = chunk.choices?.[0];
      if (!ch) continue;
      const delta = ch.delta ?? {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        assistantText += delta.content;
        yield { type: 'text_delta', delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index;
          const cur = partials.get(i) ?? { index: i, arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (typeof tc.function?.arguments === 'string') cur.arguments += tc.function.arguments;
          partials.set(i, cur);
        }
      }
      if (ch.finish_reason) finishReason = ch.finish_reason;
    }

    if (finishReason !== 'tool_calls' || partials.size === 0) {
      // No tool calls in this round → we are done.
      break;
    }

    // Build the assistant message that triggered the tool calls.
    const calls: OpenAIToolCall[] = [];
    for (const p of [...partials.values()].sort((a, b) => a.index - b.index)) {
      if (!p.id || !p.name) continue;
      calls.push({
        id: p.id,
        type: 'function',
        function: { name: p.name, arguments: p.arguments },
      });
    }
    messages.push({ role: 'assistant', content: assistantText || null, tool_calls: calls });

    // Dispatch in parallel, emit tool_call + tool_result events in order of resolution.
    const dispatched = await Promise.all(calls.map(async (c) => {
      const argParse = parseArgs(c.function.arguments);
      const args = argParse.ok ? argParse.value : {};
      const t0 = now();
      let outcome;
      if (!argParse.ok) {
        outcome = { ok: false as const, error: argParse.error };
      } else {
        outcome = await dispatch(opts.tools, c.function.name, args);
      }
      const durMs = now() - t0;
      (toolDurationsMs[c.function.name] ??= []).push(durMs);
      console.log(JSON.stringify({
        level: 30, msg: 'ptv-chat:tool',
        tool: c.function.name, durationMs: durMs, ok: outcome.ok,
        ...(outcome.ok ? {} : { err: outcome.error }),
      }));
      return { call: c, args, outcome };
    }));

    for (const d of dispatched) {
      yield { type: 'tool_call', id: d.call.id, name: d.call.function.name, args: d.args };
      const payload = d.outcome.ok ? d.outcome.result : { error: d.outcome.error };
      const summary = JSON.stringify(payload).slice(0, 1000);
      yield { type: 'tool_result', id: d.call.id, ok: d.outcome.ok, summary };
      messages.push({
        role: 'tool',
        tool_call_id: d.call.id,
        content: JSON.stringify(payload),
      });
    }
    // loop continues — next POST to OpenRouter with appended messages.
  }

  const totalMs = now() - turnStartMs;
  const toolSummary: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
  let toolTotal = 0;
  for (const [name, ds] of Object.entries(toolDurationsMs)) {
    const sum = ds.reduce((a, b) => a + b, 0);
    toolTotal += sum;
    toolSummary[name] = { count: ds.length, totalMs: sum, maxMs: Math.max(...ds) };
  }
  console.log(JSON.stringify({
    level: 30, msg: 'ptv-chat:turn_summary',
    totalMs, sdkMsgCount, toolTotalMs: toolTotal, nonToolMs: totalMs - toolTotal,
    tools: toolSummary,
  }));
  yield { type: 'turn_end' };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/llm/openrouter.test.ts`
Expected: all tests in the file pass (parser tests + 3 loop tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/openrouter.ts tests/unit/llm/openrouter.test.ts
git commit -m "feat(llm): OpenRouter streaming agent loop with parallel tool dispatch"
```

---

## Task 6: Rewrite src/chat/agent.ts to use the OpenRouter loop

**Files:**
- Modify: `src/chat/agent.ts`
- Modify: `tests/unit/chat/agent.test.ts`

The public contract (`runTurn(req, opts) → AsyncGenerator<SseEvent>`) stays. The internals change from `@anthropic-ai/claude-agent-sdk`'s `query()` to `runAgentLoop()`. Keep `mapSdkMessage` exported for now — old unit tests reference it; we will retire it in Task 7 if it is dead code.

- [ ] **Step 1: Read the existing tests to know what shape to preserve**

Run: `cat tests/unit/chat/agent.test.ts`
Expected: see which exports + behaviors the tests assert.

- [ ] **Step 2: Update the failing tests first**

Replace the contents of `tests/unit/chat/agent.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runTurn } from '../../../src/chat/agent';
import type { SseEvent } from '../../../src/chat/types';

function streamFromChunks(chunks: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}

function fakeFetch(streams: ReadableStream<Uint8Array>[]): typeof fetch {
  let i = 0;
  return (async () => new Response(streams[i++], { status: 200 })) as any;
}

const echoTool = {
  name: 'echo',
  description: 'echo',
  schema: z.object({ msg: z.string() }),
  handler: async (a: { msg: string }) => ({ echoed: a.msg }),
};

describe('runTurn (OpenRouter)', () => {
  it('streams turn_start → text_delta → turn_end for a no-tool response', async () => {
    process.env.OPENROUTER_API_KEY = 'test';
    const events: SseEvent[] = [];
    for await (const ev of runTurn(
      { messages: [{ role: 'user', content: 'hi' }] },
      {
        tools: {
          geocode: echoTool, plan: echoTool, bike_route: echoTool,
          search_stops: echoTool, nearby_stops: echoTool, schedule: echoTool,
        },
        model: 'test/model',
        fetchImpl: fakeFetch([
          streamFromChunks([
            { choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }] },
          ]),
        ]),
      } as any,
    )) events.push(ev);

    expect(events[0]).toEqual({ type: 'turn_start' });
    expect(events.find((e) => e.type === 'text_delta' && e.delta === 'hello')).toBeTruthy();
    expect(events[events.length - 1]).toEqual({ type: 'turn_end' });
  });

  it('errors cleanly when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const events: SseEvent[] = [];
    for await (const ev of runTurn(
      { messages: [{ role: 'user', content: 'hi' }] },
      { tools: {} as any, model: 'test/model' } as any,
    )) events.push(ev);
    expect(events.find((e) => e.type === 'error')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `npx vitest run tests/unit/chat/agent.test.ts`
Expected: FAIL (old agent calls `@anthropic-ai/claude-agent-sdk`, no `fetchImpl` option).

- [ ] **Step 4: Replace src/chat/agent.ts**

```typescript
// src/chat/agent.ts
import type { ChatRequest, SseEvent } from './types';
import type { ToolFactory, OpenAIMessage } from '../llm/types';
import { runAgentLoop } from '../llm/openrouter';

export type ToolBundle = {
  geocode: ToolFactory;
  plan: ToolFactory;
  bike_route: ToolFactory;
  search_stops: ToolFactory;
  nearby_stops: ToolFactory;
  schedule: ToolFactory;
};

export type RunTurnOpts = {
  tools: ToolBundle;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

const TOOL_NAMES = ['geocode', 'plan', 'bike_route', 'search_stops', 'nearby_stops', 'schedule'] as const;

function melbourneCalendarTable(now: Date): string {
  const dayFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'Australia/Melbourne' });
  const dateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Australia/Melbourne' });
  const rows: string[] = [];
  for (let i = 0; i < 14; i++) {
    const probe = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const iso = dateFmt.format(probe);
    const weekday = dayFmt.format(probe);
    const tag = i === 0 ? ' ← TODAY' : i === 1 ? ' ← tomorrow' : '';
    rows.push(`  ${iso} (${weekday})${tag}`);
  }
  return [
    'Calendar — Melbourne local dates for the next 14 days:',
    ...rows,
    'When the user says e.g. "next Sunday", pick the FIRST row whose weekday matches',
    'AND whose date is at least 1 day after today. Do not improvise.',
  ].join('\n');
}

function systemPrompt(origin?: { lat: number; lon: number }, today = new Date()): string {
  return [
    'You are the assistant for ptv-chat — a Melbourne bike + train trip planner.',
    '',
    'Tools available (your complete toolset; there are no others):',
    '- geocode: place name -> {lat, lon} via Photon (fallback Nominatim), Victoria-bounded.',
    '- plan: bike+train (or bike-only) trip between two coords.',
    '- bike_route: pure bicycle routing between two coords.',
    '- search_stops: find PTV stops by name.',
    '- nearby_stops: find PTV stops near a coord.',
    '- schedule: list real upcoming train departures from a PTV stop.',
    '',
    'Workflow:',
    '1. Geocode any place names that are not already coordinates.',
    '2. Call plan (or bike_route for pure-bike asks).',
    '3. For timetable / arrive-by asks, ALSO call schedule.',
    '4. Reply concisely. Quote elevation numbers and train depart/arrive times exactly.',
    '',
    melbourneCalendarTable(today),
    `Origin hint: ${origin ? `${origin.lat},${origin.lon} (Melbourne).` : 'unknown.'}`,
  ].join('\n');
}

export async function* runTurn(
  req: ChatRequest,
  opts: RunTurnOpts,
): AsyncGenerator<SseEvent> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    yield { type: 'turn_start' };
    yield { type: 'error', message: 'OPENROUTER_API_KEY is not set' };
    yield { type: 'turn_end' };
    return;
  }

  // Convert prior turns to OpenAI message list; last user message becomes the prompt.
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const history: OpenAIMessage[] = req.messages
    .filter((m) => m !== lastUser)
    .map((m) => ({ role: m.role, content: m.content }) as OpenAIMessage);

  const toolList: ToolFactory[] = TOOL_NAMES.map((n) => (opts.tools as any)[n]);

  yield* runAgentLoop(lastUser?.content ?? '', {
    model: req.model ?? opts.model ?? process.env.MODEL ?? 'anthropic/claude-haiku-4.5',
    systemPrompt: systemPrompt(req.origin),
    history,
    tools: toolList,
    apiKey,
    baseUrl: opts.baseUrl ?? process.env.OPENROUTER_BASE_URL,
    fetchImpl: opts.fetchImpl,
  });
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/chat/agent.test.ts`
Expected: 2/2 pass.

Run the full unit suite to surface fallout: `npx vitest run tests/unit`.
Expected: all green. If any test imports `mapSdkMessage`, delete that import — the function no longer exists. If any test imports `createSdkMcpServer`, remove that test (it was testing the old SDK plumbing, not behavior).

- [ ] **Step 6: Build to surface TypeScript errors**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/chat/agent.ts tests/unit/chat/agent.test.ts
git commit -m "feat(chat): replace Claude Agent SDK with OpenRouter agent loop"
```

---

## Task 7: Verify Fastify route still works against the new loop

**Files:**
- Test: `tests/integration/chat-route-smoke.test.ts` (create or update if it exists)

This is a contract test: the HTTP route should behave identically with the new internals. We mock OpenRouter at the fetch level.

- [ ] **Step 1: Check whether a route smoke test exists**

Run: `find tests -name "chat-route*" -o -name "*chat-serve*" -o -name "*chat-app*"`

If a test exists, read it; otherwise create the file below.

- [ ] **Step 2: Write/extend the test**

```typescript
// tests/integration/chat-route-smoke.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createChatApp } from '../../src/chat/server';
import { z } from 'zod';

function streamFromChunks(chunks: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}

describe('POST /api/chat — smoke', () => {
  beforeAll(() => { process.env.OPENROUTER_API_KEY = 'test'; });

  it('streams an SSE response without tool calls', async () => {
    // Stub global fetch so the route's underlying runTurn hits our fake OpenRouter.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        streamFromChunks([
          { choices: [{ delta: { content: 'hi there' }, finish_reason: 'stop' }] },
        ]),
        { status: 200 },
      ) as any,
    );

    const app = createChatApp({ /* default deps; see Task 6 wiring if signature changed */ } as any);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'content-type': 'application/json' },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('"type":"turn_start"');
    expect(res.payload).toContain('"type":"text_delta"');
    expect(res.payload).toContain('"type":"turn_end"');
    await app.close();
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run, fix wiring as needed**

Run: `npx vitest run tests/integration/chat-route-smoke.test.ts`
Expected: PASS. If `createChatApp` requires deps in current code, supply minimal stubs (chatLogger no-op, ctx with empty origin). Read `src/chat/server.ts` to confirm the exact factory signature; adjust the test wiring (no code change in `server.ts`).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/chat-route-smoke.test.ts
git commit -m "test(chat): smoke test the HTTP route against the OpenRouter loop"
```

---

## Task 8: SQLite eval store

**Files:**
- Create: `src/chat-eval/db.ts`
- Test: `tests/unit/chat-eval/db.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-eval/db.test.ts
import { describe, it, expect } from 'vitest';
import { openEvalDb } from '../../../src/chat-eval/db';

describe('openEvalDb', () => {
  it('creates the schema in a fresh :memory: db', () => {
    const db = openEvalDb(':memory:');
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all().map((r: any) => r.name);
    expect(tables).toEqual(['runs', 'tool_calls', 'turns']);
  });

  it('inserts a run + turn + tool_call and reads them back', () => {
    const db = openEvalDb(':memory:');
    db.insertRun({ run_id: 'r1', started_at: '2026-05-23T00:00:00Z', cmd: 'run' });
    const turnId = db.insertTurn({
      run_id: 'r1', prompt_id: null, prompt: 'p', model: 'anthropic/claude-haiku-4.5',
      origin_lat: null, origin_lon: null, started_at: '2026-05-23T00:00:00Z',
      total_ms: 1000, tool_total_ms: 100, non_tool_ms: 900, sdk_msg_count: 5,
      final_text: 'hi', usage_json: '{}', error: null,
    });
    db.insertToolCall({
      turn_id: turnId, seq: 0, tool: 'geocode',
      args_json: '{}', result_json: '{}', duration_ms: 50, ok: 1,
    });
    const rows = db.raw.prepare('SELECT COUNT(*) AS n FROM tool_calls').get() as any;
    expect(rows.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/db.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the store**

```typescript
// src/chat-eval/db.ts
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  cmd         TEXT NOT NULL,
  suite_name  TEXT,
  notes       TEXT
);
CREATE TABLE IF NOT EXISTS turns (
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
  usage_json    TEXT,
  error         TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id          INTEGER PRIMARY KEY,
  turn_id     INTEGER NOT NULL REFERENCES turns(id),
  seq         INTEGER NOT NULL,
  tool        TEXT NOT NULL,
  args_json   TEXT NOT NULL,
  result_json TEXT,
  duration_ms INTEGER NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_turns_run ON turns(run_id);
CREATE INDEX IF NOT EXISTS idx_tools_turn ON tool_calls(turn_id);
`;

export interface RunRow {
  run_id: string; started_at: string; cmd: string;
  suite_name?: string | null; notes?: string | null;
}
export interface TurnRow {
  run_id: string; prompt_id: string | null; prompt: string; model: string;
  origin_lat: number | null; origin_lon: number | null;
  started_at: string;
  total_ms: number | null; tool_total_ms: number | null;
  non_tool_ms: number | null; sdk_msg_count: number | null;
  final_text: string | null; usage_json: string | null; error: string | null;
}
export interface ToolCallRow {
  turn_id: number; seq: number; tool: string;
  args_json: string; result_json: string | null;
  duration_ms: number; ok: 0 | 1;
}

export interface EvalDb {
  raw: Database.Database;
  insertRun(r: RunRow): void;
  insertTurn(t: TurnRow): number;
  insertToolCall(c: ToolCallRow): void;
  close(): void;
}

export function openEvalDb(path: string): EvalDb {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);

  const insRun = raw.prepare(
    `INSERT INTO runs (run_id, started_at, cmd, suite_name, notes)
     VALUES (@run_id, @started_at, @cmd, @suite_name, @notes)`,
  );
  const insTurn = raw.prepare(
    `INSERT INTO turns
      (run_id, prompt_id, prompt, model, origin_lat, origin_lon, started_at,
       total_ms, tool_total_ms, non_tool_ms, sdk_msg_count, final_text, usage_json, error)
     VALUES
      (@run_id, @prompt_id, @prompt, @model, @origin_lat, @origin_lon, @started_at,
       @total_ms, @tool_total_ms, @non_tool_ms, @sdk_msg_count, @final_text, @usage_json, @error)`,
  );
  const insTool = raw.prepare(
    `INSERT INTO tool_calls
      (turn_id, seq, tool, args_json, result_json, duration_ms, ok)
     VALUES (@turn_id, @seq, @tool, @args_json, @result_json, @duration_ms, @ok)`,
  );

  return {
    raw,
    insertRun: (r) => { insRun.run({ suite_name: null, notes: null, ...r }); },
    insertTurn: (t) => Number(insTurn.run(t).lastInsertRowid),
    insertToolCall: (c) => { insTool.run(c); },
    close: () => raw.close(),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/chat-eval/db.test.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat-eval/db.ts tests/unit/chat-eval/db.test.ts
git commit -m "feat(chat-eval): SQLite eval store with runs/turns/tool_calls schema"
```

---

## Task 9: Suite YAML loader

**Files:**
- Create: `src/chat-eval/suite.ts`
- Test: `tests/unit/chat-eval/suite.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-eval/suite.test.ts
import { describe, it, expect } from 'vitest';
import { parseSuite } from '../../../src/chat-eval/suite';

describe('parseSuite', () => {
  it('parses a well-formed YAML suite', () => {
    const yaml = `
name: melbourne_bike_train_v1
prompts:
  - id: simple_short
    prompt: From Fitzroy to Hawthorn by bike
    origin: {lat: -37.8, lon: 144.97}
  - id: arriveby
    prompt: "Get me to Box Hill by 7am Sunday"
expect_keywords:
  simple_short: [Fitzroy, Hawthorn]
`;
    const suite = parseSuite(yaml);
    expect(suite.name).toBe('melbourne_bike_train_v1');
    expect(suite.prompts).toHaveLength(2);
    expect(suite.prompts[0].id).toBe('simple_short');
    expect(suite.prompts[0].origin).toEqual({ lat: -37.8, lon: 144.97 });
    expect(suite.expect_keywords?.simple_short).toEqual(['Fitzroy', 'Hawthorn']);
  });

  it('rejects a suite with duplicate prompt ids', () => {
    const yaml = `name: x\nprompts:\n  - id: a\n    prompt: p1\n  - id: a\n    prompt: p2\n`;
    expect(() => parseSuite(yaml)).toThrow(/duplicate prompt id/i);
  });

  it('rejects empty prompts list', () => {
    expect(() => parseSuite('name: x\nprompts: []\n')).toThrow(/at least one prompt/i);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/suite.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/chat-eval/suite.ts
import { parse } from 'yaml';
import { z } from 'zod';

const zPrompt = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  origin: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

const zSuite = z.object({
  name: z.string().min(1),
  prompts: z.array(zPrompt).min(1, 'suite needs at least one prompt'),
  expect_keywords: z.record(z.array(z.string())).optional(),
});

export type Suite = z.infer<typeof zSuite>;
export type SuitePrompt = z.infer<typeof zPrompt>;

export function parseSuite(yamlText: string): Suite {
  const raw = parse(yamlText);
  const s = zSuite.parse(raw);
  const seen = new Set<string>();
  for (const p of s.prompts) {
    if (seen.has(p.id)) throw new Error(`duplicate prompt id: ${p.id}`);
    seen.add(p.id);
  }
  return s;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/chat-eval/suite.test.ts`
Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat-eval/suite.ts tests/unit/chat-eval/suite.test.ts
git commit -m "feat(chat-eval): YAML suite loader with prompt-id uniqueness check"
```

---

## Task 10: Replay reconstruction from postgres events

**Files:**
- Create: `src/chat-eval/replay.ts`
- Test: `tests/unit/chat-eval/replay.test.ts`

- [ ] **Step 1: Confirm the postgres event payload shape**

Run: `grep -rn "recordUserMsg\|recordEvent\|type.*assistant_msg\|type.*user_msg" src/chat/log/ | head -20`

Read `src/chat/log/types.ts` and `src/chat/log/logger.ts` to confirm the payload field for each event type. Expect:
- `user_msg` payload `{ content: string }`
- `assistant_msg` payload `{ content: string }`

Adapt the test fixture below if the live shape differs.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/chat-eval/replay.test.ts
import { describe, it, expect } from 'vitest';
import { reconstructFromEvents } from '../../../src/chat-eval/replay';

const events = [
  { turn_seq: 0, event_seq: 0, type: 'user_msg',      payload: { content: 'Hi' } },
  { turn_seq: 0, event_seq: 1, type: 'turn_start',    payload: {} },
  { turn_seq: 0, event_seq: 2, type: 'assistant_msg', payload: { content: 'Hello!' } },
  { turn_seq: 0, event_seq: 3, type: 'turn_end',      payload: {} },
  { turn_seq: 1, event_seq: 0, type: 'user_msg',      payload: { content: 'Plan a route' } },
  { turn_seq: 1, event_seq: 1, type: 'turn_start',    payload: {} },
  { turn_seq: 1, event_seq: 2, type: 'tool_call',     payload: { name: 'plan', args: {} } },
  { turn_seq: 1, event_seq: 3, type: 'tool_result',   payload: { ok: true } },
  { turn_seq: 1, event_seq: 4, type: 'assistant_msg', payload: { content: 'Here you go.' } },
  { turn_seq: 1, event_seq: 5, type: 'turn_end',      payload: {} },
];

describe('reconstructFromEvents', () => {
  it('walks turn_seq order and pairs user/assistant messages', () => {
    const r = reconstructFromEvents(events);
    expect(r.turns).toHaveLength(2);
    expect(r.turns[0]).toMatchObject({ user: 'Hi', goldenAssistant: 'Hello!' });
    expect(r.turns[1]).toMatchObject({ user: 'Plan a route', goldenAssistant: 'Here you go.' });
  });

  it('honors --from-turn truncation', () => {
    const r = reconstructFromEvents(events, { fromTurn: 1 });
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].user).toBe('Plan a route');
  });

  it('builds the historyForReplay containing all but the last user turn', () => {
    const r = reconstructFromEvents(events);
    expect(r.historyForReplay).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);
    expect(r.replayPrompt).toBe('Plan a route');
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/replay.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

```typescript
// src/chat-eval/replay.ts
import { Client } from 'pg';

export interface EventRow {
  turn_seq: number;
  event_seq: number;
  type: string;
  payload: any;
}

export interface ReconstructedTurn {
  turnSeq: number;
  user: string;
  goldenAssistant: string;
}

export interface ReconstructResult {
  turns: ReconstructedTurn[];
  historyForReplay: Array<{ role: 'user' | 'assistant'; content: string }>;
  replayPrompt: string;
}

export function reconstructFromEvents(
  rows: EventRow[],
  opts: { fromTurn?: number } = {},
): ReconstructResult {
  const byTurn = new Map<number, EventRow[]>();
  for (const r of rows) {
    if (!byTurn.has(r.turn_seq)) byTurn.set(r.turn_seq, []);
    byTurn.get(r.turn_seq)!.push(r);
  }
  const turns: ReconstructedTurn[] = [];
  for (const [turnSeq, evs] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    if (opts.fromTurn !== undefined && turnSeq < opts.fromTurn) continue;
    const user = evs.find((e) => e.type === 'user_msg')?.payload?.content ?? '';
    const goldenAssistant = evs.find((e) => e.type === 'assistant_msg')?.payload?.content ?? '';
    turns.push({ turnSeq, user, goldenAssistant });
  }
  const last = turns[turns.length - 1];
  const history = turns
    .slice(0, -1)
    .flatMap((t) => [
      { role: 'user' as const, content: t.user },
      { role: 'assistant' as const, content: t.goldenAssistant },
    ]);
  return { turns, historyForReplay: history, replayPrompt: last?.user ?? '' };
}

export async function fetchConversationEvents(
  pgUrl: string,
  conversationId: string,
): Promise<EventRow[]> {
  const c = new Client({ connectionString: pgUrl });
  await c.connect();
  try {
    const res = await c.query<EventRow>(
      `SELECT turn_seq, event_seq, type, payload
         FROM events
        WHERE conversation_id = $1
        ORDER BY turn_seq, event_seq`,
      [conversationId],
    );
    return res.rows;
  } finally {
    await c.end();
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/chat-eval/replay.test.ts`
Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add src/chat-eval/replay.ts tests/unit/chat-eval/replay.test.ts
git commit -m "feat(chat-eval): reconstruct conversations from postgres events for replay"
```

---

## Task 11: Terminal renderer

**Files:**
- Create: `src/chat-eval/renderers/terminal.ts`
- Test: `tests/unit/chat-eval/renderers/terminal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-eval/renderers/terminal.test.ts
import { describe, it, expect } from 'vitest';
import { renderTerminal } from '../../../../src/chat-eval/renderers/terminal';

describe('renderTerminal', () => {
  it('renders a single turn with summary table', () => {
    const out = renderTerminal({
      prompt: 'From A to B',
      results: [
        {
          model: 'anthropic/claude-haiku-4.5',
          final_text: '**The route**: ride east.',
          total_ms: 9000, tool_total_ms: 200,
          tool_calls: [{ tool: 'geocode', ok: true, duration_ms: 50 }],
          error: null,
        },
      ],
    });
    expect(out).toContain('From A to B');
    expect(out).toContain('claude-haiku-4.5');
    expect(out).toContain('9000');
  });

  it('renders side-by-side for multiple models', () => {
    const out = renderTerminal({
      prompt: 'p',
      results: [
        { model: 'a/x', final_text: 'A says', total_ms: 5000, tool_total_ms: 100, tool_calls: [], error: null },
        { model: 'b/y', final_text: 'B says', total_ms: 6000, tool_total_ms: 50,  tool_calls: [], error: null },
      ],
    });
    expect(out).toContain('a/x');
    expect(out).toContain('b/y');
    expect(out).toContain('A says');
    expect(out).toContain('B says');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/renderers/terminal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/chat-eval/renderers/terminal.ts
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

(marked as any).setOptions({ renderer: new (TerminalRenderer as any)() });

export interface TerminalRenderInput {
  prompt: string;
  results: Array<{
    model: string;
    final_text: string;
    total_ms: number;
    tool_total_ms: number;
    tool_calls: Array<{ tool: string; ok: boolean; duration_ms: number }>;
    error: string | null;
  }>;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function renderTerminal(input: TerminalRenderInput): string {
  const lines: string[] = [];
  lines.push(`\n┌─ prompt ─────────────────────────────────────────`);
  lines.push(`│ ${input.prompt}`);
  lines.push(`└──────────────────────────────────────────────────\n`);

  for (const r of input.results) {
    lines.push(`◆ ${r.model}`);
    if (r.error) {
      lines.push(`  ERROR: ${r.error}`);
    } else {
      lines.push(String(marked(r.final_text)).trimEnd());
    }
    lines.push('');
  }

  // Summary table.
  const rows = input.results.map((r) => [
    r.model,
    `${r.total_ms} ms`,
    `${r.tool_total_ms} ms`,
    String(r.tool_calls.length),
  ]);
  const headers = ['model', 'total', 'tools', 'calls'];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const sep = '  ';
  lines.push(headers.map((h, i) => pad(h, widths[i])).join(sep));
  lines.push(widths.map((w) => '─'.repeat(w)).join(sep));
  for (const row of rows) lines.push(row.map((c, i) => pad(c, widths[i])).join(sep));
  lines.push('');

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/chat-eval/renderers/terminal.test.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat-eval/renderers/terminal.ts tests/unit/chat-eval/renderers/terminal.test.ts
git commit -m "feat(chat-eval): terminal renderer with markdown answer + summary table"
```

---

## Task 12: JSONL renderer

**Files:**
- Create: `src/chat-eval/renderers/jsonl.ts`
- Test: `tests/unit/chat-eval/renderers/jsonl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderJsonl, type JsonlTurn } from '../../../../src/chat-eval/renderers/jsonl';

describe('renderJsonl', () => {
  it('emits one JSON line per turn', () => {
    const turns: JsonlTurn[] = [
      {
        run_id: 'r', model: 'm', prompt: 'p', total_ms: 1, tool_total_ms: 0,
        final_text: 'hi', tool_calls: [], usage: null, error: null,
      },
      {
        run_id: 'r', model: 'n', prompt: 'p', total_ms: 2, tool_total_ms: 1,
        final_text: 'bye', tool_calls: [{ tool: 'geocode', ok: true, duration_ms: 1 }],
        usage: null, error: null,
      },
    ];
    const out = renderJsonl(turns);
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).final_text).toBe('hi');
    expect(JSON.parse(lines[1]).tool_calls[0].tool).toBe('geocode');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/renderers/jsonl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/chat-eval/renderers/jsonl.ts
export interface JsonlTurn {
  run_id: string;
  model: string;
  prompt: string;
  total_ms: number;
  tool_total_ms: number;
  final_text: string;
  tool_calls: Array<{ tool: string; ok: boolean; duration_ms: number }>;
  usage: unknown;
  error: string | null;
}

export function renderJsonl(turns: JsonlTurn[]): string {
  return turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
}
```

- [ ] **Step 4: Run, commit**

Run: `npx vitest run tests/unit/chat-eval/renderers/jsonl.test.ts`
Expected: PASS.

```bash
git add src/chat-eval/renderers/jsonl.ts tests/unit/chat-eval/renderers/jsonl.test.ts
git commit -m "feat(chat-eval): JSONL renderer for scripted analysis"
```

---

## Task 13: HTML renderer

**Files:**
- Create: `src/chat-eval/renderers/html.ts`
- Test: `tests/unit/chat-eval/renderers/html.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../../../src/chat-eval/renderers/html';

describe('renderHtml', () => {
  it('produces a self-contained html document', () => {
    const html = renderHtml({
      run_id: 'r1',
      title: 'eval — melbourne_bike_train_v1',
      prompts: [
        {
          prompt: 'From A to B',
          turns: [
            { model: 'a/x', final_text: '**hi**', total_ms: 1000, tool_total_ms: 50,
              tool_calls: [{ tool: 'geocode', ok: true, duration_ms: 30, args_json: '{}', result_json: '{}' }], error: null },
          ],
        },
      ],
    });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<style>');
    expect(html).toContain('From A to B');
    expect(html).toContain('a/x');
    expect(html).toContain('1000');
    expect(html).toContain('geocode');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/renderers/html.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/chat-eval/renderers/html.ts
import { marked } from 'marked';

export interface HtmlRenderInput {
  run_id: string;
  title: string;
  prompts: Array<{
    prompt: string;
    turns: Array<{
      model: string;
      final_text: string;
      total_ms: number;
      tool_total_ms: number;
      tool_calls: Array<{
        tool: string; ok: boolean; duration_ms: number;
        args_json: string; result_json: string | null;
      }>;
      error: string | null;
    }>;
  }>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const STYLE = `
body { font: 14px/1.5 system-ui, sans-serif; max-width: none; margin: 16px; color: #222; }
h1 { font-size: 18px; }
.prompt { background: #f4f4f4; padding: 8px 12px; border-left: 3px solid #888; margin: 16px 0 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
.card { border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
.model { font-weight: 600; }
.timing { color: #666; font-size: 12px; margin-bottom: 6px; }
.bar { height: 6px; background: #eee; border-radius: 3px; overflow: hidden; margin: 4px 0 8px; }
.bar > span { display: block; height: 100%; background: #4c8; }
details { margin-top: 8px; font-family: ui-monospace, monospace; font-size: 12px; }
pre { background: #fafafa; padding: 6px; overflow-x: auto; }
.err { color: #b00; }
`;

export function renderHtml(input: HtmlRenderInput): string {
  const maxMs = Math.max(
    1,
    ...input.prompts.flatMap((p) => p.turns.map((t) => t.total_ms)),
  );
  const sections = input.prompts.map((p) => {
    const cards = p.turns.map((t) => {
      const widthPct = (t.total_ms / maxMs) * 100;
      const calls = t.tool_calls
        .map((c) => `<details><summary>${esc(c.tool)} — ${c.duration_ms} ms ${c.ok ? '' : '<span class="err">FAIL</span>'}</summary>
<pre>args: ${esc(c.args_json)}\nresult: ${esc(c.result_json ?? '')}</pre></details>`)
        .join('\n');
      const body = t.error
        ? `<div class="err">ERROR: ${esc(t.error)}</div>`
        : marked(t.final_text);
      return `
<div class="card">
  <div class="model">${esc(t.model)}</div>
  <div class="timing">${t.total_ms} ms total · ${t.tool_total_ms} ms tools</div>
  <div class="bar"><span style="width:${widthPct.toFixed(1)}%"></span></div>
  <div class="answer">${body}</div>
  ${calls}
</div>`;
    }).join('');
    return `
<div class="prompt">${esc(p.prompt)}</div>
<div class="grid">${cards}</div>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<style>${STYLE}</style></head><body>
<h1>${esc(input.title)} — run ${esc(input.run_id)}</h1>
${sections}
</body></html>`;
}
```

- [ ] **Step 4: Run, commit**

Run: `npx vitest run tests/unit/chat-eval/renderers/html.test.ts`
Expected: PASS.

```bash
git add src/chat-eval/renderers/html.ts tests/unit/chat-eval/renderers/html.test.ts
git commit -m "feat(chat-eval): self-contained HTML report renderer"
```

---

## Task 14: Eval runner (orchestrator)

**Files:**
- Create: `src/chat-eval/runner.ts`
- Test: `tests/unit/chat-eval/runner.test.ts`

The runner drives `runTurn` for each (prompt, model) combination, captures `SseEvent`s into a structured turn record, and writes everything into the SQLite store.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/chat-eval/runner.test.ts
import { describe, it, expect } from 'vitest';
import { runOne, type RunnerDeps } from '../../../src/chat-eval/runner';
import { openEvalDb } from '../../../src/chat-eval/db';
import type { SseEvent } from '../../../src/chat/types';

function* fakeTurn(events: SseEvent[]): AsyncGenerator<SseEvent> {
  for (const e of events) yield e;
}

async function fakeRunTurn(events: SseEvent[]): Promise<AsyncGenerator<SseEvent>> {
  async function* gen() { for (const e of events) yield e; }
  return gen();
}

describe('runOne', () => {
  it('captures text + tool events into a turn record and persists', async () => {
    const db = openEvalDb(':memory:');
    db.insertRun({ run_id: 'rA', started_at: 'now', cmd: 'run' });

    const events: SseEvent[] = [
      { type: 'turn_start' },
      { type: 'tool_call', id: 'c1', name: 'geocode', args: { query: 'A' } },
      { type: 'tool_result', id: 'c1', ok: true, summary: '{"ok":true}' },
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world.' },
      { type: 'turn_end' },
    ];

    const deps: RunnerDeps = {
      db,
      runTurn: async () => {
        async function* gen() { for (const e of events) yield e; }
        return gen();
      },
      nowMs: () => 1000,
    };

    const out = await runOne(deps, {
      run_id: 'rA',
      prompt_id: null,
      prompt: 'Hi',
      model: 'm/x',
      origin: null,
    });

    expect(out.final_text).toBe('Hello world.');
    expect(out.tool_calls).toHaveLength(1);
    expect(out.tool_calls[0].tool).toBe('geocode');
    expect(out.error).toBeNull();

    const turnRows = db.raw.prepare('SELECT * FROM turns').all();
    expect(turnRows).toHaveLength(1);
    const toolRows = db.raw.prepare('SELECT * FROM tool_calls').all();
    expect(toolRows).toHaveLength(1);
  });

  it('records error event into the turn record', async () => {
    const db = openEvalDb(':memory:');
    db.insertRun({ run_id: 'rB', started_at: 'now', cmd: 'run' });
    const events: SseEvent[] = [
      { type: 'turn_start' },
      { type: 'error', message: 'kaboom' },
      { type: 'turn_end' },
    ];
    const deps: RunnerDeps = {
      db,
      runTurn: async () => { async function* g() { for (const e of events) yield e; } return g(); },
      nowMs: () => 0,
    };
    const out = await runOne(deps, { run_id: 'rB', prompt_id: null, prompt: 'x', model: 'm', origin: null });
    expect(out.error).toBe('kaboom');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/chat-eval/runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/chat-eval/runner.ts
import type { EvalDb } from './db';
import type { SseEvent } from '../chat/types';

export interface RunnerDeps {
  db: EvalDb;
  /** Returns the async generator for a single turn given prompt + model. */
  runTurn: (input: {
    prompt: string;
    model: string;
    origin?: { lat: number; lon: number } | null;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) => Promise<AsyncGenerator<SseEvent>>;
  nowMs?: () => number;
}

export interface RunOneInput {
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  model: string;
  origin: { lat: number; lon: number } | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface CapturedToolCall {
  seq: number;
  tool: string;
  args: unknown;
  ok: boolean;
  duration_ms: number;
  result_summary: string | null;
}

export interface CapturedTurn {
  turn_id: number;
  final_text: string;
  tool_calls: CapturedToolCall[];
  total_ms: number;
  error: string | null;
}

export async function runOne(deps: RunnerDeps, input: RunOneInput): Promise<CapturedTurn> {
  const now = deps.nowMs ?? (() => Date.now());
  const start = now();
  const gen = await deps.runTurn({
    prompt: input.prompt,
    model: input.model,
    origin: input.origin,
    history: input.history,
  });

  let finalText = '';
  let error: string | null = null;
  const calls = new Map<string, { call_t0: number; call: CapturedToolCall }>();
  const ordered: CapturedToolCall[] = [];
  let seq = 0;

  for await (const ev of gen) {
    switch (ev.type) {
      case 'text_delta':
        finalText += ev.delta;
        break;
      case 'tool_call': {
        const c: CapturedToolCall = {
          seq: seq++, tool: ev.name, args: ev.args ?? {},
          ok: false, duration_ms: 0, result_summary: null,
        };
        calls.set(ev.id, { call_t0: now(), call: c });
        ordered.push(c);
        break;
      }
      case 'tool_result': {
        const e = calls.get(ev.id);
        if (e) {
          e.call.ok = ev.ok;
          e.call.result_summary = ev.summary;
          e.call.duration_ms = now() - e.call_t0;
        }
        break;
      }
      case 'error':
        error = ev.message;
        break;
      default:
        break;
    }
  }

  const total_ms = now() - start;
  const tool_total_ms = ordered.reduce((a, b) => a + b.duration_ms, 0);

  const turn_id = deps.db.insertTurn({
    run_id: input.run_id,
    prompt_id: input.prompt_id,
    prompt: input.prompt,
    model: input.model,
    origin_lat: input.origin?.lat ?? null,
    origin_lon: input.origin?.lon ?? null,
    started_at: new Date(start).toISOString(),
    total_ms,
    tool_total_ms,
    non_tool_ms: total_ms - tool_total_ms,
    sdk_msg_count: null,
    final_text: finalText,
    usage_json: null,
    error,
  });

  for (const c of ordered) {
    deps.db.insertToolCall({
      turn_id, seq: c.seq, tool: c.tool,
      args_json: JSON.stringify(c.args),
      result_json: c.result_summary,
      duration_ms: c.duration_ms,
      ok: c.ok ? 1 : 0,
    });
  }

  return { turn_id, final_text: finalText, tool_calls: ordered, total_ms, error };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/chat-eval/runner.test.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat-eval/runner.ts tests/unit/chat-eval/runner.test.ts
git commit -m "feat(chat-eval): runner captures SseEvents into structured turn records + SQLite"
```

---

## Task 15: Commander subcommand `ptv chat-eval`

**Files:**
- Create: `src/commands/chat-eval.ts`
- Modify: `src/index.ts`

This wires the three subcommands (`run`, `suite`, `replay`) to the runner + renderers. It does **not** add a separate test file — the e2e test (Task 17) covers it. Read the existing `src/commands/chat-serve.ts` to match the commander style.

- [ ] **Step 1: Read existing commander idioms**

Run: `cat src/commands/chat-serve.ts`
Note: the factory pattern returns a `Command` built with `new Command('chat-serve')...`.

- [ ] **Step 2: Implement the subcommand**

```typescript
// src/commands/chat-eval.ts
import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openEvalDb, type EvalDb } from '../chat-eval/db';
import { parseSuite } from '../chat-eval/suite';
import { runOne } from '../chat-eval/runner';
import { fetchConversationEvents, reconstructFromEvents } from '../chat-eval/replay';
import { renderTerminal } from '../chat-eval/renderers/terminal';
import { renderJsonl, type JsonlTurn } from '../chat-eval/renderers/jsonl';
import { renderHtml } from '../chat-eval/renderers/html';
import { runTurn } from '../chat/agent';
import type { SseEvent } from '../chat/types';
import { Nominatim } from '../server/nominatim';
import { Photon } from '../server/photon';
import { plan as planOrchestrator } from '../plan/orchestrator';
import { ghRouteBike, ghRouteCustom } from '../plan/external';
import { DAY_RIDE_CUSTOM_MODEL, MAX_PATH_CUSTOM_MODEL } from '../plan/types';
import { ptv } from '../client';
import { makeGeocodeTool } from '../chat/tools/geocode';
import { makePlanTool } from '../chat/tools/plan';
import { makeBikeRouteTool } from '../chat/tools/bike_route';
import { makeSearchStopsTool, makeNearbyStopsTool } from '../chat/tools/stops';
import { makeScheduleTool } from '../chat/tools/schedule';
import type { ChatCtx } from '../chat/types';

function parseCoord(s: string | undefined): { lat: number; lon: number } | null {
  if (!s) return null;
  const [a, b] = s.split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`bad --origin: ${s}`);
  return { lat: a, lon: b };
}

function buildTools(ctx: ChatCtx) {
  const nominatim = new Nominatim(process.env.NOMINATIM_URL ?? 'http://localhost:8094');
  const photon = process.env.PHOTON_URL ? new Photon(process.env.PHOTON_URL) : undefined;
  const bikeFn = async (from: any, to: any, goal: any) => {
    if (goal === 'day-ride') return ghRouteCustom(from, to, DAY_RIDE_CUSTOM_MODEL);
    if (goal === 'max-path') return ghRouteCustom(from, to, MAX_PATH_CUSTOM_MODEL);
    return ghRouteBike(from, to, 'bike');
  };
  return {
    geocode: makeGeocodeTool(ctx, nominatim, photon),
    plan: makePlanTool(ctx, planOrchestrator),
    bike_route: makeBikeRouteTool(ctx, bikeFn),
    search_stops: makeSearchStopsTool(ctx, ptv),
    nearby_stops: makeNearbyStopsTool(ctx, ptv),
    schedule: makeScheduleTool(ctx, ptv),
  };
}

async function* sseGen(prompt: string, model: string, origin: any, history: any) {
  const messages = [
    ...(history ?? []),
    { role: 'user' as const, content: prompt },
  ];
  const tools = buildTools({ emit: () => {}, origin: origin ?? undefined });
  yield* runTurn({ messages, origin: origin ?? undefined, model } as any, { tools, model } as any);
}

interface RunGroupInput {
  db: EvalDb;
  run_id: string;
  prompt_id: string | null;
  prompt: string;
  models: string[];
  origin: { lat: number; lon: number } | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

async function runPromptAcrossModels(input: RunGroupInput) {
  const results = await Promise.all(input.models.map(async (model) => {
    return runOne(
      {
        db: input.db,
        runTurn: async ({ prompt, model: m, origin, history }) => sseGen(prompt, m, origin, history) as unknown as AsyncGenerator<SseEvent>,
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
  }));
  return results;
}

export function chatEvalCommand(): Command {
  const cmd = new Command('chat-eval').description('Run the chat agent in batch / comparison / replay modes');

  cmd
    .command('run <prompt>')
    .description('Run a single prompt against one or more models')
    .option('--models <list>', 'comma-separated OpenRouter slugs (default: $MODEL)', (v) => v.split(',').map((s) => s.trim()))
    .option('--origin <lat,lon>', 'geocode origin hint')
    .option('--html <path>', 'write self-contained html report')
    .option('--json', 'emit JSONL on stdout instead of pretty terminal output')
    .option('--db <path>', 'SQLite eval store path', './eval.db')
    .action(async (prompt: string, opts) => {
      const db = openEvalDb(opts.db);
      const run_id = randomUUID();
      const models = (opts.models as string[] | undefined) ?? [process.env.MODEL ?? 'anthropic/claude-haiku-4.5'];
      db.insertRun({ run_id, started_at: new Date().toISOString(), cmd: 'run' });
      const results = await runPromptAcrossModels({
        db, run_id, prompt_id: null, prompt, models, origin: parseCoord(opts.origin),
      });
      const renderInput = {
        prompt,
        results: results.map((r) => ({
          model: r.tool_calls[0]?.tool ? '' : '',  // overwritten below
          final_text: r.final_text,
          total_ms: r.total_ms,
          tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
          tool_calls: r.tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
          error: r.error,
        })),
      };
      // Align model field with the input model list (results are in same order).
      renderInput.results.forEach((rr, i) => { (rr as any).model = models[i]; });
      if (opts.json) {
        const jsonl: JsonlTurn[] = results.map((r, i) => ({
          run_id, model: models[i], prompt,
          total_ms: r.total_ms,
          tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
          final_text: r.final_text,
          tool_calls: r.tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
          usage: null, error: r.error,
        }));
        process.stdout.write(renderJsonl(jsonl));
      } else {
        process.stdout.write(renderTerminal(renderInput));
      }
      if (opts.html) {
        const htmlInput = {
          run_id,
          title: 'ptv chat-eval — run',
          prompts: [{
            prompt,
            turns: results.map((r, i) => ({
              model: models[i],
              final_text: r.final_text,
              total_ms: r.total_ms,
              tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
              tool_calls: r.tool_calls.map((tc) => ({
                tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms,
                args_json: JSON.stringify(tc.args), result_json: tc.result_summary,
              })),
              error: r.error,
            })),
          }],
        };
        writeFileSync(resolve(opts.html), renderHtml(htmlInput));
      }
      db.close();
    });

  cmd
    .command('suite <file>')
    .description('Run all prompts in a YAML suite against one or more models')
    .option('--models <list>', 'comma-separated OpenRouter slugs', (v) => v.split(',').map((s) => s.trim()))
    .option('--html <path>', 'write self-contained html report')
    .option('--json', 'emit JSONL on stdout')
    .option('--db <path>', 'SQLite eval store path', './eval.db')
    .action(async (file: string, opts) => {
      const yaml = readFileSync(file, 'utf8');
      const suite = parseSuite(yaml);
      const db = openEvalDb(opts.db);
      const run_id = randomUUID();
      const models = (opts.models as string[] | undefined) ?? [process.env.MODEL ?? 'anthropic/claude-haiku-4.5'];
      db.insertRun({ run_id, started_at: new Date().toISOString(), cmd: 'suite', suite_name: suite.name });
      const allTurns: JsonlTurn[] = [];
      const htmlSections: Array<{ prompt: string; turns: any[] }> = [];
      for (const p of suite.prompts) {
        const results = await runPromptAcrossModels({
          db, run_id, prompt_id: p.id, prompt: p.prompt, models, origin: p.origin ?? null,
        });
        for (let i = 0; i < models.length; i++) {
          allTurns.push({
            run_id, model: models[i], prompt: p.prompt,
            total_ms: results[i].total_ms,
            tool_total_ms: results[i].tool_calls.reduce((a, b) => a + b.duration_ms, 0),
            final_text: results[i].final_text,
            tool_calls: results[i].tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
            usage: null, error: results[i].error,
          });
        }
        htmlSections.push({
          prompt: p.prompt,
          turns: results.map((r, i) => ({
            model: models[i], final_text: r.final_text, total_ms: r.total_ms,
            tool_total_ms: r.tool_calls.reduce((a, b) => a + b.duration_ms, 0),
            tool_calls: r.tool_calls.map((tc) => ({
              tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms,
              args_json: JSON.stringify(tc.args), result_json: tc.result_summary,
            })),
            error: r.error,
          })),
        });
        if (opts.json) {
          // Stream per-prompt for long suites; otherwise terminal renderer below is shown at end.
        } else {
          process.stdout.write(renderTerminal({ prompt: p.prompt, results: htmlSections[htmlSections.length - 1].turns }));
        }
      }
      if (opts.json) process.stdout.write(renderJsonl(allTurns));
      if (opts.html) writeFileSync(resolve(opts.html), renderHtml({ run_id, title: `ptv chat-eval — ${suite.name}`, prompts: htmlSections }));
      db.close();
    });

  cmd
    .command('replay <conversation>')
    .description('Replay a logged conversation_id against a different model')
    .requiredOption('--model <slug>', 'OpenRouter model slug')
    .option('--from-turn <n>', 'start replay at this turn_seq', (v) => parseInt(v, 10))
    .option('--db <path>', 'SQLite eval store path', './eval.db')
    .action(async (conversationId: string, opts) => {
      if (!process.env.PTV_CHAT_PG_URL) {
        console.error('PTV_CHAT_PG_URL is not set — replay requires postgres access.');
        process.exit(2);
      }
      const evs = await fetchConversationEvents(process.env.PTV_CHAT_PG_URL, conversationId);
      const r = reconstructFromEvents(evs, { fromTurn: opts.fromTurn });
      if (!r.replayPrompt) { console.error('No user prompt found for replay.'); process.exit(2); }
      const db = openEvalDb(opts.db);
      const run_id = randomUUID();
      db.insertRun({
        run_id, started_at: new Date().toISOString(), cmd: 'replay',
        notes: `source conversation_id=${conversationId}`,
      });
      const results = await runPromptAcrossModels({
        db, run_id, prompt_id: null, prompt: r.replayPrompt, models: [opts.model], origin: null,
        history: r.historyForReplay,
      });
      process.stdout.write(renderTerminal({
        prompt: `[replay ${conversationId.slice(0,8)}…] ${r.replayPrompt}`,
        results: [{
          model: 'GOLDEN', final_text: r.turns[r.turns.length - 1].goldenAssistant,
          total_ms: 0, tool_total_ms: 0, tool_calls: [], error: null,
        }, {
          model: opts.model, final_text: results[0].final_text, total_ms: results[0].total_ms,
          tool_total_ms: results[0].tool_calls.reduce((a, b) => a + b.duration_ms, 0),
          tool_calls: results[0].tool_calls.map((tc) => ({ tool: tc.tool, ok: tc.ok, duration_ms: tc.duration_ms })),
          error: results[0].error,
        }],
      }));
      db.close();
    });

  return cmd;
}
```

- [ ] **Step 3: Register the subcommand in src/index.ts**

Modify `src/index.ts`. Find the line `import { chatServeCommand } from './commands/chat-serve';` and add directly below:

```typescript
import { chatEvalCommand } from './commands/chat-eval';
```

Find the line `program.addCommand(chatServeCommand());` and add directly below:

```typescript
program.addCommand(chatEvalCommand());
```

- [ ] **Step 4: Build to surface compile errors**

Run: `npm run build`
Expected: build succeeds. If imports for `makePlanTool` / `makeScheduleTool` etc. mismatch their real exports, adjust to the names exported in `src/chat/tools/*.ts`.

- [ ] **Step 5: Smoke-run with `--help`**

Run: `node dist/index.js chat-eval --help`
Expected: prints `run`, `suite`, `replay` subcommands.

- [ ] **Step 6: Commit**

```bash
git add src/commands/chat-eval.ts src/index.ts
git commit -m "feat(cli): ptv chat-eval (run | suite | replay) subcommand"
```

---

## Task 16: Golden suite fixture

**Files:**
- Create: `tests/fixtures/eval-suite.yaml`

- [ ] **Step 1: Write the fixture**

```yaml
# tests/fixtures/eval-suite.yaml
name: melbourne_bike_train_golden_v1
prompts:
  - id: short_bike
    prompt: From Fitzroy to Hawthorn by bike
    origin: {lat: -37.80, lon: 144.97}
  - id: arrive_by_sun
    prompt: "Get me to Box Hill by 7am Sunday using bike + train"
    origin: {lat: -37.80, lon: 144.97}
  - id: day_ride
    prompt: "Plan a leisurely day ride from Lilydale to Hurstbridge with maximum cycleways"
  - id: timetable
    prompt: "When is the next train from Flinders Street to Frankston?"
  - id: short_walk
    prompt: "Walking directions from Federation Square to MCG"
expect_keywords:
  short_bike:    [Fitzroy, Hawthorn]
  arrive_by_sun: [Box Hill]
  day_ride:      [Lilydale, Hurstbridge]
  timetable:     [Frankston]
  short_walk:    [MCG]
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/eval-suite.yaml
git commit -m "test(chat-eval): golden suite — 5 representative Melbourne prompts"
```

---

## Task 17: E2E + integration tests

**Files:**
- Create: `tests/e2e/chat-eval-cli.test.ts`
- Create: `tests/integration/chat-eval-openrouter.test.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
// tests/e2e/chat-eval-cli.test.ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const hasKey = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!hasKey)('ptv chat-eval CLI', () => {
  it('run --json emits one JSONL line per model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chateval-'));
    const dbPath = join(dir, 'eval.db');
    const res = spawnSync('node', [
      'dist/index.js', 'chat-eval', 'run',
      'Reply with exactly the word OK',
      '--models', 'google/gemini-2.5-flash',
      '--json',
      '--db', dbPath,
    ], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]);
    expect(row.model).toBe('google/gemini-2.5-flash');
    expect(typeof row.final_text).toBe('string');
    expect(existsSync(dbPath)).toBe(true);
  }, 60_000);

  it('suite produces an HTML file when --html given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chateval-'));
    const dbPath = join(dir, 'eval.db');
    const htmlPath = join(dir, 'report.html');
    const res = spawnSync('node', [
      'dist/index.js', 'chat-eval', 'suite',
      'tests/fixtures/eval-suite.yaml',
      '--models', 'google/gemini-2.5-flash',
      '--json',
      '--db', dbPath,
      '--html', htmlPath,
    ], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(existsSync(htmlPath)).toBe(true);
    const html = readFileSync(htmlPath, 'utf8');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('melbourne_bike_train_golden_v1');
  }, 5 * 60_000);
});
```

- [ ] **Step 2: Write the integration test**

```typescript
// tests/integration/chat-eval-openrouter.test.ts
import { describe, it, expect } from 'vitest';
import { runAgentLoop } from '../../src/llm/openrouter';
import { z } from 'zod';
import type { SseEvent } from '../../src/chat/types';

const hasKey = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!hasKey)('OpenRouter live', () => {
  it('returns text without tools on a trivial prompt', async () => {
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop('Reply with exactly the word OK', {
      model: 'google/gemini-2.5-flash',
      systemPrompt: 'You answer in one word.',
      history: [],
      tools: [],
      apiKey: process.env.OPENROUTER_API_KEY!,
    })) events.push(ev);
    const text = events.filter((e) => e.type === 'text_delta').map((e: any) => e.delta).join('');
    expect(text.toUpperCase()).toContain('OK');
  }, 60_000);

  it('round-trips a single tool call', async () => {
    const echo = {
      name: 'echo', description: 'Repeat the input.',
      schema: z.object({ msg: z.string() }),
      handler: async (a: { msg: string }) => ({ echoed: a.msg }),
    };
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop(
      'Call the echo tool with msg="hello".',
      {
        model: 'google/gemini-2.5-flash',
        systemPrompt: 'When asked to call a tool, call it. Then answer.',
        history: [], tools: [echo],
        apiKey: process.env.OPENROUTER_API_KEY!,
      },
    )) events.push(ev);
    expect(events.find((e) => e.type === 'tool_call')).toBeTruthy();
    expect(events.find((e) => e.type === 'tool_result' && e.ok === true)).toBeTruthy();
  }, 90_000);
});
```

- [ ] **Step 3: Build and run**

Run: `npm run build && OPENROUTER_API_KEY=$OPENROUTER_API_KEY npx vitest run tests/e2e tests/integration/chat-eval-openrouter.test.ts`
Expected: all tests pass when key is set; skipped when not.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/chat-eval-cli.test.ts tests/integration/chat-eval-openrouter.test.ts
git commit -m "test(chat-eval): e2e + integration tests against real OpenRouter"
```

---

# Phase 2 — Production cutover

Run only after Phase 1 is merged to `main` and the harness has been exercised against at least the 5 golden prompts.

## Task 18: Add OPENROUTER_API_KEY to .env.sops

**Files:**
- Modify: `.env.sops`

- [ ] **Step 1: Decrypt current env**

```bash
./scripts/decrypt-env.sh
```

- [ ] **Step 2: Open the encrypted file for editing**

```bash
SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt" sops .env.sops
```

In the editor, append the line:

```
OPENROUTER_API_KEY=<your-openrouter-api-key>
```

Save and exit. Sops will re-encrypt automatically.

- [ ] **Step 3: Verify the variable lands in the decrypted output**

```bash
./scripts/decrypt-env.sh > /dev/null && grep '^OPENROUTER_API_KEY=' .env
```
Expected: prints the line.

- [ ] **Step 4: Commit the encrypted change**

```bash
git add .env.sops
git commit -m "feat(deploy): add OPENROUTER_API_KEY to .env.sops"
```

---

## Task 19: Update compose snippet for OpenRouter

**Files:**
- Modify: `docker-compose.chat.snippet.yml`

- [ ] **Step 1: Verify the exact OpenRouter slug for Claude Haiku 4.5**

Run: `curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id' | grep -i 'claude-haiku-4.5'`
Expected: a slug like `anthropic/claude-haiku-4.5`. Use whatever comes back as the canonical value.

- [ ] **Step 2: Edit the snippet**

Open `docker-compose.chat.snippet.yml`. Change the `MODEL:` line from `claude-haiku-4-5-20251001` to the OpenRouter slug verified in Step 1. Remove the `claude-creds` volume mount and the corresponding `volumes:` declaration entry (the Claude Agent SDK token state is no longer needed).

Expected resulting `volumes:` block: omitted entirely. Expected `environment:` block:

```yaml
    environment:
      PTV_DEV_ID: ${PTV_DEV_ID}
      PTV_API_KEY: ${PTV_API_KEY}
      NOMINATIM_URL: http://nominatim:8080
      PHOTON_URL: http://photon:2322
      OSRM_AU_BICYCLE_URL: http://osrm-au-bicycle:5000
      OSRM_AU_FOOT_URL: http://osrm-au-foot:5000
      GH_REST_URL: http://graphhopper-vic-bike:8989/route
      MODEL: anthropic/claude-haiku-4.5
      LOG_LEVEL: info
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.chat.snippet.yml
git commit -m "ops(chat): switch compose snippet to OpenRouter slug; drop claude-creds volume"
```

---

## Task 20: Deploy to totoro

**Files:**
- Modify (on totoro): `/tank/code/ptv/docker-compose.yml`

- [ ] **Step 1: Sync the change to the live compose on totoro**

```bash
ssh totoro 'cp /tank/code/ptv/docker-compose.yml /tank/code/ptv/docker-compose.yml.bak.$(date +%Y%m%d-%H%M%S)'
```

Then edit `/tank/code/ptv/docker-compose.yml` on totoro (via ssh) to match the snippet's new `MODEL:` slug and remove the `claude-creds` volume mount line. Confirm:

```bash
ssh totoro 'cd /tank/code/ptv && docker compose config --quiet && echo CONFIG_OK'
```
Expected: `CONFIG_OK`.

- [ ] **Step 2: Pull latest code on totoro and rebuild**

```bash
ssh totoro 'cd /tank/code/ptv && git fetch origin && git checkout main && git pull --ff-only origin main'
ssh totoro 'cd /tank/code/ptv && ./scripts/decrypt-env.sh'
ssh totoro 'cd /tank/code/ptv && docker compose build ptv-chat 2>&1 | tail -5'
```
Expected: image rebuilt.

- [ ] **Step 3: Recreate the container**

```bash
ssh totoro 'cd /tank/code/ptv && docker compose up -d ptv-chat && sleep 3 && docker exec ptv-chat printenv MODEL'
```
Expected: prints the OpenRouter slug.

- [ ] **Step 4: Smoke-test the live endpoint**

```bash
ssh totoro 'curl -sN --max-time 60 -X POST http://127.0.0.1:8086/api/chat \
  -H "content-type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"From Fitzroy to Hawthorn by bike\"}]}" | head -c 200'
```
Expected: starts with `data: {"type":"turn_start"}` and includes a `text_delta`.

- [ ] **Step 5: Compare timing**

Inspect the new `ptv-chat:turn_summary` log line vs the pre-cutover baseline (~18,800 ms on this prompt). Acceptable if `totalMs` is within ±20%.

```bash
ssh totoro 'docker logs ptv-chat --since 5m 2>&1 | grep ptv-chat:turn_summary | tail -1'
```

- [ ] **Step 6: Cutover criteria check**

Run the golden suite against the live HTTP route (not directly):

```bash
OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
node dist/index.js chat-eval suite tests/fixtures/eval-suite.yaml \
  --models anthropic/claude-haiku-4.5 --html /tmp/post-cutover.html --db /tmp/post.db
```

For each prompt's `expect_keywords`, confirm presence in `final_text`. If any keyword is missing, investigate before declaring cutover complete.

- [ ] **Step 7: Roll back path (do NOT execute unless needed)**

If smoke-test fails:

```bash
ssh totoro 'cd /tank/code/ptv && cp docker-compose.yml.bak.<timestamp> docker-compose.yml && docker compose up -d ptv-chat'
```

---

## Task 21: Remove the Claude Agent SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm there are no remaining imports**

Run: `grep -rn '@anthropic-ai/claude-agent-sdk' src tests 2>/dev/null`
Expected: no matches.

- [ ] **Step 2: Remove the dep**

```bash
npm uninstall @anthropic-ai/claude-agent-sdk
```

- [ ] **Step 3: Build + test**

```bash
npm run build && npm test
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(chat): remove @anthropic-ai/claude-agent-sdk (replaced by OpenRouter loop)"
```

---

## Task 22: Update README / CLAUDE.md references

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Refresh project notes**

In `CLAUDE.md`, replace any mention of Claude Agent SDK / Sonnet 4.6 / Haiku 4.5 (Anthropic direct slug) with the new OpenRouter-based wiring. Specifically update:
- The Architecture section's `src/chat/` description: "Claude Agent SDK chat app exposing PTV/plan/geocode as tools" → "OpenRouter-driven chat agent exposing PTV/plan/geocode as tools".
- The Env section: add `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`; mark `MODEL` as an OpenRouter slug.
- Add a one-line note about the new `ptv chat-eval` subcommand pointing readers at the spec for details.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(chat): update CLAUDE.md for OpenRouter migration + chat-eval subcommand"
```

---

# Self-review summary

- **Spec coverage:** Architecture invariants → Tasks 6, 7. CLI surface → Task 15. Suite YAML → Task 9. SQLite schema → Task 8. Renderers → Tasks 11–13. Replay → Task 10. OpenRouter loop → Tasks 4, 5. Tool bridge → Task 3. Configuration → Tasks 18, 19, 20. Migration plan → Phase 1 (1–17) + Phase 2 (18–22). Testing → unit (each implementation task), integration (Task 17), e2e (Task 17), golden suite (Task 16). Risks (tool-use variance, JSON drift) → covered by `parseArgs` returning `ok=false` in Task 3 + tool dispatch test in Task 5.
- **Placeholder scan:** No `TODO`/`TBD`. Every code step shows complete code or a verified command.
- **Type consistency:** `ToolFactory`, `OpenAIMessage`, `SseEvent`, `EvalDb`, `RunnerDeps`, `CapturedTurn` are defined once and used consistently across tasks. `chatEvalCommand()` follows the existing `chatServeCommand()` factory pattern.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-23-chat-eval-openrouter.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints for review.

Which approach?
