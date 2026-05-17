import { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';

export function registerStatic(app: FastifyInstance): void {
  app.register(fastifyStatic, {
    root: resolve(__dirname, '../static-assets'),
    prefix: '/static/',
    cacheControl: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  });
}
