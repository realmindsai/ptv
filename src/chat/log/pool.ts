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
    keepAlive: true,
  });
  cached.on('error', (err) => {
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

export function _resetPoolForTests(): void {
  cached = undefined;
}
