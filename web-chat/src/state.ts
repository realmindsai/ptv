import type { State, Action, Message } from './types';

export function initialState(): State {
  return {
    messages: [],
    currentTurnPaths: [],
    activePathId: null,
    logEntries: [],
    logOpen: false,
    dockCollapsed: false,
    streaming: false,
    assistantBuffer: '',
  };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'user_send':
      return {
        ...state,
        messages: [...state.messages, { role: 'user', content: action.content }],
        currentTurnPaths: [],
        logEntries: [],
        assistantBuffer: '',
        activePathId: null,
        streaming: true,
      };
    case 'turn_start':
      return { ...state, streaming: true };
    case 'text_delta':
      return { ...state, assistantBuffer: state.assistantBuffer + action.delta };
    case 'tool_call':
      return { ...state, logEntries: [...state.logEntries, action.entry] };
    case 'tool_result':
      return {
        ...state,
        logEntries: state.logEntries.map((e) =>
          e.id === action.id ? { ...e, result: action.result, finishedAt: Date.now() } : e,
        ),
      };
    case 'path_add':
      return { ...state, currentTurnPaths: [...state.currentTurnPaths, action.path] };
    case 'set_active':
      return {
        ...state,
        activePathId: state.activePathId === action.id ? null : action.id,
      };
    case 'turn_end': {
      const trace = state.logEntries.length > 0 ? state.logEntries : undefined;
      const messages = state.assistantBuffer || trace
        ? [
            ...state.messages,
            {
              role: 'assistant',
              content: state.assistantBuffer,
              trace,
            } as Message,
          ]
        : state.messages;
      return { ...state, messages, assistantBuffer: '', streaming: false };
    }
    case 'toggle_log':
      return { ...state, logOpen: !state.logOpen };
    case 'toggle_dock':
      return { ...state, dockCollapsed: !state.dockCollapsed };
    case 'reset_chat':
      return initialState();
    case 'error':
      return {
        ...state,
        streaming: false,
        messages: [...state.messages, { role: 'assistant', content: `⚠ ${action.message}` }],
      };
  }
}
