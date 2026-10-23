import type { Metadata } from "next";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { CommitteeCard, type Member } from "@/components/pages/committee/CommitteeCard";

export const metadata: Metadata = {
  title: "Committee | ROW",
  description:
    "ROW Web Committee: the advisors and members behind the website of ROW.",
};

/* Content verbatim from example.org/committee.aspx — do not edit names,
   roles or districts without re-checking the live page. */

const ADVISORS: Member[] = [];

const COMMITTEE: Member[] = [];

function SectionHeader({
  eyebrow,
  title,
  note,
  count,
  countLabel,
}: {
  eyebrow: string;
  title: string;
  note?: string;
  count: number;
  countLabel: string;
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-6 lg:mb-14">
      <div>
        <div data-animate="rule" className="rule-gold" />
        <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
          {eyebrow}
        </p>
        <h2
          data-animate="up"
          data-animate-duration="0.7"
          className="mt-4 font-display text-heading font-[450] tracking-tight text-navy-950"
        >
          {title}
        </h2>
        {note && (
          <p
            data-animate="up"
            data-animate-duration="0.7"
            data-animate-delay="0.1"
            className="microlabel mt-4"
          >
            {note}
          </p>
        )}
      </div>
      <p data-animate="up" data-animate-duration="0.7" className="pb-1 text-[14px] text-muted">
        <span className="figure text-3xl text-gold-deep">{count}</span> {countLabel}
      </p>
    </div>
  );
}

export default function CommitteePage() {
  return (
    <>
      {/* Standard split-serif banner — text only, no portrait cluster. */}
      <PageBanner
        eyebrow="ROW"
        subtitle="Five advisors and a six-member team behind portal.example.org: the website of ROW."
      >
        The Web <span className="text-gold">Committee</span>
      </PageBanner>

      {/* Advisors */}
      <section className="bg-paper py-20 lg:py-28">
        <div className="container-rotary">
          <SectionHeader
            eyebrow="Advisory Board"
            title="The Advisors"
            count={ADVISORS.length}
            countLabel="advisors to the committee"
          />
          <div
            data-animate-stagger="up"
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-5"
          >
            {ADVISORS.map((m) => (
              <CommitteeCard key={m.n} m={m} />
            ))}
          </div>
        </div>
      </section>

      {/* Web Committee */}
      <section className="bg-porcelain py-20 lg:py-28">
        <div className="container-rotary">
          <SectionHeader
            eyebrow="Working Team"
            title="Web Committee"
            note="Website Chairman · Web Master"
            count={COMMITTEE.length}
            countLabel="members across the zones"
          />
          <div
            data-animate-stagger="up"
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:gap-6"
          >
            {COMMITTEE.map((m) => (
              <CommitteeCard key={m.n} m={m} />
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
