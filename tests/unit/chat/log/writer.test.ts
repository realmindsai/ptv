import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWriter } from '../../../../src/chat/log/writer';
import type { ConversationMeta } from '../../../../src/chat/log/types';

const META: ConversationMeta = {
  conversationId: '11111111-1111-1111-1111-111111111111',
  clientId:       '22222222-2222-2222-2222-222222222222',
  ip: '10.0.0.1',
  userAgent: 'jest',
};

function fakePool() {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => {}),
    on: vi.fn(),
    calls,
    client,
  };
}

describe('writer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('flushes one BEGIN/upsert/INSERT/COMMIT per drain', async () => {
    const pool = fakePool();
    const w = createWriter(pool as any, { intervalMs: 200, batchSize: 50 });

    w.enqueue({ meta: META, turnSeq: 0, type: 'user_msg',      payload: { content: 'hi' } });
    w.enqueue({ meta: META, turnSeq: 0, type: 'assistant_msg', payload: { content: 'hello' } });
    await w.flush();

    const sqls = pool.calls.map((c) => c.sql.trim().split('\n')[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toMatch(/^INSERT INTO conversations/);
    expect(pool.calls[1].sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(sqls[2]).toMatch(/^INSERT INTO events/);
    expect(sqls[3]).toBe('COMMIT');
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it('assigns monotonically increasing event_seq per conversation', async () => {
    const pool = fakePool();
    const w = createWriter(pool as any, { intervalMs: 200, batchSize: 50 });
    w.enqueue({ meta: META, turnSeq: 0, type: 'user_msg',      payload: { content: 'a' } });
    w.enqueue({ meta: META, turnSeq: 0, type: 'assistant_msg', payload: { content: 'b' } });
    w.enqueue({ meta: META, turnSeq: 1, type: 'user_msg',      payload: { content: 'c' } });
    await w.flush();

    const eventInsert = pool.calls.find((c) => /^INSERT INTO events/.test(c.sql))!;
    const values = eventInsert.values as unknown[];
    const seqs: number[] = [];
    for (let i = 2; i < values.length; i += 5) seqs.push(values[i] as number);
    expect(seqs).toEqual([0, 1, 2]);
  });

  it('drops batch and continues when pool.connect rejects', async () => {
    const failing = {
      connect: vi.fn(async () => { throw new Error('boom'); }),
      end: vi.fn(),
      on: vi.fn(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = createWriter(failing as any, { intervalMs: 200, batchSize: 50 });
    w.enqueue({ meta: META, turnSeq: 0, type: 'user_msg', payload: { content: 'x' } });
    await expect(w.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drains automatically when batchSize threshold is exceeded', async () => {
    const pool = fakePool();
    const w = createWriter(pool as any, { intervalMs: 60_000, batchSize: 3 });
    w.enqueue({ meta: META, turnSeq: 0, type: 'user_msg',      payload: { content: '1' } });
    w.enqueue({ meta: META, turnSeq: 0, type: 'assistant_msg', payload: { content: '2' } });
    w.enqueue({ meta: META, turnSeq: 0, type: 'turn_end',      payload: {} });
    await vi.advanceTimersByTimeAsync(0);
    await w.flush();
    expect(pool.client.query).toHaveBeenCalled();
  });
});
