import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const SKIP = !process.env.PTV_DEV_ID || !process.env.PTV_API_KEY || process.env.SKIP_LIVE_TESTS === '1';
const BIN = resolve(__dirname, '../../dist/index.js');
const ENV = { ...process.env };

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('node', [BIN, ...args], { env: ENV, encoding: 'utf8' });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 1,
  };
}

describe.skipIf(SKIP)('e2e: compiled CLI binary', () => {

  it('exits 0 and prints valid JSON for route-types', () => {
    const { stdout, stderr, code } = run(['route-types']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 0 and prints valid JSON for departures', () => {
    const { stdout, stderr, code } = run(['departures', '1071', '0', '--max-results', '2']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 0 and prints valid JSON for nearby', () => {
    const { stdout, stderr, code } = run(['nearby', '-37.8183', '144.9671', '--max-results', '3']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 0 and prints valid JSON for search', () => {
    const { stdout, stderr, code } = run(['search', 'flinders']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 1 and prints error to stderr when env vars missing', () => {
    const result = spawnSync('node', [BIN, 'route-types'], {
      env: { ...ENV, PTV_DEV_ID: '', PTV_API_KEY: '' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PTV_DEV_ID');
  });

  it('--raw output is a superset of trimmed output (departures)', () => {
    const trimmedResult = run(['departures', '1071', '0', '--max-results', '1']);
    const rawResult = run(['departures', '1071', '0', '--max-results', '1', '--raw']);
    expect(trimmedResult.code).toBe(0);
    expect(rawResult.code).toBe(0);
    const trimmed = JSON.parse(trimmedResult.stdout) as unknown[];
    const raw = JSON.parse(rawResult.stdout) as Record<string, unknown>;
    if (trimmed.length > 0) {
      const rawFirst = (raw.departures as Record<string, unknown>[])[0];
      const trimFirst = trimmed[0] as Record<string, unknown>;
      for (const key of Object.keys(trimFirst)) {
        expect(rawFirst).toHaveProperty(key);
      }
    }
  });

});
