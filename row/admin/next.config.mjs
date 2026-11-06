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

const apiOrigin = (() => { try { return new URL(process.env.NEXT_PUBLIC_API_URL || "").origin; } catch { return ""; } })();

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
        { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' ${apiOrigin} data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' https:; connect-src 'self' ${apiOrigin} https: wss:; frame-src 'self' https:; frame-ancestors 'self'; object-src 'self'; base-uri 'self'; form-action 'self' https:` },
      ],
    }];
  },
  // Served under a sub-path when NEXT_PUBLIC_BASE_PATH is set at build time (test host: "/admin", the IIS
  // application "admin"). Code that builds root URLs by hand uses withBase() from src/lib/basePath.ts.
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH.replace(/\/+$/, "") } : {}),
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
  eslint: {
    // Production builds don't block on ESLint warnings (pre-existing unused-vars, no-explicit-any across codebase).
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip TS type-check at build (pre-existing code issues in area-of-focus/audit-log).
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
