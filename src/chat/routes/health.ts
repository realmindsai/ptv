import { describeError, type ReadinessCheck } from '../../server/routes/health';

// Same /healthz (liveness) + /readyz (readiness) pair as Atlas; the chat app
// only differs in which dependencies it checks.
export { registerHealth, type ReadinessCheck } from '../../server/routes/health';

const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter credential validity. GET /key returns the key's metadata and costs
 * nothing, so it catches a revoked key (ptv-bdu) without a paid completion.
 */
export function openRouterCheck(opts: {
  apiKey: string | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): ReadinessCheck {
  return {
    name: 'openrouter',
    async run() {
      if (!opts.apiKey) return { ok: false, reason: 'OPENROUTER_API_KEY is not set' };
      const f = opts.fetchImpl ?? fetch;
      const res = await f(`${opts.baseUrl ?? DEFAULT_OPENROUTER_BASE}/key`, {
        headers: { Authorization: `Bearer ${opts.apiKey}` },
      });
      return res.ok ? { ok: true } : { ok: false, reason: `openrouter /key returned ${res.status}` };
    },
  };
}

/**
 * GraphHopper reachability, probed from ptv-chat rather than from inside the
 * graphhopper container. Its own loopback healthcheck stayed green for 41h
 * while it sat on no docker network (ptv-519); this request takes the same
 * docker-DNS path the day-ride / max-path routes do, so it fails when they do.
 */
export function graphHopperCheck(routeUrl: string, fetchImpl: typeof fetch = fetch): ReadinessCheck {
  return {
    name: 'graphhopper',
    async run() {
      const res = await fetchImpl(new URL('/health', routeUrl).toString());
      return res.ok ? { ok: true } : { ok: false, reason: `graphhopper /health returned ${res.status}` };
    },
  };
}

// Mirrors the grants in src/chat/log/schema.sql — exactly what writer.ts needs.
// Asks the catalog, so it proves the role can write without writing a row.
const WRITER_PRIVILEGES_SQL = `SELECT
  has_table_privilege(current_user, 'public.events', 'INSERT')
  AND has_table_privilege(current_user, 'public.conversations', 'INSERT')
  AND has_column_privilege(current_user, 'public.conversations', 'last_event_at', 'UPDATE')
  AND has_sequence_privilege(current_user, 'public.events_id_seq', 'USAGE') AS ok`;

export interface Queryable {
  query(sql: string): Promise<{ rows: Array<{ ok: boolean }> }>;
}

/** `db` is the logging pool, or null when PTV_CHAT_PG_URL is unset. */
export function loggingCheck(db: Queryable | null): ReadinessCheck {
  return {
    name: 'logging',
    async run() {
      if (!db) return { ok: false, reason: 'PTV_CHAT_PG_URL is not set' };
      try {
        const { rows } = await db.query(WRITER_PRIVILEGES_SQL);
        return rows[0]?.ok
          ? { ok: true }
          : { ok: false, reason: 'logging role lacks a privilege the writer needs (see src/chat/log/schema.sql)' };
      } catch (err) {
        return { ok: false, reason: describeError(err) };
      }
    },
  };
}
