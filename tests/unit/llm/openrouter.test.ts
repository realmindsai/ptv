import { describe, it, expect } from 'vitest';
import { parseSseChunks } from '../../../src/llm/openrouter';

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
