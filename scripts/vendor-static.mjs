#!/usr/bin/env node
// One-shot downloader for vendored web assets. Run via `node scripts/vendor-static.mjs`.
// The downloaded files are committed to the repo; production builds need no network.
//
// If a gstatic font URL 404s (Google rotates them occasionally), visit:
//   https://fonts.googleapis.com/css2?family=Epilogue:wght@400&display=swap
//   https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&display=swap
// Copy the woff2 URL from each response and update the url field below.
// Document the substitution date in a comment.
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const OUT_DIR = resolve(process.cwd(), 'src/server/static-assets');
mkdirSync(OUT_DIR, { recursive: true });

const ASSETS = [
  { name: 'htmx.min.js',    url: 'https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js' },
  { name: 'leaflet.js',     url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' },
  { name: 'leaflet.css',    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' },
  // The two woff2 files below are the regular (400) weights of each family.
  // For the v1 ship we only vendor 400; weights 500/600 fall back to system stack.
  // JetBrains Mono 400 (Latin subset).
  // URL substituted 2026-05-17: v18 URL returned 404; current URL taken from
  //   https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&display=swap
  // (latin unicode-range block, now v24).
  { name: 'jetbrains-mono.woff2',
    url: 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxTOlOVk6OThhvA.woff2' },
  // Epilogue 400 (Latin subset).
  // URL substituted 2026-05-17: v17 URL returned 404; current URL taken from
  //   https://fonts.googleapis.com/css2?family=Epilogue:wght@400&display=swap
  // (latin unicode-range block, now v20).
  { name: 'epilogue.woff2',
    url: 'https://fonts.gstatic.com/s/epilogue/v20/O4ZMFGj5hxF0EhjimngomvnCCtqb30OXMDPSC5_UqATfVXtU.woff2' },
];

for (const { name, url } of ASSETS) {
  process.stdout.write(`fetching ${name}... `);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    console.error(`FAILED (${res.status})`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolve(OUT_DIR, name), buf);
  console.log(`${buf.length.toLocaleString()} bytes`);
}
