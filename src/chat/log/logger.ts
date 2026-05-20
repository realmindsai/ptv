import type { SseEvent } from '../types';
import type { ConversationMeta, Logger, LoggedEventType } from './types';
import { NOOP_LOGGER } from './types';
import type { Writer } from './writer';

type DeltaBuf = Map<string, string>;

export function makeLogger(env: NodeJS.ProcessEnv, writer: Writer | undefined): Logger {
  if (!env.PTV_CHAT_PG_URL || !writer) return NOOP_LOGGER;
  const buffers: DeltaBuf = new Map();

  function recordUserMsg(meta: ConversationMeta, turnSeq: number, content: string): void {
    writer.enqueue({
      meta, turnSeq, type: 'user_msg', payload: { content },
    });
  }

  function recordEvent(meta: ConversationMeta, turnSeq: number, ev: SseEvent | { type: 'assistant_msg'; content: string }): void {
    switch (ev.type) {
      case 'turn_start':
        return;
      case 'text_delta': {
        const prior = buffers.get(meta.conversationId) ?? '';
        buffers.set(meta.conversationId, prior + ev.delta);
        return;
      }
      case 'turn_end': {
        const buffered = buffers.get(meta.conversationId);
        if (buffered && buffered.length > 0) {
          writer.enqueue({
            meta, turnSeq, type: 'assistant_msg', payload: { content: buffered },
          });
          buffers.delete(meta.conversationId);
        }
        writer.enqueue({ meta, turnSeq, type: 'turn_end', payload: {} });
        return;
      }
      case 'assistant_msg': {
        writer.enqueue({
          meta, turnSeq, type: 'assistant_msg', payload: { content: ev.content },
        });
        return;
      }
      case 'tool_call':
      case 'tool_result':
      case 'path_add':
      case 'error': {
        const type = ev.type as LoggedEventType;
        const { type: _t, ...rest } = ev as any;
        writer.enqueue({ meta, turnSeq, type, payload: rest });
        return;
      }
    }
  }

  async function flush(): Promise<void> {
    await writer.flush();
  }

  return { recordUserMsg, recordEvent, flush };
}
