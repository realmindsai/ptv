# ptv-chat Postgres logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every ptv-chat turn (user message, assembled assistant message, every tool_call/tool_result, every path_add, errors) to a new `ptv_chat` database on the central Postgres (`postgres.magpie-inconnu.ts.net:5433`), so sessions can be replayed and analysed via SQL.

**Architecture:** A tee inside `src/chat/routes/chat.ts` pushes every SSE event into an in-memory queue. A singleton writer drains the queue every 200 ms (or at 50 items) and inserts in one transaction: an upsert into `conversations`, then a bulk INSERT into `events` (JSONB payload). DB outage never breaks chat — the queue is fire-and-forget; when `PTV_CHAT_PG_URL` is unset, the logger is a no-op so local dev needs no Postgres.

**Tech Stack:** TypeScript 5, Node 20, Fastify 5, `pg` 8 (new dep), vitest, SOPS+age for secret management (per `infra-shared/STANDARDS.md` §4).

**Source spec:** `docs/superpowers/specs/2026-05-21-ptv-chat-postgres-logging-design.md`

---

## File Structure

**Create:**
- `src/chat/log/types.ts` — `Logger`, `ConversationMeta`, `LoggedEvent` types
- `src/chat/log/pool.ts` — `pg.Pool` factory keyed off `PTV_CHAT_PG_URL`
- `src/chat/log/writer.ts` — queue + drain loop + batched INSERT (singleton)
- `src/chat/log/logger.ts` — `makeLogger()` public surface; wraps writer
- `src/chat/log/schema.sql` — applied once on totoro
- `tests/unit/chat/log/logger.test.ts`
- `tests/unit/chat/log/writer.test.ts`
- `tests/integration/chat/logging.test.ts`

**Modify:**
- `package.json` — add `pg` + `@types/pg` deps
- `src/chat/server.ts` — instantiate logger, pass to chat route, wire `SIGTERM` flush
- `src/chat/routes/chat.ts` — read identity headers, tee `emit`, synthesise `user_msg`, accumulate text deltas into `assistant_msg`
- `src/chat/types.ts` — extend `ChatCtx` with optional `logger`/`meta` if needed (no public API change)
- `web-chat/src/sse.ts` — accept extra request headers
- `web-chat/src/main.ts` — mint `client_id`/`conversation_id` and pass them as headers
- `web-chat/src/state.ts` — `reset_chat` action mints a fresh `conversation_id`
- `web-chat/README.md` — document what's logged and how secrets are managed
- `docker-compose.chat.snippet.yml` — add `env_file:` pointing to SOPS-decrypted `/run/secrets/ptv-chat/.env`

Each file has one responsibility: pool.ts owns the connection, writer.ts owns the batching, logger.ts owns the public surface, the route owns the tee. Tests mirror the source layout one-for-one.

---

## Task 1: Add `pg` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pg and types**

Run:
```bash
npm install pg@^8.13.0
npm install -D @types/pg@^8.11.10
```

Expected: `package.json` now has `"pg": "^8.13.0"` in dependencies and `"@types/pg": "^8.11.10"` in devDependencies. `package-lock.json` updated.

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: clean tsc compile, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(chat): add pg dep for postgres logging"
```

---

## Task 2: Define logger types

**Files:**
- Create: `src/chat/log/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// src/chat/log/types.ts
import type { SseEvent } from '../types';

export interface ConversationMeta {
  conversationId: string;   // uuid v4
  clientId: string;         // uuid v4 from browser localStorage
  ip?: string;
  userAgent?: string;
  origin?: { lat: number; lon: number };
}

export type LoggedEventType =
  | 'user_msg'
  | 'assistant_msg'
  | 'tool_call'
  | 'tool_result'
  | 'path_add'
  | 'turn_end'
  | 'error';

export interface LoggedEvent {
  meta: ConversationMeta;
  turnSeq: number;       // 0-based; the user_msg sets it
  type: LoggedEventType;
  payload: unknown;      // JSON-serialisable
}

export interface Logger {
  recordUserMsg(meta: ConversationMeta, turnSeq: number, content: string): void;
  recordEvent(meta: ConversationMeta, turnSeq: number, ev: SseEvent | { type: 'assistant_msg'; content: string }): void;
  flush(): Promise<void>;
}

export const NOOP_LOGGER: Logger = {
  recordUserMsg() {},
  recordEvent() {},
  async flush() {},
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/chat/log/types.ts
git commit -m "feat(chat): logger types"
```

---

## Task 3: Schema SQL file

**Files:**
- Create: `src/chat/log/schema.sql`

- [ ] **Step 1: Write the schema**

```sql
-- src/chat/log/schema.sql
-- Apply once on totoro:
--   sudo -u postgres psql -p 5433 -d ptv_chat -f schema.sql
-- (Run CREATE DATABASE ptv_chat OWNER dewoller first.)

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY,
  client_id       UUID NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip              INET,
  user_agent      TEXT,
  origin_lat      DOUBLE PRECISION,
  origin_lon      DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS conversations_client_id_started_at
  ON conversations (client_id, started_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_seq        INTEGER NOT NULL,
  event_seq       INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_conversation_seq ON events (conversation_id, event_seq);
CREATE INDEX IF NOT EXISTS events_type_created     ON events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS events_payload_gin      ON events USING GIN (payload jsonb_path_ops);

-- Writer role (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ptv_chat_writer') THEN
    CREATE ROLE ptv_chat_writer LOGIN PASSWORD 'change-me-then-store-in-sops';
  END IF;
END$$;

GRANT CONNECT ON DATABASE ptv_chat TO ptv_chat_writer;
GRANT USAGE   ON SCHEMA public      TO ptv_chat_writer;
GRANT INSERT  ON conversations, events TO ptv_chat_writer;
GRANT UPDATE (last_event_at) ON conversations TO ptv_chat_writer;
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO ptv_chat_writer;
```

- [ ] **Step 2: Commit**

```bash
git add src/chat/log/schema.sql
git commit -m "feat(chat): schema for conversation logging"
```

---

## Task 4: Connection pool

**Files:**
- Create: `src/chat/log/pool.ts`

- [ ] **Step 1: Write the pool module**

```ts
// src/chat/log/pool.ts
import { Pool } from 'pg';

let cached: Pool | null | undefined;

export function getPool(env: NodeJS.ProcessEnv = process.env): Pool | null {
  if (cached !== undefined) return cached;
  const url = env.PTV_CHAT_PG_URL;
  if (!url) {
    cached = null;
    return null;
  }
  cached = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30_000,
    // Errors on idle clients must not crash the process.
    keepAlive: true,
  });
  cached.on('error', (err) => {
    // Logged at warn elsewhere; never throw out of an idle-client error.
    // eslint-disable-next-line no-console
    console.warn('[ptv-chat:log] idle pg client error:', err.message);
  });
  return cached;
}

export async function endPool(): Promise<void> {
  if (cached) {
    await cached.end();
    cached = null;
  }
}

// For tests: reset the cached pool so a fresh env is picked up.
export function _resetPoolForTests(): void {
  cached = undefined;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/chat/log/pool.ts
git commit -m "feat(chat): pg pool module"
```

---

## Task 5: Writer — failing test first

**Files:**
- Create: `tests/unit/chat/log/writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat/log/writer.test.ts
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
    expect(sqls[1]).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
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
    // values laid out as (conv_id, turn_seq, event_seq, type, payload) per row.
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
    // Allow the microtask queue to run the auto-drain.
    await vi.advanceTimersByTimeAsync(0);
    await w.flush();
    expect(pool.client.query).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/unit/chat/log/writer.test.ts`
Expected: FAIL — `Cannot find module '.../src/chat/log/writer'`.

---

## Task 6: Writer — implementation

**Files:**
- Create: `src/chat/log/writer.ts`

- [ ] **Step 1: Write the writer**

```ts
// src/chat/log/writer.ts
import type { Pool } from 'pg';
import type { ConversationMeta, LoggedEvent, LoggedEventType } from './types';

export interface WriterOptions {
  intervalMs?: number;   // default 200
  batchSize?: number;    // default 50
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
  // Per-conversation monotonic counter, lives for the process lifetime.
  const seqByConv = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let draining: Promise<void> = Promise.resolve();
  let stopped = false;

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

    // Unique conversations in this batch (for the upsert).
    const convs = new Map<string, ConversationMeta>();
    for (const row of batch) {
      convs.set(row.meta.conversationId, row.meta);
    }

    let client: Awaited<ReturnType<Pool['connect']>>;
    try {
      client = await pool.connect();
    } catch (err) {
      console.warn('[ptv-chat:log] pool.connect failed:', (err as Error).message);
      return;
    }

    try {
      await client.query('BEGIN');

      // Conversation upsert — one multi-row INSERT.
      const convVals: unknown[] = [];
      const convPlaceholders: string[] = [];
      let i = 1;
      for (const m of convs.values()) {
        convPlaceholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
        convVals.push(m.conversationId, m.clientId, m.ip ?? null, m.userAgent ?? null, m.origin?.lat ?? null, m.origin?.lon ?? null);
      }
      await client.query(
        `INSERT INTO conversations (id, client_id, ip, user_agent, origin_lat, origin_lon)
         VALUES ${convPlaceholders.join(', ')}
         ON CONFLICT (id) DO UPDATE SET last_event_at = excluded.last_event_at`,
        convVals,
      );

      // Events — one multi-row INSERT.
      const evVals: unknown[] = [];
      const evPlaceholders: string[] = [];
      let j = 1;
      for (const row of batch) {
        evPlaceholders.push(`($${j++}, $${j++}, $${j++}, $${j++}, $${j++})`);
        evVals.push(row.meta.conversationId, row.turnSeq, row.eventSeq, row.type, JSON.stringify(row.payload));
      }
      await client.query(
        `INSERT INTO events (conversation_id, turn_seq, event_seq, type, payload)
         VALUES ${evPlaceholders.join(', ')}`,
        evVals,
      );

      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      console.warn('[ptv-chat:log] insert failed, dropping batch:', (err as Error).message);
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
      // Fire an immediate drain without waiting for the timer.
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
```

- [ ] **Step 2: Run the writer tests; verify they pass**

Run: `npx vitest run tests/unit/chat/log/writer.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/chat/log/writer.test.ts src/chat/log/writer.ts
git commit -m "feat(chat): batched postgres writer with fire-and-forget enqueue"
```

---

## Task 7: Logger surface — failing test first

**Files:**
- Create: `tests/unit/chat/log/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat/log/logger.test.ts
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
    // No throw, nothing to inspect — just confirm calls are no-ops.
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
    // text_deltas themselves are NOT written; only assistant_msg + turn_end.
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
```

- [ ] **Step 2: Run; confirm it fails**

Run: `npx vitest run tests/unit/chat/log/logger.test.ts`
Expected: FAIL — `Cannot find module '.../src/chat/log/logger'`.

---

## Task 8: Logger surface — implementation

**Files:**
- Create: `src/chat/log/logger.ts`

- [ ] **Step 1: Write the logger**

```ts
// src/chat/log/logger.ts
import type { SseEvent } from '../types';
import type { ConversationMeta, Logger, LoggedEventType } from './types';
import { NOOP_LOGGER } from './types';
import type { Writer } from './writer';

// Per-conversation in-flight text-delta buffer (one entry per conversation).
type DeltaBuf = Map<string, string>;

export function makeLogger(env: NodeJS.ProcessEnv, writer: Writer | undefined): Logger {
  if (!env.PTV_CHAT_PG_URL || !writer) return NOOP_LOGGER;
  const buffers: DeltaBuf = new Map();

  function recordUserMsg(meta: ConversationMeta, turnSeq: number, content: string): void {
    writer.enqueue({
      meta, turnSeq, type: 'user_msg', payload: { content },
    });
  }

  function recordEvent(meta: ConversationMeta, turnSeq: number, ev: SseEvent | { type: 'assistant_msg'; content: string }): void {
    switch (ev.type) {
      case 'turn_start':
        // Not persisted; signals only.
        return;
      case 'text_delta': {
        const prior = buffers.get(meta.conversationId) ?? '';
        buffers.set(meta.conversationId, prior + ev.delta);
        return;
      }
      case 'turn_end': {
        const buffered = buffers.get(meta.conversationId);
        if (buffered && buffered.length > 0) {
          writer.enqueue({
            meta, turnSeq, type: 'assistant_msg', payload: { content: buffered },
          });
          buffers.delete(meta.conversationId);
        }
        writer.enqueue({ meta, turnSeq, type: 'turn_end', payload: {} });
        return;
      }
      case 'assistant_msg': {
        writer.enqueue({
          meta, turnSeq, type: 'assistant_msg', payload: { content: ev.content },
        });
        return;
      }
      case 'tool_call':
      case 'tool_result':
      case 'path_add':
      case 'error': {
        const type = ev.type as LoggedEventType;
        const { type: _t, ...rest } = ev as any;
        writer.enqueue({ meta, turnSeq, type, payload: rest });
        return;
      }
    }
  }

  async function flush(): Promise<void> {
    await writer.flush();
  }

  return { recordUserMsg, recordEvent, flush };
}
```

- [ ] **Step 2: Run logger tests; verify pass**

Run: `npx vitest run tests/unit/chat/log/logger.test.ts`
Expected: 5 tests pass.

- [ ] **Step 3: Run the entire unit suite to ensure nothing else broke**

Run: `npm run test:unit`
Expected: existing tests pass; the two new test files pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/chat/log/logger.test.ts src/chat/log/logger.ts
git commit -m "feat(chat): logger surface — assembles assistant_msg, forwards other events"
```

---

## Task 9: Wire logger + writer into createChatApp

**Files:**
- Modify: `src/chat/server.ts`
- Modify: `src/chat/routes/chat.ts`
- Modify: `tests/integration/chat/server.test.ts` (verify still passes — no test changes needed yet)

- [ ] **Step 1: Extend `createChatApp` to accept an optional logger and to construct the default**

In `src/chat/server.ts`, after the imports add:

```ts
import { getPool } from './log/pool';
import { createWriter, type Writer } from './log/writer';
import { makeLogger } from './log/logger';
import type { Logger } from './log/types';
```

Extend `ChatAppOptions`:

```ts
export type ChatAppOptions = {
  logger?: FastifyBaseLogger | boolean;
  runTurnFn?: RunTurnFn;
  buildTools?: BuildToolsFn;
  /** Override the conversation logger (mainly for tests). */
  chatLogger?: Logger;
};
```

Inside `createChatApp`, build the default chat logger if none provided:

```ts
let chatLogger: Logger | undefined = opts.chatLogger;
let writerForShutdown: Writer | undefined;
if (!chatLogger) {
  const pool = getPool();
  if (pool) {
    writerForShutdown = createWriter(pool);
    chatLogger = makeLogger(process.env, writerForShutdown);
  } else {
    chatLogger = makeLogger(process.env, undefined);  // NOOP
  }
}
app.addHook('onClose', async () => {
  if (writerForShutdown) await writerForShutdown.stop();
});
registerChat(app, {
  runTurnFn: opts.runTurnFn ?? (defaultRunTurn as RunTurnFn),
  buildTools: opts.buildTools ?? defaultBuildTools,
  chatLogger,
});
```

- [ ] **Step 2: Update `registerChat` signature to accept `chatLogger`**

In `src/chat/routes/chat.ts`, change the `deps` parameter:

```ts
export function registerChat(
  app: FastifyInstance,
  deps: { runTurnFn: RunTurnFn; buildTools: BuildToolsFn; chatLogger: Logger },
): void {
```

Add `import type { Logger } from '../log/types';` at the top.

- [ ] **Step 3: Run the existing tests to confirm nothing is broken yet (logger is a NOOP without env)**

Run: `npm run test:unit && npm run test:integration -- chat`
Expected: existing chat tests still pass. (No new behaviour wired in yet — that's Task 10.)

- [ ] **Step 4: Commit**

```bash
git add src/chat/server.ts src/chat/routes/chat.ts
git commit -m "feat(chat): plumb chatLogger through createChatApp"
```

---

## Task 10: Tee `emit` and synthesise `user_msg` inside the route

**Files:**
- Modify: `src/chat/routes/chat.ts`

- [ ] **Step 1: Update the route handler**

Replace the entire `app.post('/api/chat', ...)` handler with:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ChatRequest, SseEvent, ChatCtx } from '../types';
import type { Logger } from '../log/types';
import type { ConversationMeta } from '../log/types';
import { encodeSseEvent } from '../sse';

export type RunTurnFn = (req: ChatRequest, opts: any) => AsyncGenerator<SseEvent>;
export type BuildToolsFn = (ctx: ChatCtx) => any;

function uuidOr(headerVal: unknown): string {
  if (typeof headerVal === 'string' && /^[0-9a-f-]{36}$/i.test(headerVal)) return headerVal;
  return randomUUID();
}

export function registerChat(
  app: FastifyInstance,
  deps: { runTurnFn: RunTurnFn; buildTools: BuildToolsFn; chatLogger: Logger },
): void {
  app.post('/api/chat', async (req, reply) => {
    const body = req.body as ChatRequest;

    // Identity headers — mint server-side if absent.
    const conversationId = uuidOr(req.headers['x-ptv-conversation-id']);
    const clientId       = uuidOr(req.headers['x-ptv-client-id']);
    const meta: ConversationMeta = {
      conversationId,
      clientId,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      origin: body.origin,
    };

    // turn_seq = number of user messages seen so far minus 1
    // (client appends the new user message before POSTing).
    const userMsgCount = body.messages.filter((m) => m.role === 'user').length;
    const turnSeq = Math.max(0, userMsgCount - 1);
    const currentUserMsg = body.messages[body.messages.length - 1];

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
      'x-ptv-conversation-id': conversationId,
      'x-ptv-client-id': clientId,
    });

    // Log the user message before anything else.
    if (currentUserMsg && currentUserMsg.role === 'user') {
      deps.chatLogger.recordUserMsg(meta, turnSeq, currentUserMsg.content);
    }

    const rawEmit = (ev: SseEvent) => reply.raw.write(encodeSseEvent(ev));
    const tracedEmit = (ev: SseEvent) => {
      rawEmit(ev);
      deps.chatLogger.recordEvent(meta, turnSeq, ev);
    };

    const ctx: ChatCtx = { emit: tracedEmit, origin: body.origin };
    const tools = deps.buildTools(ctx);
    try {
      for await (const ev of deps.runTurnFn(body, { tools })) {
        tracedEmit(ev);
      }
    } catch (err: any) {
      tracedEmit({ type: 'error', message: err?.message ?? 'unknown' });
      tracedEmit({ type: 'turn_end' });
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}
```

- [ ] **Step 2: Run the existing chat-route integration tests**

Run: `npx vitest run tests/integration/chat/server.test.ts`
Expected: existing tests pass. The new echo headers `x-ptv-conversation-id` / `x-ptv-client-id` are present on responses; existing assertions don't check headers, so no failure.

- [ ] **Step 3: Commit**

```bash
git add src/chat/routes/chat.ts
git commit -m "feat(chat): tee emit and log user_msg + every SSE event"
```

---

## Task 11: Frontend — mint and send identity headers

**Files:**
- Modify: `web-chat/src/main.ts`
- Modify: `web-chat/src/sse.ts`
- Modify: `web-chat/src/state.ts`

- [ ] **Step 1: Update state.ts to track conversationId**

In `web-chat/src/state.ts`:

- Import nothing extra.
- The `initialState()` function doesn't need a `conversationId` — that lives at module scope in main.ts and is passed into `streamChat`. Skip this file unless tests force otherwise.

(No changes to state.ts.)

- [ ] **Step 2: Update `streamChat` to accept headers**

Replace the `streamChat` function signature and `fetch` call in `web-chat/src/sse.ts`:

```ts
export async function streamChat(
  body: unknown,
  onEvent: (ev: SseEvent) => void,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunks(buf);
    buf = rest;
    for (const e of events) onEvent(e);
  }
}
```

(Only the signature gets an extra param and the headers are spread; the body of the function is unchanged otherwise — keep the existing tail logic as-is.)

- [ ] **Step 3: Mint UUIDs in main.ts**

In `web-chat/src/main.ts`:

Near the top with the other `LS_*` consts:

```ts
const LS_CLIENT_ID = 'ptv-chat:client-id';
const LS_CONV_ID   = 'ptv-chat:conversation-id';

function ensureClientId(): string {
  let id = localStorage.getItem(LS_CLIENT_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_CLIENT_ID, id);
  }
  return id;
}
function ensureConversationId(): string {
  let id = localStorage.getItem(LS_CONV_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_CONV_ID, id);
  }
  return id;
}
function newConversationId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(LS_CONV_ID, id);
  return id;
}

const clientId = ensureClientId();
let conversationId = ensureConversationId();
```

Update the `send()` function — the `streamChat(...)` call now passes headers:

```ts
await streamChat(
  { messages: state.messages, origin },
  (ev) => {
    /* …existing switch unchanged… */
  },
  undefined,
  {
    'X-Ptv-Client-Id': clientId,
    'X-Ptv-Conversation-Id': conversationId,
  },
);
```

Update the New-chat handler near line 139 (`$newChat.addEventListener('click', …)`):

```ts
$newChat.addEventListener('click', () => {
  if (!confirm('Clear chat?')) return;
  localStorage.removeItem(LS_KEY);
  conversationId = newConversationId();
  map.clear();
  dispatch({ type: 'reset_chat' });
});
```

- [ ] **Step 4: Rebuild the web-chat bundle**

Run: `npm run build:chat-web`
Expected: `built web-chat → src/chat/static-assets/`.

- [ ] **Step 5: Commit**

```bash
git add web-chat/src/sse.ts web-chat/src/main.ts src/chat/static-assets/
git commit -m "feat(chat): mint client_id/conversation_id and pass as identity headers"
```

---

## Task 12: Integration test — full round-trip into Postgres (skipped without PTV_CHAT_PG_URL)

**Files:**
- Create: `tests/integration/chat/logging.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/chat/logging.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createChatApp } from '../../../src/chat/server';
import { createWriter } from '../../../src/chat/log/writer';
import { makeLogger } from '../../../src/chat/log/logger';

const PG = process.env.PTV_CHAT_PG_URL;

describe.skipIf(!PG)('Postgres logging integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG!, max: 2 });
    // Use a per-run id prefix to keep the test data isolated.
    await pool.query(`SELECT 1`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('writes user_msg, assistant_msg, tool_call, tool_result, turn_end', async () => {
    const fakeRunTurn = async function* () {
      yield { type: 'turn_start' };
      yield { type: 'tool_call',   id: 't1', name: 'plan', args: { from: 'A', to: 'B' } };
      yield { type: 'tool_result', id: 't1', ok: true, summary: '1 route' };
      yield { type: 'text_delta', delta: 'Here is ' };
      yield { type: 'text_delta', delta: 'your route.' };
      yield { type: 'turn_end' };
    };
    const writer = createWriter(pool, { intervalMs: 50, batchSize: 100 });
    const logger = makeLogger({ PTV_CHAT_PG_URL: PG } as any, writer);

    const app = createChatApp({
      logger: false,
      runTurnFn: fakeRunTurn as any,
      buildTools: () => ({}) as any,
      chatLogger: logger,
    });

    const conversationId = '99999999-9999-4999-8999-999999999990';
    const clientId       = '99999999-9999-4999-8999-999999999991';

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: {
        'x-ptv-conversation-id': conversationId,
        'x-ptv-client-id': clientId,
      },
      payload: { messages: [{ role: 'user', content: 'plan from A to B' }] },
    });
    expect(res.statusCode).toBe(200);
    await writer.flush();
    await app.close();

    const rows = await pool.query(
      'SELECT type, payload FROM events WHERE conversation_id = $1 ORDER BY event_seq',
      [conversationId],
    );
    const types = rows.rows.map((r) => r.type);
    expect(types).toEqual([
      'user_msg', 'tool_call', 'tool_result', 'assistant_msg', 'turn_end',
    ]);
    expect(rows.rows[3].payload.content).toBe('Here is your route.');

    // Clean up.
    await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
  });
});
```

- [ ] **Step 2: Run the test locally (skipped without env)**

Run: `npm run test:integration -- chat`
Expected: the new file is **skipped** (no `PTV_CHAT_PG_URL` on the laptop). Existing chat integration tests still pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/chat/logging.test.ts
git commit -m "test(chat): integration test for postgres logging round-trip"
```

---

## Task 13: Run the full suite & build

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean tsc + chat-web esbuild bundle, no errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all suites pass. Integration logging test is skipped.

- [ ] **Step 3: No commit — proceed to docs.**

---

## Task 14: Update `web-chat/README.md` (deployment + secrets)

**Files:**
- Modify: `web-chat/README.md`

- [ ] **Step 1: Append a "Conversation logging" section**

At the bottom of `web-chat/README.md`, append:

```markdown
## Conversation logging (production)

The deployed ptv-chat container writes every chat turn to the central Postgres
on totoro at `postgres.magpie-inconnu.ts.net:5433`, database `ptv_chat`. If
`PTV_CHAT_PG_URL` is unset the logger is a no-op (used for local dev and
tests).

### One-time setup on totoro

```bash
# 1. Create the database and the writer role.
sudo -u postgres psql -p 5433 <<'SQL'
CREATE DATABASE ptv_chat OWNER dewoller;
SQL
sudo -u postgres psql -p 5433 -d ptv_chat -f src/chat/log/schema.sql
# Then rotate the placeholder password in schema.sql to a real one and
# store it in SOPS-encrypted .env.sops at the service root (see below).
```

### Secrets — SOPS + age (per infra-shared/STANDARDS.md §4)

- Create `.env.sops` at the service root with one line:
  `PTV_CHAT_PG_URL=postgres://ptv_chat_writer:<pw>@postgres.magpie-inconnu.ts.net:5433/ptv_chat?sslmode=prefer`
- Encrypt with `sops-remediate.sh` against the standard age key
  (`/etc/age/keys.txt`). Commit the encrypted file.
- At deploy time, run `sops-decrypt-env ptv-chat` to produce
  `/run/secrets/ptv-chat/.env` (tmpfs).
- `docker-compose.chat.snippet.yml` consumes the decrypted env via
  `env_file: /run/secrets/ptv-chat/.env`.

### What is logged

| Column            | Source                                  |
|-------------------|-----------------------------------------|
| user_msg          | user's text                             |
| assistant_msg     | full assistant text per turn            |
| tool_call         | tool name + args                        |
| tool_result       | ok flag + result summary string         |
| path_add          | full itinerary (legs, geometry, totals) |
| turn_end / error  | structural events                       |
| ip, user_agent    | request metadata                        |
| origin_lat/lon    | browser geolocation when granted        |

There is no user-facing PII beyond IP. Retention is unlimited for now.
```

- [ ] **Step 2: Commit**

```bash
git add web-chat/README.md
git commit -m "docs(chat): postgres logging deployment + secrets via SOPS"
```

---

## Task 15: Update `docker-compose.chat.snippet.yml`

**Files:**
- Modify: `docker-compose.chat.snippet.yml`

- [ ] **Step 1: Add the `env_file:` pointer**

In the `ptv-chat` service block, after the existing `environment:` map, add:

```yaml
    env_file:
      # Decrypted at deploy time by `sops-decrypt-env ptv-chat`.
      # File contains PTV_CHAT_PG_URL=postgres://ptv_chat_writer:<pw>@postgres.magpie-inconnu.ts.net:5433/ptv_chat?sslmode=prefer
      - /run/secrets/ptv-chat/.env
```

(No other changes — networks already include `default` which can reach the host's tailscale IP `100.108.0.26:5433`. If a reachability problem surfaces, add `extra_hosts: ["host.docker.internal:host-gateway"]` and rewrite the URL host accordingly — but try the tailnet name first.)

- [ ] **Step 2: Commit**

```bash
git add docker-compose.chat.snippet.yml
git commit -m "deploy(chat): load PTV_CHAT_PG_URL from sops-decrypted env file"
```

---

## Self-Review

Run through the spec section by section against the plan:

- **Target database / role / grants** → Task 3 (schema.sql), README in Task 14.
- **Two-table schema with JSONB payload + indexes** → Task 3.
- **Event types & payload shapes table** → covered by logger (Task 8) and writer (Task 6), with tool_call/tool_result pairing through `payload->>'id'`.
- **`assistant_msg` assembled from text_delta** → Task 7 (test) + Task 8 (impl).
- **Architecture / tee inside route** → Tasks 9 & 10.
- **Modules `pool.ts`, `logger.ts`, `writer.ts`, `schema.sql`** → Tasks 2, 3, 4, 6, 8 (types.ts is an additional support file; spec OK with that).
- **Logger surface signature** → Task 2 + Task 8.
- **Route integration: identity headers, turnSeq calc, server-side mint, echo back** → Task 10.
- **Frontend: localStorage UUIDs, new-chat mints conversation_id, headers** → Task 11.
- **Write path: pool max 4, 200 ms / 50 batch, single TX, error swallowed, SIGTERM flush** → Tasks 4 & 6, with shutdown via `onClose` in Task 9 (Fastify's `onClose` runs on `SIGTERM`/`SIGINT`).
- **Security: SOPS + age, INSERT-only role, no public exposure** → Task 3 + Task 14 + Task 15.
- **Retention: none** → noted in README, no code.
- **Testing: unit logger/writer + integration round-trip** → Tasks 5, 7, 12.
- **E2E: no new tests** → Task 13 confirms suite still green.
- **Deployment steps 1-7** → Tasks 3, 14, 15 plus a manual psql apply step documented in README.

Placeholder scan: each step ships either runnable code or an exact shell command. No `TBD`, no "implement appropriate error handling" — error handling is explicit (`warn + drop batch`). Type names are consistent: `Logger`, `Writer`, `ConversationMeta`, `LoggedEvent` are defined once in Task 2 and referenced verbatim elsewhere.

Identified mismatches and fixed inline:
- Spec said `pool.ts` reads `/run/secrets/pg_password`; corrected to read the URL itself from a SOPS-decrypted env file. Plan reflects the corrected approach.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-ptv-chat-postgres-logging.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks here using executing-plans, batch with checkpoints.

Which approach?
