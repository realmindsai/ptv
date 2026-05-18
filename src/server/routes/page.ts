import { FastifyInstance } from 'fastify';
import { render } from '../render';

// Cache-busting version baked at process start. Bumps on every server restart,
// so when we redeploy, the asset URLs change and any cached (Cloudflare) copies
// are bypassed. Overridable via BUILD_VERSION for deterministic builds.
const ASSET_VERSION = process.env.BUILD_VERSION || Date.now().toString(36);

export function registerPage(app: FastifyInstance): void {
  app.get('/', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return render('page.html', { v: ASSET_VERSION });
  });
}
