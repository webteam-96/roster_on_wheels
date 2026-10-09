import type { Metadata } from "next";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";

export const metadata: Metadata = {
  title: "International & National Websites | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Explore the official Rotary International and Rotary News platforms to stay informed and connected with Rotary worldwide.",
};

type Site = {
  name: string;
  monogram: string;
  desc: string;
  href: string;
  domain: string;
};

/** The four official destinations. */
const GROUPS: { label: string; note: string; sites: Site[] }[] = [
  {
    label: "International",
    note: "The global home of the movement.",
    sites: [
      {
        name: "Rotary International",
        monogram: "RI",
        desc: "The official home of the movement — 1.4 million members, 46,000+ clubs, and the global initiatives, programs, and impact stories that define Rotary worldwide.",
        href: "https://www.rotary.org",
        domain: "rotary.org",
      },
      {
        name: "The Rotary Foundation",
        monogram: "TRF",
        desc: "The charitable engine of Rotary — funding grants, PolioPlus, peace fellowships, and projects in every area of focus.",
        href: "https://www.rotary.org/en/about-rotary/rotary-foundation",
        domain: "rotary.org",
      },
    ],
  },
  {
    label: "National",
    note: "Rotary's story, closer to home.",
    sites: [
      {
        name: "Rotary News Online",
        monogram: "RN",
        desc: "The latest news, features, and stories from the Rotary community — covering projects, people, and milestones across our region, every day.",
        href: "https://www.rotarynewsonline.org",
        domain: "rotarynewsonline.org",
      },
    ],
  },
  {
    label: "Fellowship",
    note: "Shared interests, worldwide.",
    sites: [
      {
        name: "Rotary Fellowships",
        monogram: "RF",
        desc: "International groups of Rotary members who share a hobby, profession, or passion — connecting people across clubs and borders through common interests.",
        href: "https://www.rotary.org/en/our-programs/more-fellowships",
        domain: "rotary.org",
      },
    ],
  },
];

/** Flat list with group labels — the bento tiles carry the grouping as chips. */
const SITES = GROUPS.flatMap((g) => g.sites.map((s) => ({ ...s, group: g.label })));
const [FLAGSHIP, ...REST] = SITES;

export default function InternationalNationalPage() {
  return (
    <>
      {/* Standard split-serif banner — the shared page-header voice */}
      <PageBanner
        eyebrow="Beyond the Zones"
        subtitle="The official platforms that carry Rotary's story past our zones — from the global home of the movement to the newsroom that follows it every day."
      >
        One Rotary, <span className="text-gold">connected worldwide</span>
      </PageBanner>

      {/* Bento showcase — kept as a component, now below the banner */}
      <section className="bg-paper py-6 lg:py-8">
        <div className="container-wide">
          <div
            data-animate-stagger="up"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12"
          >
            {/* Headline tile — 7×2 on sky */}
            <div
              data-animate="up"
              className="flex flex-col justify-center rounded-[24px] bg-[#E3EEFA] p-7 sm:col-span-2 sm:p-10 lg:col-span-7 lg:row-span-2 lg:p-14"
            >
              <p className="eyebrow">Beyond the Zones</p>
              {/* h2 — the PageBanner above owns the page's one h1 */}
              <h2 className="mt-5 font-sans text-[clamp(2.1rem,4vw,3.4rem)] font-extrabold leading-[1.06] tracking-[-0.03em] text-navy-950">
                One Rotary, <span className="text-azure">connected worldwide</span>
              </h2>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink/75 sm:text-base">
                The official platforms that carry Rotary&apos;s story past our zones —
                from the global home of the movement to the newsroom that follows it
                every day.
              </p>
            </div>

            {/* Flagship tile — Rotary International on azure, 5×2 */}
            <a
              href={FLAGSHIP.href}
              target="_blank"
              rel="noopener noreferrer"
              data-animate="up"
              className="group flex flex-col rounded-[24px] bg-azure p-7 text-white transition-colors duration-300 hover:bg-royal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2 sm:col-span-2 lg:col-span-5 lg:row-span-2 lg:p-9"
            >
              <div className="flex items-start justify-between gap-4">
                <span
                  aria-hidden
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[13px] font-semibold text-navy-900"
                >
                  {FLAGSHIP.monogram}
                </span>
                <ArrowUpRight className="h-6 w-6 opacity-70 transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1" />
              </div>
              <h2 className="mt-auto pt-10 text-2xl font-bold tracking-[-0.01em]">
                {FLAGSHIP.name}
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-white/80">
                {FLAGSHIP.desc}
              </p>
              <p className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white/60">
                {FLAGSHIP.domain} · {FLAGSHIP.group ?? "International"}
              </p>
            </a>

            {/* Remaining platforms — 3-col white tiles */}
            {REST.map((site) => (
              <a
                key={site.name}
                href={site.href}
                target="_blank"
                rel="noopener noreferrer"
                data-animate="up"
                className="group flex flex-col rounded-[24px] bg-white p-6 shadow-soft ring-1 ring-navy-950/[0.08] transition-shadow duration-300 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark lg:col-span-4 lg:p-7"
              >
                <div className="flex items-start justify-between gap-4">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-50 text-[12px] font-semibold text-navy-900"
                  >
                    {site.monogram}
                  </span>
                  <ExternalLink className="h-4 w-4 text-ink/40 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <h2 className="mt-5 text-[16px] font-bold leading-snug tracking-[-0.01em] text-navy-950">
                  {site.name}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  {site.desc}
                </p>
                <p className="mt-auto pt-4 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink/45">
                  {site.domain} · {site.group}
                </p>
              </a>
            ))}

          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
