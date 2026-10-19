import Link from "next/link";
import { Globe, Building2, ArrowUpRight, type LucideIcon } from "@/components/icons";

type Directory = { label: string; desc: string; href: string; Icon: LucideIcon; cta: string };

/** Two web destinations lifted out of the zones nav dropdown onto the home page. */
const DIRECTORIES: Directory[] = [
  {
    label: "International & National Websites",
    desc: "Rotary International, My Rotary, The Rotary Foundation, ROW and Rotary News: every official platform, gathered in one place.",
    href: "/international-national",
    Icon: Globe,
    cta: "Explore the platforms",
  },
  {
    label: "District & Club Websites",
    desc: "Find any District or Club website across the zones: search by district, state or city.",
    href: "/websites",
    Icon: Building2,
    cta: "Browse the directory",
  },
];

/**
 * Home "Explore the Rotary web" — two access cards for the International/
 * National platforms directory and the District & Club site finder, moved
 * here from the zones nav dropdown to surface them more prominently.
 */
export function WebDirectories() {
  return (
    <section className="bg-paper pb-24 pt-10 lg:pb-32 lg:pt-14">
      <div className="container-rotary">
        <div className="mb-12 max-w-2xl">
          <span data-animate="rule" className="rule-gold" />
          <p data-animate="up" className="eyebrow mt-4">
            Find Your Way In
          </p>
          <h2
            data-animate="up"
            data-animate-delay="0.08"
            className="mt-5 font-display text-display-2 font-[450] tracking-[-0.02em] text-navy-950"
          >
            Explore the <em className="accent-serif text-accent-gold">Rotary web</em>
          </h2>
        </div>

        <div data-animate-stagger="up" className="grid gap-4 md:grid-cols-2 md:gap-6">
          {DIRECTORIES.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              data-animate="up"
              className="group flex flex-col rounded-2xl bg-white p-7 shadow-soft ring-1 ring-navy-950/[0.08] transition-shadow duration-300 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark sm:p-9"
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 ring-1 ring-gold/30"
                aria-hidden
              >
                <d.Icon className="h-6 w-6 text-gold-deep" strokeWidth={1.75} />
              </span>
              <h3 className="mt-6 font-display text-xl font-[560] leading-snug tracking-[-0.01em] text-navy-950 sm:text-2xl">
                {d.label}
              </h3>
              <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">{d.desc}</p>
              <div className="mt-8 border-t border-navy-950/10 pt-4">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold-deep">
                  {d.cta}
                  <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
