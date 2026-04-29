import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // `npm run dev` doesn't run /api/* serverless functions, so without this
      // proxy every Scryfall call 404s and collection imports fail. In
      // production (Vercel) the serverless function at api/scryfall/[...path].js
      // handles the same path. Scryfall has no auth, so it's safe to talk to
      // it directly from the dev server.
      '/api/scryfall': {
        target: 'https://api.scryfall.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/scryfall/, ''),
      },
    },
  },
})
