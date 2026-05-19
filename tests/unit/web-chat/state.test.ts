import { describe, it, expect } from 'vitest';
import { initialState, reduce } from '../../../web-chat/src/state';

describe('state reducer', () => {
  it('starts empty', () => {
    const s = initialState();
    expect(s.messages).toEqual([]);
    expect(s.currentTurnPaths).toEqual([]);
    expect(s.logEntries).toEqual([]);
    expect(s.activePathId).toBeNull();
    expect(s.streaming).toBe(false);
  });

  it('user_send pushes user message and clears turn state', () => {
    let s = initialState();
    s = {
      ...s,
      currentTurnPaths: [{ id: 'p1', label: 'x', color: '#fff', itinerary: {} as any }],
      logEntries: [{ id: 't1', name: 'geocode', args: {}, startedAt: 0 }],
      assistantBuffer: 'leftover',
      activePathId: 'p1',
    };
    s = reduce(s, { type: 'user_send', content: 'hi' });
    expect(s.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(s.currentTurnPaths).toEqual([]);
    expect(s.logEntries).toEqual([]);
    expect(s.assistantBuffer).toBe('');
    expect(s.activePathId).toBeNull();
    expect(s.streaming).toBe(true);
  });

  it('path_add appends in order', () => {
    let s = initialState();
    s = reduce(s, { type: 'path_add', path: { id: 'a', label: 'A', color: '#e6194b', itinerary: {} as any } });
    s = reduce(s, { type: 'path_add', path: { id: 'b', label: 'B', color: '#3cb44b', itinerary: {} as any } });
    expect(s.currentTurnPaths.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('text_delta accumulates into the assistant buffer', () => {
    let s = initialState();
    s = reduce(s, { type: 'text_delta', delta: 'hel' });
    s = reduce(s, { type: 'text_delta', delta: 'lo' });
    expect(s.assistantBuffer).toBe('hello');
  });

  it('tool_call appends a log entry and tool_result fills it in', () => {
    let s = initialState();
    s = reduce(s, { type: 'tool_call', entry: { id: 't1', name: 'geocode', args: {}, startedAt: 100 } });
    expect(s.logEntries).toHaveLength(1);
    s = reduce(s, { type: 'tool_result', id: 't1', result: { ok: true, summary: 'done' } });
    expect(s.logEntries[0].result).toEqual({ ok: true, summary: 'done' });
    expect(typeof s.logEntries[0].finishedAt).toBe('number');
  });

  it('turn_end flushes assistantBuffer to a message and stops streaming', () => {
    let s = initialState();
    s = reduce(s, { type: 'text_delta', delta: 'reply text' });
    s = { ...s, streaming: true };
    s = reduce(s, { type: 'turn_end' });
    expect(s.messages).toEqual([{ role: 'assistant', content: 'reply text' }]);
    expect(s.assistantBuffer).toBe('');
    expect(s.streaming).toBe(false);
  });

  it('turn_end with empty buffer adds no message', () => {
    let s = initialState();
    s = reduce(s, { type: 'turn_end' });
    expect(s.messages).toEqual([]);
  });

  it('set_active toggles', () => {
    let s = initialState();
    s = {
      ...s,
      currentTurnPaths: [{ id: 'a', label: 'A', color: '#fff', itinerary: {} as any }],
    };
    s = reduce(s, { type: 'set_active', id: 'a' });
    expect(s.activePathId).toBe('a');
    s = reduce(s, { type: 'set_active', id: 'a' });
    expect(s.activePathId).toBeNull();
  });

  it('toggle_log + toggle_dock flip booleans', () => {
    let s = initialState();
    s = reduce(s, { type: 'toggle_log' });
    expect(s.logOpen).toBe(true);
    s = reduce(s, { type: 'toggle_dock' });
    expect(s.dockCollapsed).toBe(true);
  });

  it('reset_chat returns to initial state', () => {
    let s = initialState();
    s = reduce(s, { type: 'user_send', content: 'x' });
    s = reduce(s, { type: 'reset_chat' });
    expect(s).toEqual(initialState());
  });

  it('error appends a system-style assistant message with ⚠ prefix', () => {
    let s = initialState();
    s = reduce(s, { type: 'error', message: 'boom' });
    expect(s.messages).toEqual([{ role: 'assistant', content: '⚠ boom' }]);
    expect(s.streaming).toBe(false);
  });
});
