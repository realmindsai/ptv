import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
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
cpSync(resolve(__dirname, 'index.html'), resolve(outDir, 'index.html'));

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
