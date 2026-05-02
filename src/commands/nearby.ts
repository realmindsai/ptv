import { Command } from 'commander';
import { ptv } from '../client';
import { trimNearby } from '../trim';

export function nearbyCommand(): Command {
  return new Command('nearby')
    .description('Find stops near a GPS coordinate')
    .argument('<lat>', 'Latitude (decimal degrees, negative for south)')
    .argument('<lon>', 'Longitude (decimal degrees)')
    .option('--route-types <n>', 'Filter by route type (repeatable)', (v, acc: number[]) => [...acc, parseInt(v, 10)], [] as number[])
    .option('--max-distance <n>', 'Maximum distance in metres', parseInt)
    .option('--max-results <n>', 'Maximum results', parseInt)
    .option('--raw', 'Print full API response without trimming')
    .action(async (lat: string, lon: string, opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.routeTypes.length > 0) params.route_types = opts.routeTypes;
      if (opts.maxDistance !== undefined) params.max_distance = opts.maxDistance;
      if (opts.maxResults !== undefined) params.max_results = opts.maxResults;
      const data = await ptv(`/v3/stops/location/${lat},${lon}`, params);
      console.log(JSON.stringify(opts.raw ? data : trimNearby(data as Record<string, unknown>), null, 2));
    });
}
