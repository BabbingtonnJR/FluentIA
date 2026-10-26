/// <reference types="vitest/config" />
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * kuromoji's dictionary (~17 MB) is served at /kuromoji/ straight from node_modules, so it is not
 * committed: the dev server streams it and the build emits it. The app only fetches it when a
 * learner imports subtitles to analyse.
 */
function kuromojiDict(): Plugin {
  const dir = path.resolve('node_modules/kuromoji/dict');
  return {
    name: 'kuromoji-dict',
    configureServer(server) {
      server.middlewares.use('/kuromoji/', (req, res, next) => {
        const file = path.basename(req.url ?? '');
        if (!file.endsWith('.dat.gz')) return next();
        // No Content-Encoding: kuromoji gunzips the files itself.
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(path.join(dir, file)).on('error', () => next()).pipe(res);
      });
    },
    generateBundle() {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.dat.gz'))) {
        this.emitFile({ type: 'asset', fileName: `kuromoji/${file}`, source: readFileSync(path.join(dir, file)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    kuromojiDict(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Fluentia',
        short_name: 'Fluentia',
        description: 'Learn Japanese faster with spaced repetition, kanji and daily practice.',
        lang: 'en',
        theme_color: '#f7f4ec',
        background_color: '#f7f4ec',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Content packs are precached so every study feature works offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          // Comic pages (Pepper&Carrot) load from peppercarrot.com; each page is kept once seen, so
          // an episode read online can be reread offline. They are too many to precache (~130 MB).
          {
            urlPattern: /^https:\/\/www\.peppercarrot\.com\/0_sources\/.+\.jpg$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'comic-pages',
              expiration: { maxEntries: 200, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Recorded voices (VOICEVOX): each one kept after it is first played, so they work offline too.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/audio/') && url.pathname.endsWith('.mp3'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'voices',
              expiration: { maxEntries: 20000, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
          // The word-analysis dictionary, kept after its first download.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/kuromoji/'),
            handler: 'CacheFirst',
            options: { cacheName: 'kuromoji-dict', cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
