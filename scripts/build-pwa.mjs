import { generateSW } from 'workbox-build';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const distDir = resolve(process.cwd(), 'dist');
const rawBase = process.env.BASE ?? '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

const manifest = {
  name: 'NTVG – ¿Adivinás la canción?',
  short_name: 'NTVG',
  description: 'Adiviná canciones de No Te Va Gustar.',
  lang: 'es',
  start_url: base,
  scope: base,
  id: base,
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#09090b',
  theme_color: '#09090b',
  categories: ['games', 'music', 'entertainment'],
  icons: [
    {
      src: `${base}icon.svg`,
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any'
    },
    {
      src: `${base}icon-maskable.svg`,
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'maskable'
    }
  ]
};

await writeFile(
  resolve(distDir, 'manifest.webmanifest'),
  JSON.stringify(manifest, null, 2),
  'utf8'
);

const { count, size, warnings } = await generateSW({
  globDirectory: distDir,
  swDest: resolve(distDir, 'sw.js'),
  globPatterns: ['**/*.{html,js,css,svg,png,ico,webmanifest,json,woff,woff2}'],
  globIgnores: ['**/sw.js', '**/workbox-*.js'],
  modifyURLPrefix: { '': base },
  navigateFallback: `${base}index.html`,
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.destination === 'image',
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }
      }
    }
  ]
});

for (const w of warnings) console.warn('[workbox]', w);
console.log(`[pwa] manifest written (base="${base}")`);
console.log(`[pwa] sw.js: precached ${count} files (${(size / 1024).toFixed(1)} KB)`);
