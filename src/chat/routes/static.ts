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
    // Edge caches (e.g. Cloudflare in front of bike-rail.realmindsai.com.au)
    // default to ~30 days for CSS/JS, which served stale ptv-web bundles
    // after the chat cutover. Short max-age + must-revalidate keeps assets
    // cacheable but lets fixes propagate within ~1 minute. The bundle URLs
    // also carry a build-time ?v=<ts> for one-shot version busting.
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    },
  });
}
