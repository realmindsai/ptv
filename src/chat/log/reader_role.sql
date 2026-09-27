-- src/chat/log/reader_role.sql
-- Read role for conversation logs (ptv-cjd). Idempotent; safe to re-run.
--
-- ptv_chat_writer is deliberately insert-only (see schema.sql): the
-- internet-facing ptv-chat container holds its credential, so it must not be
-- able to read back logged user messages and IPs. Reading is for operators:
-- `ptv chat-eval replay` and the read-back/cleanup in
-- tests/integration/chat/logging.test.ts, both via PTV_CHAT_PG_READ_URL.
--
-- Apply on totoro (CREATE ROLE needs a superuser or CREATEROLE):
--   sudo -u postgres psql -p 5433 -d ptv_chat -v ON_ERROR_STOP=1 -f reader_role.sql
-- Then set a password out of band and store it in .env.sops as
-- PTV_CHAT_PG_READ_URL — never in this file:
--   sudo -u postgres psql -p 5433 -d ptv_chat -c "\password ptv_chat_reader"

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ptv_chat_reader') THEN
    -- No password: the role cannot log in until one is set with \password.
    CREATE ROLE ptv_chat_reader LOGIN;
  END IF;
END$$;

GRANT CONNECT ON DATABASE ptv_chat TO ptv_chat_reader;
GRANT USAGE   ON SCHEMA public      TO ptv_chat_reader;
GRANT SELECT  ON conversations, events TO ptv_chat_reader;
-- The logging integration test deletes its fixture conversation afterwards.
-- events rows go with it via ON DELETE CASCADE, which runs as the table owner,
-- so no DELETE on events is needed.
GRANT DELETE  ON conversations TO ptv_chat_reader;
