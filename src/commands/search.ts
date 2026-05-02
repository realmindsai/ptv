import { Command } from 'commander';
import { ptv } from '../client';
import { trimSearch } from '../trim';

export function searchCommand(): Command {
  return new Command('search')
    .description('Search for stops and routes by name')
    .argument('<term>', 'Search term')
    .option('--route-types <n>', 'Filter by route type (repeatable)', (v, acc: number[]) => [...acc, parseInt(v, 10)], [] as number[])
    .option('--raw', 'Print full API response without trimming')
    .action(async (term: string, opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.routeTypes.length > 0) params.route_types = opts.routeTypes;
      const data = await ptv(`/v3/search/${encodeURIComponent(term)}`, params);
      console.log(JSON.stringify(opts.raw ? data : trimSearch(data as Record<string, unknown>), null, 2));
    });
}
