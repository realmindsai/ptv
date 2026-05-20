import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createChatApp } from '../../../src/chat/server';
import { createWriter } from '../../../src/chat/log/writer';
import { makeLogger } from '../../../src/chat/log/logger';

const PG = process.env.PTV_CHAT_PG_URL;

describe.skipIf(!PG)('Postgres logging integration', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG!, max: 2 });
    await pool.query(`SELECT 1`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('writes user_msg, tool_call, tool_result, assistant_msg, turn_end', async () => {
    const fakeRunTurn = async function* () {
      yield { type: 'turn_start' };
      yield { type: 'tool_call',   id: 't1', name: 'plan', args: { from: 'A', to: 'B' } };
      yield { type: 'tool_result', id: 't1', ok: true, summary: '1 route' };
      yield { type: 'text_delta', delta: 'Here is ' };
      yield { type: 'text_delta', delta: 'your route.' };
      yield { type: 'turn_end' };
    };
    const writer = createWriter(pool, { intervalMs: 50, batchSize: 100 });
    const logger = makeLogger({ PTV_CHAT_PG_URL: PG } as any, writer);

    const app = createChatApp({
      logger: false,
      runTurnFn: fakeRunTurn as any,
      buildTools: () => ({}) as any,
      chatLogger: logger,
    });

    const conversationId = '99999999-9999-4999-8999-999999999990';
    const clientId       = '99999999-9999-4999-8999-999999999991';

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: {
        'x-ptv-conversation-id': conversationId,
        'x-ptv-client-id': clientId,
      },
      payload: { messages: [{ role: 'user', content: 'plan from A to B' }] },
    });
    expect(res.statusCode).toBe(200);
    await writer.flush();
    await app.close();

    const rows = await pool.query(
      'SELECT type, payload FROM events WHERE conversation_id = $1 ORDER BY event_seq',
      [conversationId],
    );
    const types = rows.rows.map((r) => r.type);
    expect(types).toEqual([
      'user_msg', 'tool_call', 'tool_result', 'assistant_msg', 'turn_end',
    ]);
    expect(rows.rows[3].payload.content).toBe('Here is your route.');

    await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
  });
});
