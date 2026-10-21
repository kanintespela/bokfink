import { execSync } from 'node:child_process';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The commit this build is made from. CI names it; a local build asks git,
 * and a copy without git history says so rather than failing the build.
 */
function byggcommit(): string {
  if (process.env.GITHUB_SHA !== undefined) {
    return process.env.GITHUB_SHA.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'okänd';
  }
}

export default defineConfig({
  define: {
    __KONTERA_COMMIT__: JSON.stringify(byggcommit()),
    __KONTERA_BYGGD__: JSON.stringify(
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }),
    ),
  },
  plugins: [
    react(),
    VitePWA({
      /*
       * "prompt", not "autoUpdate". An automatic reload can land in the middle
       * of registering a verifikat and throw away what was typed. The user
       * decides when to take the new version.
       */
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Kontera',
        short_name: 'Kontera',
        description: 'Bokföring för enskild firma. All data stannar på din enhet.',
        lang: 'sv-SE',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e3b32',
        theme_color: '#0e3b32',
        categories: ['finance', 'business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /*
         * Hard rule 7: everything ships with the app. Every request the app
         * makes is to its own origin, so "runtime caching" here never means
         * the network in the sense the rule forbids.
         */
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        /*
         * The readers are heavy: twenty-six megabytes of OCR engine and
         * language data, three of PDF parser and character maps. Precaching
         * them would make installing the app a thirty megabyte download for
         * features that might never be used, and would exceed Workbox's own
         * size limit besides. They are fetched from our own origin the first
         * time an underlag is read, and cached for good afterwards - so
         * reading works offline from the second time, and the app installs
         * light.
         */
        globIgnores: ['**/tesseract/**', '**/pdf/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'kontera-ocr',
              // The files are versioned by the dependency, not by content
              // hash, so they are kept until the cache is cleaned out.
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /*
             * The PDF reader, on the same terms: three megabytes of parser
             * and character maps that only a supplier's invoice needs, taken
             * from our own origin the first time one is opened and kept
             * afterwards.
             */
            urlPattern: ({ url }) => url.pathname.startsWith('/pdf/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'kontera-pdf',
              expiration: { maxEntries: 200 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        /*
         * Take control on first install so the app survives going offline
         * during the very first session. This is not skipWaiting: a new
         * version still waits for the user to accept the update banner, so
         * nothing swaps out from under an entry in progress.
         */
        clientsClaim: true,
      },
    }),
  ],
  server: {
    /*
     * Flera sessioner kan köra varsin utvecklingsserver samtidigt, och då
     * delas porten ut i PORT. Vite läser inte den variabeln själv, så den
     * läses här; utan den faller vi tillbaka på Vites egen 5173.
     */
    port: Number(process.env.PORT) || 5173,
  },

  preview: {
    /*
     * Vite refuses requests whose Host header it does not recognise, which
     * keeps a developer machine safe from DNS rebinding. Testing the app as
     * an installed PWA needs a real hostname and a real certificate, because
     * iOS only registers a service worker in a secure context - so the host
     * is named in an environment variable rather than hardcoded here or the
     * protection switched off for everyone.
     *
     *   KONTERA_PREVIEW_HOST=min-dator.exempel.ts.net npm run preview
     */
    allowedHosts: (process.env.KONTERA_PREVIEW_HOST ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
  },

  test: {
    // Node by default so domain tests stay fast and DOM-free, which is also
    // the boundary CLAUDE.md asks us to guard. Files that genuinely need a
    // document opt in with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
