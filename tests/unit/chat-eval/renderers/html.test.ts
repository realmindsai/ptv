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
      { mode: 'bike' as const, fromName: '-37.8,144.97', toName: '-37.81,144.99', km: 5, min: 20,
        latlngs: [[-37.8, 144.97], [-37.81, 144.99]] as Array<[number, number]> },
      { mode: 'train' as const, fromName: 'Flinders Street', toName: 'Hawthorn', latlngs: [[-37.818, 144.967], [-37.822, 145.035]] as Array<[number, number]> },
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
