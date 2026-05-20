import { describe, it, expect, vi } from 'vitest';
import { makeLogger } from '../../../../src/chat/log/logger';
import type { Writer } from '../../../../src/chat/log/writer';
import type { ConversationMeta } from '../../../../src/chat/log/types';

const META: ConversationMeta = {
  conversationId: '11111111-1111-1111-1111-111111111111',
  clientId:       '22222222-2222-2222-2222-222222222222',
};

function fakeWriter() {
  const enqueued: any[] = [];
  return {
    writer: {
      enqueue: vi.fn((ev) => { enqueued.push(ev); }),
      flush: vi.fn(async () => {}),
      stop:  vi.fn(async () => {}),
    } as Writer,
    enqueued,
  };
}

describe('makeLogger', () => {
  it('returns NOOP when PTV_CHAT_PG_URL is unset', () => {
    const l = makeLogger({}, undefined);
    l.recordUserMsg(META, 0, 'hi');
    l.recordEvent(META, 0, { type: 'turn_end' });
    expect(typeof l.flush).toBe('function');
  });

  it('records user_msg via the writer', () => {
    const fw = fakeWriter();
    const l = makeLogger({ PTV_CHAT_PG_URL: 'pg://x' }, fw.writer);
    l.recordUserMsg(META, 0, 'hi');
    expect(fw.enqueued).toHaveLength(1);
    expect(fw.enqueued[0].type).toBe('user_msg');
    expect(fw.enqueued[0].payload).toEqual({ content: 'hi' });
  });

  it('accumulates text_delta then emits one assistant_msg at turn_end', () => {
    const fw = fakeWriter();
    const l = makeLogger({ PTV_CHAT_PG_URL: 'pg://x' }, fw.writer);
    l.recordEvent(META, 0, { type: 'text_delta', delta: 'hel' });
    l.recordEvent(META, 0, { type: 'text_delta', delta: 'lo' });
    l.recordEvent(META, 0, { type: 'turn_end' });
    const types = fw.enqueued.map((e) => e.type);
    expect(types).toEqual(['assistant_msg', 'turn_end']);
    expect(fw.enqueued[0].payload).toEqual({ content: 'hello' });
  });

  it('skips assistant_msg when no text_delta arrived', () => {
    const fw = fakeWriter();
    const l = makeLogger({ PTV_CHAT_PG_URL: 'pg://x' }, fw.writer);
    l.recordEvent(META, 0, { type: 'turn_end' });
    expect(fw.enqueued.map((e) => e.type)).toEqual(['turn_end']);
  });

  it('passes through tool_call, tool_result, path_add, error unchanged', () => {
    const fw = fakeWriter();
    const l = makeLogger({ PTV_CHAT_PG_URL: 'pg://x' }, fw.writer);
    l.recordEvent(META, 0, { type: 'tool_call',   id: 't1', name: 'plan', args: { x: 1 } });
    l.recordEvent(META, 0, { type: 'tool_result', id: 't1', ok: true, summary: 'done' });
    l.recordEvent(META, 0, { type: 'path_add',    pathId: 'p', label: 'l', color: '#fff', itinerary: {} as any });
    l.recordEvent(META, 0, { type: 'error',       message: 'oops' });
    const types = fw.enqueued.map((e) => e.type);
    expect(types).toEqual(['tool_call', 'tool_result', 'path_add', 'error']);
  });
});
