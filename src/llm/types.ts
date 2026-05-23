import type { ZodTypeAny } from 'zod';

/** Existing tool factory shape used by src/chat/tools/*. */
export interface ToolFactory<TArgs = unknown, TOut = unknown> {
  name: string;
  description: string;
  schema: ZodTypeAny;
  handler: (args: TArgs) => Promise<TOut>;
}

/** OpenAI-compatible chat-completions message. */
export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

/** Options accepted by openrouter.runAgentLoop. */
export interface AgentLoopOptions {
  model: string;
  systemPrompt: string;
  history: OpenAIMessage[];
  tools: ToolFactory[];
  apiKey: string;
  baseUrl?: string;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
  /** Optional clock override for tests. */
  nowMs?: () => number;
}

export interface UsageBlock {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
