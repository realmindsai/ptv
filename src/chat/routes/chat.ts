import type { FastifyInstance } from 'fastify';
import type { ChatRequest, SseEvent, ChatCtx } from '../types';
import { encodeSseEvent } from '../sse';

export type RunTurnFn = (req: ChatRequest, opts: any) => AsyncGenerator<SseEvent>;
export type BuildToolsFn = (ctx: ChatCtx) => any;

export function registerChat(
  app: FastifyInstance,
  deps: { runTurnFn: RunTurnFn; buildTools: BuildToolsFn },
): void {
  app.post('/api/chat', async (req, reply) => {
    const body = req.body as ChatRequest;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const emit = (ev: SseEvent) => {
      reply.raw.write(encodeSseEvent(ev));
    };
    const ctx: ChatCtx = { emit, origin: body.origin };
    const tools = deps.buildTools(ctx);
    try {
      for await (const ev of deps.runTurnFn(body, { tools })) {
        reply.raw.write(encodeSseEvent(ev));
      }
    } catch (err: any) {
      reply.raw.write(encodeSseEvent({ type: 'error', message: err?.message ?? 'unknown' }));
      reply.raw.write(encodeSseEvent({ type: 'turn_end' }));
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}
