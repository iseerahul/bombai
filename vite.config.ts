import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  /*
   * The map lives under /app. The front door at / is the separate landing app
   * in `landing/` (the mumbai-zenscape repo), and both are served from one
   * Cloudflare origin so "Explore Bambai" is a same-origin navigation rather
   * than a jump to another host.
   *
   * This applies in dev too, so the dev URL is http://127.0.0.1:5173/app/ —
   * matching production rather than diverging from it.
   */
  base: '/app/',
  server: {
    port: 5173,
    // During `npm run dev` the Worker runs separately on :8787 (`npm run worker:dev`).
    // In production both are served from the same Cloudflare origin, so the app
    // always calls a same-origin relative "/api/..." path and never needs a base URL.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Beside the landing's own output, not on top of it.
    outDir: 'dist/app',
    // POI GeoJSON lives in /public/data and is copied verbatim; it must stay as
    // separate lazy-loadable files rather than being inlined into the bundle.
    assetsInlineLimit: 4096,
  },
})
