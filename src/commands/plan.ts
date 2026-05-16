import { Command } from 'commander';
import { plan } from '../plan/orchestrator';
import type { LatLon, PlanRequest, PlanGoal } from '../plan/types';
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

export function parseTime(s: string | undefined): Date | undefined {
  if (s === undefined) return undefined;
  if (/^\d{2}:\d{2}$/.test(s)) {
    return parseMelbourneHHMM(s);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
}

/**
 * Parse "HH:MM" as today's Melbourne local time, returning the equivalent UTC Date.
 *
 * Melbourne observes AEST (UTC+10) and AEDT (UTC+11). The offset for "today
 * HH:MM Melbourne" depends on whether DST is active. We use a 2-step probe:
 * 1. Format "today" in Melbourne to get the calendar date there.
 * 2. Construct a probe Date assuming AEST (+10:00), then ask Intl whether
 *    that Date falls inside AEDT in Melbourne; if so, re-construct with +11:00.
 *
 * Caveat: at the ambiguous hour of DST transition (02:00 local, twice a year)
 * the chosen offset may be off by one hour. The user can pass an ISO8601
 * timezone-aware string to disambiguate.
 */
function parseMelbourneHHMM(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // en-CA gives "YYYY-MM-DD" cleanly.
  const ymd = dateFmt.format(now);
  const local = `${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const probe = new Date(`${local}+10:00`);
  const tzFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', timeZoneName: 'short',
  });
  const tzName = tzFmt.formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const offset = tzName === 'AEDT' ? '+11:00' : '+10:00';
  return new Date(`${local}${offset}`);
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
    .option('--goal <type>', 'commute (default) or day-ride', 'commute')
    .option('--html <path>', 'Write a Leaflet HTML map to <path> and open it')
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
      if (opts.goal !== 'commute' && opts.goal !== 'day-ride') {
        throw new Error(`--goal must be 'commute' or 'day-ride' (got ${opts.goal})`);
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
        goal: opts.goal as PlanGoal,
      };
      const result = await plan(req);
      console.log(JSON.stringify(result, null, 2));
      if (opts.html) {
        const { writeMapHtml } = await import('../plan/map');
        writeMapHtml(opts.html, result);
      }
    });
}
