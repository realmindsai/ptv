import type { Pool, PoolClient } from 'pg';
import type { ConversationMeta, LoggedEvent, LoggedEventType } from './types';
import { describeError } from '../../server/routes/health';

export interface WriterOptions {
  intervalMs?: number;
  batchSize?: number;
}

export interface Writer {
  enqueue(ev: LoggedEvent): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

interface QueuedRow {
  meta: ConversationMeta;
  turnSeq: number;
  type: LoggedEventType;
  payload: unknown;
  eventSeq: number;
}

export function createWriter(pool: Pool, opts: WriterOptions = {}): Writer {
  const intervalMs = opts.intervalMs ?? 200;
  const batchSize  = opts.batchSize  ?? 50;

  const queue: QueuedRow[] = [];
  const seqByConv = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let draining: Promise<void> = Promise.resolve();
  let stopped = false;
  let warned = false;

  // Fire-and-forget is right for the request path and wrong for the operator:
  // a dropped batch must never fail a chat turn, but the operator has to be
  // able to see that logging is dead (ptv-t7q). This used to print one line
  // per failed batch, without the SQLSTATE: noise when the database is down,
  // and nothing that says which grant is missing. Now the first failure in the
  // process gets one loud WARN naming the SQLSTATE, and later ones are
  // suppressed. Readiness (/readyz) is what shows it is still failing.
  function reportFailure(stage: string, err: unknown): void {
    if (warned) return;
    warned = true;
    console.warn(
      '[ptv-chat:log] WARN conversation logging is failing; events are being dropped. '
      + `First failure: ${stage}: ${describeError(err)}. `
      + 'Further failures in this process are suppressed.',
    );
  }

  function scheduleTimer() {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      draining = draining.then(drainOnce);
    }, intervalMs);
    timer.unref?.();
  }

  function nextSeq(convId: string): number {
    const s = seqByConv.get(convId) ?? 0;
    seqByConv.set(convId, s + 1);
    return s;
  }

  async function drainOnce(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);

    const convs = new Map<string, ConversationMeta>();
    for (const row of batch) {
      convs.set(row.meta.conversationId, row.meta);
    }

    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (err) {
      reportFailure('pool.connect failed', err);
      return;
    }

    try {
      await client.query('BEGIN');

      const convVals: unknown[] = [];
      const convPlaceholders: string[] = [];
      let i = 1;
      for (const m of convs.values()) {
        convPlaceholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
        convVals.push(
          m.conversationId,
          m.clientId,
          m.ip ?? null,
          m.userAgent ?? null,
          m.origin?.lat ?? null,
          m.origin?.lon ?? null,
        );
      }
      await client.query(
        `INSERT INTO conversations (id, client_id, ip, user_agent, origin_lat, origin_lon)
         VALUES ${convPlaceholders.join(', ')}
         ON CONFLICT (id) DO UPDATE SET last_event_at = excluded.last_event_at`,
        convVals,
      );

      const evVals: unknown[] = [];
      const evPlaceholders: string[] = [];
      let j = 1;
      for (const row of batch) {
        evPlaceholders.push(`($${j++}, $${j++}, $${j++}, $${j++}, $${j++})`);
        evVals.push(
          row.meta.conversationId,
          row.turnSeq,
          row.eventSeq,
          row.type,
          JSON.stringify(row.payload),
        );
      }
      await client.query(
        `INSERT INTO events (conversation_id, turn_seq, event_seq, type, payload)
         VALUES ${evPlaceholders.join(', ')}`,
        evVals,
      );

      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      reportFailure('insert failed', err);
    } finally {
      client.release();
    }
  }

  function enqueue(ev: LoggedEvent): void {
    if (stopped) return;
    const row: QueuedRow = {
      meta: ev.meta,
      turnSeq: ev.turnSeq,
      type: ev.type,
      payload: ev.payload,
      eventSeq: nextSeq(ev.meta.conversationId),
    };
    queue.push(row);
    if (queue.length >= batchSize) {
      draining = draining.then(drainOnce);
    } else {
      scheduleTimer();
    }
  }

  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    draining = draining.then(drainOnce);
    await draining;
  }

  async function stop(): Promise<void> {
    stopped = true;
    await flush();
  }

  return { enqueue, flush, stop };
}
