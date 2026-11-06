function hostOf(url) {
  try { return url ? new URL(url).hostname : ""; } catch { return ""; }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "5000",
        pathname: "/**",
      },
      // Public-domain photos for theme-preview sample content (src/lib/samplePhotos.ts).
      { protocol: "https", hostname: "thumb.wikimedia.org", pathname: "/wikipedia/commons/**" },
      // The API host and every club host, from configuration (no product domain in code).
      ...[hostOf(process.env.NEXT_PUBLIC_API_URL), hostOf(process.env.NEXT_PUBLIC_PORTAL_ORIGIN)]
        .filter(Boolean)
        .map((hostname) => ({ protocol: "https", hostname, pathname: "/**" })),
      ...(process.env.NEXT_PUBLIC_CLUB_SITE_PARENT_DOMAIN
        ? [{ protocol: "https", hostname: `**.${process.env.NEXT_PUBLIC_CLUB_SITE_PARENT_DOMAIN}`, pathname: "/**" }]
        : []),
    ],
  },
};

export default nextConfig;
