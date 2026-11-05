// ABOUTME: Guards bike-rail's Content-Security-Policy (report-only rollout) and its report sink.
// ABOUTME: realmindsai/security bead security-sdr.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createChatApp } from '../../../src/chat/server';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function directives(header: string | string[] | undefined): Map<string, string[]> {
  expect(typeof header).toBe('string');
  const out = new Map<string, string[]>();
  for (const part of (header as string).split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe('Content-Security-Policy-Report-Only', () => {
  it('is sent on every response while the policy is being measured', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy-report-only']).toBeDefined();
  });

  it('is not yet enforced, so a wrong guess cannot break the map', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it("allows scripts only from the site itself, with no 'unsafe-inline' or 'unsafe-eval'", async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const d = directives(res.headers['content-security-policy-report-only']);
    expect(d.get('script-src')).toEqual(["'self'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
  });

  it('lets Leaflet load OpenStreetMap tiles and the GPX blob, and nothing else off-site for images', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const img = directives(res.headers['content-security-policy-report-only']).get('img-src');
    expect(img).toEqual(["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org']);
  });

  it('keeps chat traffic same-origin and closes plugins, base-tag and form hijacking', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    const d = directives(res.headers['content-security-policy-report-only']);
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'self'"]);
  });

  it('sends violation reports to the app itself', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(directives(res.headers['content-security-policy-report-only']).get('report-uri')).toEqual(['/csp-report']);
  });
});

describe('POST /csp-report', () => {
  const report = {
    'csp-report': {
      'document-uri': 'https://bike-rail.realmindsai.com.au/',
      'violated-directive': 'script-src-elem',
      'blocked-uri': 'inline',
    },
  };

  it('accepts a browser report (application/csp-report) and answers 204', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify(report),
    });
    expect(res.statusCode).toBe(204);
  });

  it('accepts the Reporting API form (application/reports+json)', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/csp-report',
      headers: { 'content-type': 'application/reports+json' },
      payload: JSON.stringify([{ type: 'csp-violation', body: { blockedURL: 'inline' } }]),
    });
    expect(res.statusCode).toBe(204);
  });

  it('refuses an oversized body, since the endpoint is public and unauthenticated', async () => {
    app = createChatApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { padding: 'x'.repeat(20_000) } }),
    });
    expect(res.statusCode).toBe(413);
  });
});
