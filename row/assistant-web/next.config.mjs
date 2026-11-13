/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pure static site (out/) served by IIS — no Node server.
  output: "export",
  // Emits out/login/index.html instead of out/login.html, so IIS resolves /login/ with its
  // default-document handling (see public/web.config).
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
};

if (process.argv.includes("build") && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn(
    "\n⚠ NEXT_PUBLIC_API_URL is not set — the build will call http://localhost:5000. " +
      "Set it (e.g. https://<your-api-host>/api) before building for production.\n",
  );
}

export default nextConfig;
