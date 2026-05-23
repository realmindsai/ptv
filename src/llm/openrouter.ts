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
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

  while (true) {
    const body = {
      model: opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages,
      ...(oaTools.length ? { tools: oaTools, tool_choice: 'auto' } : {}),
    };
    // One-shot retry: undici's `fetch` occasionally throws a bare TypeError
    // ("fetch failed") under concurrency. Retry once after 500ms before
    // giving up, so a multi-model eval doesn't lose a turn to a socket blip.
    const doFetch = () => fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${opts.apiKey}`,
        'http-referer': 'https://bike-rail.realmindsai.com.au',
        'x-title': 'ptv-chat',
      },
      body: JSON.stringify(body),
    });
    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        res = await doFetch();
      } catch (err2) {
        yield { type: 'error', message: `openrouter fetch failed (after 1 retry): ${(err2 as Error).message}` };
        break;
      }
    }
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
        console.error(JSON.stringify({
          level: 30, msg: 'ptv-chat:sdk_gap', sdkType: 'chunk', gapMs: gap,
        }));
      }
      if (chunk.usage) lastUsage = chunk.usage;
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
          const cur: PartialToolCall = partials.get(i) ?? { index: i, arguments: '' };
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
      console.error(JSON.stringify({
        level: 30, msg: 'ptv-chat:tool',
        tool: c.function.name, durationMs: durMs, ok: outcome.ok,
        ...(outcome.ok ? {} : { err: (outcome as { ok: false; error: string }).error }),
      }));
      return { call: c, args, outcome };
    }));

    for (const d of dispatched) {
      yield { type: 'tool_call', id: d.call.id, name: d.call.function.name, args: d.args };
      const payload = d.outcome.ok
        ? (d.outcome as { ok: true; result: unknown }).result
        : { error: (d.outcome as { ok: false; error: string }).error };
      const summary = JSON.stringify(payload).slice(0, 200000);
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
  console.error(JSON.stringify({
    level: 30, msg: 'ptv-chat:turn_summary',
    totalMs, sdkMsgCount, toolTotalMs: toolTotal, nonToolMs: totalMs - toolTotal,
    tools: toolSummary,
  }));
  yield { type: 'turn_end', ...(lastUsage ? { usage: lastUsage } : {}) };
}

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
