import type { NextConfig } from "next";

// Classic page lifecycle: a page unmounts on navigation, so every page's GSAP
// scenes and ScrollTriggers are built on mount and reverted on unmount.
const nextConfig: NextConfig = {
  // .next/standalone: a self-contained server (server.js + only the node_modules it needs) for the IIS deploy
  output: "standalone",
  async headers() {
    if (process.env.NODE_ENV !== "production") return []; // the dev server needs eval and plain http
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // 'unsafe-inline' for scripts: Next.js writes inline bootstrap scripts, a nonce would need dynamic rendering everywhere.
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' https:; connect-src 'self' https: wss:; frame-src 'self' https:; frame-ancestors 'self'; object-src 'self'; base-uri 'self'; form-action 'self' https:" },
      ],
    }];
  },
  // Test go-live: the site runs as the IIS application "/site" beside the admin on one host (row/deploy/iis/README.md).
  basePath: process.env.SITE_BASE_PATH || undefined,
  // Pages from the first content version now live under the V2 page names.
  async redirects() {
    return [
      { source: "/about", destination: "/about-us", permanent: false },
      { source: "/for-clubs", destination: "/club-management", permanent: false },
      { source: "/for-districts", destination: "/district-management", permanent: false },
      { source: "/plan-next-year", destination: "/district-management", permanent: false },
      { source: "/my-rotary-integration", destination: "/how-to-get-started", permanent: false },
      { source: "/migration", destination: "/how-to-get-started", permanent: false },
      { source: "/languages", destination: "/", permanent: false },
      { source: "/row-vs-clubrunner-vs-dacdb", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
