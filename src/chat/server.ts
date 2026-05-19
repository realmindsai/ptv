import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { registerHealth } from './routes/health';

export type ChatAppOptions = {
  logger?: FastifyBaseLogger | boolean;
};

export function createChatApp(opts: ChatAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
  });
  registerHealth(app);
  return app;
}

export async function startChat(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createChatApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
