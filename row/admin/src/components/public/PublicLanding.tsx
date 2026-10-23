"use client";

/**
 * Public marketing landing page rendered at "/" for UNAUTHENTICATED visitors
 * (including Cashfree's whitelisting reviewer).
 *
 * Authenticated users get the existing role-based experience handled in
 * app/page.tsx — this component never renders for them.
 *
 * Sections (in order) — every one of these maps to something Cashfree's
 * domain-whitelisting modal explicitly requires:
 *   1. Hero                — clear merchant identity
 *   2. About / Trust       — what the platform is and who it serves
 *   3. Services (#services)— PRODUCTS / SERVICES LISTED (required)
 *   4. Pricing (#pricing)  — PRICING IN INR (required)
 *   5. Features            — capability proof
 *   6. Compliance          — payment security + statutory disclosures
 *   7. Call-to-action      — Sign In
 *
 * Plus a sticky header (with policy links one tap away) and a footer that
 * carries the four policy links Cashfree wants visible: Contact Us, Terms &
 * Conditions, Refunds & Cancellations, Privacy Policy.
 */

import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ShieldCheck,
  Users,
  Building2,
  Calendar,
  IndianRupee,
  BarChart3,
  Award,
  HandHeart,
  CheckCircle2,
  Lock,
  CreditCard,
  LineChart,
  Globe,
  FileCheck,
  HeartHandshake,
} from "@/components/icons";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

const BRAND_NAVY = "#17458f";
const BRAND_GOLD = "#F7A81B";

// ─────────────────────────────────────────────────────────────────────────
// Services (Cashfree requires the homepage to list products/services).
// Edit the descriptions if any service is added/removed in production.
// ─────────────────────────────────────────────────────────────────────────
const SERVICES: {
  icon: typeof IndianRupee;
  title: string;
  description: string;
  accent: "navy" | "gold" | "blue" | "green" | "purple";
}[] = [
  {
    icon: IndianRupee,
    title: "Club Dues Collection",
    description:
      "Collect annual Rotary Club Dues from members securely. Each club sets its own dues amount in INR; members pay through the integrated Cashfree gateway with instant receipt.",
    accent: "gold",
  },
  {
    icon: Calendar,
    title: "Event Registration & Payments",
    description:
      "Publish club, district, and zone-level events. Members register and pay registration fees online in INR. Organisers track headcount and payments in real time.",
    accent: "blue",
  },
  {
    icon: HeartHandshake,
    title: "Project & Foundation Contributions",
    description:
      "Accept voluntary contributions toward club service projects, district initiatives, and The Rotary Foundation. Donors choose any INR amount; receipts are auto-generated.",
    accent: "purple",
  },
  {
    icon: Users,
    title: "Member & Club Administration",
    description:
      "Centralised directory, board-of-directors records, project documentation, communications, and statutory reports across every club, district, and zone in the network.",
    accent: "navy",
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    description:
      "Dashboards for club admins, assistant governors and district admins. Membership trends, project impact, fund flows: all derived from live data.",
    accent: "green",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Pricing tiers — Cashfree requires explicit INR pricing on the homepage.
// Values shown are representative ranges; actual amounts are configured per
// club / per event / per donor in the admin portal.
// ─────────────────────────────────────────────────────────────────────────
const PRICING: {
  service: string;
  range: string;
  unit: string;
  description: string;
}[] = [
  {
    service: "Annual Club Dues",
    range: "Set by the club",
    unit: "per member · per Rotary year",
    description: "Set independently by each Rotary club. Includes RI dues, district dues, and club dues.",
  },
  {
    service: "Event Registration",
    range: "Set by the organiser",
    unit: "per registration",
    description: "Varies by event (club fellowship, district conference, training, fundraiser). Set by the organiser.",
  },
  {
    service: "Project Contribution",
    range: "Any amount",
    unit: "per contribution",
    description: "Voluntary contribution to a service project. No upper cap.",
  },
  {
    service: "Foundation Contribution",
    range: "Any amount",
    unit: "per contribution",
    description: "Voluntary contribution to The Rotary Foundation. No upper cap.",
  },
  {
    service: "Platform Fee",
    range: "Shown at checkout",
    unit: "per transaction",
    description: "Any platform fee and the payment provider's charges are shown before you pay.",
  },
];

const FEATURES = [
  { icon: Globe, title: "Multi-Zone, Multi-District", body: "One unified portal serving every Rotary club across the zones." },
  { icon: Users, title: "Role-Based Access", body: "Club Admins, Assistant Governors, District Admins | each sees what they need." },
  { icon: ShieldCheck, title: "Secure by Default", body: "JWT-secured sessions, HTTPS only, encrypted at rest, regular backups." },
  { icon: FileCheck, title: "Statutory Reports", body: "Auto-generated reports aligned with Rotary International and Indian regulatory requirements." },
  { icon: LineChart, title: "Live Dashboards", body: "Membership, projects, events, and fund flows visualised in real time." },
  { icon: CreditCard, title: "Cashfree-Powered Payments", body: "PCI-DSS compliant payment processing in INR. UPI, cards, net banking, wallets." },
];

const accentClass = (a: (typeof SERVICES)[number]["accent"]) => {
  switch (a) {
    case "gold":   return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
    case "blue":   return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    case "green":  return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
    case "purple": return { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" };
    case "navy":   return { bg: "bg-slate-100", text: "text-slate-800", border: "border-slate-200" };
  }
};

export default function PublicLanding() {
  return (
    // Escape the global layout's px-8 py-4 wrapper so hero / footer can go full-bleed.
    <div className="-mx-8 -my-4 bg-white">
      <PublicHeader />

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="hero-title"
        className="relative overflow-hidden"
        style={{
          background: BRAND_NAVY,
        }}
      >
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div className="text-white">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full" style={{ background: "rgba(247,168,27,0.2)", color: BRAND_GOLD, border: "1px solid rgba(247,168,27,0.5)" }}>
                <Award size={11} /> Official Administration Portal
              </span>
              <h1 id="hero-title" className="mt-4 text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
                Rotary Zones <span style={{ color: BRAND_GOLD }}>4 · 5 · 6 · 7 · 8</span>
                <span className="block text-2xl sm:text-3xl lg:text-4xl font-semibold text-slate-200 mt-2">India</span>
              </h1>
              <p className="mt-5 text-base sm:text-lg text-slate-200 leading-relaxed max-w-xl">
                The integrated administration platform for Rotary clubs across
                Western, Northern, Central and Southern India. Membership,
                projects, events, foundation contributions: managed in one
                place with secure INR payments through Cashfree.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="#services"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-md text-sm font-semibold shadow-lg hover:opacity-90 transition"
                  style={{ background: BRAND_GOLD, color: BRAND_NAVY }}
                >
                  Explore Our Services <ArrowRight size={16} />
                </a>
                <a
                  href="#pricing"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-md text-sm font-semibold border-2 hover:bg-white/10 transition"
                  style={{ borderColor: "rgba(255,255,255,0.4)", color: "white" }}
                >
                  View Pricing
                </a>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-slate-300">
                <div className="flex items-center gap-1.5"><Lock size={12} /> SSL Secured</div>
                <div className="flex items-center gap-1.5"><ShieldCheck size={12} /> Cashfree Payments</div>
                <div className="flex items-center gap-1.5"><IndianRupee size={12} /> INR Only</div>
                <div className="flex items-center gap-1.5"><CheckCircle2 size={12} /> PCI-DSS Compliant</div>
              </div>
            </div>

            <div className="hidden lg:flex items-center justify-center">
              <div className="relative">
                <Image
                  src="/brand/row-logo-inverse.png"
                  alt="ROW emblem"
                  width={420}
                  height={420}
                  className="relative z-10 object-contain"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ABOUT / TRUST STRIP ─────────────────────────────────────── */}
      <section aria-labelledby="about-title" className="py-16 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 id="about-title" className="text-3xl font-bold tracking-tight" style={{ color: BRAND_NAVY }}>
              About the Platform
            </h2>
            <p className="mt-3 text-base text-slate-600 max-w-2xl mx-auto">
              ROW span the majority of Indian Rotary
              districts. This portal is the canonical digital infrastructure
              for clubs, members, and the Multi-District Initiative.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Award, title: "Who We Are", body: "An initiative by the Multi-District team representing Rotary clubs across the zones in India | operated for the benefit of clubs and their members." },
              { icon: HandHeart, title: "What We Do", body: "Provide secure digital tools for member management, event administration, project documentation, and online collection of dues, fees, and contributions in INR." },
              { icon: Building2, title: "Who We Serve", body: "Rotary club Presidents, Secretaries, Treasurers, Directors, Members; District Governors, Assistant Governors, District Admins; Rotary International Directors." },
            ].map((b) => (
              <div key={b.title} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <div className="h-11 w-11 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(247,168,27,0.12)", color: BRAND_GOLD }}>
                  <b.icon size={20} />
                </div>
                <h3 className="text-lg font-semibold text-slate-800">{b.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SERVICES (CASHFREE REQUIRED) ────────────────────────────── */}
      <section id="services" aria-labelledby="services-title" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: BRAND_GOLD }}>
              What We Offer
            </span>
            <h2 id="services-title" className="mt-2 text-3xl font-bold tracking-tight" style={{ color: BRAND_NAVY }}>
              Services Available on This Platform
            </h2>
            <p className="mt-3 text-base text-slate-600 max-w-2xl mx-auto">
              Every service below is fulfilled digitally and paid for in Indian
              Rupees (INR) through the secure Cashfree payment gateway.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {SERVICES.map((s) => {
              const a = accentClass(s.accent);
              const Icon = s.icon;
              return (
                <article key={s.title} className={`bg-white border ${a.border} rounded-xl p-6 hover:shadow-md transition-shadow`}>
                  <div className={`h-12 w-12 rounded-lg flex items-center justify-center mb-4 ${a.bg} ${a.text}`}>
                    <Icon size={22} />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800">{s.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{s.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PRICING (CASHFREE REQUIRED — INR) ───────────────────────── */}
      <section id="pricing" aria-labelledby="pricing-title" className="py-16 bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: BRAND_GOLD }}>
              Transparent Pricing
            </span>
            <h2 id="pricing-title" className="mt-2 text-3xl font-bold tracking-tight" style={{ color: BRAND_NAVY }}>
              Pricing in Indian Rupees (INR)
            </h2>
            <p className="mt-3 text-base text-slate-600 max-w-2xl mx-auto">
              All amounts charged through this platform are denominated in
              Indian Rupees. Specific amounts are configured by each Rotary
              club, event organiser, or donor and are shown clearly before
              every payment.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="hidden md:grid grid-cols-12 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <div className="col-span-4">Service</div>
              <div className="col-span-3">Amount (INR)</div>
              <div className="col-span-5">Notes</div>
            </div>
            <ul className="divide-y divide-slate-100">
              {PRICING.map((p) => (
                <li key={p.service} className="grid grid-cols-1 md:grid-cols-12 px-6 py-4 gap-2 md:gap-4 hover:bg-slate-50/60">
                  <div className="md:col-span-4">
                    <p className="font-semibold text-slate-800">{p.service}</p>
                  </div>
                  <div className="md:col-span-3">
                    <p className="font-bold tabular-nums" style={{ color: BRAND_NAVY }}>{p.range}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{p.unit}</p>
                  </div>
                  <div className="md:col-span-5">
                    <p className="text-sm text-slate-600">{p.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-6 text-xs text-slate-500 text-center max-w-2xl mx-auto leading-relaxed">
            Final amount, applicable taxes (if any), Cashfree processing fees,
            and the recipient (club / district / project / Foundation) are
            disclosed on every payment screen before the user authorises the
            transaction. Receipts are sent to the registered email.
          </p>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section aria-labelledby="features-title" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 id="features-title" className="text-3xl font-bold tracking-tight" style={{ color: BRAND_NAVY }}>
              Platform Capabilities
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-4 p-5 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(30,58,95,0.08)", color: BRAND_NAVY }}>
                  <f.icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{f.title}</h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPLIANCE ──────────────────────────────────────────────── */}
      <section aria-labelledby="compliance-title" className="py-14 bg-slate-50 border-y border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 id="compliance-title" className="text-2xl font-bold tracking-tight" style={{ color: BRAND_NAVY }}>
            Security, Compliance &amp; Trust
          </h2>
          <p className="mt-3 text-sm text-slate-600 max-w-2xl mx-auto">
            All payments on this platform are processed by{" "}
            <strong>Cashfree Payments India Pvt. Ltd.</strong>, a Reserve Bank
            of India authorised Payment Aggregator (CA No. 51/2022). The
            platform is operated in accordance with the Information Technology
            Act 2000, the Information Technology (Intermediary Guidelines and
            Digital Media Ethics Code) Rules 2021, the Consumer Protection
            Act 2019 and the Digital Personal Data Protection Act 2023.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700">
              <Lock size={13} /> SSL / TLS
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700">
              <ShieldCheck size={13} /> PCI-DSS via Cashfree
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700">
              <IndianRupee size={13} /> INR Only
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700">
              <FileCheck size={13} /> IT Act 2000 / IT Rules 2021
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-slate-300 text-slate-700">
              <CheckCircle2 size={13} /> DPDPA 2023
            </span>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="cta-title" className="py-16" style={{ background: BRAND_NAVY }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
          <h2 id="cta-title" className="text-2xl sm:text-3xl font-bold tracking-tight">
            Have a question?
          </h2>
          <p className="mt-3 text-base text-slate-300">
            Reach our team for any administrative, payment, or refund query.
            Replies typically within two (2) business days.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/contact-us"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-md text-sm font-semibold shadow-lg hover:opacity-90 transition"
              style={{ background: BRAND_GOLD, color: BRAND_NAVY }}
            >
              Contact Us <ArrowRight size={16} />
            </Link>
            <Link
              href="/about-us"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-md text-sm font-semibold border-2 hover:bg-white/10 transition"
              style={{ borderColor: "rgba(255,255,255,0.35)", color: "white" }}
            >
              About the Platform
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
