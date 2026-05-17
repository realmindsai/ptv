import { Command } from 'commander';
import { plan } from '../plan/orchestrator';
import type { LatLon, PlanRequest, PlanGoal, PlanMode } from '../plan/types';
import { parseTime } from '../plan/parse_time';
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

export function planCommand(): Command {
  return new Command('plan')
    .description('Multi-modal bike+train+bike trip planner')
    .argument('<from>', 'Origin as lat,lon')
    .argument('<to>',   'Destination as lat,lon')
    .option('--depart <iso>', 'Departure time (ISO8601 or HH:MM)')
    .option('--arrive-by <iso>', 'Latest arrival (ISO8601 or HH:MM)')
    .option('--min-bike-km <n>', 'Minimum total bike distance (km)', parseFloat, 0)
    .option('--max-bike-km <n>', 'Maximum total bike distance (km)', parseFloat, 20)
    .option('--max-transfers <n>', 'Max train transfers (default 1; max 1 in v1.2)', (v) => parseInt(v, 10), 1)
    .option('--no-enrich', 'Skip gh-route enrichment (bike_km_on_path)')
    .option('--prefer-bike-path', 'Recommend itineraries with more bike-path km')
    .option('--hill-weight <n>', 'Signed elevation bias: negative=prefer flat, positive=prefer hills (default 0)', parseFloat, 0)
    .option('--goal <type>', 'commute (default), day-ride, or max-path', 'commute')
    .option('--mode <type>', 'bike-only or bike-train (default)', 'bike-train')
    .option('--min-on-path-fraction <n>', 'Require N fraction of bike distance on dedicated paths (0-1)', parseFloat)
    .option('--html <path>', 'Write a Leaflet HTML map to <path> and open it')
    .option('--gpx <path>', 'Write a GPX track to <path> and open it')
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
      if (!['commute', 'day-ride', 'max-path'].includes(opts.goal)) {
        throw new Error(`--goal must be 'commute', 'day-ride', or 'max-path' (got ${opts.goal})`);
      }
      if (opts.mode !== 'bike-only' && opts.mode !== 'bike-train') {
        throw new Error(`--mode must be 'bike-only' or 'bike-train' (got ${opts.mode})`);
      }
      if (opts.minOnPathFraction !== undefined) {
        if (Number.isNaN(opts.minOnPathFraction) || opts.minOnPathFraction < 0 || opts.minOnPathFraction > 1) {
          throw new Error('--min-on-path-fraction must be in [0, 1]');
        }
        if (opts.enrich === false) {
          throw new Error('--min-on-path-fraction requires --enrich (default on)');
        }
      }
      if (Number.isNaN(opts.hillWeight)) {
        throw new Error('--hill-weight must be a number');
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
        preferBikePath: !!opts.preferBikePath,
        hillWeight: opts.hillWeight,
        goal: opts.goal as PlanGoal,
        mode: opts.mode as PlanMode,
        minOnPathFraction: opts.minOnPathFraction,
      };
      const result = await plan(req);
      console.log(JSON.stringify(result, null, 2));
      if (opts.html) {
        const { writeMapHtml } = await import('../plan/map');
        writeMapHtml(opts.html, result);
      }
      if (opts.gpx) {
        const { writeGpx } = await import('../plan/gpx');
        writeGpx(opts.gpx, result);
      }
    });
}
