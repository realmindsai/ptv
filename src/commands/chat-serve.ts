import { Command } from 'commander';
import { startChat } from '../chat/server';

export function chatServeCommand(): Command {
  return new Command('chat-serve')
    .description('Run the ptv-chat web app (chat-driven planner)')
    .option('--port <n>', 'port', (v) => parseInt(v, 10), parseInt(process.env.PORT ?? '8086', 10))
    .option('--host <h>', 'host', process.env.HOST ?? '0.0.0.0')
    .action(async (opts: { port: number; host: string }) => {
      await startChat({ port: opts.port, host: opts.host });
    });
}
