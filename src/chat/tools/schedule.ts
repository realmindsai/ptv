import { z } from 'zod';
import { departuresFrom, runPattern } from '../../plan/transit';
import { parseTime } from '../../plan/parse_time';

// Melbourne wall-clock for a UTC ISO string, e.g. "06:18 (Sun)".
const MELB_TIME = new Intl.DateTimeFormat('en-AU', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Melbourne',
});
const MELB_DAY = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short', timeZone: 'Australia/Melbourne',
});
function melbLocal(iso: string): string {
  try {
    const d = new Date(iso);
    return `${MELB_TIME.format(d)} (${MELB_DAY.format(d)})`;
  } catch { return iso; }
}

export const zScheduleArgs = z.object({
  fromStopId: z.number().int().describe('PTV stop_id you are departing from.'),
  toStopId: z.number().int().optional().describe(
    'Optional PTV stop_id of the destination. If given, results are filtered to runs that pass through this stop, and each result includes arriveLocal.',
  ),
  fromTime: z.string().describe(
    'Earliest departure to consider. "HH:MM" = today in Melbourne local, OR ISO8601 with offset like "2026-05-24T04:00:00+10:00".',
  ),
  windowMin: z.number().int().min(15).max(360).default(180).describe(
    'How many minutes after fromTime to scan. Defaults to 180.',
  ),
  routeType: z.union([z.literal(0), z.literal(3)]).default(0).describe(
    '0 = metro train (default), 3 = V/Line regional train.',
  ),
  maxResults: z.number().int().min(1).max(20).default(10),
});
export type ScheduleArgs = z.infer<typeof zScheduleArgs>;

export function makeScheduleTool() {
  return {
    name: 'schedule' as const,
    description:
      'List real upcoming train departures from a PTV stop (and optionally only those ' +
      'that pass through a second stop, with arrival time). Use this when the user asks ' +
      'about timetables, wants to compare departure times, or wants the next-train view ' +
      'rather than one curated itinerary. Backed by the live PTV Timetable API. ' +
      'Find stop IDs first via search_stops or nearby_stops.',
    schema: zScheduleArgs,
    handler: async (args: ScheduleArgs) => {
      const fromUtc = parseTime(args.fromTime);
      if (!fromUtc) return { ok: false as const, error: 'fromTime did not parse' };
      const deps = await departuresFrom(args.fromStopId, args.routeType, fromUtc, args.windowMin);
      if (deps.length === 0) {
        return { ok: false as const, error: 'No departures in that window' };
      }

      type Row = {
        departLocal: string;
        arriveLocal?: string;
        durationMin?: number;
        route: string;
        runRef: string;
      };
      const rows: Row[] = [];
      for (const d of deps) {
        let arriveLocal: string | undefined;
        let durationMin: number | undefined;
        if (args.toStopId !== undefined) {
          const pat = await runPattern(d.runRef, args.routeType, new Date(d.departUtc));
          const fromIdx = pat.findIndex((p) => p.stopId === args.fromStopId);
          const toIdx = pat.findIndex((p) => p.stopId === args.toStopId);
          if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) continue;  // train doesn't reach toStop after fromStop
          const arriveUtc = pat[toIdx].arriveUtc;
          arriveLocal = melbLocal(arriveUtc);
          durationMin = Math.round(
            (Date.parse(arriveUtc) - Date.parse(d.departUtc)) / 60_000,
          );
        }
        rows.push({
          departLocal: melbLocal(d.departUtc),
          arriveLocal,
          durationMin,
          route: d.routeName,
          runRef: d.runRef,
        });
        if (rows.length >= args.maxResults) break;
      }
      if (rows.length === 0) {
        return { ok: false as const, error: 'No trains in that window reach the destination stop' };
      }
      return { ok: true as const, count: rows.length, departures: rows };
    },
  };
}
