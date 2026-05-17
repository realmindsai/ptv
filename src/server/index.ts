import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';

export type AppOptions = {
  logger?: FastifyBaseLogger | boolean;
};

export function createApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
  });
  return app;
}

export async function start(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
