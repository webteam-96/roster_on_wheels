function hostOf(url) {
  try { return url ? new URL(url).hostname : ""; } catch { return ""; }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
