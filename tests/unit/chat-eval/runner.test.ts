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
