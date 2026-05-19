import type { SseEvent } from './types';

export function parseSseChunks(buf: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  let i = 0;
  while (true) {
    const sep = buf.indexOf('\n\n', i);
    if (sep === -1) break;
    const chunk = buf.slice(i, sep);
    if (chunk.startsWith('data: ')) {
      try {
        events.push(JSON.parse(chunk.slice('data: '.length)));
      } catch {
        // skip malformed
      }
    }
    i = sep + 2;
  }
  return { events, rest: buf.slice(i) };
}

export async function streamChat(
  body: unknown,
  onEvent: (ev: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunks(buf);
    for (const ev of events) onEvent(ev);
    buf = rest;
  }
}
