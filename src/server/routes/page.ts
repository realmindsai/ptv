import { FastifyInstance } from 'fastify';
import { render } from '../render';

export function registerPage(app: FastifyInstance): void {
  app.get('/', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return render('page.html', {});
  });
}
