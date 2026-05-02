import { Command } from 'commander';
import { ptv } from '../client';
import { trimStopDetails } from '../trim';

export function stopDetailsCommand(): Command {
  return new Command('stop-details')
    .description('Get detailed information about a specific stop')
    .argument('<stop-id>', 'Stop ID (integer)')
    .argument('<route-type>', 'Route type (0=train,1=tram,2=bus,3=vLine,4=night)')
    .option('--location', 'Include stop location details')
    .option('--amenities', 'Include stop amenities (sub-object, verbatim)')
    .option('--accessibility', 'Include stop accessibility info (sub-object, verbatim)')
    .option('--raw', 'Print full API response without trimming')
    .action(async (stopId: string, routeType: string, opts) => {
      const params: Record<string, string | number | number[]> = {};
      if (opts.location) params.stop_location = 'true';
      if (opts.amenities) params.stop_amenities = 'true';
      if (opts.accessibility) params.stop_accessibility = 'true';
      const data = await ptv(`/v3/stops/${stopId}/route_type/${routeType}`, params);
      const trimOpts = { amenities: opts.amenities, accessibility: opts.accessibility };
      console.log(JSON.stringify(opts.raw ? data : trimStopDetails(data as Record<string, unknown>, trimOpts), null, 2));
    });
}
