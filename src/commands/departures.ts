import { Command } from 'commander';
import { ptv } from '../client';
import { trimDepartures } from '../trim';

export function departuresCommand(): Command {
  return new Command('departures')
    .description('Get next departures from a stop')
    .argument('<stop-id>', 'Stop ID (integer)')
    .argument('<route-type>', 'Route type (0=train,1=tram,2=bus,3=vLine,4=night)')
    .option('--max-results <n>', 'Maximum results to return', parseInt)
    .option('--direction-id <n>', 'Filter by direction ID', parseInt)
    .option('--raw', 'Print full API response without trimming')
    .action(async (stopId: string, routeType: string, opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.maxResults !== undefined) params.max_results = opts.maxResults;
      if (opts.directionId !== undefined) params.direction_id = opts.directionId;
      // Note: CLI args are <stop-id> <route-type> but URL path is route_type/{rt}/stop/{id}
      const data = await ptv(`/v3/departures/route_type/${routeType}/stop/${stopId}`, params);
      console.log(JSON.stringify(opts.raw ? data : trimDepartures(data as Record<string, unknown>), null, 2));
    });
}
