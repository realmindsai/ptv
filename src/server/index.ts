import Fastify, { FastifyInstance } from 'fastify';

export function createApp(): FastifyInstance {
  const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const app = Fastify({
    logger: isTest ? false : { level: process.env.LOG_LEVEL ?? 'info' },
  });
  return app;
}

export async function start(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
