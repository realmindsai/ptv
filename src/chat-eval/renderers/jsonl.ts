export interface JsonlTurn {
  run_id: string;
  model: string;
  prompt: string;
  total_ms: number;
  tool_total_ms: number;
  final_text: string;
  tool_calls: Array<{ tool: string; ok: boolean; duration_ms: number }>;
  usage: unknown;
  error: string | null;
}

export function renderJsonl(turns: JsonlTurn[]): string {
  return turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
}
