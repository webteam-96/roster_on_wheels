import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ChapterRail } from "@/components/motion/ChapterRail";
import { ProspectiveForm } from "@/components/pages/prospective/ProspectiveForm";

export const metadata: Metadata = {
  title: "Prospective Member | Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Interested in joining Rotary? Fill in your details below to become a part of Rotary Zones 4, 5, 6, 7 & 8.",
};

/** How the enquiry travels — the quiet three-step primer above the form. */
const STEPS = [
  {
    title: "Submit your details",
    desc: "Two minutes — who you are and the club you'd like to join.",
  },
  {
    title: "Club review",
    desc: "Your selected club receives the enquiry and validates it locally.",
  },
  {
    title: "Welcome call",
    desc: "A club officer reaches out and invites you to your first meeting.",
  },
];

/** The form's three chapters — ids must match the panel ids in ProspectiveForm. */
const CHAPTERS = [
  { id: "your-details", label: "Your details" },
  { id: "district-club", label: "Your district & club" },
  { id: "confirm", label: "Confirm" },
];

export default function ProspectiveMemberPage() {
  return (
    <>
      <PageBanner
        eyebrow="Join Rotary"
        subtitle="Tell us who you are and the club you'd like to join. No fees. No obligation."
      >
        Prospective <span className="text-gold">Member</span>
      </PageBanner>

      {/* Enquiry experience */}
      <section className="bg-paper py-20 lg:py-28">
        <div className="container-rotary">
          {/* Editorial intro */}
          <div className="max-w-2xl">
            <div data-animate="rule" className="rule-gold" aria-hidden />
            <p data-animate="up" data-animate-duration="0.7" className="eyebrow mt-3.5">
              Membership Enquiry
            </p>
            <h2
              data-animate="up"
              className="mt-5 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950"
            >
              Begin your <em className="accent-serif text-accent-gold">journey</em>
            </h2>
            <p
              data-animate="up"
              data-animate-duration="0.7"
              className="mt-6 text-[17px] leading-relaxed text-muted"
            >
              Tell us a little about yourself and who pointed you our way — the club
              nearest you will take it from there. No fees. No obligation.
            </p>
            <Link
              data-animate="up"
              data-animate-duration="0.7"
              href="/contact-us"
              className="group mt-7 inline-flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
            >
              <span className="text-[15px] font-semibold text-navy-950 transition-colors duration-300 group-hover:text-gold-deep">
                Prefer a conversation? Talk to us first
              </span>
              <ArrowUpRight className="h-4 w-4 text-navy-950 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          {/* How it travels — three quiet cells on one hairline */}
          <div
            data-animate-stagger="up"
            className="mt-14 grid grid-cols-1 gap-x-10 gap-y-8 border-t border-navy-950/10 pt-10 sm:grid-cols-3 lg:mt-20"
          >
            {STEPS.map((s) => (
              <div key={s.title} data-animate="up" data-animate-duration="0.35">
                <h3 className="font-display text-lg font-[560] tracking-tight text-navy-950">
                  {s.title}
                </h3>
                <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>

          {/* The form as chapters, spied by the rail's gold timeline */}
          <div className="mt-14 lg:mt-20 lg:flex lg:items-start lg:gap-14">
            <ChapterRail items={CHAPTERS} />
            <div className="min-w-0 flex-1">
              <ProspectiveForm />
            </div>
          </div>
        </div>
      </section>

      {/* Reassurance — quiet porcelain pull-quote */}
      <section className="bg-paper pb-24 lg:pb-32">
        <div className="container-rotary">
          <div
            data-animate="up"
            className="rounded-3xl bg-porcelain px-6 py-14 text-center sm:px-12 lg:py-16"
          >
            <div className="rule-gold mx-auto" aria-hidden />
            <p className="mx-auto mt-8 max-w-3xl font-display text-heading font-[340] tracking-[-0.02em] text-navy-950">
              Every Rotary story starts the same way — with{" "}
              <em className="accent-serif text-accent-gold">one hello</em> at a local
              club.
            </p>
            <p className="microlabel mt-8">
              Zones 4, 5, 6, 7 &amp; 8 — India, Sri Lanka, Nepal, Maldives &amp; Bhutan
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
