import { Command } from 'commander';
import { ptv } from '../client';
import { trimDisruptions } from '../trim';

export function disruptionsCommand(): Command {
  return new Command('disruptions')
    .description('List current service disruptions')
    .option('--route-type <n>', 'Filter by route type (0=train,1=tram,2=bus,3=vLine,4=night)', parseInt)
    .option('--disruption-status <status>', 'Filter by status: current or planned')
    .option('--raw', 'Print full API response without trimming')
    .action(async (opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.routeType !== undefined) params.route_type = opts.routeType;
      if (opts.disruptionStatus) {
        if (!['current', 'planned'].includes(opts.disruptionStatus)) {
          throw new Error('--disruption-status must be "current" or "planned"');
        }
        params.disruption_status = opts.disruptionStatus;
      }
      const data = await ptv('/v3/disruptions', params);
      console.log(JSON.stringify(opts.raw ? data : trimDisruptions(data as Record<string, unknown>), null, 2));
    });
}
