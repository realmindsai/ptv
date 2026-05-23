import { z } from 'zod';
import type { OpenAITool, ToolFactory } from './types';

export function toOpenAITool(t: ToolFactory): OpenAITool {
  // Zod v4 ships native JSON schema generation; strip the $schema meta field.
  const json = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete json.$schema;
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: json },
  };
}

export type ParseResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseArgs(raw: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` };
  }
}

export type DispatchResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export async function dispatch(
  tools: ToolFactory[],
  name: string,
  args: unknown,
): Promise<DispatchResult> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, error: `unknown tool: ${name}` };
  try {
    const result = await t.handler(args as never);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
