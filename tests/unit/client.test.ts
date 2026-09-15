import { describe, it, expect, vi } from 'vitest';
import { sign, buildQueryString, MissingCredentialsError, ptv } from '../../src/client';

// Test vector derived from PTV API documentation key/input pair.
// https://stevage.github.io/PTV-API-doc/8-6-examples.html
// NOTE: the signature printed in that doc ('D5474F...') does not match what
// HMAC-SHA1 produces for its own listed key+input — verified independently
// with Python (hmac/hashlib) and Node (crypto). The correct computed value is
// used here instead.
const CANONICAL_KEY = '9c132d31-6a30-4cac-8d8b-8a1970834799';
const CANONICAL_INPUT = '/v2/mode/2/line/787/stops-for-line?devid=2';
const CANONICAL_SIG = '1FD3AC2EC7FE0EA39D7D5EF44A23B89AA7974B41';

describe('sign()', () => {
  it('matches the canonical PTV API test vector', () => {
    expect(sign(CANONICAL_INPUT, CANONICAL_KEY)).toBe(CANONICAL_SIG);
  });

  it('output is 40-character uppercase hex', () => {
    const result = sign(CANONICAL_INPUT, CANONICAL_KEY);
    expect(result).toHaveLength(40);
    expect(result).toMatch(/^[0-9A-F]{40}$/);
  });
});

describe('buildQueryString()', () => {
  it('returns empty string for no params', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('serialises a single string param', () => {
    expect(buildQueryString({ route_name: 'Glen Waverley' })).toBe('route_name=Glen%20Waverley');
  });

  it('serialises a single number param', () => {
    expect(buildQueryString({ max_results: 5 })).toBe('max_results=5');
  });

  it('expands array values into repeated params', () => {
    expect(buildQueryString({ route_types: [0, 1] })).toBe('route_types=0&route_types=1');
  });

  it('handles multiple params in insertion order', () => {
    expect(buildQueryString({ max_results: 3, route_types: [0] })).toBe('max_results=3&route_types=0');
  });
});

describe('MissingCredentialsError', () => {
  it('is thrown when env vars are absent', async () => {
    const savedId = process.env.PTV_DEV_ID;
    const savedKey = process.env.PTV_API_KEY;
    try {
      delete process.env.PTV_DEV_ID;
      delete process.env.PTV_API_KEY;
      await expect(ptv('/v3/route_types')).rejects.toThrow(MissingCredentialsError);
    } finally {
      if (savedId !== undefined) process.env.PTV_DEV_ID = savedId;
      else delete process.env.PTV_DEV_ID;
      if (savedKey !== undefined) process.env.PTV_API_KEY = savedKey;
      else delete process.env.PTV_API_KEY;
    }
  });
});

describe('ptv() error reporting', () => {
  const withCreds = async (fn: () => Promise<void>) => {
    const savedId = process.env.PTV_DEV_ID;
    const savedKey = process.env.PTV_API_KEY;
    process.env.PTV_DEV_ID = '2';
    process.env.PTV_API_KEY = CANONICAL_KEY;
    try { await fn(); } finally {
      if (savedId !== undefined) process.env.PTV_DEV_ID = savedId; else delete process.env.PTV_DEV_ID;
      if (savedKey !== undefined) process.env.PTV_API_KEY = savedKey; else delete process.env.PTV_API_KEY;
      vi.unstubAllGlobals();
    }
  };

  // PTV explains itself in the response body and we were throwing it away, so
  // "403" looked like a permissions or deprecation problem for as long as
  // nobody read the body. It is throttling, and it is per-endpoint.
  it('includes PTV’s own message when the request is throttled', async () => {
    await withCreds(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({
          message: 'Forbidden (403): Throttling limit reached for this service.',
          status: { version: '3.0', health: 1 },
        }),
        { status: 403 },
      )));
      await expect(ptv('/v3/pattern/run/950027/route_type/0'))
        .rejects.toThrow(/Throttling limit reached/);
    });
  });

  it('still reports the status code and path', async () => {
    await withCreds(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"nope"}', { status: 403 })));
      await expect(ptv('/v3/pattern/run/950027/route_type/0'))
        .rejects.toThrow(/403.*\/v3\/pattern\/run\/950027\/route_type\/0/);
    });
  });

  it('does not fall over when the error body is not JSON', async () => {
    await withCreds(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })));
      await expect(ptv('/v3/route_types')).rejects.toThrow(/502/);
    });
  });

  it('does not fall over when the error body is empty', async () => {
    await withCreds(async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
      await expect(ptv('/v3/route_types')).rejects.toThrow(/500/);
    });
  });
});
