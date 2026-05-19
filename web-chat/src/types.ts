export type Itinerary = any; // mirrored loosely from server; we only render legs[].geometry

export type Path = {
  id: string;
  label: string;
  color: string;
  itinerary: Itinerary;
};

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; trace?: LogEntry[] };

export type LogEntry = {
  id: string;
  name: string;
  args: unknown;
  result?: { ok: boolean; summary: string };
  startedAt: number;
  finishedAt?: number;
};

export type SseEvent =
  | { type: 'turn_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string }
  | { type: 'path_add'; pathId: string; label: string; color: string; itinerary: Itinerary }
  | { type: 'turn_end' }
  | { type: 'error'; message: string };

export type State = {
  messages: Message[];
  currentTurnPaths: Path[];
  activePathId: string | null;
  logEntries: LogEntry[];
  logOpen: boolean;
  dockCollapsed: boolean;
  streaming: boolean;
  assistantBuffer: string;
};

export type Action =
  | { type: 'user_send'; content: string }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; entry: LogEntry }
  | { type: 'tool_result'; id: string; result: { ok: boolean; summary: string } }
  | { type: 'path_add'; path: Path }
  | { type: 'set_active'; id: string }
  | { type: 'toggle_log' }
  | { type: 'toggle_dock' }
  | { type: 'reset_chat' }
  | { type: 'error'; message: string };
