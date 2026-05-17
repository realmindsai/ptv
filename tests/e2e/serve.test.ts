import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let proc: ChildProcessWithoutNullStreams;
const PORT = 18085;

beforeAll(async () => {
  proc = spawn('node', ['dist/index.js', 'serve', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'pipe' });
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
});
