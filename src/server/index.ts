import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { registerHealth } from './routes/health';
import { registerGeocode } from './routes/geocode';
import { Nominatim } from './nominatim';
import { Cache, makeRedisClient } from './cache';

export type AppOptions = {
  logger?: FastifyBaseLogger | boolean;
  nominatimUrl?: string;
  cache?: Cache | null;
};

export function createApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
  });
  const nominatimUrl = opts.nominatimUrl ?? process.env.NOMINATIM_URL ?? 'http://localhost:8094';
  const nominatim = new Nominatim(nominatimUrl);
  const cache = opts.cache !== undefined
    ? opts.cache
    : (() => {
        const c = makeRedisClient(process.env.REDIS_URL);
        return c ? new Cache(c) : null;
      })();

  registerHealth(app);
  registerGeocode(app, { nominatim, cache });
  return app;
}

export async function start(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
