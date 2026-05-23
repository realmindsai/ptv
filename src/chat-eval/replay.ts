// src/chat-eval/replay.ts
import { Client } from 'pg';

export interface EventRow {
  turn_seq: number;
  event_seq: number;
  type: string;
  payload: any;
}

export interface ReconstructedTurn {
  turnSeq: number;
  user: string;
  goldenAssistant: string;
}

export interface ReconstructResult {
  turns: ReconstructedTurn[];
  historyForReplay: Array<{ role: 'user' | 'assistant'; content: string }>;
  replayPrompt: string;
}

export function reconstructFromEvents(
  rows: EventRow[],
  opts: { fromTurn?: number } = {},
): ReconstructResult {
  const byTurn = new Map<number, EventRow[]>();
  for (const r of rows) {
    if (!byTurn.has(r.turn_seq)) byTurn.set(r.turn_seq, []);
    byTurn.get(r.turn_seq)!.push(r);
  }
  const turns: ReconstructedTurn[] = [];
  for (const [turnSeq, evs] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    if (opts.fromTurn !== undefined && turnSeq < opts.fromTurn) continue;
    const user = evs.find((e) => e.type === 'user_msg')?.payload?.content ?? '';
    const goldenAssistant = evs.find((e) => e.type === 'assistant_msg')?.payload?.content ?? '';
    turns.push({ turnSeq, user, goldenAssistant });
  }
  const last = turns[turns.length - 1];
  const history = turns
    .slice(0, -1)
    .flatMap((t) => [
      { role: 'user' as const, content: t.user },
      { role: 'assistant' as const, content: t.goldenAssistant },
    ]);
  return { turns, historyForReplay: history, replayPrompt: last?.user ?? '' };
}

export async function fetchConversationEvents(
  pgUrl: string,
  conversationId: string,
): Promise<EventRow[]> {
  const c = new Client({ connectionString: pgUrl });
  await c.connect();
  try {
    const res = await c.query<EventRow>(
      `SELECT turn_seq, event_seq, type, payload
         FROM events
        WHERE conversation_id = $1
        ORDER BY turn_seq, event_seq`,
      [conversationId],
    );
    return res.rows;
  } finally {
    await c.end();
  }
}
