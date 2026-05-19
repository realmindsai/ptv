import { describe, it, expect } from 'vitest';
import { encodeSseEvent, type SseEvent } from '../../../src/chat/sse';

describe('encodeSseEvent', () => {
  it('encodes a text_delta event as a single SSE frame', () => {
    const ev: SseEvent = { type: 'text_delta', delta: 'hello' };
    expect(encodeSseEvent(ev)).toBe(
      `data: {"type":"text_delta","delta":"hello"}\n\n`
    );
  });

  it('encodes a path_add event with nested itinerary', () => {
    const ev: SseEvent = {
      type: 'path_add',
      pathId: 'p1',
      label: 'commute',
      color: '#e6194b',
      itinerary: { legs: [], distanceKm: 12, durationMin: 45 } as any,
    };
    const out = encodeSseEvent(ev);
    expect(out.startsWith('data: ')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(true);
    const json = JSON.parse(out.slice('data: '.length, -2));
    expect(json.type).toBe('path_add');
    expect(json.itinerary.distanceKm).toBe(12);
  });

  it('encodes turn_start with no payload', () => {
    expect(encodeSseEvent({ type: 'turn_start' }))
      .toBe('data: {"type":"turn_start"}\n\n');
  });
});
