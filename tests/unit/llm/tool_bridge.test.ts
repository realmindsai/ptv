import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toOpenAITool, parseArgs, dispatch } from '../../../src/llm/tool_bridge';
import type { ToolFactory } from '../../../src/llm/types';

describe('toOpenAITool', () => {
  it('converts a zod-schema tool factory to OpenAI function-calling shape', () => {
    const t: ToolFactory = {
      name: 'geocode',
      description: 'Resolve a place name.',
      schema: z.object({ query: z.string().min(1) }),
      handler: async () => ({ ok: true }),
    };
    const out = toOpenAITool(t);
    expect(out.type).toBe('function');
    expect(out.function.name).toBe('geocode');
    expect(out.function.description).toBe('Resolve a place name.');
    expect(out.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
    });
  });
});

describe('parseArgs', () => {
  it('parses valid JSON', () => {
    expect(parseArgs('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('returns ok=false on malformed JSON', () => {
    const r = parseArgs('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/i);
  });
});

describe('dispatch', () => {
  it('calls the registered handler with parsed args', async () => {
    const t: ToolFactory<{ a: number }, { doubled: number }> = {
      name: 'doubler',
      description: 'x2',
      schema: z.object({ a: z.number() }),
      handler: async (args) => ({ doubled: args.a * 2 }),
    };
    const r = await dispatch([t], 'doubler', { a: 21 });
    expect(r).toEqual({ ok: true, result: { doubled: 42 } });
  });

  it('returns ok=false when no tool matches', async () => {
    const r = await dispatch([], 'missing', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown/i);
  });

  it('captures handler errors as ok=false', async () => {
    const t: ToolFactory = {
      name: 'broken', description: '', schema: z.object({}),
      handler: async () => { throw new Error('boom'); },
    };
    const r = await dispatch([t], 'broken', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('boom');
  });
});
