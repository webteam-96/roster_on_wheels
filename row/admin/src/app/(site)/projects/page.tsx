import type { Metadata } from "next";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ProjectsHub } from "@/components/pages/projects/ProjectsHub";
import { SAMPLE_PROJECTS } from "@/components/pages/projects/sampleProjects";
import { driftedOverview, getSnapshot } from "@/lib/projectStatsServer";

export const metadata: Metadata = {
  title: "Projects | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Service on the ground across Rotary Zones 4, 5, 6, 7 & 8 — browse club projects by state, district, club and area of focus.",
};

// The overview is handed down from the server-side snapshot (src/lib/statsCache.ts), so
// the live hub renders on the FIRST paint with real numbers already in the HTML. Without
// it the hub has to probe the API on mount and shows the bundled sample until the answer
// lands — a visible swap, and an 8-second one on a cold upstream. A null snapshot (cold
// cache, first request after a deploy) falls back to exactly that old behaviour, so this
// is a speed-up, never a dependency.
//
// The PageBanner is not decorative — the hub's first child is a -mt-16 filter console
// that expects a banner seam directly above it, and it carries the page's only <h1>.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { area?: string | string[] };
}) {
  // ?area=<cause> deep-link from the home page, About and /projects/[id]; the
  // hub matches it loosely via normArea(). A repeated param arrives as an
  // array — ignore it rather than hand normArea() a non-string.
  const area = typeof searchParams.area === "string" ? searchParams.area : undefined;

  const snapshot = await getSnapshot();

  return (
    <>
      <PageBanner
        eyebrow="Service on the ground"
        subtitle="Club work from across the zones — filter by state, district, club or area of focus, then open any project for the full story."
      >
        Rotary <span className="text-gold">Projects</span>
      </PageBanner>

      <ProjectsHub
        projects={SAMPLE_PROJECTS}
        initialArea={area}
        initialOverview={snapshot ? driftedOverview(snapshot) : null}
      />

      <SiteFooter />
    </>
  );
}
