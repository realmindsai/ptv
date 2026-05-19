import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CJS build: __dirname is always defined. The fileURLToPath(import.meta.url)
// form is omitted because tsconfig module=commonjs rejects import.meta syntax
// at parse time; the CJS fallback is sufficient for this project.
const here = __dirname;

const SHELL_PATH = resolve(here, '../static-assets/index.html');

export function registerPage(app: FastifyInstance): void {
  app.get('/', async (_req, reply) => {
    const html = readFileSync(SHELL_PATH, 'utf8');
    reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });
}
