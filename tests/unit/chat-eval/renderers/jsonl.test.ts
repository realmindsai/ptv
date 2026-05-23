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
