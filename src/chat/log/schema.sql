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
-- Needed for the ON CONFLICT (id) DO UPDATE SET last_event_at = excluded.last_event_at
-- upsert clause: PG requires SELECT on the columns referenced in the UPDATE.
GRANT SELECT (id, last_event_at) ON conversations TO ptv_chat_writer;
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO ptv_chat_writer;
