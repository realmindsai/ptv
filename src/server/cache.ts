import type { Redis } from 'ioredis';

export class Cache {
  constructor(private readonly client: Pick<Redis, 'get' | 'setex'>) {}

  private key(ns: string, k: string): string {
    return `ptv:${ns}:${k}`;
  }

  async get<T>(ns: string, k: string): Promise<T | null> {
    try {
      const raw = await this.client.get(this.key(ns, k));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  async setex(ns: string, k: string, ttlSeconds: number, value: unknown): Promise<void> {
    try {
      await this.client.setex(this.key(ns, k), ttlSeconds, JSON.stringify(value));
    } catch {
      /* graceful pass-through */
    }
  }
}

export function makeRedisClient(url: string | undefined): Redis | null {
  if (!url) return null;
  // Lazy import so cache.ts is importable in CLI-only paths without ioredis at runtime.
  const IORedis = require('ioredis');
  return new IORedis(url) as Redis;
}
