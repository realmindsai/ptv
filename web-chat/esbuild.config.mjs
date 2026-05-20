import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../src/chat/static-assets');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/main.ts')],
  outfile: resolve(outDir, 'app.js'),
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: 'es2020',
});

cpSync(resolve(__dirname, 'app.css'),    resolve(outDir, 'app.css'));

// Cache-bust asset URLs in index.html with a build-time tag so Cloudflare's
// edge cache (30-day default) doesn't serve stale CSS/JS after a deploy.
const buildTag = String(Date.now());
const indexHtml = readFileSync(resolve(__dirname, 'index.html'), 'utf8')
  .replace(/(\/static\/(?:app\.css|app\.js|leaflet\.css|leaflet\.js))(")/g,
           `$1?v=${buildTag}$2`);
writeFileSync(resolve(outDir, 'index.html'), indexHtml);

// Vendor Leaflet from the existing server's static-assets to avoid re-downloading.
cpSync(
  resolve(__dirname, '../src/server/static-assets/leaflet.js'),
  resolve(outDir, 'leaflet.js'),
);
cpSync(
  resolve(__dirname, '../src/server/static-assets/leaflet.css'),
  resolve(outDir, 'leaflet.css'),
);

console.log('built web-chat → src/chat/static-assets/');
