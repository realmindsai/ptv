import { Command } from 'commander';
import { ptv } from '../client';
import { trimRoutes } from '../trim';

export function routesCommand(): Command {
  return new Command('routes')
    .description('List routes, optionally filtered by type or name')
    .option('--route-types <n>', 'Filter by route type (repeatable)', (v, acc: number[]) => [...acc, parseInt(v, 10)], [] as number[])
    .option('--name <str>', 'Filter routes by name (partial match)')
    .option('--raw', 'Print full API response without trimming')
    .action(async (opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.routeTypes.length > 0) params.route_types = opts.routeTypes;
      if (opts.name) params.route_name = opts.name;
      const data = await ptv('/v3/routes', params);
      console.log(JSON.stringify(opts.raw ? data : trimRoutes(data as Record<string, unknown>), null, 2));
    });
}
