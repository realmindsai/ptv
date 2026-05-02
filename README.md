# ptv

A TypeScript CLI for the Melbourne PTV (Public Transport Victoria) API v3. Designed to be invoked by AI agents or shell scripts for transit queries.

## Installation

```bash
npm install
npm run build
npm link        # installs `ptv` globally
```

Requires Node.js ≥ 18.

## Credentials

You need a PTV API developer ID and key. [Register here to get yours](https://www.ptv.vic.gov.au/footer/data-and-reporting/datasets/ptv-timetable-api/).

Add to your shell profile (`~/.zprofile`, `~/.bashrc`, etc.):

```bash
export PTV_DEV_ID=your_dev_id
export PTV_API_KEY=your_api_key
```

## Usage

```bash
ptv --help
ptv route-types
ptv routes --route-type 0
ptv departures 1071 0 --max-results 5
ptv stops "flinders" --route-types 0
ptv disruptions --disruption-status current
ptv search "southern cross"
ptv nearby -37.8136 144.9631 --route-types 1 --max-results 10
ptv stop-details 1071 0 --amenities --accessibility
```

All commands output trimmed JSON by default. Pass `--raw` to get the full PTV API response.

## Commands

| Command | Description | Key options |
|---|---|---|
| `route-types` | List all route types (train, tram, bus…) | — |
| `routes` | List routes | `--route-type <n>`, `--name <str>` |
| `departures <stop-id> <route-type>` | Next departures from a stop | `--max-results <n>`, `--direction-id <n>` |
| `stops <term>` | Search stops by name | `--route-types <n>` *(repeatable)*, `--max-results <n>` |
| `disruptions` | Active service disruptions | `--route-type <n>`, `--disruption-status current\|planned` |
| `search <term>` | Search stops and routes | `--route-types <n>` *(repeatable)* |
| `nearby <lat> <lon>` | Stops near a GPS coordinate | `--route-types <n>` *(repeatable)*, `--max-distance <n>`, `--max-results <n>` |
| `stop-details <stop-id> <route-type>` | Detailed stop info | `--location`, `--amenities`, `--accessibility` |

Route types: `0` = Train, `1` = Tram, `2` = Bus, `3` = Vline, `4` = Night Bus.

Stop IDs and route IDs can be found via `ptv search` or `ptv stops`.

## Examples

```bash
# Next trains from Flinders Street (stop 1071)
ptv departures 1071 0 --max-results 5

# Tram stops near the CBD
ptv nearby -37.8136 144.9631 --route-types 1 --max-results 10

# All current disruptions on trains
ptv disruptions --route-type 0 --disruption-status current

# Find a stop ID
ptv stops "richmond" --route-types 0
```

## Testing

```bash
npm test                    # all tests (unit only if no credentials)
npm run test:unit           # HMAC signing — no credentials needed
PTV_DEV_ID=... PTV_API_KEY=... npm run test:integration
PTV_DEV_ID=... PTV_API_KEY=... npm run test:e2e
```

Integration and e2e tests hit the live PTV API and are skipped automatically when credentials are absent.
