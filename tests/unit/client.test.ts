import { describe, it, expect } from 'vitest';
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
