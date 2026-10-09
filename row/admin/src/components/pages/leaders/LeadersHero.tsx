import { PageBanner } from "@/components/site/PageBanner";

/** Standard split-serif banner — text only, no portrait cluster. */
export function LeadersHero() {
  return (
    <PageBanner
      eyebrow="Our Leadership"
      subtitle="Visionary leaders guiding Rotary's mission across Zones 4, 5, 6, 7 & 8."
    >
      Zones 4, 5, 6, 7 &amp; 8 <span className="text-gold">leaders</span>
    </PageBanner>
  );
}
