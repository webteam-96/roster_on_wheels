import type { Metadata } from "next";
import { PageBanner } from "@/components/site/PageBanner";
import { AboutBento } from "@/components/pages/about/AboutBento";
import { AboutStory } from "@/components/pages/about/AboutStory";
import { ImpactAreas } from "@/components/pages/about/ImpactAreas";
import { SevaQuote } from "@/components/pages/about/SevaQuote";
import { NetworkBand } from "@/components/pages/about/NetworkBand";
import { JoinBand } from "@/components/pages/about/JoinBand";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ScrubMarquee } from "@/components/motion/ScrubMarquee";

export const metadata: Metadata = {
  title: "About Rotary Clubs in the zones | ROW",
  description:
    "Rotary Clubs in the zones unite approximately 1,80,000 Rotarians across India, Sri Lanka, Nepal, Maldives and Bhutan: serving communities in the spirit of Service Above Self.",
};

export default function AboutUsPage() {
  return (
    <>
      {/* Standard split-serif banner — the shared page-header voice */}
      <PageBanner
        eyebrow="About Us · Since 1920"
        subtitle="Service, diversity and community spirit: uniting clubs, inspiring leaders and transforming lives across five nations."
      >
        About Rotary in <span className="text-gold">the zones</span>
      </PageBanner>

      {/* Bento showcase — kept as a component, now below the banner */}
      <AboutBento />

      <div className="bg-paper">
        <AboutStory />
        <ImpactAreas />
        <SevaQuote />
        {/* The site's second and last marquee voice — serif, mid-page, never above the footer. */}
        <ScrubMarquee text="Service Above Self" serif className="bg-paper" />
        <NetworkBand />
        <JoinBand />
      </div>

      <SiteFooter />
    </>
  );
}
