import { Command } from 'commander';
import { plan } from '../plan/orchestrator';
import type { LatLon, PlanRequest } from '../plan/types';
import { NEG_COORD_PREFIX } from '../argv';

function parseCoord(raw: string, label: string): LatLon {
  // Unwrap the negative-coordinate sentinel inserted by index.ts argv preprocessing.
  const s = raw.startsWith(NEG_COORD_PREFIX) ? '-' + raw.slice(NEG_COORD_PREFIX.length) : raw;
  const parts = s.split(',');
  if (parts.length !== 2) {
    throw new Error(`${label} must be lat,lon (got: ${s})`);
  }
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error(`${label} has non-numeric components`);
  }
  return { lat, lon };
}

function parseTime(s: string | undefined): Date | undefined {
  if (s === undefined) return undefined;
  // Accept ISO8601, or HH:MM (interpreted as today UTC)
  if (/^\d{2}:\d{2}$/.test(s)) {
    const now = new Date();
    const [h, m] = s.split(':').map(Number);
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
    return t;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
}

export function planCommand(): Command {
  return new Command('plan')
    .description('Multi-modal bike+train+bike trip planner')
    .argument('<from>', 'Origin as lat,lon')
    .argument('<to>',   'Destination as lat,lon')
    .option('--depart <iso>', 'Departure time (ISO8601 or HH:MM)')
    .option('--arrive-by <iso>', 'Latest arrival (ISO8601 or HH:MM)')
    .option('--min-bike-km <n>', 'Minimum total bike distance (km)', parseFloat, 0)
    .option('--max-bike-km <n>', 'Maximum total bike distance (km)', parseFloat, 20)
    .option('--max-transfers <n>', 'Max train transfers (v1: 0)', (v) => parseInt(v, 10), 0)
    .option('--no-enrich', 'Skip gh-route enrichment (bike_km_on_path)')
    .option('--raw', 'Reserved; no-op in v1')
    .action(async (fromStr: string, toStr: string, opts) => {
      if (opts.depart && opts.arriveBy) {
        throw new Error('--depart and --arrive-by are mutually exclusive');
      }
      if (opts.minBikeKm > opts.maxBikeKm) {
        throw new Error('--min-bike-km must be <= --max-bike-km');
      }
      for (const [name, value] of [
        ['--min-bike-km', opts.minBikeKm],
        ['--max-bike-km', opts.maxBikeKm],
        ['--max-transfers', opts.maxTransfers],
      ] as const) {
        if (typeof value === 'number' && value < 0) {
          throw new Error(`${name} must be >= 0 (got ${value})`);
        }
      }
      const req: PlanRequest = {
        from: parseCoord(fromStr, '<from>'),
        to:   parseCoord(toStr,   '<to>'),
        departUtc:   parseTime(opts.depart),
        arriveByUtc: parseTime(opts.arriveBy),
        minBikeKm:  opts.minBikeKm,
        maxBikeKm:  opts.maxBikeKm,
        maxTransfers: opts.maxTransfers,
        enrich: opts.enrich !== false,
      };
      const result = await plan(req);
      console.log(JSON.stringify(result, null, 2));
    });
}
