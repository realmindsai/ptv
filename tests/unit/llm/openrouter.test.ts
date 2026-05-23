import { describe, it, expect } from 'vitest';
import { parseSseChunks, runAgentLoop } from '../../../src/llm/openrouter';
import type { SseEvent } from '../../../src/chat/types';
import type { AgentLoopOptions } from '../../../src/llm/types';
import { z } from 'zod';

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
