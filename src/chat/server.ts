import Fastify, { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { registerHealth } from './routes/health';
import { registerChat, type RunTurnFn, type BuildToolsFn } from './routes/chat';
import { registerPage } from './routes/page';
import { registerStatic } from './routes/static';
import { runTurn as defaultRunTurn } from './agent';
import type { ChatCtx } from './types';
import type { LatLon } from '../plan/types';
import { DAY_RIDE_CUSTOM_MODEL, MAX_PATH_CUSTOM_MODEL } from '../plan/types';
import { makeGeocodeTool } from './tools/geocode';
import { makePlanTool } from './tools/plan';
import { makeBikeRouteTool, type BikeFn } from './tools/bike_route';
import { makeSearchStopsTool, makeNearbyStopsTool } from './tools/stops';
import { makeScheduleTool } from './tools/schedule';
import { Nominatim } from '../server/nominatim';
import { Photon } from '../server/photon';
import { plan as planOrchestrator } from '../plan/orchestrator';
import { ghRouteBike, ghRouteCustom } from '../plan/external';
import { ptv } from '../client';

export type ChatAppOptions = {
  logger?: FastifyBaseLogger | boolean;
  runTurnFn?: RunTurnFn;
  buildTools?: BuildToolsFn;
};

// Dispatch the right bike engine for the requested goal.
const dispatchBike: BikeFn = async (from: LatLon, to: LatLon, goal) => {
  if (goal === 'day-ride') return ghRouteCustom(from, to, DAY_RIDE_CUSTOM_MODEL);
  if (goal === 'max-path') return ghRouteCustom(from, to, MAX_PATH_CUSTOM_MODEL);
  return ghRouteBike(from, to, 'bike');  // commute
};

function defaultBuildTools(ctx: ChatCtx) {
  const nominatim = new Nominatim(process.env.NOMINATIM_URL ?? 'http://localhost:8094');
  // PHOTON_URL unset = Photon disabled, tool falls back to Nominatim only.
  const photon = process.env.PHOTON_URL
    ? new Photon(process.env.PHOTON_URL)
    : undefined;
  return {
    geocode:      makeGeocodeTool(ctx, nominatim, photon),
    plan:         makePlanTool(ctx, planOrchestrator),
    bike_route:   makeBikeRouteTool(ctx, dispatchBike),
    search_stops: makeSearchStopsTool(ptv),
    nearby_stops: makeNearbyStopsTool(ptv),
    schedule:     makeScheduleTool(),
  };
}

export function createChatApp(opts: ChatAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
  });
  registerHealth(app);
  registerChat(app, {
    runTurnFn: opts.runTurnFn ?? (defaultRunTurn as RunTurnFn),
    buildTools: opts.buildTools ?? defaultBuildTools,
  });
  // Register static + page. fastify-static is async but we let the plugin
  // resolve via the regular `register()` queue — callers should `await app.ready()`
  // before assertion-style testing or first request.
  app.register(registerStatic);
  registerPage(app);
  return app;
}

export async function startChat(opts: { port: number; host: string }): Promise<FastifyInstance> {
  const app = createChatApp();
  await app.listen({ port: opts.port, host: opts.host });
  return app;
}
