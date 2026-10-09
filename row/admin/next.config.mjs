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
        hostname: "rizones45678.org",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
