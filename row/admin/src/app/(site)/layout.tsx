import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Animator } from "@/components/site/Animator";
import { PageTransition } from "@/components/motion/PageTransition";
import { ScrollToTop } from "@/components/motion/ScrollToTop";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

/** Editorial serif for display headings + italic accents — Fraunces variable
 *  (upright + italic) with the optical-size axis; weights via font-[340/450/560]. */
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rotary Zones 4, 5, 6, 7 & 8 | Service Above Self",
  description:
    "Rotary Zones 4, 5, 6, 7 & 8 unite clubs across India, Sri Lanka, Nepal, Maldives & Bhutan to serve communities and transform lives.",
};

/**
 * Public website shell. This is a GROUP layout (no <html>/<body> — the admin
 * root layout provides those). All public-site styling is confined to the
 * `.site-shell` wrapper so it never restyles the admin app.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${fraunces.variable} site-shell flex min-h-screen flex-col`}>
      {/* If JavaScript is unavailable, never leave reveal elements hidden. */}
      <noscript>
        <style>{`.site-shell [data-animate]{opacity:1 !important;transform:none !important;filter:none !important}`}</style>
      </noscript>
      <ScrollToTop />
      <Animator />
      <SiteHeader />
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
