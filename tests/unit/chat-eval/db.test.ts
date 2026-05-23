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
