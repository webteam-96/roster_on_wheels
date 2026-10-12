// Host of the ROW portal / API for next/image (NEXT_PUBLIC_PORTAL_ORIGIN, e.g. https://portal.example.org).
const portalHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? "").hostname; } catch { return ""; }
})();

// The public marketing pages carried the previous owner's content (people, events, story). Until ROW has its
// own public content they redirect to the sign-in page; set NEXT_PUBLIC_PUBLIC_SITE=true to serve them.
const CONTENT_PAGES = [
  "/", "/about-us", "/committee", "/contact-us", "/district-governors", "/events", "/past-events",
  "/international-national", "/our-leaders", "/regional-leaders", "/download",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    if (process.env.NEXT_PUBLIC_PUBLIC_SITE === "true") return [];
    return CONTENT_PAGES.flatMap((source) => [
      { source, destination: "/login", permanent: false },
      ...(source === "/" ? [] : [{ source: `${source}/:path*`, destination: "/login", permanent: false }]),
    ]);
  },
  output: "standalone",
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
  eslint: {
    // Production builds don't block on ESLint warnings (pre-existing unused-vars, no-explicit-any across codebase).
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip TS type-check at build (pre-existing code issues in area-of-focus/categories/sub-categories/audit-log).
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "5000",
        pathname: "/**",
      },
      ...(portalHost ? [{ protocol: "https", hostname: portalHost, pathname: "/**" }] : []),
    ],
  },
};

export default nextConfig;
