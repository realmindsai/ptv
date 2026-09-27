import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let proc: ChildProcessWithoutNullStreams;
const PORT = 18085;

beforeAll(async () => {
  proc = spawn('node', ['dist/index.js', 'serve', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'pipe',
    // Nothing listens on loopback :59999, so readiness must go red.
    env: { ...process.env, NOMINATIM_URL: 'http://127.0.0.1:59999' },
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve did not boot in 5s')), 5000);
    const onData = (b: Buffer) => {
      if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
  });
}, 10000);

afterAll(() => proc?.kill('SIGTERM'));

describe('ptv serve', () => {
  it('responds 200 on /healthz', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('responds 503 on /readyz when Nominatim is unreachable', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/readyz`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.nominatim).toEqual({
      ok: false, reason: 'fetch failed: connect ECONNREFUSED 127.0.0.1:59999 (ECONNREFUSED)',
    });
  });
});
