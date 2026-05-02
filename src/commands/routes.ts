import { Command } from 'commander';
import { ptv } from '../client';
import { trimRoutes } from '../trim';

export function routesCommand(): Command {
  return new Command('routes')
    .description('List routes, optionally filtered by type or name')
    .option('--route-type <n>', 'Filter by route type (0=train,1=tram,2=bus,3=vLine,4=night)', parseInt)
    .option('--name <str>', 'Filter routes by name (partial match)')
    .option('--raw', 'Print full API response without trimming')
    .action(async (opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.routeType !== undefined) params.route_types = opts.routeType;
      if (opts.name) params.route_name = opts.name;
      const data = await ptv('/v3/routes', params);
      console.log(JSON.stringify(opts.raw ? data : trimRoutes(data as Record<string, unknown>), null, 2));
    });
}
