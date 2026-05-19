import type { Itinerary } from '../plan/types';
export type { Itinerary };

export type SseEvent =
  | { type: 'turn_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string }
  | { type: 'path_add'; pathId: string; label: string; color: string; itinerary: Itinerary }
  | { type: 'turn_end' }
  | { type: 'error'; message: string };

export type ChatRequest = {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  origin?: { lat: number; lon: number };
};

export type ChatCtx = {
  emit: (ev: SseEvent) => void;
  origin?: { lat: number; lon: number };
};
