#!/usr/bin/env node
import { Command } from 'commander';
import { MissingCredentialsError } from './client';
import { routeTypesCommand } from './commands/route-types';
import { routesCommand } from './commands/routes';
import { departuresCommand } from './commands/departures';
import { stopsCommand } from './commands/stops';
import { disruptionsCommand } from './commands/disruptions';
import { searchCommand } from './commands/search';
import { nearbyCommand } from './commands/nearby';

const program = new Command()
  .name('ptv')
  .description('Melbourne PTV API CLI')
  .version('1.0.0');

program.addCommand(routeTypesCommand());
program.addCommand(routesCommand());
program.addCommand(departuresCommand());
program.addCommand(stopsCommand());
program.addCommand(disruptionsCommand());
program.addCommand(searchCommand());
program.addCommand(nearbyCommand());

program.parseAsync(process.argv).catch((err: Error) => {
  if (err instanceof MissingCredentialsError) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else {
    process.stderr.write(`${err.message}\n`);
  }
  process.exit(1);
});
