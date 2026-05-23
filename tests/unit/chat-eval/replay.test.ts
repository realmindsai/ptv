// tests/unit/chat-eval/replay.test.ts
import { describe, it, expect } from 'vitest';
import { reconstructFromEvents } from '../../../src/chat-eval/replay';

const events = [
  { turn_seq: 0, event_seq: 0, type: 'user_msg',      payload: { content: 'Hi' } },
  { turn_seq: 0, event_seq: 1, type: 'turn_start',    payload: {} },
  { turn_seq: 0, event_seq: 2, type: 'assistant_msg', payload: { content: 'Hello!' } },
  { turn_seq: 0, event_seq: 3, type: 'turn_end',      payload: {} },
  { turn_seq: 1, event_seq: 0, type: 'user_msg',      payload: { content: 'Plan a route' } },
  { turn_seq: 1, event_seq: 1, type: 'turn_start',    payload: {} },
  { turn_seq: 1, event_seq: 2, type: 'tool_call',     payload: { name: 'plan', args: {} } },
  { turn_seq: 1, event_seq: 3, type: 'tool_result',   payload: { ok: true } },
  { turn_seq: 1, event_seq: 4, type: 'assistant_msg', payload: { content: 'Here you go.' } },
  { turn_seq: 1, event_seq: 5, type: 'turn_end',      payload: {} },
];

describe('reconstructFromEvents', () => {
  it('walks turn_seq order and pairs user/assistant messages', () => {
    const r = reconstructFromEvents(events);
    expect(r.turns).toHaveLength(2);
    expect(r.turns[0]).toMatchObject({ user: 'Hi', goldenAssistant: 'Hello!' });
    expect(r.turns[1]).toMatchObject({ user: 'Plan a route', goldenAssistant: 'Here you go.' });
  });

  it('honors --from-turn truncation', () => {
    const r = reconstructFromEvents(events, { fromTurn: 1 });
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].user).toBe('Plan a route');
  });

  it('builds the historyForReplay containing all but the last user turn', () => {
    const r = reconstructFromEvents(events);
    expect(r.historyForReplay).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);
    expect(r.replayPrompt).toBe('Plan a route');
  });
});
