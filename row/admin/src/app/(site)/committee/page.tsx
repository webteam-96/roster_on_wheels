import type { Metadata } from "next";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { CommitteeCard, type Member } from "@/components/pages/committee/CommitteeCard";

export const metadata: Metadata = {
  title: "Committee | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Rizones45678.org Web Committee — the advisors and members behind the website of Rotary Zones 4, 5, 6, 7 & 8.",
};

/* Content verbatim from rotaryindia.org/committee.aspx — do not edit names,
   roles or districts without re-checking the live page. */

const ADVISORS: Member[] = [
  {
    n: "01",
    variant: "advisor",
    name: "PRID A.S. Venkatesh",
    alt: "PRID A.S. Venkatesh",
    role: "Trustee, The Rotary Foundation",
    roleNote: "(2026-30)",
    photo: "/images/committee/as-venkatesh.png",
  },
  {
    n: "02",
    variant: "advisor",
    name: "K. P. Nagesh",
    alt: "K. P. Nagesh",
    role: "Rotary International Director 2025-27",
    roleNote: "(Zone 4 & 7)",
    photo: "/images/committee/kp-nagesh.jpg",
  },
  {
    n: "03",
    variant: "advisor",
    name: "M. Muruganandam",
    alt: "M. Muruganandam",
    role: "Rotary International Director 2025-27",
    roleNote: "(Zone 5 & 6)",
    photo: "/images/committee/muruganandam.jpg",
  },
  {
    n: "04",
    variant: "advisor",
    name: "Gurjeet Singh Sekhon",
    alt: "PDG Gurjeet Singh Sekhon",
    role: "Rotary International Director 2027-29",
    roleNote: "(Zone 4 & 7)",
    photo: "/images/committee/gurjeet-sekhon.jpg",
  },
  {
    n: "05",
    variant: "advisor",
    name: "Basu Dev Golyan",
    alt: "Basu Dev Golyan",
    role: "Rotary International Director 2027-29",
    roleNote: "(Zone 5 & 6)",
    photo: "/images/committee/basu-dev-golyan.png",
  },
];

const COMMITTEE: Member[] = [
  {
    n: "06",
    variant: "member",
    name: "PDG Angsuman Bandyopadhyay",
    alt: "PDG Angsuman Bandyopadhyay",
    role: "Website Chairman",
    district: "(District 3291)",
    photo: "/images/committee/angsuman.jpg",
  },
  {
    n: "07",
    variant: "member",
    name: "IPDG Ravi Prakash",
    alt: "Ravi Prakash",
    role: "Zonal Coordinator  - Zone 4",
    district: "(District 3080)",
    photo: "/images/committee/ravi-prakash.jpeg",
  },
  {
    n: "08",
    variant: "member",
    name: "PDG Dr. Nandakumar N",
    alt: "Dr. Nandakumar N",
    role: "Zonal Coordinator  - Zone 5",
    district: "(District 3233)",
    photo: "/images/committee/nandakumar.jpg",
  },
  {
    n: "09",
    variant: "member",
    name: "PDG Prabir Chatterjee",
    alt: "PDG Prabir Chatterjee",
    role: "Zonal Coordinator  - Zone 6",
    district: "(District 3291)",
    photo: "/images/committee/prabir-chatterjee.jpg",
  },
  {
    n: "10",
    variant: "member",
    name: "PDG Jeetendra Aneja",
    alt: "PDG Jeetendra Aneja",
    role: "Zonal Coordinator  - Zone 7",
    district: "(District 3192)",
    photo: "/images/committee/jeetendra-aneja.jpg",
  },
  {
    n: "11",
    variant: "member",
    name: "Rtn. Narendra Rao",
    alt: "Rtn. Narendra Rao",
    role: "Web Master",
    district: "(District 3142)",
    photo: "/images/committee/narendra-rao.jpg",
  },
];

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
        eyebrow="Rotary Zones 4, 5, 6, 7 & 8"
        subtitle="Five advisors and a six-member team behind rizones45678.org — the website of Rotary Zones 4, 5, 6, 7 & 8."
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
            note="Website Chairman · Zonal Coordinators, Zones 4–7 · Web Master"
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
