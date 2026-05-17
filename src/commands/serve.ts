import { Command } from 'commander';
import { start } from '../server/index';

export function serveCommand(): Command {
  return new Command('serve')
    .description('Run the ptv web frontend')
    .option('--port <n>', 'TCP port to listen on', (v) => parseInt(v, 10), 8080)
    .option('--host <h>', 'Host/interface to bind', '0.0.0.0')
    .action(async (opts: { port: number; host: string }) => {
      await start({ port: opts.port, host: opts.host });
    });
}
