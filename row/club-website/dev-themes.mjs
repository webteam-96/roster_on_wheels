// Serve all five themes at once, one port each — the React equivalent of the
// ASP.NET workspace's single /config-mode IIS Express instance covering
// 8090-8094.
//
// It works because ThemeResolver's step (a2) reads DevThemePortMap and matches
// window.location.port, exactly as the C# matches Request.Url.Port. So the five
// servers run the SAME app and the theme is decided in the browser, per port.
//
// Vite's JS API lets all five live in ONE node process, so this is one thing to
// start and one thing to stop.
import { createServer } from 'vite'

// Must match VITE_DevThemePortMap in .env.local — that is what actually picks
// the theme; this list only decides which ports get a server.
const PORTS = {
  8090: 'classic-blue',
  8091: 'warm-modern',
  8092: 'civic-bold',
  8093: 'verdigris-ledger',
  8094: 'madras-legacy',
  8095: 'gold',
  8096: 'handloom',
  // Theme 8 family (unreleased). 8099 is skipped: a local PHP dev server owns it.
  8100: 'cinematic',
  8101: 'split-story',
  8102: 'liquid-motion',
  8103: 'horizontal-journey',
  8104: 'photo-collage',
  8105: 'sunrise',
}

// Optional port filter: `node dev-themes.mjs 8100 8101 ...` serves only those
// (e.g. the Theme 8 ports while the older ones already run elsewhere).
const only = process.argv.slice(2).map(Number).filter(Boolean)
const servers = []
for (const [port, theme] of Object.entries(PORTS)) {
  if (only.length && !only.includes(Number(port))) continue
  const server = await createServer({
    configFile: './vite.config.js',
    // warmup: compile this port's own theme at startup, so the first page open is not
    // a 2-4s on-demand compile of ~124 modules (each server has its own module graph)
    server: { port: Number(port), strictPort: true, host: true,
      warmup: { clientFiles: ['./src/main.jsx', './src/themes/' + theme + '/**/*.{js,jsx}'] } },
  })
  await server.listen()
  servers.push(server)
  console.log(`  http://localhost:${port}/`.padEnd(28) + theme)
}

console.log('\nAll ' + servers.length + ' themes are up. Ctrl+C to stop them all.')
console.log('(A port with no mapping falls through the normal chain to the club\'s own theme.)')

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await Promise.all(servers.map((s) => s.close()))
    process.exit(0)
  })
}
