# Expose routing services via Tailscale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Photon and GraphHopper reachable from any device on the user's tailnet (laptop, phone, …) at `http://totoro.magpie-inconnu.ts.net:<port>`, alongside Nominatim and OSRM-au which already are. Then wire a one-source dev-env override in this repo so `ptv chat-eval` (and any future scripted use of the planner) Just Works from a laptop without ssh-tunneling.

**Architecture:** No new infra. Tailscale is already on totoro; nominatim (8094) and osrm-au-{bicycle,foot,car} (5002/5003/5001) are already bound to `0.0.0.0:<port>` so any tailnet member can reach them via totoro's MagicDNS name. Photon and GraphHopper just need a `ports:` entry added to their compose files. On the dev side, add a `scripts/env-dev.sh` that exports tailscale-routed URLs after the standard `.env` decrypt — production (the ptv-chat docker container) keeps using docker-DNS hostnames via its compose `environment:` block, which always wins over `env_file`. No security surface is changed: tailnet membership = current trust model.

**Tech Stack:** Docker Compose, Tailscale MagicDNS, bash. No new TypeScript or npm deps.

**Spec source:** This plan is its own spec — a small infra change driven directly by the user request: "I want those services to be public. […] They have to be useful. They're not useful if they're locked away in a container."

**Out of scope:**
- Public-internet exposure via Cloudflare or `tailscale funnel`. The user explicitly picked tailscale-only.
- Auth / rate-limiting (not needed for tailnet-only).
- Per-service tailscale sidecar containers (overkill for 2 ports).
- Changes to the production ptv-chat container's URL wiring (its compose `environment:` block stays on docker-DNS hostnames; the tailscale URLs are an additional reachability path, not a replacement).

---

## Reference: current state (verified 2026-05-24)

| Service | Container port | Host bind on totoro | Tailscale-reachable today | Compose file (on totoro) |
|---|---|---|---|---|
| nominatim | 8080 | `0.0.0.0:8094` | ✓ | `/tank/services/active_services/nominatim/docker-compose.yml` |
| photon | 2322 | not bound | ✗ | `/home/dewoller/docker/photon/docker-compose.yml` |
| graphhopper-vic-bike | 8989 | not bound | ✗ | `/tank/services/docker/graphhopper/docker-compose.yml` |
| osrm-au-bicycle | 5000 | `0.0.0.0:5002` | ✓ | `/tank/services/active_services/osrm-au/docker-compose.yml` |
| osrm-au-foot | 5000 | `0.0.0.0:5003` | ✓ | same as above |
| osrm-au-car | 5000 | `0.0.0.0:5001` | ✓ | same as above |

Totoro's tailscale MagicDNS name: `totoro.magpie-inconnu.ts.net`.

The compose files for the four upstream services live **on totoro, not in this repo**. Changes in Tasks 1 and 2 happen on totoro's filesystem and aren't tracked by `feat/ptv-chat`. The implementer should back up each file with `cp …yml …yml.bak.$(date +%Y%m%d-%H%M%S)` before editing.

---

## File map

**Modified on totoro (out-of-repo):**
- `/home/dewoller/docker/photon/docker-compose.yml`
- `/tank/services/docker/graphhopper/docker-compose.yml`

**New in repo:**
- `scripts/env-dev.sh`
- `tests/unit/scripts/env-dev.test.ts` — sources the script and asserts the resulting env

**Modified in repo:**
- `CLAUDE.md` — add tailscale-URL table + dev workflow blurb
- `.gitignore` — already excludes `.env`; confirm

---

## Task 1: Bind Photon to host port 2322

**Files (on totoro):**
- Modify: `/home/dewoller/docker/photon/docker-compose.yml`

- [ ] **Step 1: Verify it's currently unreachable from totoro's host shell**

Run via ssh:

```bash
ssh totoro 'curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://localhost:2322/api?q=fitzroy'
```

Expected: `000` (connection refused — port not exposed to host yet).

- [ ] **Step 2: Inspect the current compose file**

```bash
ssh totoro 'cat /home/dewoller/docker/photon/docker-compose.yml'
```

Expected: a `services.photon` block with no `ports:` entry. Note the indentation style (2-space, YAML).

- [ ] **Step 3: Back up + add the port binding**

```bash
ssh totoro 'cp /home/dewoller/docker/photon/docker-compose.yml /home/dewoller/docker/photon/docker-compose.yml.bak.$(date +%Y%m%d-%H%M%S)'
```

Then edit `/home/dewoller/docker/photon/docker-compose.yml`. Inside the `photon` service block, add (matching the file's existing indentation):

```yaml
    ports:
      - "2322:2322"
```

If the file already has a `volumes:` or `networks:` block on the service, drop `ports:` directly above one of them to keep alphabetical/conventional order.

- [ ] **Step 4: Validate + recreate**

```bash
ssh totoro 'cd /home/dewoller/docker/photon && docker compose config --quiet && echo OK && docker compose up -d photon'
```

Expected: `OK` then `Container photon Recreated` / `Started`.

- [ ] **Step 5: Verify reachable from totoro's host**

```bash
ssh totoro 'sleep 3 && curl -s --max-time 5 "http://localhost:2322/api?q=fitzroy&limit=1" | head -c 200'
```

Expected: a JSON snippet starting with `{"features":[…]` containing a Fitzroy match.

- [ ] **Step 6: Verify reachable from the laptop via tailscale**

```bash
curl -s --max-time 5 "http://totoro.magpie-inconnu.ts.net:2322/api?q=fitzroy&limit=1" | head -c 200
```

Expected: same JSON.

**If step 6 hangs/fails but step 5 succeeds:** the host firewall is blocking. Check:

```bash
ssh totoro 'sudo ufw status 2>/dev/null || sudo iptables -L INPUT -n -v 2>/dev/null | head -20'
```

The fix is environment-specific (allow tailscale interface, or `sudo ufw allow in on tailscale0`). Tailscale by default routes to a virtual interface (`tailscale0`); accept on that interface, deny elsewhere. Report as DONE_WITH_CONCERNS and stop if the firewall edit is non-trivial — the user can decide.

- [ ] **Step 7: Done — no in-repo commit for this task**

The compose file is on totoro, not in this repo. The backup created in step 3 is the rollback path.

---

## Task 2: Bind GraphHopper to host port 8989

**Files (on totoro):**
- Modify: `/tank/services/docker/graphhopper/docker-compose.yml`

Same pattern as Task 1, with one extra consideration: GraphHopper takes ~30s to load the OSM graph on startup, so the post-recreate probe needs to wait longer.

- [ ] **Step 1: Verify it's currently unreachable from totoro's host shell**

```bash
ssh totoro 'curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://localhost:8989/health'
```

Expected: `000`.

- [ ] **Step 2: Inspect**

```bash
ssh totoro 'cat /tank/services/docker/graphhopper/docker-compose.yml'
```

Note: the service name in this compose project is `graphhopper-vic-bike` (per `docker ps`). The compose service key inside the file may be `graphhopper` or `graphhopper-vic-bike` — adapt the up command in step 4 accordingly.

- [ ] **Step 3: Back up + add the port binding**

```bash
ssh totoro 'cp /tank/services/docker/graphhopper/docker-compose.yml /tank/services/docker/graphhopper/docker-compose.yml.bak.$(date +%Y%m%d-%H%M%S)'
```

Add to the GraphHopper service block:

```yaml
    ports:
      - "8989:8989"
```

- [ ] **Step 4: Validate + recreate**

```bash
ssh totoro 'cd /tank/services/docker/graphhopper && docker compose config --quiet && echo OK && docker compose up -d'
```

Expected: `OK` then `Recreated` / `Started`.

- [ ] **Step 5: Wait for graph load**

```bash
ssh totoro 'for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8989/health)
  echo "attempt $i → $code"
  [ "$code" = "200" ] && break
  sleep 5
done'
```

Expected: eventually `200`. If still not after 50s, check `docker logs graphhopper-vic-bike --tail 30` for the loading-progress lines.

- [ ] **Step 6: Verify a real route call from the laptop**

```bash
curl -s --max-time 10 "http://totoro.magpie-inconnu.ts.net:8989/route?point=-37.78,144.96&point=-37.81,144.99&profile=bike&points_encoded=false" | head -c 200
```

Expected: JSON containing `"paths":[…]`. If 502/504 from tailscale, see Task 1 step 6's firewall note.

- [ ] **Step 7: Done — no in-repo commit**

---

## Task 3: Add `scripts/env-dev.sh` for laptop-side URL overrides

**Files:**
- Create: `scripts/env-dev.sh`
- Modify: `.gitignore` (confirm `.env` is already ignored)
- Test: `tests/unit/scripts/env-dev.test.ts`

The script doesn't try to be clever — it just exports the four URL vars that point at totoro's tailscale MagicDNS. Usage is documented inline: source it after `./scripts/decrypt-env.sh && source .env`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/scripts/env-dev.test.ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('scripts/env-dev.sh', () => {
  it('exports the four tailscale-routed URL vars and nothing else', () => {
    const script = resolve('scripts/env-dev.sh');
    // Source the script, then dump only the four vars we care about.
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
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/scripts/env-dev.test.ts`
Expected: FAIL — script doesn't exist; spawn fails.

- [ ] **Step 3: Write the script**

```bash
#!/usr/bin/env bash
# Source AFTER `./scripts/decrypt-env.sh && set -a && source .env && set +a`
# to override the docker-DNS peer URLs (which only resolve inside totoro's
# docker network) with tailscale MagicDNS URLs (which resolve from any
# device on the magpie-inconnu tailnet).
#
# Production (the ptv-chat container running on totoro) ignores these
# overrides because its docker-compose `environment:` block re-asserts
# the docker-DNS URLs at container start. Only ad-hoc dev shells benefit.

export NOMINATIM_URL=http://totoro.magpie-inconnu.ts.net:8094
export PHOTON_URL=http://totoro.magpie-inconnu.ts.net:2322
export GH_REST_URL=http://totoro.magpie-inconnu.ts.net:8989/route
export OSRM_AU_BICYCLE_URL=http://totoro.magpie-inconnu.ts.net:5002
export OSRM_AU_FOOT_URL=http://totoro.magpie-inconnu.ts.net:5003
```

`chmod +x scripts/env-dev.sh` (though it's only ever sourced, not exec'd — the +x is for discoverability and parity with `decrypt-env.sh`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/scripts/env-dev.test.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Verify `.gitignore` already excludes `.env`**

```bash
grep -q '^\.env$\|^/\.env$\|^\.env\s*$' .gitignore && echo OK || echo "ADD .env TO .gitignore"
```

Expected: `OK` (this was set up in the earlier SOPS work).

- [ ] **Step 6: Commit**

```bash
git add scripts/env-dev.sh tests/unit/scripts/env-dev.test.ts
git commit -m "feat(dev): scripts/env-dev.sh — tailscale URL overrides for laptop use"
```

Use HEREDOC. Append `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Task 4: Update CLAUDE.md with the dev workflow + URL table

**Files:**
- Modify: `CLAUDE.md`

Add a brief section that documents how to drive the CLI from a laptop. The existing "Env for the chat/server stack" subsection already lists `NOMINATIM_URL` etc. — extend it.

- [ ] **Step 1: Read the current env subsection**

```bash
grep -n -A2 '^- `NOMINATIM_URL`' CLAUDE.md
```

This identifies the lines to edit.

- [ ] **Step 2: Append a "local dev URLs (tailscale)" subsection right after the env table**

After the `- `PTV_CHAT_PG_URL` …` bullet, add a new block:

```markdown

### Local dev — tailscale-routed peer URLs

The four peer services (Nominatim, Photon, GraphHopper, OSRM-au) live in
docker containers on totoro. The container's compose `environment:` block
references them by docker-DNS names like `http://nominatim:8080` that only
resolve **inside** the docker network. From a laptop, you need the
tailscale MagicDNS routes:

| Service | Tailscale URL |
|---|---|
| Nominatim | `http://totoro.magpie-inconnu.ts.net:8094` |
| Photon | `http://totoro.magpie-inconnu.ts.net:2322` |
| GraphHopper REST | `http://totoro.magpie-inconnu.ts.net:8989/route` |
| OSRM-au (bicycle) | `http://totoro.magpie-inconnu.ts.net:5002` |
| OSRM-au (foot) | `http://totoro.magpie-inconnu.ts.net:5003` |

Quickstart from a laptop on the magpie-inconnu tailnet:

```bash
./scripts/decrypt-env.sh
set -a && source .env && set +a
source scripts/env-dev.sh             # override docker-DNS URLs with tailscale ones
node dist/index.js chat-eval run "your prompt" --models anthropic/claude-haiku-4.5 --html /tmp/out.html
open /tmp/out.html
```

The production container ignores these overrides — its compose
`environment:` block re-asserts the docker-DNS URLs at start time.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(dev): document tailscale-routed peer URLs + scripts/env-dev.sh quickstart"
```

---

## Task 5: End-to-end smoke from the laptop

**Files:** none (manual)

Validates the whole chain: tailscale → photon → graphhopper → chat-eval → HTML map.

- [ ] **Step 1: Source env**

```bash
./scripts/decrypt-env.sh
set -a && source .env && set +a
source scripts/env-dev.sh
echo "NOMINATIM=$NOMINATIM_URL"
echo "PHOTON=$PHOTON_URL"
echo "GH_REST=$GH_REST_URL"
```

Expected: all three print the `totoro.magpie-inconnu.ts.net:<port>` URLs.

- [ ] **Step 2: Quick service probes**

```bash
curl -s --max-time 5 "$NOMINATIM_URL/search?q=Fitzroy,Melbourne&format=json&limit=1" | head -c 120
curl -s --max-time 5 "$PHOTON_URL/api?q=fitzroy&limit=1" | head -c 120
curl -s --max-time 10 "$GH_REST_URL?point=-37.78,144.96&point=-37.81,144.99&profile=bike" | head -c 120
curl -s --max-time 5 "$OSRM_AU_BICYCLE_URL/route/v1/driving/144.96,-37.78;144.99,-37.81?overview=false" | head -c 120
```

Expected: each returns JSON, not connection-refused or timeout.

- [ ] **Step 3: Run chat-eval with a prompt that exercises geocode + bike_route**

```bash
node dist/index.js chat-eval run \
  "Plan a day ride from Lilydale to Hurstbridge with maximum cycleways" \
  --models anthropic/claude-haiku-4.5,google/gemini-3.5-flash \
  --html /tmp/laptop-smoke.html --db /tmp/laptop-smoke.db
```

Expected: exits 0 in ~10–30s. The HTML opens with cards for both models, both with non-empty segment tables, USD cost rendered, and the Leaflet map at the bottom showing route polylines (`grep -c '"latlngs"' /tmp/laptop-smoke.html` > 0).

- [ ] **Step 4: Open the report**

```bash
open /tmp/laptop-smoke.html
```

Visually verify the map renders polylines and the segment table has from→to names.

- [ ] **Step 5: Push the branch**

```bash
git push origin feat/ptv-chat
```

---

# Self-review summary

- **Spec coverage:** "make Photon + GraphHopper publicly reachable on tailscale, same way Nominatim + OSRM-au already are, then make the local CLI use them" — Tasks 1+2 do the binding; Tasks 3+4 wire the dev side.
- **Placeholder scan:** every step has a concrete command. Service-specific quirks (graphhopper startup time, photon's compose file living in `/home/dewoller/docker` rather than `/tank/services`) are called out inline.
- **Type consistency:** N/A (no TypeScript surface changes).
- **Out-of-repo edits:** Tasks 1 + 2 modify files on totoro that aren't in this git repo. The backups created in each task are the rollback path; the user's existing `.bak.timestamp` convention is honored.
- **Risk:** if totoro's firewall blocks non-localhost on the new ports, tasks 1+2 succeed locally but fail from the laptop. Step 6 of each task probes from the laptop specifically to surface this. The fix is environment-specific and flagged as DONE_WITH_CONCERNS rather than guessed.
- **What's deliberately not done:** no public-internet exposure, no Cloudflare tunnel, no auth — all out of scope per the user's "tailscale-reachable" choice. Easy to extend later (each becomes one more compose/cloudflared edit).

---

Plan complete and saved to `docs/superpowers/plans/2026-05-24-expose-routing-services-via-tailscale.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.

**2. Inline Execution** — `superpowers:executing-plans` here in this session, batched with checkpoints.

Which approach? (This one is small enough that inline is reasonable — 5 tasks, 2 of which are pure ssh + compose edits I can do directly.)
