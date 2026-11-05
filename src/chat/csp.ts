// ABOUTME: bike-rail's Content-Security-Policy, sent Report-Only while it is measured, plus a report sink.
// ABOUTME: realmindsai/security bead security-sdr; enforce by switching REPORT_ONLY once reports are clean.
import type { FastifyInstance } from 'fastify';

// The page loads only same-origin scripts (/static/leaflet.js, /static/app.js) and has
// no inline script of its own. The one inline <script> a browser sees on
// bike-rail.realmindsai.com.au is injected by Cloudflare's bot-detection layer and
// changes per request, so it cannot be allowed by hash; Report-Only is how we learn
// whether it needs an exception before anything is enforced.
//
// style-src keeps 'unsafe-inline': Leaflet writes style attributes into the markup it
// builds, and app.js renders chat messages through innerHTML. Scripts are the XSS
// vector this policy exists to close; inline styles are not.
//
// img-src: OpenStreetMap tiles (app.js uses https://{s}.tile.openstreetmap.org), data:
// for Leaflet's inline icons, blob: for the GPX export link.
export const CSP_DIRECTIVES: ReadonlyArray<readonly [string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob: https://*.tile.openstreetmap.org"],
  ['font-src', "'self'"],
  ['connect-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'self'"],
  ['report-uri', '/csp-report'],
];

export const CSP_POLICY = CSP_DIRECTIVES.map(([name, value]) => `${name} ${value}`).join('; ');

// Flip to false (header becomes Content-Security-Policy) once /csp-report has run clean.
export const REPORT_ONLY = true;

// Browsers send a few hundred bytes per violation; anything larger is not a report.
const REPORT_BODY_LIMIT = 8 * 1024;

export function registerCsp(app: FastifyInstance): void {
  const header = REPORT_ONLY ? 'content-security-policy-report-only' : 'content-security-policy';
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header(header, CSP_POLICY);
    return payload;
  });

  // report-uri sends application/csp-report; the Reporting API sends application/reports+json.
  for (const type of ['application/csp-report', 'application/reports+json']) {
    app.addContentTypeParser(type, { parseAs: 'string', bodyLimit: REPORT_BODY_LIMIT }, (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
  }

  app.post('/csp-report', { bodyLimit: REPORT_BODY_LIMIT }, async (req, reply) => {
    req.log.warn({ csp_report: req.body }, 'csp violation report');
    return reply.code(204).send();
  });
}
