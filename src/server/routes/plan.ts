import { FastifyInstance } from 'fastify';
import { plan as defaultPlan } from '../../plan/orchestrator';
import type { PlanRequest, PlanResult } from '../../plan/types';
import { renderMapInit } from '../../plan/map';
import { render } from '../render';
import { Cache } from '../cache';
import { Nominatim } from '../nominatim';
import { planCacheKey } from '../plan-cache-key';

type Point = { lat: number; lon: number } | { query: string };
type PlanBody = {
  from: Point;
  to: Point;
  depart?: string;
  arriveBy?: string;
  mode?: 'bike-only' | 'bike-train';
  goal?: 'commute' | 'day-ride' | 'max-path';
  minBikeKm?: number;
  maxBikeKm?: number;
  maxTransfers?: number;
  preferBikePath?: boolean;
  hillWeight?: number;
  minOnPathFraction?: number;
  enrich?: boolean;
};

export type PlanFn = (req: PlanRequest) => Promise<PlanResult>;

export function registerPlan(
  app: FastifyInstance,
  deps: { planFn?: PlanFn; cache: Cache | null; nominatim: Nominatim },
): void {
  const planFn = deps.planFn ?? defaultPlan;

  app.post<{ Body: PlanBody }>('/api/plan', async (req, reply) => {
    let resolved: PlanRequest;
    try {
      resolved = await resolveRequest(req.body, deps.nominatim);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      reply.code(400);
      if ((req.headers.accept ?? '').includes('text/html')) {
        reply.type('text/html; charset=utf-8');
        return render('error.html', { message: msg });
      }
      return { error: { code: 'BAD_INPUT', message: msg } };
    }

    const key = planCacheKey(resolved as unknown as Record<string, unknown>);
    let result = (await deps.cache?.get<PlanResult>('plan', key)) ?? null;
    if (!result) {
      try {
        result = await planFn(resolved);
        await deps.cache?.setex('plan', key, 600, result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        reply.code(500);
        if ((req.headers.accept ?? '').includes('text/html')) {
          reply.type('text/html; charset=utf-8');
          return render('error.html', { message: msg });
        }
        return { error: { code: 'PLAN_FAILED', message: msg } };
      }
    }

    if ((req.headers.accept ?? '').includes('text/html')) {
      reply.type('text/html; charset=utf-8');
      const { scriptBody, cssBody } = renderMapInit(result);
      return render('results.html', {
        itineraries: result.itineraries.map((it) => ({
          labels: it.labels.join(', '),
          totalTimeMin: it.totalTimeMin.toFixed(0),
          bikeKm: it.bikeKm.toFixed(1),
          transfers: it.transfers,
          trainMin: it.trainMin.toFixed(0),
        })),
        mapCss: cssBody,
        mapScript: scriptBody,
      });
    }
    return result;
  });
}

async function resolveRequest(body: PlanBody, nom: Nominatim): Promise<PlanRequest> {
  const from = await resolvePoint(body.from, nom, 'from');
  const to   = await resolvePoint(body.to,   nom, 'to');
  return {
    from, to,
    // depart/arriveBy parsing is deferred — see Out of scope in the plan doc
    departUtc: undefined,
    arriveByUtc: undefined,
    minBikeKm: toNumber(body.minBikeKm, 0),
    maxBikeKm: toNumber(body.maxBikeKm, 20),
    maxTransfers: toNumber(body.maxTransfers, 1),
    enrich: body.enrich ?? true,
    preferBikePath: body.preferBikePath ?? false,
    hillWeight: toNumber(body.hillWeight, 0),
    goal: (body.goal ?? 'commute'),
    mode: (body.mode ?? 'bike-train'),
    minOnPathFraction: body.minOnPathFraction !== undefined
      ? toNumber(body.minOnPathFraction, 0)
      : undefined,
  };
}

async function resolvePoint(p: Point, nom: Nominatim, label: string): Promise<{ lat: number; lon: number }> {
  if ('lat' in p && 'lon' in p) {
    const lat = toNumber(p.lat, NaN);
    const lon = toNumber(p.lon, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`${label}: invalid coordinates`);
    }
    return { lat, lon };
  }
  if ('query' in p && p.query) {
    const rows = await nom.search(p.query, 1);
    if (rows.length === 0) throw new Error(`${label} not found: ${p.query}`);
    return { lat: rows[0].lat, lon: rows[0].lon };
  }
  throw new Error(`${label} requires {lat,lon} or {query}`);
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
