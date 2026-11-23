import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Chemin de base : "/" en local ; "/pk-rail/" pour GitHub Pages (BASE_PATH=/pk-rail/).
const base = process.env.BASE_PATH ?? '/';
// Aperçu publié sur claude.ai (VITE_PREVIEW=1) : chemins relatifs, sans service worker ni dossier public.
const preview = process.env.VITE_PREVIEW === '1';

export default defineConfig({
  base: preview ? './' : base,
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  build: {
    ...(preview ? { outDir: 'dist-preview', copyPublicDir: false } : {}),
    // MapLibre seul pèse ≈ 1 Mo (290 Ko compressé) : c'est attendu, pas un oubli de découpage.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        // La carte (MapLibre) et les bibliothèques à part : à chaque mise à jour de l'appli, le téléphone ne
        // retélécharge que le petit fichier de l'appli (≈ 200 Ko au lieu de 1,4 Mo).
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    // Aperçu sans service worker : module d'enregistrement vide.
    preview && {
      name: 'pwa-register-vide',
      resolveId: (id: string) => (id === 'virtual:pwa-register' ? '\0pwa-register-vide' : null),
      load: (id: string) => (id === '\0pwa-register-vide' ? 'export function registerSW() { return () => Promise.resolve(); }' : null),
    },
    !preview && VitePWA({
      registerType: 'autoUpdate',
      // Enregistrement fait dans main.tsx : l'appli se recharge seule dès qu'une nouvelle version est installée.
      injectRegister: false,
      manifest: {
        name: 'PK Rail',
        short_name: 'PK Rail',
        description: 'Se repérer le long des voies : ligne et PK, suivi du PK en direct, aller à un PK, accès.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#d9480f',
        theme_color: '#0b1220',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // L'appli elle-même est précachée. Les données (cases, fiches de ligne, carte des voies) sont gardées
        // par l'appli elle-même au fil de l'usage (src/lib/data.ts), même avant que le service worker soit actif.
        // Planche des dessins de signaux (rfn.json) comprise : sans elle, plus de signaux sur la carte hors réseau.
        globPatterns: ['**/*.{js,css,html,png,svg,pbf}', 'signaux/*.json'],
        globIgnores: ['data/**'],
        // La nouvelle version prend la main tout de suite (l'appli se recharge alors toute seule).
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/\/data\//],
        runtimeCaching: [
          {
            // Fond de carte OpenFreeMap (style, tuiles, sprites).
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'pkr-fond-plan', expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 24 * 3600 } },
          },
          {
            // Photo aérienne IGN.
            urlPattern: ({ url }) => url.hostname === 'data.geopf.fr',
            handler: 'CacheFirst',
            options: { cacheName: 'pkr-fond-photo', expiration: { maxEntries: 2500, maxAgeSeconds: 90 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
});
