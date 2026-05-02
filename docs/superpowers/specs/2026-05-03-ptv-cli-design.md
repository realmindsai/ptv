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
- Signs every request: appends `devid=` to path, computes HMAC-SHA1 over the full path+devid string using the key, appends `&signature=` (uppercase hex).
- Base URL: `https://timetableapi.ptv.vic.gov.au`
- Single exported function: `ptv(path: string): Promise<unknown>` — builds signed URL, fetches, returns parsed JSON. Throws on non-2xx.

---

## Commands

All 8 commands map 1:1 to PTV API v3 endpoints. Every command accepts `--raw` to bypass trimming.

| Subcommand | PTV endpoint | Key args |
|---|---|---|
| `route-types` | GET /v3/route_types | — |
| `routes` | GET /v3/routes | `--route-type <n>`, `--name <str>` |
| `departures <stop-id> <route-type>` | GET /v3/departures/route_type/{rt}/stop/{id} | `--max-results <n>`, `--direction-id <n>` |
| `stops <search-term>` | GET /v3/stops/search/{term} | `--route-types <n,n,...>`, `--max-results <n>` |
| `disruptions` | GET /v3/disruptions | `--route-type <n>`, `--status <str>` |
| `search <term>` | GET /v3/search/{term} | `--route-types <n,n,...>`, `--stop-filter`, `--route-filter` |
| `nearby <lat> <lon>` | GET /v3/stops/location/{lat},{lon} | `--max-distance <n>`, `--route-types <n,n,...>`, `--max-results <n>` |
| `stop-details <stop-id> <route-type>` | GET /v3/stops/{id}/route_type/{rt} | `--location`, `--amenities`, `--accessibility` |

---

## Output & Trimming (`src/trim.ts`)

Default (trimmed) output strips API metadata and keeps only fields useful to an AI consumer:

- **departures**: `scheduled_departure_utc`, `estimated_departure_utc`, `platform_number`, `run_ref`, `route_id`, `stop_id`, `flags`
- **stops / nearby**: `stop_id`, `stop_name`, `stop_suburb`, `route_type`, `stop_latitude`, `stop_longitude`, `stop_distance` (if present)
- **routes**: `route_id`, `route_name`, `route_number`, `route_type`
- **disruptions**: `disruption_id`, `title`, `description`, `disruption_status`, `disruption_type`, `affected_routes`
- **search**: top-level `stops` and `routes` arrays, each trimmed as above
- **route-types**: full response (already small)
- **stop-details**: `stop_id`, `stop_name`, `stop_suburb`, `stop_latitude`, `stop_longitude`, `stop_amenities` (if requested), `stop_accessibility` (if requested)

`--raw` bypasses all trimming and prints the full PTV API JSON.

---

## Error Handling

- Missing env vars → print to stderr, exit 1
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

- **Unit**: auth signature generation (`client.ts`) — verify HMAC-SHA1 output against known good values from the archived `main.ts`
- **Integration**: each command against the live PTV API — assert shape of trimmed response, assert `--raw` returns superset of trimmed fields
- **e2e**: invoke the compiled `ptv` binary as a subprocess, check stdout JSON parses and stderr is empty on success

No mocks — always real API per project standards.
