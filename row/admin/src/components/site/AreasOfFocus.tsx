import Link from "next/link";
import {
  BookOpen,
  Coins,
  ShieldPlus,
  Leaf,
  Baby,
  Bird,
  Droplet,
  ArrowUpRight,
  type LucideIcon,
} from "@/components/icons";

type Area = { label: string; desc: string; Icon: LucideIcon; color: string; rgb: string };

/** The seven official areas of focus — official colours are brand-mandated, byte-exact. */
export const AREAS: Area[] = [
  {
    label: "Basic Education & Literacy",
    desc: "Strengthening schools and adult literacy across our region.",
    Icon: BookOpen,
    color: "#FF7600",
    rgb: "255, 118, 0",
  },
  {
    label: "Community Economic Development",
    desc: "Creating opportunities for local, sustainable livelihoods.",
    Icon: Coins,
    color: "#F0A80C",
    rgb: "240, 168, 12",
  },
  {
    label: "Disease Prevention & Treatment",
    desc: "Fighting disease and improving access to healthcare.",
    Icon: ShieldPlus,
    color: "#E02927",
    rgb: "224, 41, 39",
  },
  {
    label: "Environment",
    desc: "Protecting ecosystems and building climate resilience.",
    Icon: Leaf,
    color: "#009739",
    rgb: "0, 151, 57",
  },
  {
    label: "Maternal & Child Health",
    desc: "Better care for mothers, infants, and growing children.",
    Icon: Baby,
    color: "#D41E8B",
    rgb: "212, 30, 139",
  },
  {
    label: "Peacebuilding & Conflict Prevention",
    desc: "Fostering understanding and lasting peace in communities.",
    Icon: Bird,
    color: "#901F93",
    rgb: "144, 31, 147",
  },
  {
    label: "Water, Sanitation & Hygiene",
    desc: "Clean water and sanitation for healthier communities.",
    Icon: Droplet,
    color: "#00A2E0",
    rgb: "0, 162, 224",
  },
];

/**
 * Seven cause cards in a centered 4+3 arrangement (flex-wrap keeps the last
 * row centered — no orphans). Each card: 3px left rule + 10% tint of its
 * official hex, visible at rest; deep-links the projects hub pre-filtered
 * to its cause.
 */
export function AreasOfFocus() {
  return (
    <section className="section-glow py-24 lg:py-32">
      <div className="container-rotary relative">
        {/* Section header */}
        <div className="mb-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span data-animate="rule" className="rule-gold" />
            <p data-animate="up" className="eyebrow mt-4">
              What We Champion
            </p>
            <h2
              data-animate="up"
              data-animate-delay="0.08"
              className="mt-5 font-display text-display-2 font-[450] tracking-[-0.02em] text-navy-950"
            >
              Seven causes. <em className="accent-serif text-accent-gold">One purpose.</em>
            </h2>
          </div>
          <p
            data-animate="up"
            data-animate-delay="0.16"
            className="max-w-md text-[15px] leading-relaxed text-muted"
          >
            The causes ROW champion to create lasting change , 
            locally and around the world.
          </p>
        </div>

        {/* Cards — 4 + 3, centered */}
        <div data-animate-stagger="up" className="flex flex-wrap justify-center gap-4">
          {AREAS.map((a) => (
            <Link
              key={a.label}
              href={`/projects?area=${encodeURIComponent(a.label)}`}
              data-animate="up"
              className="group flex w-full flex-col overflow-hidden rounded-2xl p-6 shadow-soft ring-1 ring-navy-950/[0.08] transition-shadow duration-300 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)]"
              style={{ borderLeft: `3px solid ${a.color}`, backgroundColor: `${a.color}1A` }}
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/70 ring-1 ring-navy-950/[0.06]"
                aria-hidden
              >
                <a.Icon className="h-[22px] w-[22px]" style={{ color: a.color }} strokeWidth={2} />
              </span>
              <h3 className="mt-5 font-display text-lg font-[560] leading-snug tracking-[-0.01em] text-navy-950">
                {a.label}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/70">{a.desc}</p>
              <div className="mt-auto border-t border-navy-950/10 pt-4">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-navy-900">
                  View projects
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
