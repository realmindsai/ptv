// tests/integration/chat-eval-openrouter.test.ts
import { describe, it, expect } from 'vitest';
import { runAgentLoop } from '../../src/llm/openrouter';
import { z } from 'zod';
import type { SseEvent } from '../../src/chat/types';

const hasKey = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!hasKey)('OpenRouter live', () => {
  it('returns text without tools on a trivial prompt', async () => {
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop('Reply with exactly the word OK', {
      model: 'google/gemini-2.5-flash',
      systemPrompt: 'You answer in one word.',
      history: [],
      tools: [],
      apiKey: process.env.OPENROUTER_API_KEY!,
    })) events.push(ev);
    const text = events.filter((e) => e.type === 'text_delta').map((e: any) => e.delta).join('');
    expect(text.toUpperCase()).toContain('OK');
  }, 60_000);

  it('round-trips a single tool call', async () => {
    const echo = {
      name: 'echo', description: 'Repeat the input.',
      schema: z.object({ msg: z.string() }),
      handler: async (a: { msg: string }) => ({ echoed: a.msg }),
    };
    const events: SseEvent[] = [];
    for await (const ev of runAgentLoop(
      'Call the echo tool with msg="hello".',
      {
        model: 'google/gemini-2.5-flash',
        systemPrompt: 'When asked to call a tool, call it. Then answer.',
        history: [], tools: [echo],
        apiKey: process.env.OPENROUTER_API_KEY!,
      },
    )) events.push(ev);
    expect(events.find((e) => e.type === 'tool_call')).toBeTruthy();
    expect(events.find((e) => e.type === 'tool_result' && e.ok === true)).toBeTruthy();
  }, 90_000);
});
