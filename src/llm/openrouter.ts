export async function* parseSseChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<any> {
  const reader = body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // SSE events are separated by blank lines (\n\n).
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLines = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      const payload = dataLines.join('\n').trim();
      if (!payload) continue;
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload);
      } catch {
        // Ignore malformed chunks; OpenRouter occasionally interleaves keepalives.
      }
    }
  }
}
