import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 3000 on purpose: the public API CORS-whitelists http://localhost:3000.
// (The ASP.NET original calls the API server-side, so it never needed CORS —
// this SPA calls it from the browser, so every deployed domain must be on the
// API's allow-list too. See README.)
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, host: true },
  preview: { port: 3000 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
})
