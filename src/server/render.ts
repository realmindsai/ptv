import { readFileSync } from 'fs';
import { resolve } from 'path';

const TEMPLATES_DIR = resolve(__dirname, 'templates');
const cache = new Map<string, string>();

function load(name: string): string {
  let t = cache.get(name);
  if (!t) {
    t = readFileSync(resolve(TEMPLATES_DIR, name), 'utf8');
    cache.set(name, t);
  }
  return t;
}

export function render(template: string, ctx: Record<string, unknown>): string {
  return expand(load(template), ctx);
}

function expand(s: string, ctx: Record<string, unknown>): string {
  // {{#each items}}…{{/each}}
  s = s.replace(/{{#each\s+(\w+)}}([\s\S]*?){{\/each}}/g, (_, key, body) => {
    const arr = ctx[key];
    if (!Array.isArray(arr)) return '';
    return arr.map((item) => expand(body, item as Record<string, unknown>)).join('');
  });
  // {{{var}}} raw (no escape)
  s = s.replace(/{{{(\w+(?:\.\w+)*)}}}/g, (_, path) => String(get(ctx, path) ?? ''));
  // {{var}} escaped
  s = s.replace(/{{(\w+(?:\.\w+)*)}}/g, (_, path) => escape(String(get(ctx, path) ?? '')));
  return s;
}

function get(ctx: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]),
    ctx,
  );
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
