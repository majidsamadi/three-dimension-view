import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: process.env.APP_BASE_PATH || '/',
  plugins: [vue(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['app-icon.svg'],
    manifest: {
      id: '.', name: 'Three Dimension View · WiseStay', short_name: '3D View',
      description: 'Scan, explore, measure and export your spaces. Local-first, on your phone.',
      start_url: '.', scope: '.', display: 'standalone',
      theme_color: '#087f61', background_color: '#f5f8f7',
      icons: [{ src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,webp}'],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      // Only the application shell is cached. Private scan data lives in IndexedDB.
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/_capacitor_file_\//],
      cleanupOutdatedCaches: true,
    },
  })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', strictPort: true, port: 5173 },
  preview: { host: '127.0.0.1', strictPort: true, port: 4173 },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
})
