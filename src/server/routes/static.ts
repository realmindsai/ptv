import { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';

export function registerStatic(app: FastifyInstance): void {
  app.register(fastifyStatic, {
    root: resolve(__dirname, '../static-assets'),
    prefix: '/static/',
    cacheControl: true,
    maxAge: 5 * 60 * 1000, // 5 minutes — short TTL so future deploys propagate
                            // through Cloudflare without stale-cache incidents.
                            // page.html appends ?v= to its asset URLs as belt-and-braces.
  });
}
