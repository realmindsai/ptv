#!/usr/bin/env node
import { Command } from 'commander';
import { MissingCredentialsError } from './client';
import { routeTypesCommand } from './commands/route-types';

const program = new Command()
  .name('ptv')
  .description('Melbourne PTV API CLI')
  .version('1.0.0');

program.addCommand(routeTypesCommand());

program.parseAsync(process.argv).catch((err: Error) => {
  if (err instanceof MissingCredentialsError) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else {
    process.stderr.write(`${err.message}\n`);
  }
  process.exit(1);
});
