import { describe, it, expect } from 'vitest';
import { parseSseChunks } from '../../../web-chat/src/sse';

describe('parseSseChunks', () => {
  it('emits one event per data: line', () => {
    const buf =
      `data: {"type":"turn_start"}\n\n` +
      `data: {"type":"text_delta","delta":"hi"}\n\n`;
    const { events, rest } = parseSseChunks(buf);
    expect(events).toEqual([
      { type: 'turn_start' },
      { type: 'text_delta', delta: 'hi' },
    ]);
    expect(rest).toBe('');
  });

  it('returns partial trailing chunk as rest', () => {
    const buf = `data: {"type":"turn_start"}\n\ndata: {"type":"text_d`;
    const { events, rest } = parseSseChunks(buf);
    expect(events).toEqual([{ type: 'turn_start' }]);
    expect(rest).toBe(`data: {"type":"text_d`);
  });

  it('skips malformed JSON chunks gracefully', () => {
    const buf = `data: not-json\n\ndata: {"type":"turn_end"}\n\n`;
    const { events, rest } = parseSseChunks(buf);
    expect(events).toEqual([{ type: 'turn_end' }]);
    expect(rest).toBe('');
  });

  it('handles empty input', () => {
    expect(parseSseChunks('')).toEqual({ events: [], rest: '' });
  });
});
