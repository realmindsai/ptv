import type { SseEvent } from '../types';

export interface ConversationMeta {
  conversationId: string;
  clientId: string;
  ip?: string;
  userAgent?: string;
  origin?: { lat: number; lon: number };
}

export type LoggedEventType =
  | 'user_msg'
  | 'assistant_msg'
  | 'tool_call'
  | 'tool_result'
  | 'path_add'
  | 'turn_end'
  | 'error';

export interface LoggedEvent {
  meta: ConversationMeta;
  turnSeq: number;
  type: LoggedEventType;
  payload: unknown;
}

export interface Logger {
  recordUserMsg(meta: ConversationMeta, turnSeq: number, content: string): void;
  recordEvent(meta: ConversationMeta, turnSeq: number, ev: SseEvent | { type: 'assistant_msg'; content: string }): void;
  flush(): Promise<void>;
}

export const NOOP_LOGGER: Logger = {
  recordUserMsg() {},
  recordEvent() {},
  async flush() {},
};
