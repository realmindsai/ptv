import { Command } from 'commander';
import { ptv } from '../client';

export function routeTypesCommand(): Command {
  return new Command('route-types')
    .description('List all PTV route types')
    .option('--raw', 'Print full API response without trimming')
    .action(async (opts) => {
      const data = await ptv('/v3/route_types');
      console.log(JSON.stringify(opts.raw ? data : (data as Record<string, unknown>).route_types, null, 2));
    });
}
