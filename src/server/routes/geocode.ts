import { FastifyInstance } from 'fastify';
import { Nominatim, GeocodeResult } from '../nominatim';
import { Cache } from '../cache';
import { render } from '../render';

export function registerGeocode(
  app: FastifyInstance,
  deps: { nominatim: Nominatim; cache: Cache | null },
): void {
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/geocode', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 3) {
      reply.code(400);
      return { error: { code: 'Q_TOO_SHORT', message: 'q must be at least 3 characters' } };
    }
    const limit = Math.min(20, parseInt(req.query.limit ?? '8', 10) || 8);

    const cacheKey = q.toLowerCase();
    let results = await deps.cache?.get<GeocodeResult[]>('geocode', cacheKey) ?? null;
    if (!results) {
      results = await deps.nominatim.search(q, limit);
      await deps.cache?.setex('geocode', cacheKey, 86400, results);
    }

    const accept = req.headers.accept ?? '';
    if (accept.includes('text/html')) {
      reply.type('text/html; charset=utf-8');
      return render('geocode-suggest.html', { results });
    }
    return { results };
  });
}
