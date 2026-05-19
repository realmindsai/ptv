import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SseEvent } from '../../../src/chat/types';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  tool: vi.fn((name, description, schema, handler) => ({ name, description, schema, handler })),
  createSdkMcpServer: vi.fn((opts) => ({ name: opts.name, tools: opts.tools, instance: {} })),
}));

import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk';
import { runTurn, mapSdkMessage } from '../../../src/chat/agent';

describe('mapSdkMessage', () => {
  it('maps a content_block_delta text_delta to text_delta SSE event', () => {
    const ev: any = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
    };
    expect(mapSdkMessage(ev)).toEqual([{ type: 'text_delta', delta: 'Hi' }]);
  });

  it('maps an assistant message with one tool_use block to one tool_call event', () => {
    const ev: any = {
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', id: 'tu_1', name: 'mcp__ptv-chat__geocode', input: { query: 'Hurstbridge' } },
      ]},
    };
    const out = mapSdkMessage(ev);
    expect(out).toEqual([
      { type: 'tool_call', id: 'tu_1', name: 'geocode', args: { query: 'Hurstbridge' } },
    ]);
  });

  it('maps assistant text blocks to a single text_delta (SDK default is non-streaming)', () => {
    const ev: any = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'all done' }] },
    };
    expect(mapSdkMessage(ev)).toEqual([{ type: 'text_delta', delta: 'all done' }]);
  });

  it('skips empty assistant text blocks', () => {
    const ev: any = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '' }] },
    };
    expect(mapSdkMessage(ev)).toEqual([]);
  });

  it('maps a user message carrying tool_use_result to a tool_result event', () => {
    const ev: any = {
      type: 'user',
      message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: '{"ok":true,"lat":-37.74}' }] },
      ]},
    };
    expect(mapSdkMessage(ev)).toEqual([
      { type: 'tool_result', id: 'tu_1', ok: true, summary: '{"ok":true,"lat":-37.74}' },
    ]);
  });

  it('marks tool_result is_error true as ok:false', () => {
    const ev: any = {
      type: 'user',
      message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_2', is_error: true,
          content: [{ type: 'text', text: 'boom' }] },
      ]},
    };
    expect(mapSdkMessage(ev)).toEqual([
      { type: 'tool_result', id: 'tu_2', ok: false, summary: 'boom' },
    ]);
  });

  it('ignores result messages (turn_end is emitted by the runTurn finally block)', () => {
    expect(mapSdkMessage({ type: 'result', subtype: 'success' } as any)).toEqual([]);
  });
});

describe('runTurn', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('yields turn_start, mapped events, and turn_end', async () => {
    async function* script() {
      yield { type: 'stream_event',
              event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }} as any;
      yield { type: 'assistant',
              message: { content: [{ type: 'tool_use', id: 'tu_1',
                                     name: 'mcp__ptv-chat__geocode', input: { query: 'Hurst' } }] }} as any;
      yield { type: 'user',
              message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1',
                                     content: [{ type: 'text', text: '{"ok":true}' }] }] }} as any;
      yield { type: 'result', subtype: 'success' } as any;
    }
    (mockQuery as any).mockReturnValue(script());

    const events: SseEvent[] = [];
    const tools = {
      geocode:      { name: 'geocode',      description: 'd', schema: {} as any, handler: async () => ({}) },
      plan:         { name: 'plan',         description: 'd', schema: {} as any, handler: async () => ({}) },
      bike_route:   { name: 'bike_route',   description: 'd', schema: {} as any, handler: async () => ({}) },
      search_stops: { name: 'search_stops', description: 'd', schema: {} as any, handler: async () => ({}) },
      nearby_stops: { name: 'nearby_stops', description: 'd', schema: {} as any, handler: async () => ({}) },
      schedule:     { name: 'schedule',     description: 'd', schema: {} as any, handler: async () => ({}) },
    };
    for await (const ev of runTurn(
      { messages: [{ role: 'user', content: 'where is Hurst?' }] },
      { tools, model: 'claude-sonnet-4-6' },
    )) {
      events.push(ev);
    }
    const types = events.map(e => e.type);
    expect(types[0]).toBe('turn_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types[types.length - 1]).toBe('turn_end');
  });

  it('emits an error event when query() throws', async () => {
    (mockQuery as any).mockImplementation(() => { throw new Error('boom'); });
    const events: SseEvent[] = [];
    const tools = {
      geocode: {}, plan: {}, bike_route: {}, search_stops: {}, nearby_stops: {}, schedule: {},
    } as any;
    for await (const ev of runTurn(
      { messages: [{ role: 'user', content: 'x' }] },
      { tools },
    )) { events.push(ev); }
    expect(events.find(e => e.type === 'error')).toBeDefined();
    expect(events[events.length - 1].type).toBe('turn_end');
  });
});
