# ptv-chat — Postgres conversation logging

Status: draft
Date: 2026-05-21
Scope: ptv-chat only (ptv-web is out of scope)

## Goal

Persist every chat turn — user query, assistant response, every tool call
(args + result), and structural events (`path_add`, `error`, `turn_end`) — to
the central Postgres instance on totoro, so we can later replay sessions,
debug regressions, and analyse usage patterns. Chat history today lives only
in the browser's localStorage; nothing reaches the server's filesystem or DB.

Non-goal: building an admin UI to browse the log. SQL access is enough for now.

## Target database

- Host: `postgres.magpie-inconnu.ts.net:5433` (PostgreSQL 17 on totoro ZFS).
- New database: `ptv_chat`, owned by `dewoller`.
- New role: `ptv_chat_writer` (LOGIN, INSERT only on the two tables below,
  plus `UPDATE (last_event_at)` on `conversations`).
- Connection over the tailnet, `sslmode=prefer`.
- Password managed per `infra-shared/STANDARDS.md` §4: encrypted with SOPS
  (age key) in `.env.sops` at the service root, decrypted at startup to
  `/run/secrets/ptv-chat/.env` (tmpfs) by `sops-decrypt-env ptv-chat`, and
  loaded via `EnvironmentFile=` (systemd) or `env_file:` (compose).

Local dev: if `PTV_CHAT_PG_URL` is unset, the logger is a no-op. Tests and
laptop runs work without a postgres reachable.

## Schema

Two tables. `events` is append-only; `conversations` is upserted on every
write so `last_event_at` stays fresh.

```sql
CREATE TABLE conversations (
  id              UUID PRIMARY KEY,            -- client-minted
  client_id       UUID NOT NULL,               -- localStorage UUID, groups sessions per browser
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip              INET,
  user_agent      TEXT,
  origin_lat      DOUBLE PRECISION,            -- first known origin (geolocation)
  origin_lon      DOUBLE PRECISION
);
CREATE INDEX conversations_client_id_started_at
  ON conversations (client_id, started_at DESC);

CREATE TABLE events (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_seq        INTEGER NOT NULL,            -- 0-based, increments on each user_msg
  event_seq       INTEGER NOT NULL,            -- 0-based within the conversation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL
);
CREATE INDEX events_conversation_seq ON events (conversation_id, event_seq);
CREATE INDEX events_type_created     ON events (type, created_at DESC);
CREATE INDEX events_payload_gin      ON events USING GIN (payload jsonb_path_ops);
```

### Event types and payload shapes

| type            | payload (JSON)                                          | source                          |
| --------------- | ------------------------------------------------------- | ------------------------------- |
| `user_msg`      | `{content}`                                             | synthesized in the route before agent runs |
| `assistant_msg` | `{content}`                                             | assembled from `text_delta` stream at `turn_end` |
| `tool_call`     | `{id, name, args}`                                      | SSE `tool_call`                 |
| `tool_result`   | `{id, ok, summary}`                                     | SSE `tool_result`               |
| `path_add`      | `{pathId, label, color, itinerary}`                     | SSE `path_add`                  |
| `turn_end`      | `{}`                                                    | SSE `turn_end`                  |
| `error`         | `{message}`                                             | SSE `error`                     |

`tool_call` and `tool_result` join on `payload->>'id'`. We deliberately do not
write per-delta rows; the assembled `assistant_msg` is one row per turn.

### Permissions

```sql
GRANT CONNECT ON DATABASE ptv_chat TO ptv_chat_writer;
GRANT USAGE   ON SCHEMA public      TO ptv_chat_writer;
GRANT INSERT  ON conversations, events TO ptv_chat_writer;
GRANT UPDATE (last_event_at) ON conversations TO ptv_chat_writer;
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO ptv_chat_writer;
```

Reads stay on `dewoller` (manual SQL / analysis). No SELECT on writer role,
limiting blast radius if the container secret leaks.

## Architecture

```
Browser (web-chat)
  │  POST /api/chat
  │  headers: X-Ptv-Client-Id, X-Ptv-Conversation-Id
  ▼
src/chat/routes/chat.ts
  │  tee emit:
  │    ├─► reply.raw.write(encodeSseEvent(ev))   ← unchanged: client
  │    └─► logger.recordEvent(meta, turnSeq, ev) ← new
  ▼
src/chat/log/logger.ts
  │  push to in-memory queue, return immediately (non-blocking)
  ▼
src/chat/log/writer.ts  (singleton, started at server boot)
  │  drain loop: every 200 ms OR queue ≥ 50 items
  │  one TX per drain: upsert conversation, INSERT events
  ▼
postgres.magpie-inconnu.ts.net:5433 / ptv_chat
```

## Modules

```
src/chat/log/
  pool.ts      # pg.Pool (max 4); reads PTV_CHAT_PG_URL (loaded by SOPS-decrypted .env)
  logger.ts    # public surface: Logger interface + makeLogger()
  writer.ts    # queue + drain loop + batched INSERT
  schema.sql   # checked-in schema; applied via psql once
```

### Logger surface

```ts
export interface ConversationMeta {
  conversationId: string;
  clientId: string;
  ip?: string;
  userAgent?: string;
  origin?: { lat: number; lon: number };
}

export interface Logger {
  recordUserMsg(meta: ConversationMeta, turnSeq: number, content: string): void;
  recordEvent(meta: ConversationMeta, turnSeq: number, ev: SseEvent): void;
}

export function makeLogger(env = process.env): Logger;  // no-op if env unset
```

### Route integration (`src/chat/routes/chat.ts`)

- Read `X-Ptv-Conversation-Id` and `X-Ptv-Client-Id`. If absent, mint UUIDs
  server-side and echo them back in response headers.
- Compute `turnSeq` from request:
  `body.messages.filter(m => m.role === 'user').length - 1`
  (the new user message is appended client-side before POST).
- Synthesize `user_msg` event and log it before `runTurn` starts.
- Accumulate `text_delta` content into a string; on `turn_end`, log one
  assembled `assistant_msg` event.
- Tee:
  ```ts
  const tracedEmit = (ev: SseEvent) => {
    rawEmit(ev);
    logger.recordEvent(meta, turnSeq, ev);
  };
  ```

### Frontend (`web-chat/src/main.ts`, `chat.ts`)

- On first load, mint `client_id` (uuid v4) into `localStorage` (`ptv-chat:client-id`)
  if not present.
- On each "New chat" button, mint a new `conversation_id` (uuid v4) and stash
  in app state. Persist the current `conversation_id` to localStorage so
  reloads keep the same id until the user explicitly resets.
- Pass both as headers on `POST /api/chat`.

## Write path

`pool.ts`:
- One module-level `pg.Pool` (`max: 4`, `idleTimeoutMillis: 30000`).
- Lazy init: first call to `getPool()`. Returns `null` if `PTV_CHAT_PG_URL` unset.

`writer.ts`:
- Queue: `Array<{ meta: ConversationMeta, turnSeq: number, type: string, payload: unknown, conversationSeen: boolean }>`.
- Drain trigger: setInterval 200 ms OR queue length ≥ 50.
- One transaction per drain:
  1. `INSERT INTO conversations (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET last_event_at = excluded.last_event_at` — one row per unique conversation in the batch.
  2. Bulk `INSERT INTO events (conversation_id, turn_seq, event_seq, type, payload) VALUES (...), (...), ...` — `event_seq` is computed at enqueue time from a per-conversation in-memory counter.
- On any pool error: log at `warn`, drop the batch, continue. Never throw into the request path.
- On `SIGTERM`: flush queue once then resolve. Server boot wires `process.on('SIGTERM', () => writer.flush())`.

## Security

- Role separation: writer can INSERT only, not SELECT. Analysis happens via
  the `dewoller` superuser from totoro itself.
- Secret management follows `infra-shared/STANDARDS.md` §4 (SOPS + age):
  - Encrypted `.env.sops` at the service root (committed to git as ciphertext).
  - Decrypted at startup to `/run/secrets/ptv-chat/.env` (tmpfs) via
    `sops-decrypt-env ptv-chat` (run as `ExecStartPre=+...` for systemd
    services, or as a pre-start step for the docker-compose deploy path).
  - Age key paths per standards: `/home/dewoller/.config/sops/age/keys.txt`
    (runtime decrypt) and `/etc/age/keys.txt` (used by `sops-remediate.sh`
    when editing/re-encrypting secrets).
  - SOPS config: `/tank/services/active_services/.sops.yaml`.
  - The `.env` contains `PTV_CHAT_PG_URL` (full URL with password) so the
    application code never sees a separate password file.
- `pg_hba.conf` already restricts 5433 to localhost + tailnet — no public
  exposure.
- IP and user-agent logged for debugging. No other PII. Documented in
  `web-chat/README.md` so anyone deploying knows what's captured.

## Retention

None. Volume is tiny (a chat turn is a few KB), so we keep forever. A later
cron job can add pruning if the table ever grows uncomfortably; out of scope
for this spec.

## Testing

- **Unit `tests/unit/chat/logger.test.ts`** — env-unset returns no-op;
  text_delta accumulation flushes a single `assistant_msg` at turn_end;
  tool_call/tool_result remain separate events with matching `id`.
- **Unit `tests/unit/chat/writer.test.ts`** — fake `pg.Pool`; one TX per
  drain; ON CONFLICT upsert exercised; pool error swallowed and warned.
- **Integration `tests/integration/chat/logging.test.ts`** — connects to
  `PTV_CHAT_PG_URL` if set (skipped otherwise), creates a temp schema,
  exercises one full conversation through `runTurn` (with stubbed Anthropic
  driver), asserts conversations + events rows match expected types and
  ordering.
- **E2E** — no new tests. Existing playwright suite should pass unchanged.

## Deployment steps

1. On totoro: `sudo -u postgres psql -p 5433 -c "CREATE DATABASE ptv_chat OWNER dewoller;"`
2. Apply `src/chat/log/schema.sql`.
3. Create `ptv_chat_writer` role + grants (also in schema.sql).
4. Create `.env.sops` at service root with `PTV_CHAT_PG_URL=postgres://ptv_chat_writer:<pw>@postgres.magpie-inconnu.ts.net:5433/ptv_chat?sslmode=prefer`, encrypt with `sops-remediate.sh` against the standard age key (`/etc/age/keys.txt`). Commit the encrypted file.
5. Update `docker-compose.chat.snippet.yml` to source secrets per STANDARDS.md §4:
   - Run `sops-decrypt-env ptv-chat` before `docker compose up` (writes `/run/secrets/ptv-chat/.env`).
   - Add `env_file: /run/secrets/ptv-chat/.env` to the `ptv-chat` service.
   - No plaintext secrets in the compose file or in git.
6. Build + deploy new `ptv-chat:latest`, restart container.
7. Verify: hit the chat once, then `psql -h postgres.magpie-inconnu.ts.net -p 5433 -d ptv_chat -c "SELECT COUNT(*) FROM events;"`.

## Out of scope

- Admin UI for browsing logs.
- Conversation export / GDPR-style deletion endpoint.
- Spinner UI for the processing stage (tracked as `bd` issue `ptv-czi`).
- ptv-web logging (this spec is ptv-chat only).
