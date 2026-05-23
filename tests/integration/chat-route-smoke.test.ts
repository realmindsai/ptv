// tests/integration/chat-route-smoke.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createChatApp } from '../../src/chat/server';
import { NOOP_LOGGER } from '../../src/chat/log/types';
import { _resetPoolForTests } from '../../src/chat/log/pool';

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

describe('POST /api/chat — smoke', () => {
  beforeAll(() => {
    // Ensure pool cache is clean so getPool() doesn't try to reuse a stale pool from
    // another test suite that may have set PTV_CHAT_PG_URL.
    _resetPoolForTests();
    process.env.OPENROUTER_API_KEY = 'test-key';
    // Unset PG URL so getPool() returns null and no postgres connection is attempted.
    delete process.env.PTV_CHAT_PG_URL;
  });

  afterAll(() => {
    delete process.env.OPENROUTER_API_KEY;
    _resetPoolForTests();
  });

  it('streams an SSE response without tool calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        streamFromChunks([
          { choices: [{ delta: { content: 'hi there' }, finish_reason: null }] },
          { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] },
        ]),
        { status: 200 },
      ) as any,
    );

    // Pass NOOP_LOGGER to bypass postgres entirely; logger: false silences Fastify noise.
    const app = createChatApp({ chatLogger: NOOP_LOGGER, logger: false });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { 'content-type': 'application/json' },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('"type":"turn_start"');
    expect(res.payload).toContain('"type":"text_delta"');
    expect(res.payload).toContain('"type":"turn_end"');
    // Confirm the actual text delta content made it through.
    expect(res.payload).toContain('"delta":"hi there"');

    // Exactly one fetch call to OpenRouter.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
    expect(calledUrl).toContain('openrouter.ai');

    await app.close();
    fetchSpy.mockRestore();
  });
});
