import { FastifyInstance } from 'fastify';

// Liveness vs readiness (ptv-t7q). /healthz proves the process is up — it is
// what the Docker HEALTHCHECK polls, so it must never depend on anything
// outside the process. /readyz proves the service can do its job: each check
// touches one real dependency, cheaply and under a short timeout. Readiness is
// what should have gone red when a dependency broke while /healthz stayed green.

export type CheckResult = { ok: true } | { ok: false; reason: string };

export interface ReadinessCheck {
  name: string;
  run(): Promise<CheckResult>;
}

export interface ReadinessOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * `message (SQLSTATE xxxxx)` / `message (ECONNREFUSED)` / `message`. Follows
 * `cause`, because Node's fetch reports every network failure as a bare
 * "fetch failed" and keeps the reason (ENOTFOUND, ECONNREFUSED) on its cause.
 */
export function describeError(err: unknown): string {
  const e = err as { message?: string; code?: unknown; cause?: unknown };
  let msg = e?.message ?? String(err);
  if (typeof e?.code === 'string') {
    msg = /^[0-9A-Z]{5}$/.test(e.code) ? `${msg} (SQLSTATE ${e.code})` : `${msg} (${e.code})`;
  }
  return e?.cause instanceof Error ? `${msg}: ${describeError(e.cause)}` : msg;
}

async function runWithTimeout(check: ReadinessCheck, timeoutMs: number): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: `timed out after ${timeoutMs}ms` }), timeoutMs);
  });
  try {
    return await Promise.race([
      check.run().catch((err): CheckResult => ({ ok: false, reason: describeError(err) })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerReadiness(
  app: FastifyInstance,
  checks: ReadinessCheck[],
  opts: ReadinessOptions = {},
): void {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  app.get('/readyz', async (_req, reply) => {
    const results = await Promise.all(checks.map((c) => runWithTimeout(c, timeoutMs)));
    const byName: Record<string, CheckResult> = {};
    checks.forEach((c, i) => { byName[c.name] = results[i]; });
    const ready = results.every((r) => r.ok);
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', checks: byName };
  });
}

/** Nominatim's own /status endpoint: 200 "OK" when its database is usable. */
export function nominatimCheck(baseUrl: string): ReadinessCheck {
  return {
    name: 'nominatim',
    async run() {
      const res = await fetch(new URL('/status', baseUrl).toString(), {
        headers: { 'User-Agent': 'ptv-web/1.0' },
      });
      return res.ok ? { ok: true } : { ok: false, reason: `nominatim /status returned ${res.status}` };
    },
  };
}

export function registerHealth(
  app: FastifyInstance,
  checks: ReadinessCheck[] = [],
  opts: ReadinessOptions = {},
): void {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
  registerReadiness(app, checks, opts);
}
