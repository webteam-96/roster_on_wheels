import { PageBanner } from "@/components/site/PageBanner";

/** Standard split-serif banner — text only, no portrait cluster. */
export function LeadersHero() {
  return (
    <PageBanner
      eyebrow="Our Leadership"
      subtitle="Visionary leaders guiding Rotary's mission across the zones."
    >
      the zones <span className="text-gold">leaders</span>
    </PageBanner>
  );
}
