export type { SseEvent } from './types';
import type { SseEvent } from './types';

export function encodeSseEvent(ev: SseEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}
