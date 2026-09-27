import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

// The compiled chat server with both dependencies deliberately unconfigured:
// liveness must stay 200 while readiness names each broken dependency.
let proc: ChildProcessWithoutNullStreams;
const PORT = 18186;

beforeAll(async () => {
  proc = spawn('node', ['dist/index.js', 'chat-serve', '--port', String(PORT), '--host', '127.0.0.1'], {
    stdio: 'pipe',
    // Nothing listens on loopback :59999, so graphhopper is unreachable. (Not a low
    // port like 9: fetch refuses those as "bad port" without touching the network.)
    env: {
      ...process.env,
      OPENROUTER_API_KEY: '', PTV_CHAT_PG_URL: '', GH_REST_URL: 'http://127.0.0.1:59999/route', LOG_LEVEL: 'silent',
    },
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('chat-serve did not boot in 5s')), 5000);
    const poll = async () => {
      try {
        await fetch(`http://127.0.0.1:${PORT}/healthz`);
        clearTimeout(t);
        resolve();
      } catch {
        setTimeout(poll, 100);
      }
    };
    poll();
  });
}, 10000);

afterAll(() => proc?.kill('SIGTERM'));

describe('ptv chat-serve', () => {
  it('liveness /healthz is 200 with broken dependencies', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    expect(res.status).toBe(200);
  });

  it('readiness /readyz is 503 and names each broken dependency', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/readyz`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'not_ready',
      checks: {
        openrouter: { ok: false, reason: 'OPENROUTER_API_KEY is not set' },
        logging:    { ok: false, reason: 'PTV_CHAT_PG_URL is not set' },
        graphhopper: { ok: false, reason: 'fetch failed: connect ECONNREFUSED 127.0.0.1:59999 (ECONNREFUSED)' },
      },
    });
  });
});
