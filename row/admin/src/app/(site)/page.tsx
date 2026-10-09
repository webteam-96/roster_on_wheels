import { Hero } from "@/components/site/Hero";
import { AboutSection } from "@/components/site/AboutSection";
import { AreasOfFocus, AREAS } from "@/components/site/AreasOfFocus";
import { HighlightCards } from "@/components/site/HighlightCards";
import { WebDirectories } from "@/components/site/WebDirectories";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ScrubMarquee } from "@/components/motion/ScrubMarquee";

export default function HomePage() {
  return (
    <>
      <Hero />

      {/* Cause spectrum — 6px full-bleed divider in the 7 official cause hexes */}
      <div aria-hidden className="flex h-1.5 w-full">
        {AREAS.map((a) => (
          <span key={a.label} className="flex-1" style={{ backgroundColor: a.color }} />
        ))}
      </div>

      <AboutSection />
      <AreasOfFocus />
      <ScrubMarquee text="Service Above Self" serif className="bg-paper" />
      <HighlightCards />
      <WebDirectories />
      <SiteFooter />
    </>
  );
}
