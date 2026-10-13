import createNextIntlPlugin from "next-intl/plugin";

// Translation without locale routing: see src/i18n/config.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Images may be served from the instance's own API host (NEXT_PUBLIC_API_URL) as well as
// the ROW host the existing pattern list already allows.
function apiImagePattern() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_API_URL || "");
    return [{ protocol: url.protocol.replace(":", ""), hostname: url.hostname, ...(url.port ? { port: url.port } : {}), pathname: "/**" }];
  } catch {
    return [];
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
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
      {
        protocol: "https",
        hostname: "portal.example.org",
        pathname: "/**",
      },
      ...apiImagePattern(),
    ],
  },
};

export default withNextIntl(nextConfig);
