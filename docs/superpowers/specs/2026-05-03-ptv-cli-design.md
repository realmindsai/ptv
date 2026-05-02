# PTV CLI — Design Spec

## Purpose

A TypeScript/Node.js CLI that exposes all 8 Melbourne PTV API v3 endpoints as subcommands. Intended to be invoked by an AI agent (via shell) for complex transit queries. Output is trimmed JSON by default; `--raw` returns the full PTV API response.

---

## Architecture

**Approach:** Command modules + thin client layer.

```
ptv/
  src/
    index.ts            # Commander.js root; registers subcommands; bin entry
    client.ts           # HMAC-SHA1 auth + fetch; reads env vars
    trim.ts             # per-response field trimming
    commands/
      route-types.ts
      routes.ts
      departures.ts
      stops.ts
      disruptions.ts
      search.ts
      nearby.ts
      stop-details.ts
  package.json          # "bin": { "ptv": "dist/index.js" }
  tsconfig.json
```

Each command file: parse args/options → call `client.ts` → pass through `trim.ts` (or bypass with `--raw`) → print JSON to stdout.

---

## Client (`src/client.ts`)

- Reads `PTV_DEV_ID` and `PTV_API_KEY` from environment. Exits with error if either is missing.
- Signing process (exact order matters):
  1. Assemble the path + all query parameters, e.g. `/v3/departures/route_type/0/stop/1071?max_results=5`
  2. Append `devid=<PTV_DEV_ID>` to the query string (with `?` or `&` as appropriate)
  3. Compute HMAC-SHA1 over the string from step 2 — path starts with `/v3/`, base URL (`https://timetableapi.ptv.vic.gov.au`) is NOT included in the signed string
  4. Encode the digest as uppercase hex
  5. Full request URL = `<BASE_URL><path-from-step-2>&signature=<HEX>` — `signature=` is appended to the full URL after signing, not included in the HMAC input
- Base URL: `https://timetableapi.ptv.vic.gov.au`
- Single exported function: `ptv(path: string, params?: Record<string, string | number | number[]>): Promise<unknown>` — assembles query string, signs, fetches, returns parsed JSON. Throws on non-2xx.
- Array param serialization: array values (e.g. `route_types`) are serialized as repeated query parameters: `{ route_types: [0, 1] }` → `route_types=0&route_types=1`. The PTV API does not accept comma-separated values for these params. On the CLI, `--route-types` is a repeatable option: `--route-types 0 --route-types 1`. Commander.js collects repeated uses into an array which is passed directly to `ptv()`.

---

## Commands

All 8 commands map 1:1 to PTV API v3 endpoints. Every command accepts `--raw` to bypass trimming.

| Subcommand | PTV endpoint | Key args |
|---|---|---|
| `route-types` | GET /v3/route_types | — |
| `routes` | GET /v3/routes | `--route-type <n>`, `--name <str>` |
| `departures <stop-id> <route-type>` | GET /v3/departures/route_type/**{route-type}**/stop/**{stop-id}** | `--max-results <n>`, `--direction-id <n>` |
| `stops <search-term>` | GET /v3/stops/search/{term} | `--route-types <n>` *(repeatable)*, `--max-results <n>` |
| `disruptions` | GET /v3/disruptions | `--route-type <n>`, `--disruption-status current\|planned` |
| `search <term>` | GET /v3/search/{term} | `--route-types <n>` *(repeatable)* |
| `nearby <lat> <lon>` | GET /v3/stops/location/{lat},{lon} | `--max-distance <n>`, `--route-types <n>` *(repeatable)*, `--max-results <n>` |
| `stop-details <stop-id> <route-type>` | GET /v3/stops/**{stop-id}**/route_type/**{route-type}** | `--location`, `--amenities`, `--accessibility` |

**Notes on specific commands:**

- `departures`: first positional arg is `<stop-id>`, second is `<route-type>`. Path segments are `route_type/{route-type}/stop/{stop-id}` (route-type first in URL, stop-id second).
- `stops`: maps to `/v3/stops/search/{term}`. This endpoint is not in the official PTV Swagger but has been confirmed working via the archived `ptv-api/main.ts` and the prior Extism MCP server. Treat as an undocumented alias — if it breaks, fall back to `search`. Note: `--max-results` may be silently ignored by this undocumented endpoint; verify during implementation.
- `disruptions --disruption-status`: accepted values are `current` and `planned` only (PTV enum). Maps to query param `disruption_status`.
- `nearby --route-types`: optional repeatable flag. When omitted the PTV API returns all route types within range. `stop_disruptions` is intentionally omitted from `nearby` — disruption detail requires a separate `disruptions` call.
- `search`: always returns both stops and routes — no include/exclude filtering is exposed by the API.
- `stop-details --location` / `--amenities` / `--accessibility`: map to `stop_location=true`, `stop_amenities=true`, `stop_accessibility=true`. PTV also supports `stop_contact`, `stop_ticket`, `stop_staffing`, `stop_disruptions` — intentionally omitted as not needed for AI transit queries.

---

## Output & Trimming (`src/trim.ts`)

Default (trimmed) output strips API metadata and keeps only fields useful to an AI consumer:

- **departures**: `scheduled_departure_utc`, `estimated_departure_utc`, `platform_number`, `run_ref`, `route_id`, `stop_id`, `flags`
- **stops / nearby**: `stop_id`, `stop_name`, `stop_suburb`, `route_type`, `stop_latitude`, `stop_longitude`, `stop_distance` (if present)
- **routes**: `route_id`, `route_name`, `route_number`, `route_type`
- **disruptions**: `disruption_id`, `title`, `description`, `disruption_status`, `disruption_type`, `affected_routes`
- **search**: top-level `stops` and `routes` arrays, each trimmed as above
- **route-types**: full response (already small)
- **stop-details**: `stop_id`, `stop_name`, `stop_suburb`, `stop_latitude`, `stop_longitude`, `stop_amenities` (sub-object, included verbatim if requested), `stop_accessibility` (sub-object, included verbatim if requested)

`--raw` bypasses all trimming and prints the full PTV API JSON.

---

## Error Handling

- Missing env vars → print to stderr, exit 1
- Missing required option (e.g. `--route-types` on `nearby`) → Commander.js error to stderr, exit 1
- Non-2xx from PTV API → print `{"error": "<status> <url>"}` to stderr, exit 1
- Invalid args → Commander.js default help, exit 1
- All normal output goes to stdout; all errors go to stderr

---

## Credentials

Stored as environment variables:
- `PTV_DEV_ID` — developer ID (integer)
- `PTV_API_KEY` — API key (UUID string)

These match the credentials already present in the archived `ptv-api/main.ts`. Recommended: store in `~/.zshrc` or a `.env` file (not committed).

---

## Build & Install

```bash
npm install
npm run build        # tsc → dist/
npm link             # installs `ptv` globally via symlink
```

Usage:
```bash
ptv departures 1071 0 --max-results 5
ptv nearby -37.8136 144.9631 --route-types 1 --max-results 10
ptv stops "flinders" --route-types 0
```

---

## Testing

- **Unit**: auth signature generation (`client.ts`) — verify HMAC-SHA1 output against known good values from the archived `ptv-api/main.ts`
- **Integration**: each command against the live PTV API — assert structural shape of trimmed response (keys present, correct types), assert `--raw` response is a superset of trimmed fields. Departure value assertions must be structural only (not exact times, which change).
- **e2e**: invoke the compiled `ptv` binary as a subprocess, check stdout JSON parses and stderr is empty on success

**CI / credential guard:** All integration and e2e tests must check for `PTV_DEV_ID` / `PTV_API_KEY` at test startup and skip (not fail) if absent, using a `SKIP_LIVE_TESTS` environment variable or equivalent guard. Unit tests have no such dependency and always run.

No mocks — always real API per project standards.
