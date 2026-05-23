// tests/e2e/chat-eval-cli.test.ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const hasKey = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!hasKey)('ptv chat-eval CLI', () => {
  it('run --json emits one JSONL line per model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chateval-'));
    const dbPath = join(dir, 'eval.db');
    const res = spawnSync('node', [
      'dist/index.js', 'chat-eval', 'run',
      'Reply with exactly the word OK',
      '--models', 'google/gemini-2.5-flash',
      '--json',
      '--db', dbPath,
    ], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]);
    expect(row.model).toBe('google/gemini-2.5-flash');
    expect(typeof row.final_text).toBe('string');
    expect(existsSync(dbPath)).toBe(true);
  }, 60_000);

  it('suite produces an HTML file when --html given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chateval-'));
    const dbPath = join(dir, 'eval.db');
    const htmlPath = join(dir, 'report.html');
    const res = spawnSync('node', [
      'dist/index.js', 'chat-eval', 'suite',
      'tests/fixtures/eval-suite.yaml',
      '--models', 'google/gemini-2.5-flash',
      '--json',
      '--db', dbPath,
      '--html', htmlPath,
    ], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(existsSync(htmlPath)).toBe(true);
    const html = readFileSync(htmlPath, 'utf8');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('melbourne_bike_train_golden_v1');
  }, 5 * 60_000);
});
