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
  /** Returns + drains any path_add events that landed via ctx.emit during this turn. */
  getSideEvents?: () => SseEvent[];
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
  side_events: SseEvent[];   // path_add and other out-of-band events from ctx.emit
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
  let usage: any = null;
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
      case 'turn_end':
        if ((ev as any).usage) usage = (ev as any).usage;
        break;
      case 'error':
        error = ev.message;
        break;
      default:
        break;
    }
  }

  const sideEvents = deps.getSideEvents?.() ?? [];
  const pathAdds = sideEvents.filter((e): e is Extract<SseEvent, { type: 'path_add' }> => e.type === 'path_add');

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
    usage_json: usage ? JSON.stringify(usage) : null,
    error,
    path_adds_json: pathAdds.length ? JSON.stringify(pathAdds) : null,
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

  return { turn_id, final_text: finalText, tool_calls: ordered, total_ms, error, side_events: sideEvents };
}
