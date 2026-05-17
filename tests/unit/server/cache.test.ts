import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { Cache } from '../../../src/server/cache';

describe('Cache', () => {
  let cache: Cache;
  beforeEach(() => { cache = new Cache(new RedisMock() as any); });

  it('round-trips a key with TTL via setex', async () => {
    await cache.setex('plan', 'abc', 60, { hi: 1 });
    expect(await cache.get<{hi:number}>('plan', 'abc')).toEqual({ hi: 1 });
  });

  it('namespaces keys under ptv:', async () => {
    const client = new RedisMock();
    const c = new Cache(client as any);
    await c.setex('geocode', 'q', 10, 'v');
    expect(await client.get('ptv:geocode:q')).toBe(JSON.stringify('v'));
  });

  it('returns null when get target missing', async () => {
    expect(await cache.get('plan', 'missing')).toBeNull();
  });

  it('pass-through (returns null/no-throw) when client emits error', async () => {
    const bad = {
      get: async () => { throw new Error('redis down'); },
      setex: async () => { throw new Error('redis down'); },
    };
    const c = new Cache(bad as any);
    expect(await c.get('plan', 'k')).toBeNull();
    await expect(c.setex('plan', 'k', 60, {})).resolves.not.toThrow();
  });
});
