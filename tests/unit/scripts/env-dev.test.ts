import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('scripts/env-dev.sh', () => {
  it('exports the four tailscale-routed URL vars and nothing else', () => {
    const script = resolve('scripts/env-dev.sh');
    const r = spawnSync('bash', [
      '-c',
      `source "${script}" && printf 'N=%s\nP=%s\nG=%s\nB=%s\nF=%s\n' "$NOMINATIM_URL" "$PHOTON_URL" "$GH_REST_URL" "$OSRM_AU_BICYCLE_URL" "$OSRM_AU_FOOT_URL"`,
    ], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const lines = Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=', 2)));
    expect(lines.N).toBe('http://totoro.magpie-inconnu.ts.net:8094');
    expect(lines.P).toBe('http://totoro.magpie-inconnu.ts.net:2322');
    expect(lines.G).toBe('http://totoro.magpie-inconnu.ts.net:8989/route');
    expect(lines.B).toBe('http://totoro.magpie-inconnu.ts.net:5002');
    expect(lines.F).toBe('http://totoro.magpie-inconnu.ts.net:5003');
  });

  it('is sourceable without errors under `set -e`', () => {
    const script = resolve('scripts/env-dev.sh');
    const r = spawnSync('bash', ['-c', `set -e && source "${script}" && echo OK`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('OK');
  });
});
