import type { FastifyInstance } from 'fastify';

export function registerHealth(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
}
