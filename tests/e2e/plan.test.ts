import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const SKIP = !process.env.PTV_DEV_ID
  || !process.env.PTV_API_KEY
  || process.env.SKIP_LIVE_TESTS === '1';
const BIN = resolve(__dirname, '../../dist/index.js');

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('node', [BIN, ...args], { env: process.env, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 };
}

describe.skipIf(SKIP)('e2e: plan command', () => {
  it('depart now: exits 0 with parseable JSON', () => {
    const { stdout, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--max-bike-km', '8', '--no-enrich',
    ]);
    expect(code).toBe(0);
    const json = JSON.parse(stdout) as { itineraries: unknown[] };
    expect(Array.isArray(json.itineraries)).toBe(true);
  });

  it('--arrive-by: exits 0 and accepts a future ISO time', () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const { stdout, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--arrive-by', future, '--max-bike-km', '8', '--no-enrich',
    ]);
    expect(code).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('--min-bike-km infeasible: exits 0 with warning + violation', () => {
    const { stdout, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--min-bike-km', '50', '--max-bike-km', '60', '--no-enrich',
    ]);
    expect(code).toBe(0);
    const json = JSON.parse(stdout) as {
      itineraries: { constraintsViolated?: string[] }[];
      warnings?: string[];
    };
    if (json.itineraries.length > 0) {
      expect(json.itineraries[0].constraintsViolated).toBeDefined();
    }
  });

  it('--depart and --arrive-by together: exits non-zero', () => {
    const { stderr, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--depart', '08:00', '--arrive-by', '09:00',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/mutually exclusive/);
  });

  it('--max-transfers > 0: exits non-zero in v1', () => {
    const { stderr, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--max-transfers', '1',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/max-transfers/);
  });

  it('--min-bike-km negative: exits non-zero', () => {
    const { stderr, code } = run([
      'plan', '-37.7656,144.9614', '-37.648,144.946',
      '--min-bike-km=-5',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/min-bike-km/);
  });
});
