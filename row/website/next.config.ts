import type { NextConfig } from "next";

// Classic page lifecycle: a page unmounts on navigation, so every page's GSAP
// scenes and ScrollTriggers are built on mount and reverted on unmount.
const nextConfig: NextConfig = {
  // .next/standalone: a self-contained server (server.js + only the node_modules it needs) for the IIS deploy
  output: "standalone",
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
