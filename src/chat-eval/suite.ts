import { parse } from 'yaml';
import { z } from 'zod';

const zPrompt = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  origin: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

const zSuite = z.object({
  name: z.string().min(1),
  prompts: z.array(zPrompt).min(1, 'suite needs at least one prompt'),
  expect_keywords: z.record(z.string(), z.array(z.string())).optional(),
});

export type Suite = z.infer<typeof zSuite>;
export type SuitePrompt = z.infer<typeof zPrompt>;

export function parseSuite(yamlText: string): Suite {
  const raw = parse(yamlText);
  const s = zSuite.parse(raw);
  const seen = new Set<string>();
  for (const p of s.prompts) {
    if (seen.has(p.id)) throw new Error(`duplicate prompt id: ${p.id}`);
    seen.add(p.id);
  }
  return s;
}
