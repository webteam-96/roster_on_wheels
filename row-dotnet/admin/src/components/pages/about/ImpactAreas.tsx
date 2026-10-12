import Link from "next/link";
import { ArrowRight, BookOpen, HeartPulse, Droplets, Leaf, type LucideIcon } from "lucide-react";

type Area = {
  Icon: LucideIcon;
  label: string;
  /** Official cause this area maps to — exact title + byte-exact brand hex. */
  cause: string;
  color: string;
};

// Exactly the four areas named in the live copy, each mapped to its official
// Rotary cause (title + brand-mandated hex from the home AREAS array).
const AREAS: Area[] = [
  { Icon: BookOpen, label: "Education", cause: "Basic Education & Literacy", color: "#FF7600" },
  { Icon: HeartPulse, label: "Healthcare", cause: "Disease Prevention & Treatment", color: "#E02927" },
  { Icon: Droplets, label: "Sanitation", cause: "Water, Sanitation & Hygiene", color: "#00A2E0" },
  { Icon: Leaf, label: "Environmental Sustainability", cause: "Environment", color: "#009739" },
];

/**
 * What we do — the live About page's third paragraph, verbatim, with the four
 * named areas as cause cards: 3px left rule + permanent 10% tint in the
 * official cause hex, deep-linking into the pre-filtered projects hub.
 */
export function ImpactAreas() {
  return (
    <section className="bg-paper py-24 lg:py-32">
      <div className="container-rotary grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
        {/* Left — copy */}
        <div className="lg:col-span-6">
          <div data-animate="rule" className="rule-gold" aria-hidden />
          <p className="eyebrow mt-3.5" data-animate="up" data-animate-duration="0.7">
            What We Do
          </p>
          <p
            className="mt-7 text-[15px] leading-relaxed text-ink/75 sm:text-base"
            data-animate="up"
            data-animate-duration="0.7"
          >
            Dedicated to addressing the unique challenges faced by communities across
            these countries, Rotary Clubs actively contribute to projects in areas such
            as education, healthcare, sanitation, and environmental sustainability.
            Through impactful initiatives, we strive to uplift the underprivileged,
            empower youth, and create sustainable solutions that resonate with the
            diverse needs of our society.
          </p>
          <div className="mt-9" data-animate="up" data-animate-duration="0.7">
            <Link href="/projects" className="btn-primary shine group">
              Explore Our Projects
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>

        {/* Right — the four named areas as cause cards */}
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-6"
          data-animate-stagger="up"
        >
          {AREAS.map(({ Icon, label, cause, color }) => (
            <Link
              key={label}
              href={`/projects?area=${encodeURIComponent(cause)}`}
              data-animate="up"
              style={{ borderLeftColor: color, backgroundColor: `${color}1A` }}
              className="flex flex-col rounded-r-xl border-l-[3px] p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
            >
              <Icon className="h-6 w-6" style={{ color }} strokeWidth={1.75} aria-hidden />
              <h3 className="mt-5 font-display text-lg font-[560] tracking-tight text-navy-950">
                {label}
              </h3>
              <p className="mt-1.5 text-[12px] font-medium text-ink/60">{cause}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
