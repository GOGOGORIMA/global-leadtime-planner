import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs: the same `dist/` works on Cloudflare Pages (served at "/")
  // and on GitHub Pages project sites (served at "/<repo>/") without any changes.
  // The app has no client-side routes (state lives in the query string), so this is safe.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // `date-holidays` ships rule data for ~200 countries (+ moment-timezone data). That vendor
    // chunk is intentionally large (~1.4 MB raw / ~280 kB gzip); warn only above that.
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        // Split rarely-changing vendor code from app code so redeploys keep the big
        // holiday-data chunk cached in browsers / CDN. three.js gets its own chunk: it is only
        // imported by the lazily loaded 3D viewer (tab ⑤), so it must not end up in `vendor`.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 3 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
