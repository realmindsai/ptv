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
