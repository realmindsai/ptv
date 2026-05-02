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
    expect(stderr.trim()).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 0 and prints valid JSON for departures', () => {
    const { stdout, stderr, code } = run(['departures', '1071', '0', '--max-results', '2']);
    expect(code).toBe(0);
    expect(stderr.trim()).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 0 and prints valid JSON for nearby', () => {
    const { stdout, stderr, code } = run(['nearby', '-37.8183', '144.9671', '--max-results', '3']);
    expect(code).toBe(0);
    expect(stderr.trim()).toBe('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('exits 0 and prints valid JSON for search', () => {
    const { stdout, stderr, code } = run(['search', 'flinders']);
    expect(code).toBe(0);
    expect(stderr.trim()).toBe('');
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

  it('--raw output contains departures array', () => {
    const { stdout, stderr, code } = run(['departures', '1071', '0', '--max-results', '1', '--raw']);
    expect(code).toBe(0);
    expect(stderr.trim()).toBe('');
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    expect(Array.isArray(raw.departures)).toBe(true);
  });

});
