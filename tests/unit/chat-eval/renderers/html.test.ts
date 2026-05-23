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
