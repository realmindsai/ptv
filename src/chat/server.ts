import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { registerHealth } from './routes/health';
import { registerChat, type RunTurnFn, type BuildToolsFn } from './routes/chat';
import { runTurn as defaultRunTurn } from './agent';

export type ChatAppOptions = {
  logger?: FastifyBaseLogger | boolean;
  runTurnFn?: RunTurnFn;
  buildTools?: BuildToolsFn;
};

export function createChatApp(opts: ChatAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
  });
  registerHealth(app);
  registerChat(app, {
    runTurnFn: opts.runTurnFn ?? (defaultRunTurn as RunTurnFn),
    buildTools: opts.buildTools ?? ((_ctx) => ({})),  // real builder wired in Task C3
  });
  return app;
}

export async function startChat(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createChatApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
