import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ChatRequest, SseEvent, ChatCtx } from '../types';
import type { Logger, ConversationMeta } from '../log/types';
import { encodeSseEvent } from '../sse';

export type RunTurnFn = (req: ChatRequest, opts: any) => AsyncGenerator<SseEvent>;
export type BuildToolsFn = (ctx: ChatCtx) => any;

function uuidOr(headerVal: unknown): string {
  if (typeof headerVal === 'string' && /^[0-9a-f-]{36}$/i.test(headerVal)) return headerVal;
  return randomUUID();
}

export function registerChat(
  app: FastifyInstance,
  deps: { runTurnFn: RunTurnFn; buildTools: BuildToolsFn; chatLogger: Logger },
): void {
  app.post('/api/chat', async (req, reply) => {
    const body = req.body as ChatRequest;

    const conversationId = uuidOr(req.headers['x-ptv-conversation-id']);
    const clientId       = uuidOr(req.headers['x-ptv-client-id']);
    const meta: ConversationMeta = {
      conversationId,
      clientId,
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      origin: body.origin,
    };

    const userMsgCount = body.messages.filter((m) => m.role === 'user').length;
    const turnSeq = Math.max(0, userMsgCount - 1);
    const currentUserMsg = body.messages[body.messages.length - 1];

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
      'x-ptv-conversation-id': conversationId,
      'x-ptv-client-id': clientId,
    });

    if (currentUserMsg && currentUserMsg.role === 'user') {
      deps.chatLogger.recordUserMsg(meta, turnSeq, currentUserMsg.content);
    }

    const rawEmit = (ev: SseEvent) => reply.raw.write(encodeSseEvent(ev));
    const tracedEmit = (ev: SseEvent) => {
      rawEmit(ev);
      deps.chatLogger.recordEvent(meta, turnSeq, ev);
    };

    const ctx: ChatCtx = { emit: tracedEmit, origin: body.origin };
    const tools = deps.buildTools(ctx);
    try {
      for await (const ev of deps.runTurnFn(body, { tools })) {
        tracedEmit(ev);
      }
    } catch (err: any) {
      tracedEmit({ type: 'error', message: err?.message ?? 'unknown' });
      tracedEmit({ type: 'turn_end' });
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}
