import { Command } from 'commander';
import { ptv } from '../client';
import { trimStopsSearch } from '../trim';

export function stopsCommand(): Command {
  return new Command('stops')
    .description('Search for stops by name (undocumented endpoint; falls back gracefully)')
    .argument('<search-term>', 'Stop name to search for')
    .option('--route-types <n>', 'Filter by route type (repeatable)', (v, acc: number[]) => [...acc, parseInt(v, 10)], [] as number[])
    .option('--max-results <n>', 'Maximum results (may be silently ignored by this endpoint)', parseInt)
    .option('--raw', 'Print full API response without trimming')
    .action(async (searchTerm: string, opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.routeTypes.length > 0) params.route_types = opts.routeTypes;
      if (opts.maxResults !== undefined) params.max_results = opts.maxResults;
      const data = await ptv(`/v3/stops/search/${encodeURIComponent(searchTerm)}`, params);
      console.log(JSON.stringify(opts.raw ? data : trimStopsSearch(data as Record<string, unknown>), null, 2));
    });
}
