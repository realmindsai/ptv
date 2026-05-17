import { createHash } from 'crypto';

export function planCacheKey(req: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(canonical(req))).digest('hex');
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) sorted[k] = canonical(o[k]);
    return sorted;
  }
  if (typeof v === 'number') return Math.trunc(v * 1e5) / 1e5;
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}
