import type { Metadata } from "next";
import Image from "next/image";
import { ChevronDown, FileDown, Play } from "@/components/icons";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ChapterRail } from "@/components/motion/ChapterRail";
import { LeadersHero } from "@/components/pages/leaders/LeadersHero";
import { LeaderProfile } from "@/components/pages/leaders/LeaderProfile";
import {
  CURRENT_LEADERS,
  PAST_PRESIDENTS,
  type LeaderProfileData,
} from "@/components/pages/leaders/data";

export const metadata: Metadata = {
  title: "Our Leaders | ROW",
  description:
    "Visionary leaders guiding Rotary's mission across India, Sri Lanka, Nepal, Maldives & Bhutan.",
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const RAIL_ITEMS = [
  ...CURRENT_LEADERS.map((l) => ({ id: slug(l.name), label: l.name })),
  { id: "past-presidents", label: "Past RI Presidents" },
];

/**
 * Quieter archive register for a past president: compact identity row,
 * documents as quiet links, full verbatim biography behind a native
 * disclosure so the legacy voice stays present but subdued.
 */
function ArchiveEntry({ leader }: { leader: LeaderProfileData }) {
  const { name, roles, photo, biodata, video, bio } = leader;
  return (
    <article className="flex flex-col rounded-2xl bg-white/70 p-5 ring-1 ring-navy-950/[0.06] sm:p-6">
      <div className="flex items-center gap-4">
        <div className="media-grade h-20 w-16 shrink-0 rounded-xl bg-paper-200 ring-1 ring-navy-950/10">
          <Image src={photo} alt={name} fill sizes="64px" className="object-cover object-top" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-[560] leading-tight tracking-[-0.01em] text-navy-950">
            {name}
          </h3>
          <p className="mt-1 text-[13px] font-medium leading-snug text-muted">
            {roles.join(" · ")}
          </p>
        </div>
      </div>

      <details className="group mt-4 border-t border-navy-950/10 pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-[13px] font-semibold text-gold-deep transition-colors duration-200 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark [&::-webkit-details-marker]:hidden">
          Read biography
          <ChevronDown
            aria-hidden
            className="h-4 w-4 transition-transform duration-300 group-open:rotate-180"
          />
        </summary>
        <div className="mt-4 space-y-3 text-[14px] leading-[1.75] text-muted [&_b]:font-semibold [&_b]:text-navy-900">
          {bio}
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {biodata && (
          <a
            href={biodata}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm text-[13px] font-semibold text-navy-900 transition-colors duration-200 hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
          >
            <FileDown aria-hidden className="h-4 w-4" />
            Biodata (PDF)
          </a>
        )}
        {video && (
          <a
            href={video}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm text-[13px] font-semibold text-navy-900 transition-colors duration-200 hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
          >
            <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
            Video introduction
          </a>
        )}
      </div>
    </article>
  );
}

export default function OurLeadersPage() {
  return (
    <>
      <LeadersHero />

      <section className="bg-paper py-16 lg:py-24">
        <div className="container-rotary">
          <div className="flex items-start gap-12 xl:gap-16">
            <ChapterRail items={RAIL_ITEMS} />

            <div className="min-w-0 flex-1">
              <div data-animate="rule" className="rule-gold" />
              <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
                the zones
              </p>
              <h2
                data-animate="up"
                data-animate-duration="0.7"
                className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
              >
                Rotary International <em className="accent-serif text-accent-gold">leaders</em>
              </h2>

              <div className="mt-12 space-y-14 lg:mt-14 lg:space-y-16">
                {CURRENT_LEADERS.map((leader) => (
                  <LeaderProfile key={leader.name} leader={leader} id={slug(leader.name)} />
                ))}
              </div>

              {/* Past presidents — visibly quieter porcelain archive register */}
              <section
                id="past-presidents"
                aria-label="Past Rotary International Presidents"
                className="mt-20 scroll-mt-28 rounded-3xl bg-porcelain p-6 sm:p-10"
              >
                <div data-animate="rule" className="rule-gold" />
                <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
                  Legacy of Leadership
                </p>
                <h2
                  data-animate="up"
                  data-animate-duration="0.7"
                  className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
                >
                  Past Rotary International presidents
                </h2>
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:mt-10 lg:gap-6">
                  {PAST_PRESIDENTS.map((leader) => (
                    <ArchiveEntry key={leader.name} leader={leader} />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
