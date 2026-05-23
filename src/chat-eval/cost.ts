import type { UsageBlock } from '../llm/types';

export interface ModelPrice {
  prompt: number;
  completion: number;
}
export type PriceTable = Record<string, ModelPrice>;

export interface FetchPricesOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

export async function fetchPrices(
  modelSlugs: string[],
  opts: FetchPricesOptions = {},
): Promise<PriceTable> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? DEFAULT_BASE}/models`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return {};
    const body = await res.json() as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
    const wanted = new Set(modelSlugs);
    const out: PriceTable = {};
    for (const m of body.data ?? []) {
      if (!wanted.has(m.id) || !m.pricing) continue;
      const p = parseFloat(m.pricing.prompt ?? 'NaN');
      const c = parseFloat(m.pricing.completion ?? 'NaN');
      if (Number.isFinite(p) && Number.isFinite(c)) out[m.id] = { prompt: p, completion: c };
    }
    return out;
  } catch {
    return {};
  }
}

export function computeCost(model: string, usage: UsageBlock, prices: PriceTable): number | null {
  const p = prices[model];
  if (!p) return null;
  if (typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') return null;
  return usage.prompt_tokens * p.prompt + usage.completion_tokens * p.completion;
}
