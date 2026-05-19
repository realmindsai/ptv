import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';

// CJS build: __dirname is always defined. The fileURLToPath(import.meta.url)
// form is omitted because tsconfig module=commonjs rejects import.meta syntax
// at parse time; the CJS fallback is sufficient for this project.
const here = __dirname;

const STATIC_ROOT = resolve(here, '../static-assets');

export async function registerStatic(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: STATIC_ROOT,
    prefix: '/static/',
    decorateReply: false,
  });
}
