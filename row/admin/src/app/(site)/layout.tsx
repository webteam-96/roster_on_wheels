import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerBrand, isFeatureOn } from "@/lib/brand";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Animator } from "@/components/site/Animator";
import { PageTransition } from "@/components/motion/PageTransition";
import { ScrollToTop } from "@/components/motion/ScrollToTop";

// The description is this site's content, not brand: an instance without its own
// public content turns the site off with the site.public flag (below).
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand();
  return {
    title: `${brand.productName} | Service Above Self`,
    description:
      "ROW unite clubs across India, Sri Lanka, Nepal, Maldives & Bhutan to serve communities and transform lives.",
  };
}

/**
 * Public website shell. This is a GROUP layout (no <html>/<body> — the admin
 * root layout provides those). All public-site styling is confined to the
 * `.site-shell` wrapper so it never restyles the admin app.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // site.public off (ROW until its public content exists): the public pages send visitors to sign-in.
  if (!isFeatureOn(await getServerBrand(), "site.public")) redirect("/login");
  return (
    <div className="site-shell flex min-h-screen flex-col">
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
