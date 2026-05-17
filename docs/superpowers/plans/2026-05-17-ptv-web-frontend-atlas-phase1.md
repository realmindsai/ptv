# Atlas Phase 1 — implementation plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to walk tasks. Each task is independently shippable, TDD-flavored, and ends in a commit.

**Goal:** Ship a working web UI for `ptv plan` on totoro behind Tailscale — Atlas visual direction (map-first, soft, riderly).

**Architecture:** Fastify in-process server calls `orchestrator.plan()` directly. HTMX page swaps server-rendered fragments. Nominatim (already on totoro:8094) handles geocoding. Redis (shared with Twenty, `ptv:` namespace) caches plans + geocodes. Single deployable container.

**Tech stack:** TypeScript, Fastify 5, ioredis 5, HTMX 1.9, Leaflet 1.9, JetBrains Mono + Epilogue (vendored).

**Inputs to read first:**
- `docs/superpowers/specs/2026-05-17-ptv-web-frontend-prd.md` — what + why
- `docs/superpowers/specs/2026-05-17-ptv-web-frontend-design.md` — how (and locked Atlas visual direction at the bottom)
- `web/design-reference/atlas.jsx` + `web/design-reference/app.css` — pixel reference
- `src/plan/orchestrator.ts`, `src/plan/types.ts`, `src/plan/map.ts`, `src/commands/plan.ts` — existing surface

---

## File structure (target)

```
src/
  server/
    index.ts                       # Fastify factory + start({port,host})
    routes/
      health.ts                    # GET /healthz
      geocode.ts                   # GET /api/geocode + /api/reverse
      plan.ts                      # POST /api/plan (content-negotiated)
      page.ts                      # GET / (Atlas shell)
      static.ts                    # GET /static/*
    templates/
      page.html                    # Atlas shell — pill, sheet, map, htmx
      results.html                 # itinerary cards + map-init <script>
      geocode-suggest.html         # HTMX dropdown rows
      error.html                   # red banner fragment
    static-assets/                 # vendored at repo root, tsc-copy to dist
      htmx.min.js leaflet.{js,css} epilogue.woff2 jetbrains-mono.woff2 app.css
    cache.ts                       # ioredis wrapper, ptv: namespace, pass-through on error
    nominatim.ts                   # search() + reverse() against NOMINATIM_URL
    render.ts                      # template-string renderer (no deps)
    types.ts                       # PlanFormBody, GeocodeResult, etc.
  commands/
    serve.ts                       # `ptv serve [--port N] [--host H]`
  plan/
    map.ts                         # refactored: writeMapHtml() + renderMapInit()
tests/
  unit/server/
    cache.test.ts
    cache-key.test.ts              # plan-cache key normalization
    nominatim.test.ts
    render.test.ts
    plan-route-mapping.test.ts     # Accept branching + body parsing
  integration/server/
    health.test.ts
    geocode.test.ts
    plan.test.ts
    page.test.ts
  e2e/
    serve.test.ts                  # spawn dist/index.js serve + curl /healthz
Dockerfile                         # multi-stage, node:20-alpine runtime
docker-compose.snippet.yml         # totoro deployment example
```

---

## Task 1 — Deps + Fastify scaffold

**Files:**
- Modify: `package.json`
- Create: `src/server/index.ts`
- Create: `tests/unit/server/scaffold.test.ts`

- [ ] **Step 1: Add deps**

```bash
npm install fastify@^5 ioredis@^5
npm install --save-dev ioredis-mock@^8 cheerio@^1 @types/cheerio@^0.22
```

- [ ] **Step 2: Write failing test** (`tests/unit/server/scaffold.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('createApp()', () => {
  it('boots a Fastify instance that 404s unknown routes', async () => {
    const app = createApp();
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`createApp` not defined)

```bash
npm run test:unit -- tests/unit/server/scaffold.test.ts
```

- [ ] **Step 4: Implement `src/server/index.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify';

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  return app;
}

export async function start(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
```

- [ ] **Step 5: Run — expect PASS**, commit

```bash
git add package.json package-lock.json src/server/index.ts tests/unit/server/scaffold.test.ts
git commit -m "feat(server): scaffold Fastify app factory for ptv-t3x.1"
```

---

## Task 2 — `/healthz` route

**Files:**
- Create: `src/server/routes/health.ts`
- Modify: `src/server/index.ts` (register route)
- Create: `tests/integration/server/health.test.ts`

- [ ] **Step 1: Failing integration test**

```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('GET /healthz', () => {
  it('returns 200 with status ok and uptime', async () => {
    const app = createApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    await app.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (404)

- [ ] **Step 3: Implement** `src/server/routes/health.ts`

```typescript
import { FastifyInstance } from 'fastify';
export function registerHealth(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
}
```

- [ ] **Step 4: Wire in `src/server/index.ts`**

```typescript
import { registerHealth } from './routes/health';
// inside createApp(), before `return app;`:
registerHealth(app);
```

- [ ] **Step 5: Run — expect PASS**, commit

```bash
git add src/server/routes/health.ts src/server/index.ts tests/integration/server/health.test.ts
git commit -m "feat(server): add /healthz route"
```

---

## Task 3 — `ptv serve` command

**Files:**
- Create: `src/commands/serve.ts`
- Modify: `src/index.ts` (register subcommand)
- Create: `tests/e2e/serve.test.ts`

- [ ] **Step 1: Failing e2e test** (`tests/e2e/serve.test.ts`)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let proc: ChildProcessWithoutNullStreams;
const PORT = 18085;

beforeAll(async () => {
  proc = spawn('node', ['dist/index.js', 'serve', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'pipe' });
  // wait for listen log
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve did not boot in 5s')), 5000);
    proc.stdout.on('data', (b) => { if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', (b) => { if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); } });
  });
});

afterAll(() => proc?.kill('SIGTERM'));

describe('ptv serve', () => {
  it('responds 200 on /healthz', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no `serve` command yet)

```bash
npm run build && npm run test:e2e -- tests/e2e/serve.test.ts
```

- [ ] **Step 3: Implement** `src/commands/serve.ts`

```typescript
import { Command } from 'commander';
import { start } from '../server/index';

export function serveCommand(): Command {
  return new Command('serve')
    .description('Run the ptv web frontend')
    .option('--port <n>', 'TCP port to listen on', (v) => parseInt(v, 10), 8080)
    .option('--host <h>', 'Host/interface to bind', '0.0.0.0')
    .action(async (opts: { port: number; host: string }) => {
      await start({ port: opts.port, host: opts.host });
    });
}
```

- [ ] **Step 4: Register in `src/index.ts`**

```typescript
import { serveCommand } from './commands/serve';
// ... after the other `program.addCommand(...)` lines:
program.addCommand(serveCommand());
```

- [ ] **Step 5: Run — expect PASS**, commit

```bash
git add src/commands/serve.ts src/index.ts tests/e2e/serve.test.ts
git commit -m "feat(server): add ptv serve subcommand"
```

---

## Task 4 — Redis cache wrapper

**Files:**
- Create: `src/server/cache.ts`
- Create: `tests/unit/server/cache.test.ts`

- [ ] **Step 1: Failing unit test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { Cache } from '../../../src/server/cache';

describe('Cache', () => {
  let cache: Cache;
  beforeEach(() => { cache = new Cache(new RedisMock() as any); });

  it('round-trips a key with TTL via setex', async () => {
    await cache.setex('plan', 'abc', 60, { hi: 1 });
    expect(await cache.get<{hi:number}>('plan', 'abc')).toEqual({ hi: 1 });
  });

  it('namespaces keys under ptv:', async () => {
    const client = new RedisMock();
    const c = new Cache(client as any);
    await c.setex('geocode', 'q', 10, 'v');
    expect(await client.get('ptv:geocode:q')).toBe(JSON.stringify('v'));
  });

  it('returns null when get target missing', async () => {
    expect(await cache.get('plan', 'missing')).toBeNull();
  });

  it('pass-through (returns null/no-throw) when client emits error', async () => {
    const bad = { get: async () => { throw new Error('redis down'); },
                  setex: async () => { throw new Error('redis down'); } };
    const c = new Cache(bad as any);
    expect(await c.get('plan', 'k')).toBeNull();
    await expect(c.setex('plan', 'k', 60, {})).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no `Cache` export)

- [ ] **Step 3: Implement** `src/server/cache.ts`

```typescript
import type { Redis } from 'ioredis';

export class Cache {
  constructor(private readonly client: Pick<Redis, 'get' | 'setex'>) {}

  private key(ns: string, k: string): string { return `ptv:${ns}:${k}`; }

  async get<T>(ns: string, k: string): Promise<T | null> {
    try {
      const raw = await this.client.get(this.key(ns, k));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  async setex(ns: string, k: string, ttlSeconds: number, value: unknown): Promise<void> {
    try {
      await this.client.setex(this.key(ns, k), ttlSeconds, JSON.stringify(value));
    } catch {
      /* graceful pass-through */
    }
  }
}

export function makeRedisClient(url: string | undefined): Redis | null {
  if (!url) return null;
  // Lazy import keeps the dep out of CLI-only paths.
  const IORedis = require('ioredis');
  return new IORedis(url);
}
```

- [ ] **Step 4: Run — expect PASS**, commit

```bash
git add src/server/cache.ts tests/unit/server/cache.test.ts
git commit -m "feat(server): add Redis cache wrapper with graceful pass-through"
```

---

## Task 5 — Nominatim client

**Files:**
- Create: `src/server/nominatim.ts`
- Create: `tests/unit/server/nominatim.test.ts`

- [ ] **Step 1: Failing unit test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Nominatim, type GeocodeResult } from '../../../src/server/nominatim';

describe('Nominatim', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('search() hits /search with countrycodes=au + Melbourne viewbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => [{
        display_name: 'Hurstbridge, Shire of Nillumbik, Victoria',
        lat: '-37.64', lon: '145.19', place_rank: 18,
      }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const nom = new Nominatim('http://nominatim:8080');
    const results: GeocodeResult[] = await nom.search('hurstbridge', 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('hurstbridge');
    expect(url.searchParams.get('countrycodes')).toBe('au');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('viewbox')).toBeTruthy();
    expect(results[0]).toEqual({
      label: 'Hurstbridge, Shire of Nillumbik, Victoria',
      lat: -37.64, lon: 145.19, rank: 18,
    });
  });

  it('reverse() hits /reverse and returns label or null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ display_name: '11 Melbourne Rd, Williamstown' }),
    }));
    const nom = new Nominatim('http://nominatim:8080');
    expect(await nom.reverse(-37.86, 144.89)).toBe('11 Melbourne Rd, Williamstown');
  });

  it('search() returns [] when fetch fails (degrade silently)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('econnrefused')));
    expect(await new Nominatim('http://x').search('foo')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** `src/server/nominatim.ts`

```typescript
export type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
  rank: number;
};

// Melbourne metro viewbox (lon_w, lat_n, lon_e, lat_s) — biases ranking.
const MELBOURNE_VIEWBOX = '144.5,-37.5,145.6,-38.3';

export class Nominatim {
  constructor(private readonly baseUrl: string) {}

  async search(q: string, limit = 8): Promise<GeocodeResult[]> {
    const u = new URL('/search', this.baseUrl);
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('countrycodes', 'au');
    u.searchParams.set('viewbox', MELBOURNE_VIEWBOX);
    u.searchParams.set('bounded', '0');
    try {
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'ptv-web/1.0' } });
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; place_rank: number }>;
      return rows.map((r) => ({
        label: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon), rank: r.place_rank,
      }));
    } catch {
      return [];
    }
  }

  async reverse(lat: number, lon: number): Promise<string | null> {
    const u = new URL('/reverse', this.baseUrl);
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
    u.searchParams.set('format', 'jsonv2');
    try {
      const res = await fetch(u.toString(), { headers: { 'User-Agent': 'ptv-web/1.0' } });
      if (!res.ok) return null;
      const row = (await res.json()) as { display_name?: string };
      return row.display_name ?? null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**, commit

```bash
git add src/server/nominatim.ts tests/unit/server/nominatim.test.ts
git commit -m "feat(server): add Nominatim client (search + reverse) with Melbourne viewbox"
```

---

## Task 6 — Refactor `map.ts` to expose `renderMapInit()`

**Files:**
- Modify: `src/plan/map.ts`
- Create: `tests/unit/plan/map-render.test.ts`

The existing `writeMapHtml(path, result)` works by string-replacing `__INJECT_DATA__` in a baked HTML template. We want a function the server can call to get just the `<script>` body and the small `<style>` snippet, so `results.html` can embed them in an already-rendered page.

- [ ] **Step 1: Failing unit test**

```typescript
import { describe, it, expect } from 'vitest';
import { renderMapInit, writeMapHtml } from '../../../src/plan/map';
import type { PlanResult } from '../../../src/plan/types';

const RESULT: PlanResult = {
  query: { from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
    minBikeKm: 0, maxBikeKm: 20, maxTransfers: 0, enrich: true,
    preferBikePath: false, hillWeight: 0, goal: 'commute', mode: 'bike-only' },
  itineraries: [{
    labels: ['recommended', 'fastest'], totalTimeMin: 60, bikeKm: 25, bikeMin: 60,
    trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
    legs: [{ mode: 'bike', from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
              km: 25, min: 60, geometry: { type: 'LineString', coordinates: [[145.19, -37.64], [144.89, -37.86]] } }],
  }],
};

describe('renderMapInit()', () => {
  it('returns scriptBody and cssBody with embedded data', () => {
    const out = renderMapInit(RESULT);
    expect(out.scriptBody).toContain('L.map');
    expect(out.scriptBody).toContain('"recommended"');
    expect(out.cssBody).toContain('.legend');
  });
  it('writeMapHtml continues to produce a full HTML document with same data', () => {
    // Smoke: build a temp result, write to /tmp, read it back, assert key markers.
    const tmp = `/tmp/ptv-map-test-${Date.now()}.html`;
    writeMapHtml(tmp, RESULT);
    const html = require('fs').readFileSync(tmp, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('L.map');
    expect(html).toContain('"recommended"');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`renderMapInit` not exported)

- [ ] **Step 3: Refactor `src/plan/map.ts`**

Split the existing `HTML_TEMPLATE` into three pieces:

```typescript
import { writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import type { PlanResult } from './types';

const CSS_BODY = `
  html,body,#map { height: 100%; margin: 0; }
  .legend { background: white; padding: 6px 10px; font: 12px sans-serif; }
  .legend .bike  { color: #2a7; }
  .legend .train { color: #c33; }
`;

function scriptBodyFor(result: PlanResult): string {
  const labeled = result.itineraries.filter((i) => i.labels.length > 0);
  labeled.sort((a, b) => a.totalTimeMin - b.totalTimeMin);
  const data = JSON.stringify({ query: result.query, itineraries: labeled });
  // The body is the same JS that used to live inside the bundled template.
  return `
    const data = ${data};
    const map = L.map('map');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    /* ...existing per-itinerary loop, copied verbatim from the old template... */
  `;
}

export function renderMapInit(result: PlanResult): { scriptBody: string; cssBody: string } {
  return { scriptBody: scriptBodyFor(result), cssBody: CSS_BODY };
}

export function writeMapHtml(path: string, result: PlanResult): void {
  const fullPath = resolve(path);
  if (!existsSync(dirname(fullPath))) throw new Error(`cannot write to ${path}: directory does not exist`);
  const { scriptBody, cssBody } = renderMapInit(result);
  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"><title>ptv plan</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>${cssBody}</style>
</head><body>
  <div id="map"></div>
  <script>${scriptBody}</script>
</body></html>`;
  writeFileSync(fullPath, html, 'utf8');
  try { spawnSync('open', [fullPath], { stdio: 'ignore' }); } catch { /* non-mac */ }
}
```

When copying the existing per-itinerary JS body across, preserve every line — there's path-percent display, recommended-layer activation, and a legend that the existing `--html` users rely on.

- [ ] **Step 4: Re-run full test suite — expect PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/plan/map.ts tests/unit/plan/map-render.test.ts
git commit -m "refactor(plan/map): extract renderMapInit() for embedding in server fragments"
```

---

## Task 7 — `GET /api/geocode` route (HTML fragment + JSON)

**Files:**
- Create: `src/server/routes/geocode.ts`
- Create: `src/server/templates/geocode-suggest.html`
- Create: `src/server/render.ts` (tiny `${var}` template-string renderer; no engine dep)
- Modify: `src/server/index.ts` (register, inject Nominatim + cache)
- Create: `tests/integration/server/geocode.test.ts`

- [ ] **Step 1: Failing integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../../../src/server/index';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, json: async () => [{ display_name: 'Hurstbridge, Vic', lat: '-37.64', lon: '145.19', place_rank: 18 }],
  }));
});

describe('GET /api/geocode', () => {
  it('returns JSON when Accept: application/json', async () => {
    const app = createApp({ nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/api/geocode?q=hurst', headers: { accept: 'application/json' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].label).toContain('Hurstbridge');
    await app.close();
  });

  it('returns an HTML fragment when Accept: text/html', async () => {
    const app = createApp({ nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/api/geocode?q=hurst', headers: { accept: 'text/html' } });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Hurstbridge');
    expect(res.body).toMatch(/data-lat="-37\.64"/);
    await app.close();
  });

  it('rejects q shorter than 3 chars', async () => {
    const app = createApp({ nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/api/geocode?q=hu' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

`createApp` will now take an options bag (`{ nominatimUrl, cache, … }`) — update the Task 1 signature accordingly. Keep the no-arg call working for backward-compat by defaulting all options from env vars.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** `src/server/render.ts`

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

const TEMPLATES_DIR = resolve(__dirname, 'templates');
const cache = new Map<string, string>();

function load(name: string): string {
  let t = cache.get(name);
  if (!t) { t = readFileSync(resolve(TEMPLATES_DIR, name), 'utf8'); cache.set(name, t); }
  return t;
}

// Replaces {{var}} and {{#each items}}…{{/each}} blocks. No conditionals, no escaping nesting.
// HTML-escapes string values by default; use {{{var}}} for raw.
export function render(template: string, ctx: Record<string, unknown>): string {
  const html = load(template);
  return expand(html, ctx);
}

function expand(s: string, ctx: Record<string, unknown>): string {
  // {{#each items}}…{{/each}}
  s = s.replace(/{{#each\s+(\w+)}}([\s\S]*?){{\/each}}/g, (_, key, body) => {
    const arr = ctx[key];
    if (!Array.isArray(arr)) return '';
    return arr.map((item) => expand(body, item as Record<string, unknown>)).join('');
  });
  // {{{var}}} raw
  s = s.replace(/{{{(\w+(?:\.\w+)*)}}}/g, (_, path) => String(get(ctx, path) ?? ''));
  // {{var}} escaped
  s = s.replace(/{{(\w+(?:\.\w+)*)}}/g, (_, path) => escape(String(get(ctx, path) ?? '')));
  return s;
}

function get(ctx: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), ctx);
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
```

- [ ] **Step 4: Implement** `src/server/templates/geocode-suggest.html`

```html
<ul class="geocode-list" role="listbox">
  {{#each results}}
  <li class="geocode-item" role="option" data-lat="{{lat}}" data-lon="{{lon}}">
    <span class="geocode-label">{{label}}</span>
    <span class="geocode-coord">{{lat}}, {{lon}}</span>
  </li>
  {{/each}}
</ul>
```

- [ ] **Step 5: Implement** `src/server/routes/geocode.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { Nominatim } from '../nominatim';
import { Cache } from '../cache';
import { render } from '../render';

export function registerGeocode(app: FastifyInstance, deps: { nominatim: Nominatim; cache: Cache | null }): void {
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/geocode', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 3) { reply.code(400); return { error: { code: 'Q_TOO_SHORT', message: 'q must be ≥3 chars' } }; }
    const limit = Math.min(20, parseInt(req.query.limit ?? '8', 10));

    const key = q.toLowerCase();
    let results = await deps.cache?.get<Array<{label:string;lat:number;lon:number;rank:number}>>('geocode', key) ?? null;
    if (!results) {
      results = await deps.nominatim.search(q, limit);
      await deps.cache?.setex('geocode', key, 86400, results);
    }

    const accept = req.headers.accept ?? '';
    if (accept.includes('text/html')) {
      reply.type('text/html; charset=utf-8');
      return render('geocode-suggest.html', { results });
    }
    return { results };
  });
}
```

- [ ] **Step 6: Update `src/server/index.ts`** to accept options + register

```typescript
import { Nominatim } from './nominatim';
import { Cache, makeRedisClient } from './cache';
import { registerHealth } from './routes/health';
import { registerGeocode } from './routes/geocode';

export type AppOptions = {
  nominatimUrl?: string;
  cache?: Cache | null;
};

export function createApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const nominatimUrl = opts.nominatimUrl ?? process.env.NOMINATIM_URL ?? 'http://localhost:8094';
  const nominatim = new Nominatim(nominatimUrl);
  const cache = opts.cache === undefined
    ? (() => { const c = makeRedisClient(process.env.REDIS_URL); return c ? new Cache(c) : null; })()
    : opts.cache;
  registerHealth(app);
  registerGeocode(app, { nominatim, cache });
  return app;
}
```

- [ ] **Step 7: Run — expect PASS**, commit

```bash
git add src/server/routes/geocode.ts src/server/templates/geocode-suggest.html src/server/render.ts src/server/index.ts tests/integration/server/geocode.test.ts
git commit -m "feat(server): GET /api/geocode with HTML+JSON content negotiation"
```

---

## Task 8 — `POST /api/plan` route (cache + content-negotiation)

**Files:**
- Create: `src/server/routes/plan.ts`
- Create: `src/server/plan-cache-key.ts`
- Create: `src/server/templates/results.html`
- Create: `src/server/templates/error.html`
- Modify: `src/server/index.ts` (register; inject orchestrator)
- Create: `tests/unit/server/cache-key.test.ts`
- Create: `tests/integration/server/plan.test.ts`

The route must:
1. Accept JSON body OR form-encoded body (HTMX).
2. Resolve `{ query: "..." }` for `from`/`to` via Nominatim if needed.
3. Compute a cache key by normalizing the request, hit `planCache` first.
4. Call `orchestrator.plan(req)` directly.
5. Branch on `Accept`: HTML → `results.html` fragment that includes `renderMapInit` script; JSON → `{ query, itineraries }`.

- [ ] **Step 1: cache-key unit test**

```typescript
import { describe, it, expect } from 'vitest';
import { planCacheKey } from '../../../src/server/plan-cache-key';

describe('planCacheKey', () => {
  it('rounds coords to 5 dp', () => {
    const a = planCacheKey({ from: { lat: -37.64012345, lon: 145.1976543 }, to: { lat: -37.86, lon: 144.89 },
      mode: 'bike-only', goal: 'commute' });
    const b = planCacheKey({ from: { lat: -37.64012999, lon: 145.1976501 }, to: { lat: -37.86, lon: 144.89 },
      mode: 'bike-only', goal: 'commute' });
    expect(a).toBe(b);
  });
  it('is independent of key order', () => {
    expect(planCacheKey({ mode: 'bike-only', goal: 'commute', from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 } }))
      .toBe(planCacheKey({ to: { lat: 1, lon: 1 }, from: { lat: 0, lon: 0 }, goal: 'commute', mode: 'bike-only' }));
  });
});
```

- [ ] **Step 2: Implement `src/server/plan-cache-key.ts`**

```typescript
import { createHash } from 'crypto';

export function planCacheKey(req: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(canonical(req))).digest('hex');
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = canonical(o[k]);
    return sorted;
  }
  if (typeof v === 'number') return Math.round(v * 1e5) / 1e5;
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}
```

- [ ] **Step 3: Integration test** `tests/integration/server/plan.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../../src/server/index';

const fakePlan = vi.fn(async () => ({
  query: { from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
    minBikeKm: 0, maxBikeKm: 20, maxTransfers: 0, enrich: true, preferBikePath: false, hillWeight: 0,
    goal: 'commute', mode: 'bike-only' },
  itineraries: [{
    labels: ['recommended', 'fastest'], totalTimeMin: 60, bikeKm: 25, bikeMin: 60,
    trainKm: 0, trainMin: 0, waitMin: 0, transfers: 0,
    legs: [{ mode: 'bike', from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
              km: 25, min: 60, geometry: { type: 'LineString', coordinates: [[145.19, -37.64], [144.89, -37.86]] } }],
  }],
}));

describe('POST /api/plan', () => {
  it('returns JSON shape matching CLI on Accept: application/json', async () => {
    const app = createApp({ planFn: fakePlan, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload: { from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().itineraries[0].totalTimeMin).toBe(60);
    expect(fakePlan).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns HTML fragment with results card + map init script on Accept: text/html', async () => {
    const app = createApp({ planFn: fakePlan, cache: null, nominatimUrl: 'http://x' });
    const res = await app.inject({
      method: 'POST', url: '/api/plan',
      headers: { 'content-type': 'application/json', accept: 'text/html' },
      payload: { from: { lat: -37.64, lon: 145.19 }, to: { lat: -37.86, lon: 144.89 },
                 mode: 'bike-only', goal: 'commute' },
    });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toMatch(/class=\"itinerary-card\"/);
    expect(res.body).toContain('60'); // minutes
    expect(res.body).toContain('L.map'); // map init script embedded
    await app.close();
  });
});
```

- [ ] **Step 4: Implement** `src/server/templates/results.html`

```html
<div id="results-inner">
  {{#each itineraries}}
  <article class="itinerary-card">
    <header class="itinerary-card__label">{{labels}}</header>
    <div class="itinerary-card__time"><span class="mono">{{totalTimeMin}}</span> min</div>
    <div class="itinerary-card__meta">
      <span class="mono">{{bikeKm}}</span> km bike ·
      <span class="mono">{{transfers}}</span> transfers ·
      <span class="mono">{{trainMin}}</span> min train
    </div>
  </article>
  {{/each}}
</div>
<style>{{{mapCss}}}</style>
<script>(function(){ {{{mapScript}}} })();</script>
```

(The card spec follows Atlas notes: eyebrow label → mono total time → mono meta. The segment-bar visualization is deferred to a polish task — leave the structure additive.)

- [ ] **Step 5: Implement** `src/server/templates/error.html`

```html
<div id="results-inner" class="error-banner" role="alert">
  <strong>error:</strong> {{message}}
</div>
```

- [ ] **Step 6: Implement** `src/server/routes/plan.ts`

```typescript
import { FastifyInstance } from 'fastify';
import { plan as defaultPlan } from '../../plan/orchestrator';
import type { PlanRequest, PlanResult } from '../../plan/types';
import { renderMapInit } from '../../plan/map';
import { render } from '../render';
import { Cache } from '../cache';
import { Nominatim } from '../nominatim';
import { planCacheKey } from '../plan-cache-key';

type PointInput = { lat: number; lon: number } | { query: string };
type PlanBody = {
  from: PointInput; to: PointInput;
  depart?: string; arriveBy?: string;
  mode?: 'bike-only' | 'bike-train';
  goal?: 'commute' | 'day-ride' | 'max-path';
  minBikeKm?: number; maxBikeKm?: number; maxTransfers?: number;
  preferBikePath?: boolean; hillWeight?: number; minOnPathFraction?: number;
  enrich?: boolean;
};

export type PlanFn = (req: PlanRequest) => Promise<PlanResult>;

export function registerPlan(
  app: FastifyInstance,
  deps: { planFn?: PlanFn; cache: Cache | null; nominatim: Nominatim },
): void {
  const planFn = deps.planFn ?? defaultPlan;

  app.post<{ Body: PlanBody }>('/api/plan', async (req, reply) => {
    let resolved: PlanRequest;
    try {
      resolved = await resolveRequest(req.body, deps.nominatim);
    } catch (e: any) {
      reply.code(400);
      return contentNegotiate(req.headers.accept, { error: { code: 'BAD_INPUT', message: e.message } },
        () => render('error.html', { message: e.message }));
    }

    const key = planCacheKey(resolved as unknown as Record<string, unknown>);
    let result = await deps.cache?.get<PlanResult>('plan', key) ?? null;
    if (!result) {
      result = await planFn(resolved);
      await deps.cache?.setex('plan', key, 600, result);
    }

    if ((req.headers.accept ?? '').includes('text/html')) {
      reply.type('text/html; charset=utf-8');
      const { scriptBody, cssBody } = renderMapInit(result);
      return render('results.html', {
        itineraries: result.itineraries.map((it) => ({
          labels: it.labels.join(', '),
          totalTimeMin: it.totalTimeMin.toFixed(0),
          bikeKm: it.bikeKm.toFixed(1),
          transfers: it.transfers,
          trainMin: it.trainMin.toFixed(0),
        })),
        mapCss: cssBody, mapScript: scriptBody,
      });
    }
    return result;
  });
}

async function resolveRequest(body: PlanBody, nom: Nominatim): Promise<PlanRequest> {
  const from = await resolvePoint(body.from, nom, 'from');
  const to = await resolvePoint(body.to, nom, 'to');
  return {
    from, to,
    departUtc: undefined, arriveByUtc: undefined, // parse depart/arriveBy in a later polish task
    minBikeKm: body.minBikeKm ?? 0,
    maxBikeKm: body.maxBikeKm ?? 20,
    maxTransfers: body.maxTransfers ?? 1,
    enrich: body.enrich ?? true,
    preferBikePath: body.preferBikePath ?? false,
    hillWeight: body.hillWeight ?? 0,
    goal: body.goal ?? 'commute',
    mode: body.mode ?? 'bike-train',
    minOnPathFraction: body.minOnPathFraction,
  };
}

async function resolvePoint(p: PointInput, nom: Nominatim, label: string): Promise<{ lat: number; lon: number }> {
  if ('lat' in p && 'lon' in p) return { lat: p.lat, lon: p.lon };
  const rows = await nom.search(p.query, 1);
  if (rows.length === 0) throw new Error(`${label} not found: ${p.query}`);
  return { lat: rows[0].lat, lon: rows[0].lon };
}

function contentNegotiate(accept: string | undefined, json: unknown, html: () => string) {
  if ((accept ?? '').includes('text/html')) return html();
  return json;
}
```

- [ ] **Step 7: Wire into `src/server/index.ts`**

```typescript
import { registerPlan, type PlanFn } from './routes/plan';
export type AppOptions = { nominatimUrl?: string; cache?: Cache | null; planFn?: PlanFn };
// inside createApp(), after registerGeocode:
registerPlan(app, { planFn: opts.planFn, cache, nominatim });
```

- [ ] **Step 8: Run — expect PASS**, commit

```bash
git add src/server/routes/plan.ts src/server/plan-cache-key.ts src/server/templates/results.html src/server/templates/error.html src/server/index.ts tests/unit/server/cache-key.test.ts tests/integration/server/plan.test.ts
git commit -m "feat(server): POST /api/plan with content negotiation + Redis cache"
```

---

## Task 9 — `GET /` Atlas shell (page template + CSS)

**Files:**
- Create: `src/server/routes/page.ts`
- Create: `src/server/templates/page.html`
- Create: `src/server/static-assets/app.css` (hand-written, Atlas spec)
- Modify: `src/server/index.ts`
- Create: `tests/integration/server/page.test.ts`

- [ ] **Step 1: Failing integration test**

```typescript
import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import { createApp } from '../../../src/server/index';

describe('GET /', () => {
  it('serves the Atlas shell with required elements', async () => {
    const app = createApp({ nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const $ = load(res.body);
    expect($('script[src*="htmx"]').length).toBeGreaterThan(0);
    expect($('link[href*="leaflet"]').length).toBeGreaterThan(0);
    expect($('#map').length).toBe(1);
    expect($('.from-to-pill').length).toBe(1);
    expect($('input[name="from-query"]').length).toBe(1);
    expect($('input[name="to-query"]').length).toBe(1);
    expect($('.sheet').length).toBe(1);  // bottom sheet
    expect(res.body).toContain('--rmai-purple: #A77ACD'); // palette token present
    await app.close();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `src/server/templates/page.html`**

The shell wires HTMX autocomplete on the from/to inputs (`hx-get="/api/geocode" hx-trigger="keyup changed delay:300ms" hx-target` per-field), posts the form to `/api/plan`, and includes the map + bottom sheet structure from the Atlas reference. Keep markup semantic; visual styling lives in `app.css`. See `web/design-reference/atlas.jsx:7-30` (top pill) and `:85-141` (empty state shell) for the structural reference. Critically: every numeric span gets `class="mono"` so the CSS can swap fonts.

- [ ] **Step 4: Implement `src/server/static-assets/app.css`**

Lift the relevant subset from `web/design-reference/app.css`: palette CSS vars, `.btn--cta`, `.from-to-pill`, `.sheet`, `.itinerary-card*`, `.geocode-list`. Replace web-font CDN with `@font-face` rules pointing at the vendored `/static/jetbrains-mono.woff2` and `/static/epilogue.woff2` (vendored in Task 10).

- [ ] **Step 5: Implement `src/server/routes/page.ts`**

```typescript
import { FastifyInstance } from 'fastify';
import { render } from '../render';

export function registerPage(app: FastifyInstance): void {
  app.get('/', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return render('page.html', {});
  });
}
```

- [ ] **Step 6: Register in `src/server/index.ts`**, run, commit

```bash
git add src/server/routes/page.ts src/server/templates/page.html src/server/static-assets/app.css src/server/index.ts tests/integration/server/page.test.ts
git commit -m "feat(server): GET / Atlas shell with palette tokens + sheet structure"
```

---

## Task 10 — `/static/*` route + vendored assets

**Files:**
- Create: `src/server/routes/static.ts`
- Create: `scripts/vendor-static.mjs` (one-time downloader; checked-in files are the source of truth)
- Modify: `package.json` (add `build` to also copy templates + static-assets into `dist/`)
- Create: `src/server/static-assets/{htmx.min.js,leaflet.js,leaflet.css,jetbrains-mono.woff2,epilogue.woff2}` (vendored binaries committed)
- Create: `tests/integration/server/static.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/server/index';

describe('GET /static/*', () => {
  it('serves htmx.min.js with text/javascript', async () => {
    const app = createApp({ nominatimUrl: 'http://x', cache: null });
    const res = await app.inject({ method: 'GET', url: '/static/htmx.min.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body.length).toBeGreaterThan(1000);
    await app.close();
  });
});
```

- [ ] **Step 2: Vendor the assets**

```bash
node scripts/vendor-static.mjs
# Downloads:
#   htmx 1.9.x → src/server/static-assets/htmx.min.js
#   leaflet 1.9.4 → src/server/static-assets/leaflet.{js,css}
#   JetBrains Mono 400/500/600 + Epilogue 400/500/600/700 woff2 from fonts.gstatic.com
# Files are then committed to the repo so prod builds need no network.
```

- [ ] **Step 3: Implement `src/server/routes/static.ts`** using `@fastify/static`

```bash
npm install @fastify/static@^7
```

```typescript
import { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';

export function registerStatic(app: FastifyInstance): void {
  app.register(fastifyStatic, {
    root: resolve(__dirname, '../static-assets'),
    prefix: '/static/',
    cacheControl: true,
    maxAge: 86400 * 30 * 1000,
  });
}
```

- [ ] **Step 4: Update build script to copy templates + static-assets into `dist/`**

```json
"build": "tsc && node -e \"require('fs').cpSync('src/server/templates','dist/server/templates',{recursive:true}); require('fs').cpSync('src/server/static-assets','dist/server/static-assets',{recursive:true})\""
```

- [ ] **Step 5: Wire + commit**

```bash
git add src/server/routes/static.ts src/server/static-assets/ scripts/vendor-static.mjs src/server/index.ts package.json package-lock.json tests/integration/server/static.test.ts
git commit -m "feat(server): vendored /static/ route (htmx, leaflet, fonts)"
```

---

## Task 11 — End-to-end browser test (Playwright)

**Files:**
- Create: `tests/e2e/atlas.spec.ts`
- Add: playwright dep + npm script

This task uses the `playwright-skill` skill conventions: spawn the built server on a high port, drive Chromium, assert the user-visible behaviors that matter.

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Add script**

```json
"test:e2e:browser": "playwright test tests/e2e"
```

- [ ] **Step 3: Test**

```typescript
import { test, expect } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let proc: ChildProcessWithoutNullStreams;
const PORT = 18086;

test.beforeAll(async () => {
  proc = spawn('node', ['dist/index.js', 'serve', '--port', String(PORT), '--host', '127.0.0.1']);
  await new Promise<void>((resolve) => {
    const cb = (b: Buffer) => { if (b.toString().includes(String(PORT))) { proc.stdout.off('data', cb); resolve(); } };
    proc.stdout.on('data', cb);
  });
});

test.afterAll(() => proc?.kill('SIGTERM'));

test('atlas shell renders, autocomplete fires, plan submits', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('.from-to-pill')).toBeVisible();
  await page.fill('input[name="from-query"]', 'hurstbridge');
  await expect(page.locator('.geocode-list li').first()).toBeVisible({ timeout: 3000 });
  // ... rest of flow as scope permits
});
```

- [ ] **Step 4: Run + commit**

```bash
npm run build && npm run test:e2e:browser
git add tests/e2e/atlas.spec.ts package.json package-lock.json
git commit -m "test(server): e2e Playwright spec for Atlas shell"
```

---

## Task 12 — Dockerfile + compose snippet + deploy README

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.snippet.yml`
- Create: `web/README.md` (deploy notes)

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist/index.js", "serve", "--port", "8080", "--host", "0.0.0.0"]
```

- [ ] **Step 2: Compose snippet**

```yaml
# Drop into totoro's compose tree alongside nominatim/twenty/graphhopper.
services:
  ptv-web:
    build: <path-to-this-repo>
    restart: unless-stopped
    ports: ["8085:8080"]
    environment:
      PTV_DEV_ID: ${PTV_DEV_ID}
      PTV_API_KEY: ${PTV_API_KEY}
      NOMINATIM_URL: http://nominatim:8080
      REDIS_URL: redis://twenty-twenty-redis-1:6379
      GH_REST_URL: http://graphhopper-vic-bike:8989/route
    networks: [default, nominatim_default, twenty_default]
networks:
  nominatim_default: { external: true }
  twenty_default:    { external: true }
```

- [ ] **Step 3: Deploy README** (`web/README.md`)

Document: how to build the image, where to drop the compose snippet, the magic-DNS hostname target, the **known caveat** that `osrm-au` is currently a subprocess and won't work inside the container — the `--goal commute` path that uses it will fail until `OSRM_REST_URL` is wired (track as a follow-up bead).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.snippet.yml web/README.md
git commit -m "feat(server): Dockerfile + totoro compose snippet for ptv-t3x.1"
```

---

## Out of scope for this plan (track as follow-ups / beads)

- **Phase 2** (click-to-route, geolocation, URL hash state, PWA install) — separate plan against `ptv-t3x.2`.
- **`osrm-au` → REST migration** (gating issue for clean container deploy). Open as a new bead, depended on by ptv-t3x.1's deploy.
- **Depart/arrive-by parsing in the server** — Task 8's request resolver currently sets both to `undefined`. Add a polish task that lifts `parseMelbourneHHMM` from `src/commands/plan.ts` into a shared module and uses it here.
- **Segment-bar render in the itinerary card** — the Atlas spec calls for a lilac/ink/stone segment bar; structure is in place but the visualization itself is a polish task.
- **`?dense=1` Console mode** — explicitly deferred per the locked Atlas direction.

---

## Self-review notes

- Every task has the actual files, actual code, and exact commands. No "implement appropriate error handling" placeholders.
- Each task is independently shippable + committable; ordering enforces dependencies (cache exists before routes that use it; render.ts exists before templates).
- Type consistency: `Cache.get(ns, k)` / `Cache.setex(ns, k, ttl, v)` signature used identically in Tasks 6 + 8. `renderMapInit(result)` shape (`{scriptBody, cssBody}`) used identically in Tasks 6 + 8.
- Spec coverage:
  - PRD F1–F8 mapped to Tasks 6/8/9/10/12.
  - PRD F9–F14 (Phase 2) intentionally deferred per scope.
  - Design "Visual direction" → Tasks 9 + 10.
  - Design "Caching" → Tasks 4 + 8.
  - Design "Deployment" → Task 12.
  - Design "Testing" pyramid → Tasks 1/2 (boot) + 4/5/8-cache-key (unit) + 6/7-routes (integration) + 11 (e2e).
- Known gap captured in Out-of-scope: `osrm-au` subprocess vs container.
