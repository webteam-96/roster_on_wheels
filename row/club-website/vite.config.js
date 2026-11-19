import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Fills __API_BASE__ in dist/web.config (the link-preview bot rule) from VITE_ApiBaseUrl, so the one
// web.config in public/ works for every environment. A build without the value fails instead of
// shipping a rule that redirects bots to a placeholder.
function webConfigApiBase(apiBase) {
  return {
    name: 'web-config-api-base',
    apply: 'build',
    closeBundle() {
      const file = resolve('dist/web.config')
      if (!existsSync(file)) return
      if (!apiBase) throw new Error('VITE_ApiBaseUrl is empty: dist/web.config needs it for the link-preview rule.')
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__API_BASE__', apiBase.replace(/\/+$/, '')))
    },
  }
}

// Port 3000 on purpose: the public API CORS-whitelists http://localhost:3000.
// (The ASP.NET original calls the API server-side, so it never needed CORS —
// this SPA calls it from the browser, so every deployed domain must be on the
// API's allow-list too. See README.)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), webConfigApiBase(env.VITE_ApiBaseUrl)],
    server: { port: 3000, host: true },
    preview: { port: 3000 },
    build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  }
})
