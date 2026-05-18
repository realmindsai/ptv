import { FastifyInstance } from 'fastify';
import { plan as defaultPlan } from '../../plan/orchestrator';
import type { PlanRequest, PlanResult } from '../../plan/types';
import { renderMapInit } from '../../plan/map';
import { buildGpxXml } from '../../plan/gpx';
import { render } from '../render';
import { Cache } from '../cache';
import { Nominatim } from '../nominatim';
import { planCacheKey } from '../plan-cache-key';
import { parseTime } from '../../plan/parse_time';

type Point = { lat: number; lon: number } | { query: string };
type PlanBody = {
  origin: Point;
  destination: Point;
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
    reply.header('x-plan-key', key);
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
        itineraries: result.itineraries.map((it) => {
          const segments = it.legs.map((leg) => {
            if (leg.mode === 'bike') {
              const min = Math.max(1, Math.round(leg.min));
              const badge = min >= 12 ? `<span class="seg__min mono">${min}m</span>` : '';
              return { kind: 'bike', min, label: `${leg.km.toFixed(1)}km`, badge };
            }
            const dep = new Date(leg.departUtc).getTime();
            const arr = new Date(leg.arriveUtc).getTime();
            const min = Math.max(1, Math.round((arr - dep) / 60000));
            const badge = min >= 12 ? `<span class="seg__min mono">${min}m</span>` : '';
            return { kind: 'train', min, label: escLabel(leg.routeName), badge };
          });
          // Pre-render segment bar HTML to avoid nested {{#each}} in the template engine.
          const segBarHtml = '<div class="seg-bar" role="img" aria-label="trip segments">'
            + segments.map((s) =>
                `<div class="seg seg--${s.kind}" style="flex:${s.min}" title="${escLabel(s.label)}">${s.badge}</div>`,
              ).join('')
            + '</div>';
          const segLegendHtml = '<div class="seg-bar__legend">'
            + segments.map((s) =>
                `<span class="seg-legend"><span class="seg-legend__chip seg-legend__chip--${s.kind}"></span>${escLabel(s.label)}</span>`,
              ).join('')
            + '</div>';
          const trainLegs = it.legs.filter((l): l is Extract<typeof l, { mode: 'train' }> => l.mode === 'train');
          const firstTrain = trainLegs[0];
          const lastTrain = trainLegs[trainLegs.length - 1];
          const headTimesHtml = firstTrain && lastTrain
            ? `<div class="itinerary-card__times">dep <time class="itin__dep mono" datetime="${firstTrain.departUtc}">${firstTrain.departUtc}</time> · arr <time class="itin__arr mono" datetime="${lastTrain.arriveUtc}">${lastTrain.arriveUtc}</time></div>`
            : '';
          const ascendM = typeof it.ascendM === 'number' ? Math.round(it.ascendM) : null;
          const onPathPct = (typeof it.bikeKmOnPath === 'number' && it.bikeKm > 0)
            ? Math.round(100 * it.bikeKmOnPath / it.bikeKm) : null;
          const metaTailHtml = [
            ascendM != null   ? ` · <span class="mono">${ascendM}</span> m ↑` : '',
            onPathPct != null ? ` · <span class="mono">${onPathPct}%</span> path` : '',
          ].join('');
          return {
            labels: it.labels.join(', '),
            totalTimeMin: it.totalTimeMin.toFixed(0),
            bikeKm: it.bikeKm.toFixed(1),
            transfers: it.transfers,
            trainMin: it.trainMin.toFixed(0),
            headTimesHtml,
            segBarHtml,
            segLegendHtml,
            metaTailHtml,
          };
        }),
        mapCss: cssBody,
        mapScript: scriptBody,
      });
    }
    return result;
  });

  app.get<{ Params: { key: string } }>('/api/plan/:key/gpx', async (req, reply) => {
    const result = (await deps.cache?.get<PlanResult>('plan', req.params.key)) ?? null;
    if (!result) {
      reply.code(404);
      return { error: { code: 'PLAN_NOT_FOUND', message: 'plan cache miss — re-plan to download' } };
    }
    reply.type('application/gpx+xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="ptv-plan-${req.params.key}.gpx"`);
    return buildGpxXml(result);
  });
}

async function resolveRequest(body: PlanBody, nom: Nominatim): Promise<PlanRequest> {
  const from = await resolvePoint(body.origin,      nom, 'origin');
  const to   = await resolvePoint(body.destination, nom, 'destination');
  const mode = body.mode ?? 'bike-train';
  // The orchestrator forbids maxTransfers > 0 in bike-only mode (there are no trains
  // to transfer between). Coerce rather than error so the form can default to
  // bike-only without the user knowing about the invariant.
  const maxTransfers = mode === 'bike-only' ? 0 : toNumber(body.maxTransfers, 1);
  const departUtc   = parseOptionalTime(body.depart,   'depart');
  const arriveByUtc = parseOptionalTime(body.arriveBy, 'arriveBy');
  if (departUtc && arriveByUtc) {
    throw new Error('specify either depart or arriveBy, not both');
  }
  return {
    from, to,
    departUtc,
    arriveByUtc,
    minBikeKm: toNumber(body.minBikeKm, 0),
    maxBikeKm: toNumber(body.maxBikeKm, 40),
    maxTransfers,
    enrich: body.enrich ?? true,
    preferBikePath: body.preferBikePath ?? false,
    hillWeight: toNumber(body.hillWeight, 0),
    goal: (body.goal ?? 'commute'),
    mode,
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

function escLabel(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseOptionalTime(raw: unknown, field: string): Date | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (s === '') return undefined;
  try { return parseTime(s); }
  catch { throw new Error(`${field}: invalid time (use HH:MM or ISO8601)`); }
}
