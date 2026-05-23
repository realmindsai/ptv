import { describe, it, expect, vi } from 'vitest';
import { fetchPrices, computeCost, type PriceTable } from '../../../src/chat-eval/cost';

describe('fetchPrices', () => {
  it('returns USD-per-token prices for the requested model slugs', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
        { id: 'google/gemini-3.5-flash',   pricing: { prompt: '0.0000002', completion: '0.000001' } },
        { id: 'openai/gpt-5',              pricing: { prompt: '0.000003', completion: '0.00001' } },
      ],
    }), { status: 200 }));
    const prices = await fetchPrices(
      ['anthropic/claude-haiku-4.5', 'google/gemini-3.5-flash'],
      { fetchImpl: fakeFetch as any },
    );
    expect(prices['anthropic/claude-haiku-4.5']).toEqual({ prompt: 1e-6, completion: 5e-6 });
    expect(prices['google/gemini-3.5-flash']).toEqual({ prompt: 2e-7, completion: 1e-6 });
    expect(prices['openai/gpt-5']).toBeUndefined();   // not asked
  });

  it('returns an empty table on fetch failure (degrades silently)', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    const prices = await fetchPrices(['anthropic/claude-haiku-4.5'], { fetchImpl: fakeFetch as any });
    expect(prices).toEqual({});
  });
});

describe('computeCost', () => {
  const prices: PriceTable = {
    'anthropic/claude-haiku-4.5': { prompt: 1e-6, completion: 5e-6 },
  };
  it('multiplies tokens by price', () => {
    const usd = computeCost('anthropic/claude-haiku-4.5', { prompt_tokens: 1000, completion_tokens: 200 }, prices);
    expect(usd).toBeCloseTo(1000 * 1e-6 + 200 * 5e-6, 9);
  });
  it('returns null when the model has no entry', () => {
    expect(computeCost('mystery/model', { prompt_tokens: 100, completion_tokens: 50 }, prices)).toBeNull();
  });
  it('returns null when tokens are missing', () => {
    expect(computeCost('anthropic/claude-haiku-4.5', {} as any, prices)).toBeNull();
  });
});
