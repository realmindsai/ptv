import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runTurn } from '../../../src/chat/agent';
import type { SseEvent } from '../../../src/chat/types';

function streamFromChunks(chunks: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}

function fakeFetch(streams: ReadableStream<Uint8Array>[]): typeof fetch {
  let i = 0;
  return (async () => new Response(streams[i++], { status: 200 })) as any;
}

const echoTool = {
  name: 'echo',
  description: 'echo',
  schema: z.object({ msg: z.string() }),
  handler: async (a: { msg: string }) => ({ echoed: a.msg }),
};

describe('runTurn (OpenRouter)', () => {
  it('streams turn_start → text_delta → turn_end for a no-tool response', async () => {
    process.env.OPENROUTER_API_KEY = 'test';
    const events: SseEvent[] = [];
    for await (const ev of runTurn(
      { messages: [{ role: 'user', content: 'hi' }] },
      {
        tools: {
          geocode: echoTool, plan: echoTool, bike_route: echoTool,
          search_stops: echoTool, nearby_stops: echoTool, schedule: echoTool,
        },
        model: 'test/model',
        fetchImpl: fakeFetch([
          streamFromChunks([
            { choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }] },
          ]),
        ]),
      } as any,
    )) events.push(ev);

    expect(events[0]).toEqual({ type: 'turn_start' });
    expect(events.find((e) => e.type === 'text_delta' && e.delta === 'hello')).toBeTruthy();
    expect(events[events.length - 1]).toEqual({ type: 'turn_end' });
  });

  it('errors cleanly when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const events: SseEvent[] = [];
    for await (const ev of runTurn(
      { messages: [{ role: 'user', content: 'hi' }] },
      { tools: {} as any, model: 'test/model' } as any,
    )) events.push(ev);
    expect(events.find((e) => e.type === 'error')).toBeTruthy();
  });
});
