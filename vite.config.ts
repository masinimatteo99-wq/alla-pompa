import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { appIcon } from './scripts/icons.ts';

const icons = [
  { fileName: 'icon-192.png', size: 192 },
  { fileName: 'icon-512.png', size: 512 },
  { fileName: 'apple-touch-icon.png', size: 180 },
];

export default defineConfig({
  base: process.env.APP_BASE_PATH ?? '/',
  plugins: [{
    name: 'include-font-license',
    generateBundle() {
      this.emitFile({
        type: 'asset', fileName: 'licenses/RobotoMono-OFL.txt',
        source: readFileSync(new URL('./node_modules/@fontsource/roboto-mono/LICENSE', import.meta.url), 'utf8'),
      });
    },
  }, {
    name: 'app-icons',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const icon = icons.find(({ fileName }) => request.url?.split('?')[0]?.endsWith(`/${fileName}`));
        if (!icon) return next();
        response.setHeader('Content-Type', 'image/png');
        response.end(appIcon(icon.size));
      });
    },
    generateBundle() {
      for (const icon of icons) this.emitFile({ type: 'asset', fileName: icon.fileName, source: appIcon(icon.size) });
    },
  }, VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      id: './', name: 'Alla pompa — Diario dei consumi', short_name: 'Alla pompa',
      description: 'Rifornimenti e consumo reale da pieno a pieno, sul tuo dispositivo.',
      lang: 'it', start_url: './', scope: './', display: 'standalone',
      theme_color: '#faf7ed', background_color: '#dedfd8',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,css,woff,woff2,png,webmanifest,txt}'],
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: true,
    },
  })],
  test: { include: ['tests/**/*.test.ts'] },
});
